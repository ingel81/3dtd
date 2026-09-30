import { DestroyRef, ElementRef, Injectable, Injector, NgZone, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { Quaternion, Vector3 } from 'three';
import { GameClock } from '../managers/game-state/game-clock';
import { GameStore } from '../store/game.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { REPLAY_CONFIG } from '../configs/replay.config';
import type { ReplayMarker } from '../replay/replay-bar-view';
import { replayFileName, replayFileRefusalText, type ReplayFile, type ReplayFileRefusal } from '../simulator/replay-file';
import { balanceConfigHash } from '../run-log/config-hash';
import { buildCommit } from '../run-log/build-commit';
import { BUILD_VERSION } from '../configs/build-info.config';
import { WaveDirector } from '../director/wave-director';
import { LocationManagementService } from './location/location-management.service';
import type { ThreeTilesEngine } from '../three-engine';
import { cameraTimeline } from '../utils/camera-timeline';
import { cycleTab, focusedElement } from '../utils/focus-cycle';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { CameraControlService } from './camera-control.service';
import { PhotoModeService } from './photo-mode.service';
import { HeroControlService } from './hero-control.service';
import { BossIntroService } from './boss-intro.service';
import { SimClient } from '../sim/client/sim-client.service';
import { TowerSelectionService } from './tower-selection.service';
import type { ReplayEntered } from '../sim/protocol/messages';

/** Wall-clock ms between two updates of the replay bar while it plays */
const BAR_REFRESH_MS = 50;

/**
 * How long a click on replay waits for the field to be quiet (the last
 * shots of the wave still flying), wall-clock ms: the snapshot of the live
 * game needs it (SimScalars.snapshotRefusal).
 */
const QUIET_WAIT_MS = 5000;

/** Where the camera was when the replay started */
interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  up: Vector3;
}

/**
 * Replay of a wave of the run (docs/REPLAY.md): the HUD goes, the live game
 * pauses, the simulation re-simulates the wave in its worker and shows it
 * through the same packets as the live game (docs/SIM_WORKER.md), the camera
 * stays free. Every wave of the run can be chosen (decision D4 of
 * docs/SIMULATOR_PLAN.md). The replay bar drives it; leaving puts the live
 * game, camera, pause, open menu and focus back as they were.
 *
 * Provided by the game component like PhotoModeService. The game loop hands
 * it every frame (update(), GameLoopFacadeService). Space and P pause, + and
 * - change the speed, Esc leaves (HotkeyService).
 */
