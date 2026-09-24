import { ElementRef, Injectable, Injector, NgZone, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { Quaternion, Vector3 } from 'three';
import { GameStateManager } from '../managers/game-state.manager';
import { GameClock } from '../managers/game-state/game-clock';
import { GameStore } from '../store/game.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { REPLAY_CONFIG } from '../configs/replay.config';
import { commandMarkers, type ReplayMarker } from '../replay/replay-bar-view';
import { ReplaySession } from '../simulator/replay-session';
import type { WaveRecord } from '../simulator/sim-recorder';
import type { CommandLogEntry } from '../managers/game-state/command-log';
import { buildReplayFile, readReplayFile, replayFileName, replayFileRefusalText } from '../simulator/replay-file';
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

/** Wall-clock ms between two updates of the replay bar while it plays */
const BAR_REFRESH_MS = 50;

/**
 * How long a click on replay waits for the field to be quiet (the last
 * shots of the wave still flying), wall-clock ms: the snapshot of the live
 * game needs it (GameStateManager.snapshotRefusal).
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
 * pauses, a ReplaySession re-simulates the wave with the real renderers,
 * the camera stays free. Every wave of the run can be chosen (decision D4
 * of docs/SIMULATOR_PLAN.md). The replay bar drives it; leaving puts the
 * live game, camera, pause, open menu and focus back as they were.
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
  private readonly gameState = inject(GameStateManager);
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
  /** The newest wave a replay can show, null while there is none */
  readonly recordedWave = this.gameState.simRecorder.latestReplayable;
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
  /** The replay shows a loaded file, not the run under way */
  readonly fromFile = signal(false);
  /** Why the last file did not load, shown next to the load button; null when it did */
  readonly fileProblem = signal<string | null>(null);
  /** A loaded file of another game version: shown in the bar, the replay may differ */
  readonly fileNote = signal<string | null>(null);

  private session: ReplaySession | null = null;
  /** The waves and log shown: a loaded replay file, else the run under way */
  private file: { waves: readonly WaveRecord[]; log: readonly CommandLogEntry[] } | null = null;
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
    // The waves went (restart, a new place): nothing left to show
    effect(() => {
      if (this.recordedWave() === null) untracked(() => this.exit());
    });
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
    if (this.gameState.snapshotRefusal() !== null) {
      this.pending = { wave, since: performance.now() };
      return;
    }
    this.begin(wave);
  }

  /** Hide the game UI, keep camera and pause, and play `wave`. The gates are the caller's. */
  private begin(wave: number): void {
    const engine = this.engineInit.getEngine();
    if (!engine || !this.recordOf(wave)) return;
    // Out of a manned tower first, while the live listeners still hear it
    // (camera and pointer lock of the tower view): in the replay they do not
    if (this.gameStore.mannedTowerId()) this.gameState.getEventBus().emit({ type: 'command:leave-tower' });

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
    this.gameState.towerManager.selectTower(null);
    this.uiStore.openMenu.set(null);
    this.cameraControl.cancelJump();
    engine.towerBadges.setVisible(false);

    this.camera = saveCamera(engine);
    this.pausedBefore = this.gameStore.paused();
    this.setPaused(true);

    this.open(engine, wave);
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
    // The live game back as it was, before the session leaves replay mode
    this.session?.exit();
    this.session = null;
    this.file = null;
    this.fromFile.set(false);
    this.fileNote.set(null);
    this.cameraControl.cancelJump();
    if (engine && this.camera) restoreCamera(engine, this.camera);
    this.camera = null;
    engine?.towerBadges.setVisible(true);
    this.setPaused(this.pausedBefore);
    this.uiStore.openMenu.set(this.menuBefore);
    this.active.set(false);
    const focus = this.focusBefore;
    this.focusBefore = null;
    this.announcer.announce('Replay left.');
    this.afterLayout(() => {
      if (focus?.isConnected) focus.focus();
    });
  }

  /** Switch the running replay to the next (1) or the previous (-1) wave the bar offers. */
  switchWave(step: 1 | -1): void {
    const session = this.session;
    const engine = this.engineInit.getEngine();
    if (!session || !engine) return;
    const waves = this.waves();
    const next = waves[waves.indexOf(session.wave) + step];
    if (next === undefined) return;
    session.exit();
    this.open(engine, next);
    this.syncBar();
    this.announcer.announce(`Replay of wave ${next}.`);
  }

  togglePlay(): void {
    this.session?.togglePlay();
    this.syncBar();
  }

  setSpeed(speed: number): void {
    this.speed.set(speed);
    this.session?.setSpeed(speed);
    this.syncBar();
  }

  /** One step along REPLAY_CONFIG.speeds, held at the ends (+ and -). */
  stepSpeed(step: 1 | -1): void {
    const speeds = this.speeds;
    const at = speeds.indexOf(this.speed());
    const next = speeds[Math.max(0, Math.min(speeds.length - 1, (at < 0 ? speeds.indexOf(1) : at) + step))];
    this.setSpeed(next);
  }

  seek(ms: number): void {
    this.session?.seek(ms);
    this.syncBar();
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
    if (!this.session?.playing) return;
    this.resumeAfterScrub = true;
    this.session.pause();
    this.syncBar();
  }

  endScrub(): void {
    if (!this.resumeAfterScrub) return;
    this.resumeAfterScrub = false;
    const session = this.session;
    if (session && session.currentMs < session.durationMs) session.play();
    this.syncBar();
  }

  /**
   * Per rendered frame from the game loop, wall-clock ms, outside the
   * Angular zone: start a replay that waited for a quiet field, advance the
   * running one, refresh the bar every BAR_REFRESH_MS.
   */
  update(deltaMs: number): void {
    const pending = this.pending;
    if (pending) {
      if (this.gameState.snapshotRefusal() === null) {
        this.pending = null;
        this.ngZone.run(() => this.enter(pending.wave));
      } else if (performance.now() - pending.since > QUIET_WAIT_MS) {
        this.pending = null;
        this.ngZone.run(() => this.announcer.announce('The replay cannot start while shots are still flying.'));
      }
    }
    const session = this.session;
    if (!session) return;
    session.update(deltaMs);
    const now = performance.now();
    if (now - this.lastBarSync >= BAR_REFRESH_MS || session.playing !== this.playing()) {
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
   * The replayable waves of the run under way as a file (decision D4), for
   * a download. False when there is nothing to save or no DOM to hang the
   * link on.
   */
  saveFile(doc: Document | undefined = globalThis.document): boolean {
    const records = this.file?.waves ?? this.gameState.simRecorder.records;
    const log = this.file?.log ?? this.gameState.commandLog.entries;
    const file = buildReplayFile(records, log, {
      worldKey: this.gameState.worldKey(),
      configHash: this.configHash(),
      seed: this.gameState.rng.seed,
      gameVersion: BUILD_VERSION,
      commit: buildCommit(),
    });
    if (!doc || file.waves.length === 0) return false;
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = replayFileName(file, this.locations.editableHqLocation()?.name ?? 'map');
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
    this.ngZone.run(() => {
      const phase = this.store.phase();
      if (this.active() || (phase !== 'setup' && phase !== 'gameover')) {
        this.fileProblem.set('A replay loads between waves.');
        return;
      }
      if (this.uiStore.coopMapLocked()) {
        this.fileProblem.set('Replays are off in a coop game.');
        return;
      }
      const read = readReplayFile(text, {
        worldKey: this.gameState.worldKey(),
        configHash: this.configHash(),
        gameVersion: BUILD_VERSION,
      });
      if (read.refusal) {
        this.fileProblem.set(replayFileRefusalText(read.refusal));
        this.announcer.announce(replayFileRefusalText(read.refusal));
        return;
      }
      this.fileProblem.set(null);
      // Another version loads; the bar says it may differ
      this.fileNote.set(read.note);
      this.file = { waves: read.file.waves, log: read.file.log };
      this.fromFile.set(true);
      const first = read.file.waves[0].wave;
      this.enterAny(first);
      if (!this.active()) {
        this.file = null;
        this.fromFile.set(false);
      }
    });
  }

  /** enter() without its gate on the run's own waves: a loaded file brings its own. */
  private enterAny(wave: number): void {
    if (this.bossIntro.active() || this.store.loading() || this.store.error() || this.uiStore.coopMapLocked()) return;
    const phase = this.store.phase();
    if (phase !== 'setup' && phase !== 'gameover') return;
    if (this.gameState.snapshotRefusal() !== null) {
      this.fileProblem.set('The replay cannot start while shots are still flying.');
      return;
    }
    this.begin(wave);
  }

  /** The record of `wave` in what is shown: the loaded file, else the run under way. */
  private recordOf(wave: number): WaveRecord | null {
    if (this.file) return this.file.waves.find((w) => w.wave === wave) ?? null;
    return this.gameState.simRecorder.get(wave);
  }

  private configHash(): string {
    return balanceConfigHash(this.waveDirector.source.id);
  }

  /** A session for `wave` on the live game, at its start and playing. */
  private open(engine: ThreeTilesEngine, wave: number): void {
    const record = this.recordOf(wave);
    if (!record) return;
    const log = this.file?.log ?? this.gameState.commandLog.entries;
    const session = new ReplaySession(this.gameState, engine, record, log);
    session.setSpeed(this.speed());
    session.enter();
    this.session = session;
    this.waves.set(this.file ? this.file.waves.map((w) => w.wave) : this.gameState.simRecorder.replayableWaves());
    this.markers.set(commandMarkers(log, record.startStep, record.endStep ?? record.startStep));
  }

  private syncBar(): void {
    const session = this.session;
    if (!session) return;
    this.wave.set(session.wave);
    this.timeMs.set(session.currentMs);
    this.durationMs.set(session.durationMs);
    this.playing.set(session.playing);
    this.speed.set(session.speed);
    this.baseHealth.set(this.gameState.baseHealth());
    this.enemiesAlive.set(this.gameState.enemyManager.aliveCount());
    const diverged = session.divergedAt;
    this.divergedAtMs.set(
      diverged === null ? null : Math.max(0, diverged - session.record.startStep) * GameClock.FIXED_STEP_MS,
    );
  }

  /** Both pause signals: the store's reaches the GameStateManager only with the next change detection. */
  private setPaused(paused: boolean): void {
    this.gameStore.paused.set(paused);
    this.gameState.paused.set(paused);
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
