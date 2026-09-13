import { ElementRef, Injectable, Injector, NgZone, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { Quaternion, Vector3 } from 'three';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { REPLAY_CONFIG } from '../configs/replay.config';
import { ReplayPlayer } from '../replay/replay-player';
import { commandMarkers, type ReplayMarker } from '../replay/replay-bar-view';
import type { ThreeTilesEngine } from '../three-engine';
import { cameraTimeline } from '../utils/camera-timeline';
import { cycleTab, focusedElement } from '../utils/focus-cycle';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { CameraControlService } from './camera-control.service';
import { PhotoModeService } from './photo-mode.service';

/** Wall-clock ms between two updates of the replay bar while it plays */
const BAR_REFRESH_MS = 50;

/** Where the camera was when the replay started */
interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  up: Vector3;
}

/**
 * Replay of the last wave (docs/REPLAY.md): the HUD goes, the live game
 * pauses, a ReplayPlayer shows the recording the GameStateManager's
 * ReplayRecorder made, the camera stays free. The replay bar drives it;
 * leaving puts camera, pause, open menu and focus back as they were.
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
  private readonly ngZone = inject(NgZone);
  private readonly injector = inject(Injector);
  /** The game component's element, whose template holds the replay bar */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly announcer = inject(LiveAnnouncer);

  readonly active = this.uiStore.replayMode;
  /** Wave of the finished recording, null while there is none */
  readonly recordedWave = this.gameState.replayRecorder.readyWave;
  /** A replay can start: a wave is recorded and the next one has not begun, or the game is over */
  readonly available = computed(() => {
    if (this.recordedWave() === null || this.store.loading() || this.store.error()) return false;
    const phase = this.store.phase();
    return phase === 'setup' || phase === 'gameover';
  });

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

  private player: ReplayPlayer | null = null;
  private camera: CameraPose | null = null;
  private pausedBefore = false;
  private focusBefore: HTMLElement | null = null;
  private menuBefore: ReturnType<UIStore['openMenu']> = null;
  private lastBarSync = 0;
  /** The replay played when a drag on the progress bar began */
  private resumeAfterScrub = false;

  constructor() {
    // The recording went (restart, a new place): nothing left to show
    effect(() => {
      if (this.recordedWave() === null) untracked(() => this.exit());
    });
  }

  enter(): void {
    if (this.active() || !this.available()) return;
    const engine = this.engineInit.getEngine();
    const recording = this.gameState.replayRecorder.recording;
    if (!engine || !recording) return;

    if (this.photoMode.active()) this.photoMode.exit();
    this.focusBefore = focusedElement();
    this.menuBefore = this.uiStore.openMenu();
    // Nothing of the game UI in the replay: build preview, placement
    // markers, an ability's reticle, the selected tower's range and LOS,
    // the veteran badges
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.gameState.towerManager.selectTower(null);
    this.uiStore.openMenu.set(null);
    this.cameraControl.cancelJump();
    engine.towerBadges.setVisible(false);

    this.camera = saveCamera(engine);
    this.pausedBefore = this.gameStore.paused();
    this.setPaused(true);

    const player = new ReplayPlayer(recording, engine);
    player.setSpeed(1);
    player.enter();
    this.player = player;
    this.wave.set(recording.wave);
    this.markers.set(commandMarkers(recording));
    this.active.set(true);
    this.syncBar();
    this.announcer.announce(`Replay of wave ${recording.wave}. Space pauses, Esc leaves it.`);
    // Space pauses from anywhere; the focus waits on play and pause all the same
    this.afterLayout(() => this.host.nativeElement.querySelector<HTMLElement>('.td-replay-play')?.focus());
  }

  exit(): void {
    if (!this.active()) return;
    const engine = this.engineInit.getEngine();
    this.player?.exit();
    this.player = null;
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

  togglePlay(): void {
    this.player?.togglePlay();
    this.syncBar();
  }

  setSpeed(speed: number): void {
    this.player?.setSpeed(speed);
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
    this.player?.seek(ms);
    this.syncBar();
  }

  /**
   * Pointer down on the progress bar: a playing replay holds still while
   * the thumb is dragged, otherwise playback and the drag pull the thumb
   * both ways. endScrub() on release plays on, unless the drag ended at
   * the very end.
   */
  beginScrub(): void {
    if (!this.player?.isPlaying) return;
    this.resumeAfterScrub = true;
    this.player.pause();
    this.syncBar();
  }

  endScrub(): void {
    if (!this.resumeAfterScrub) return;
    this.resumeAfterScrub = false;
    const player = this.player;
    if (player && player.currentMs < player.durationMs) player.play();
    this.syncBar();
  }

  /**
   * Per rendered frame from the game loop, wall-clock ms, outside the
   * Angular zone: advance the replay, refresh the bar every BAR_REFRESH_MS.
   */
  update(deltaMs: number): void {
    const player = this.player;
    if (!player) return;
    player.update(deltaMs);
    const now = performance.now();
    if (now - this.lastBarSync >= BAR_REFRESH_MS || player.isPlaying !== this.playing()) {
      this.lastBarSync = now;
      this.ngZone.run(() => this.syncBar());
    }
  }

  /** Window keydown while the replay is on: Tab stays in the bar, see cycleTab. */
  trapTab(event: KeyboardEvent): void {
    if (!this.active()) return;
    cycleTab(event, this.barControls());
  }

  private syncBar(): void {
    const player = this.player;
    if (!player) return;
    this.timeMs.set(player.currentMs);
    this.durationMs.set(player.durationMs);
    this.playing.set(player.isPlaying);
    this.speed.set(player.currentSpeed);
    this.baseHealth.set(player.baseHealth);
    this.enemiesAlive.set(player.enemiesAlive);
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