@Injectable()
export class ReplayService {
  private readonly uiStore = inject(UIStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly gameStore = inject(GameStore);
  private readonly sim = inject(SimClient);
  private readonly selection = inject(TowerSelectionService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly photoMode = inject(PhotoModeService);
  private readonly heroControl = inject(HeroControlService);
  private readonly bossIntro = inject(BossIntroService);
  private readonly ngZone = inject(NgZone);
  private readonly injector = inject(Injector);
  /** The game component's element, whose template holds the replay bar */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly waveDirector = inject(WaveDirector);
  private readonly locations = inject(LocationManagementService);

  readonly active = this.uiStore.replayMode;
  /** The newest wave a replay can show, null while there is none (SimScalars.replayableWaves) */
  readonly recordedWave = signal<number | null>(null);
  /** A replay can start: a wave can be shown and the next one has not begun, or the game is over */
  readonly available = computed(() => {
    if (this.recordedWave() === null || this.store.loading() || this.store.error()) return false;
    // Coop: a replay re-simulates here only (docs/COOP_PLAN.md, R4)
    if (this.uiStore.coopMapLocked()) return false;
    const phase = this.store.phase();
    return phase === 'setup' || phase === 'gameover';
  });
  /** A replay can start and the player is offered it (REPLAY_CONFIG.offered): its buttons show */
  readonly offered = computed(() => REPLAY_CONFIG.offered && this.available());

  // What the replay bar shows, see syncBar()
  readonly wave = signal(0);
  readonly timeMs = signal(0);
  readonly durationMs = signal(0);
  readonly playing = signal(false);
  readonly speed = signal(1);
  readonly baseHealth = signal(0);
  readonly enemiesAlive = signal(0);
  readonly markers = signal<readonly ReplayMarker[]>([]);
  readonly speeds = REPLAY_CONFIG.speeds;
  /** The waves the bar can switch to, oldest first */
  readonly waves = signal<readonly number[]>([]);
  /**
   * Game time into the wave where the re-simulation stopped matching the
   * live run (a determinism bug), null while it matches
   */
  readonly divergedAtMs = signal<number | null>(null);
  /** A jump running: how far it got, 0 to 100 (the simulation runs it in slices of 60 ms), null while none runs */
  readonly seekPercent = signal<number | null>(null);
  /** The replay shows a loaded file, not the run under way */
  readonly fromFile = signal(false);
  /** Why the last file did not load, shown next to the load button; null when it did */
  readonly fileProblem = signal<string | null>(null);
  /** A loaded file of another game version: shown in the bar, the replay may differ */
  readonly fileNote = signal<string | null>(null);

  /** The wave the simulation re-simulates, null outside a replay (or while it is being entered) */
  private entered: ReplayEntered | null = null;
  /** A loaded replay file's waves are shown instead of the run's (rpc loadReplayFile) */
  private file = false;
  /** An rpc of enter or switch is on its way */
  private busy = false;
  /** A click on replay that waits for a quiet field, see QUIET_WAIT_MS */
  private pending: { wave: number; since: number } | null = null;
  private camera: CameraPose | null = null;
  private pausedBefore = false;
  private focusBefore: HTMLElement | null = null;
  private menuBefore: ReturnType<UIStore['openMenu']> = null;
  private lastBarSync = 0;
  /** The replay played when a drag on the progress bar began */
  private resumeAfterScrub = false;

  constructor() {
    // The waves the simulation can re-simulate, from every packet. The
    // client is the app's, this service the game component's: let go with it
    const offFrame = this.sim.onFrame((packet) => {
      const waves = packet.scalars.replayableWaves;
      const newest = waves.length > 0 ? waves[waves.length - 1] : null;
      if (newest !== this.recordedWave()) this.ngZone.run(() => this.recordedWave.set(newest));
    });
    inject(DestroyRef).onDestroy(offFrame);
    // The waves went (restart, a new place): nothing left to show
    effect(() => {
      if (this.recordedWave() === null && !this.file) untracked(() => this.exit());
    });
  }

  /** The renderers' clock while the replay is on: its speed, 0 in its pause; null outside a replay. */
  timescale(): number | null {
    const replay = this.sim.replay;
    if (!replay) return null;
    return replay.playing ? replay.speed : 0;
  }

  /**
   * Replay `wave`, the newest by default. No replay while a boss intro holds
   * the camera (it pauses the game and puts the camera back itself); during
   * the replay no intro starts, it listens with onLive. The live game has to
   * be quiet for its snapshot: a click right after a wave waits for the last
   * shots to land (QUIET_WAIT_MS).
   */
  enter(wave: number | null = this.recordedWave()): void {
    if (this.active() || !this.available() || this.bossIntro.active() || wave === null) return;
    if (this.sim.scalars.snapshotRefusal !== null) {
      this.pending = { wave, since: performance.now() };
      return;
    }
    void this.begin(wave);
  }

  /** Hide the game UI, keep camera and pause, and play `wave`. The gates are the caller's. */
  private async begin(wave: number): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine || this.busy) return;
    // Out of a manned tower first (camera and pointer lock of the tower view):
    // the command goes with the tick before the replay starts
    if (this.gameStore.mannedTowerId()) this.sim.bus.emit({ type: 'command:leave-tower' });

    if (this.photoMode.active()) this.photoMode.exit();
    this.focusBefore = focusedElement();
    this.menuBefore = this.uiStore.openMenu();
    // Nothing of the game UI in the replay: build preview, placement
    // markers, an ability's reticle, the selected tower's range and LOS,
    // the veteran badges
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.heroControl.deselect();
    this.selection.select(null);
    this.uiStore.openMenu.set(null);
    this.cameraControl.cancelJump();
    engine.towerBadges.setVisible(false);

    this.camera = saveCamera(engine);
    this.pausedBefore = this.gameStore.paused();
    this.gameStore.paused.set(true);

    if (!(await this.open(wave))) {
      this.restoreLive(engine);
      return;
    }
    this.active.set(true);
    this.syncBar();
    this.announcer.announce(`Replay of wave ${wave}. Space pauses, Esc leaves it.`);
    // Space pauses from anywhere; the focus waits on play and pause all the same
    this.afterLayout(() => this.host.nativeElement.querySelector<HTMLElement>('.td-replay-play')?.focus());
  }

  exit(): void {
    this.pending = null;
    if (!this.active()) return;
    const engine = this.engineInit.getEngine();
    // The live game back as it was: the simulation restores it in replay
    // mode, so the live listeners hear nothing of the way back
    if (this.entered) void this.sim.rpc('replayExit');
    this.entered = null;
    this.sim.replay = null;
    this.file = false;
    this.fromFile.set(false);
    this.fileNote.set(null);
    this.restoreLive(engine);
    this.active.set(false);
    const focus = this.focusBefore;
    this.focusBefore = null;
    this.announcer.announce('Replay left.');
    this.afterLayout(() => {
      if (focus?.isConnected) focus.focus();
    });
  }

  /** Camera, badges, pause and menu as the replay found them. */
  private restoreLive(engine: ThreeTilesEngine | null): void {
    this.cameraControl.cancelJump();
    if (engine && this.camera) restoreCamera(engine, this.camera);
    this.camera = null;
    engine?.towerBadges.setVisible(true);
    this.gameStore.paused.set(this.pausedBefore);
    this.uiStore.openMenu.set(this.menuBefore);
  }

  /** Switch the running replay to the next (1) or the previous (-1) wave the bar offers. */
  async switchWave(step: 1 | -1): Promise<void> {
    const entered = this.entered;
    if (!entered || this.busy) return;
    const waves = this.waves();
    const next = waves[waves.indexOf(entered.wave) + step];
    if (next === undefined) return;
    // The simulation switches in replay mode (SimReplay.switchTo) and keeps
    // a loaded file; replayExit would drop it and go back to the run's waves
    if (!(await this.open(next))) {
      this.exit();
      return;
    }
    this.syncBar();
    this.announcer.announce(`Replay of wave ${next}.`);
  }

  togglePlay(): void {
    const replay = this.sim.replay;
    if (!replay) return;
    // At the wave's end play starts it over
    if (!replay.playing && this.sim.scalars.replay?.finished) this.seek(0);
    replay.playing = !replay.playing;
    this.syncBar();
  }

  setSpeed(speed: number): void {
    this.speed.set(speed);
    if (this.sim.replay) this.sim.replay.speed = speed;
    this.syncBar();
  }

  /** One step along REPLAY_CONFIG.speeds, held at the ends (+ and -). */
  stepSpeed(step: 1 | -1): void {
    const speeds = this.speeds;
    const at = speeds.indexOf(this.speed());
    const next = speeds[Math.max(0, Math.min(speeds.length - 1, (at < 0 ? speeds.indexOf(1) : at) + step))];
    this.setSpeed(next);
  }

  /**
   * Jump to `ms` into the wave: the simulation runs there without the show
   * (the sounds and effects of the stretch skipped are left out) and says so
   * with `sim:restored`, on which the presentation clears and sets up what
   * stands there now.
   */
  seek(ms: number): void {
    if (!this.entered) return;
    this.timeMs.set(Math.max(0, ms));
    void this.sim.rpc('replaySeek', Math.max(0, Math.round(ms / GameClock.FIXED_STEP_MS)));
  }

  /**
   * Pointer down on the progress bar: a playing replay holds still while
   * the thumb is dragged, otherwise playback and the drag pull the thumb
   * both ways. endScrub() on release plays on, unless the drag ended at
   * the very end. Release is pointerup or pointercancel: a press that does
   * not move the thumb fires no change. change comes from the keyboard,
   * and a second call does nothing.
   */
  beginScrub(): void {
    const replay = this.sim.replay;
    if (!replay?.playing) return;
    this.resumeAfterScrub = true;
    replay.playing = false;
    this.syncBar();
  }

  endScrub(): void {
    if (!this.resumeAfterScrub) return;
    this.resumeAfterScrub = false;
    const replay = this.sim.replay;
    if (replay && this.timeMs() < this.durationMs()) replay.playing = true;
    this.syncBar();
  }

  /**
   * Per rendered frame from the game loop, outside the Angular zone: start a
   * replay that waited for a quiet field, refresh the bar every
   * BAR_REFRESH_MS. The simulation plays the replay itself (SimClient.replay).
   */
  update(): void {
    const pending = this.pending;
    if (pending) {
      if (this.sim.scalars.snapshotRefusal === null) {
        this.pending = null;
        this.ngZone.run(() => this.enter(pending.wave));
      } else if (performance.now() - pending.since > QUIET_WAIT_MS) {
        this.pending = null;
        this.ngZone.run(() => this.announcer.announce('The replay cannot start while shots are still flying.'));
      }
    }
    const replay = this.sim.replay;
    if (!replay || !this.entered) return;
    // The wave's end holds the replay
    if (replay.playing && this.sim.scalars.replay?.finished) replay.playing = false;
    const now = performance.now();
    if (now - this.lastBarSync >= BAR_REFRESH_MS || replay.playing !== this.playing()) {
      this.lastBarSync = now;
      this.ngZone.run(() => this.syncBar());
    }
  }

  /** Window keydown while the replay is on: Tab stays in the bar, see cycleTab. */
  trapTab(event: KeyboardEvent): void {
    if (!this.active()) return;
    cycleTab(event, this.barControls());
  }

  /**
   * The replayable waves of the run under way (or of the loaded file) as a
   * file (decision D4), for a download. False when there is nothing to save
   * or no DOM to hang the link on.
   */
  async saveFile(doc: Document | undefined = globalThis.document): Promise<boolean> {
    const file = await this.sim.rpc('replayFile', {
      configHash: this.configHash(),
      gameVersion: BUILD_VERSION,
      commit: buildCommit(),
    });
    if (!doc || !file || file.waves.length === 0) return false;
    const blob = new Blob([file.text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    const named = { waves: file.waves.map((wave) => ({ wave })) } as Pick<ReplayFile, 'waves'> as ReplayFile;
    link.download = replayFileName(named, this.locations.editableHqLocation()?.name ?? 'map');
    link.click();
    URL.revokeObjectURL(url);
    this.announcer.announce(`Replay of ${file.waves.length} waves saved.`);
    return true;
  }

  /**
   * Load a replay file and play its first wave. Only on the world and with
   * the balance it was played with, between waves or after game over;
   * otherwise fileProblem says why.
   */
  async loadFile(blob: Blob): Promise<void> {
    const text = await blob.text();
    const phase = this.store.phase();
    if (this.active() || (phase !== 'setup' && phase !== 'gameover')) {
      this.ngZone.run(() => this.fileProblem.set('A replay loads between waves.'));
      return;
    }
    if (this.uiStore.coopMapLocked()) {
      this.ngZone.run(() => this.fileProblem.set('Replays are off in a coop game.'));
      return;
    }
    const read = await this.sim.rpc('loadReplayFile', text, { configHash: this.configHash(), gameVersion: BUILD_VERSION });
    await this.ngZone.run(async () => {
      if (read.refusal) {
        const why = replayFileRefusalText(read.refusal as ReplayFileRefusal);
        this.fileProblem.set(why);
        this.announcer.announce(why);
        return;
      }
      this.fileProblem.set(null);
      // Another version loads; the bar says it may differ
      this.fileNote.set(read.note);
      this.file = true;
      this.fromFile.set(true);
      await this.enterAny(read.waves[0]);
      if (!this.active()) {
        // Not entered (a gate, shots in the air, no replayable wave): the
        // simulation lets go of the file, or saving would write its waves
        // under this run's world and seed
        this.file = false;
        this.fromFile.set(false);
        this.fileNote.set(null);
        await this.sim.rpc('replayExit');
      }
    });
  }

  /** enter() without its gate on the run's own waves: a loaded file brings its own. */
  private async enterAny(wave: number): Promise<void> {
    if (this.bossIntro.active() || this.store.loading() || this.store.error() || this.uiStore.coopMapLocked()) return;
    const phase = this.store.phase();
    if (phase !== 'setup' && phase !== 'gameover') return;
    if (this.sim.scalars.snapshotRefusal !== null) {
      this.fileProblem.set('The replay cannot start while shots are still flying.');
      return;
    }
    await this.begin(wave);
  }

  private configHash(): string {
    return balanceConfigHash(this.waveDirector.source.id);
  }

  /** The simulation at `wave`'s start in replay mode, playing. False when it cannot re-simulate the wave. */
  private async open(wave: number): Promise<boolean> {
    this.busy = true;
    try {
      const entered = await this.sim.rpc('replayEnter', wave, this.file);
      if (!entered) return false;
      this.entered = entered;
      this.sim.replay = { playing: true, speed: this.speed() };
      this.waves.set(entered.waves);
      this.markers.set(entered.markers);
      return true;
    } finally {
      this.busy = false;
    }
  }

  private syncBar(): void {
    const entered = this.entered;
    const replay = this.sim.replay;
    if (!entered || !replay) return;
    const scalars = this.sim.scalars;
    const state = scalars.replay;
    this.wave.set(entered.wave);
    const seeking = state?.seeking ?? null;
    // While a jump runs the thumb stays on its target
    if (state) this.timeMs.set((seeking ? seeking.target : state.stepInWave) * GameClock.FIXED_STEP_MS);
    this.seekPercent.set(seeking === null ? null
      : Math.round((100 * Math.max(0, state!.stepInWave - seeking.from)) / Math.max(1, seeking.target - seeking.from)));
    this.durationMs.set((entered.lengthInSteps ?? 0) * GameClock.FIXED_STEP_MS);
    this.playing.set(replay.playing);
    this.speed.set(replay.speed);
    this.baseHealth.set(scalars.baseHealth);
    this.enemiesAlive.set(scalars.enemiesAlive);
    const diverged = state?.divergedAt ?? null;
    this.divergedAtMs.set(
      diverged === null ? null : Math.max(0, diverged - entered.startStep) * GameClock.FIXED_STEP_MS,
    );
  }

  /** The bar's controls that can take the focus, in tab order */
  private barControls(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      '.td-replay-bar button:not(:disabled), .td-replay-bar input',
    ));
  }

  /** `then` runs once the DOM has followed the HUD leaving or coming back. */
  private afterLayout(then: () => void): void {
    afterNextRender(then, { injector: this.injector });
  }
}

function saveCamera(engine: ThreeTilesEngine): CameraPose {
  const camera = engine.getCamera();
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
  };
}

/**
 * Put the camera back where the replay found it. Switching the controls off
 * drops their inertia and a drag under way; switched on again they take
 * their pivot from the camera.
 */
function restoreCamera(engine: ThreeTilesEngine, pose: CameraPose): void {
  const camera = engine.getCamera();
  const controls = engine.getControls();
  if (controls) controls.enabled = false;
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.up.copy(pose.up);
  camera.updateMatrixWorld();
  if (controls) controls.enabled = true;
  cameraTimeline.record('camera.replay.restore', {}, true);
}
