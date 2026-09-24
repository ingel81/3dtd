import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Quaternion, Vector3 } from 'three';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerLifecycle } from '../managers/game-state/tower-lifecycle';
import { TowerCombatService } from './combat/tower-combat.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { HeroControlService } from './hero-control.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { InputHandlerService } from './input-handler.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { BossIntroService } from './boss-intro.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { TOWER_CONTROL } from '../configs/tower-control.config';
import { UI_SOUNDS } from '../configs/audio.config';
import { aimDirectionInto } from '../utils/manual-aim';
import { toneWavDataUrl } from '../utils/alert-tone';
import { cameraTimeline } from '../utils/camera-timeline';
import { TICK_SUB_STEPS } from '../coop/lockstep';
import type { Tower } from '../entities/tower.entity';
import type { ThreeTilesEngine } from '../three-engine';

/** Where the camera was before the player got in */
interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  up: Vector3;
  fov: number;
  /** The controls were on, as BossIntroService keeps it */
  controlsEnabled: boolean;
}

/** What the crosshair shows for a moment after a shot */
export type TowerControlMarker = 'hit' | 'kill' | null;

/** Visual kick of the view per shot, rad; it springs back over RECOIL_MS */
const RECOIL_KICK_RAD = 0.012;
const RECOIL_MS = 120;
/** How fast the zoom follows the right button, 1/s */
const ZOOM_RATE = 12;

/**
 * Manning a tower (docs/TOWER_CONTROL.md): the player gets into a projectile
 * tower and aims and fires it from first person. C or the tower panel's
 * button gets in, C, Esc (it also releases the mouse) or selling the tower
 * gets out; so does anything else that takes the camera (photo mode, the
 * replay, a boss intro) and the end of the game.
 *
 * The game side is the TowerLifecycle's (command:man-tower, leave-tower,
 * tower-trigger) and TowerCombatService.updateMannedTower: the tower keeps
 * its rules. This service is the input and the view: pointer lock and mouse
 * look (gathered per frame, sent by flushAim() as command:tower-aim), the
 * left button as trigger command, the right button zooms, the camera on the
 * tower's eye point every frame (update(), from the game loop), and the
 * crosshair's state for the HUD (TowerControlHudComponent).
 *
 * The view follows the player's own tower:manned, not the click: in coop
 * the command acts at its tick, a moment later (docs/COOP_PLAN.md, D12).
 * The camera looks along the aim the mouse gave here, which the tower
 * follows one tick later; in coop the aim goes out at most once a tick.
 *
 * Provided by the game component: it drives the component-scoped
 * GameStateManager.
 */
@Injectable()
export class TowerControlService {
  private readonly gameState = inject(GameStateManager);
  private readonly towerCombat = inject(TowerCombatService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly heroControl = inject(HeroControlService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly introFlight = inject(IntroCameraFlightService);
  private readonly bossIntro = inject(BossIntroService);
  private readonly uiStore = inject(UIStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly announcer = inject(LiveAnnouncer);

  /** The player sits in a tower */
  readonly active = computed(() => this.store.mannedTowerId() !== null);
  /** Name of the tower they sit in, for the HUD */
  readonly towerName = signal('');
  /** The mouse is captured (pointer lock); until then a click on the map captures it */
  readonly aiming = signal(false);
  /** The crosshair is on an enemy the tower may shoot */
  readonly onTarget = signal(false);
  /** Reload of the next shot, 0 (just fired) to 1 (ready) */
  readonly reload = signal(1);
  /** Hit or kill marker on the crosshair, null when none */
  readonly marker = signal<TowerControlMarker>(null);
  /** Counts the shots, the crosshair's recoil animation keys on it */
  readonly shots = signal(0);

  private pose: CameraPose | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private zoomHeld = false;
  private recoilMs = 0;
  private markerTimer: ReturnType<typeof setTimeout> | null = null;
  /** The aim the mouse gives, where the camera looks; set from the tower when the player gets in */
  private aimHeading = 0;
  private aimPitch = 0;
  /** The mouse moved since the last aim that went out */
  private aimMoved = false;
  /** Sub-step of the last aim that went out, for the coop pace */
  private aimSentStep = -Infinity;
  /**
   * The trigger as last sent. Not the tower's: in coop that one follows a
   * tick later, and a short click would let go before it was down there, so
   * the release never went out and the tower fired on (playtest T1).
   */
  private triggerSent = false;
  private readonly eye = new Vector3();
  private readonly dir = new Vector3();
  private readonly lookAt = new Vector3();

  constructor() {
    const bus = this.gameState.getEventBus();
    const subs = [
      bus.onLive('tower:manual-shot', (event) => this.onShot(event.towerId)),
      bus.onLive('projectile:hit', (event) => {
        if (event.projectile.sourceTowerId === this.store.mannedTowerId()) this.showMarker('hit');
      }),
      bus.onLive('enemy:died', (event) => {
        const by = event.killedBy;
        if (by?.kind === 'tower' && by.towerId === this.store.mannedTowerId()) this.showMarker('kill');
      }),
      // Out of the tower, however that came (C, Esc, sold, game over, restart,
      // a new place): the camera comes back at once, before a new place frames it
      bus.onLive('tower:manned', (event) => {
        if (!event.local) return;
        if (event.towerId === null) {
          if (this.pose) this.cleanUp();
        } else {
          this.takeSeat(event.towerId);
        }
      }),
    ];
    inject(DestroyRef).onDestroy(() => {
      for (const sub of subs) sub.dispose();
      this.detach();
      this.restoreCamera();
    });

    // Whatever else takes the camera takes the player out of the tower
    effect(() => {
      // Placing the HQ or a spawn (header) needs the pointer on the map
      const taken = this.uiStore.photoMode() || this.uiStore.replayMode() || this.bossIntro.active()
        || this.introFlight.active() || this.uiStore.mapPlacementMode() !== null
        || this.store.loading() || !!this.store.error();
      if (taken) untracked(() => this.exit());
    });
  }

  /** Whether the player can get into `tower` now */
  canEnter(tower: Tower | null): tower is Tower {
    return tower !== null
      && TowerLifecycle.canMan(tower)
      && !this.store.isGameOver()
      && !this.store.loading()
      && !this.store.error()
      && !this.uiStore.viewOnly()
      && !this.bossIntro.active()
      && !this.introFlight.active();
  }

  /**
   * Get into `tower`: build mode, placement, aiming and the hero's selection
   * end, the tower is deselected, and the command goes out. Once the player
   * sits in it (tower:manned, takeSeat) the camera goes to its eye point and
   * the mouse is captured. Call it from a click or a key: pointer lock needs
   * one, and in coop the seat comes a tick later, still within the gesture's
   * activation.
   * @returns whether the player asked to get in
   */
  enter(tower: Tower): boolean {
    const engine = this.engineInit.getEngine();
    if (!engine || !this.canEnter(tower)) return false;
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.heroControl.deselect();
    // No selection or hover ring and range in the view: the pointer that
    // hovered the tower stays over it, and its moves are the aim from now on
    this.gameState.towerManager.selectTower(null);
    this.inputHandler.clearHover();
    this.uiStore.openMenu.set(null);
    this.cameraControl.cancelJump();
    // A camera key held on the way in would pan on. Keys pressed inside pan
    // the camera too, but update() puts it on the eye point every frame.
    this.keyboardPan.clearKeys();

    this.gameState.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    return true;
  }

  /** The player sits in the tower now (their own tower:manned): camera, mouse and HUD. */
  private takeSeat(towerId: string): void {
    const engine = this.engineInit.getEngine();
    const tower = this.gameState.getMannedTower();
    if (!engine || !tower || tower.id !== towerId) return;
    this.aimHeading = tower.manualAim.heading;
    this.aimPitch = tower.manualAim.pitch;
    this.aimMoved = false;
    this.aimSentStep = -Infinity;
    this.triggerSent = tower.triggerHeld;

    if (!this.pose) this.pose = this.saveCamera(engine);
    const controls = engine.getControls();
    if (controls) controls.enabled = false;
    this.towerName.set(tower.typeConfig.name);
    // Its own veteran badge would stand in the middle of the view
    engine.towerBadges.hideFor(tower.id);
    engine.spatialAudio.setFeedbackMinDistance(TOWER_CONTROL.feedbackSoundMinDistanceM);
    this.attach(engine);
    this.capturePointer();
    this.announcer.announce(`In the ${tower.typeConfig.name}. Left button fires, right button zooms, C or Esc gets out.`);
  }

  /** Get out of the tower; it fires by itself again. */
  exit(): void {
    if (!this.active()) return;
    this.gameState.getEventBus().emit({ type: 'command:leave-tower' });
  }

  /** C: into the selected tower, or out of the manned one. */
  toggle(): boolean {
    if (this.active()) {
      this.exit();
      return true;
    }
    const tower = this.store.selectedTower();
    return this.canEnter(tower) && this.enter(tower);
  }

  /**
   * Per frame, before the game's sub-steps: the aim the mouse moved to goes
   * out as one command:tower-aim, only when it moved. A command per mouse
   * event would put several a frame into the command log. In coop at most
   * one per tick (D12): the relay stamps them into ticks anyway, and the
   * camera looks along the local aim in between.
   */
  flushAim(): void {
    if (!this.aimMoved || !this.gameState.getMannedTower()) return;
    const step = this.gameState.subStep;
    if (this.gameState.lockstepActive && step < this.aimSentStep + TICK_SUB_STEPS) return;
    this.aimMoved = false;
    this.aimSentStep = step;
    this.gameState.getEventBus().emit({ type: 'command:tower-aim', heading: this.aimHeading, pitch: this.aimPitch });
  }

  /**
   * Per frame, wall-clock ms, after the game's sub-steps: the camera on the
   * tower's eye point, looking along the aim, and the HUD's state.
   */
  update(deltaTime: number): void {
    const tower = this.gameState.getMannedTower();
    const engine = this.engineInit.getEngine();
    if (!tower || !engine || !this.pose) return;

    const camera = engine.getCamera();
    this.recoilMs = Math.max(0, this.recoilMs - deltaTime);
    const kick = RECOIL_KICK_RAD * (this.recoilMs / RECOIL_MS);
    // The eye from the player's own aim, as the view: the tower's comes a tick later in coop
    this.towerCombat.mannedEyeInto(tower, this.eye, { heading: this.aimHeading, pitch: this.aimPitch });
    aimDirectionInto(this.aimHeading, this.aimPitch + kick, this.dir);
    camera.position.copy(this.eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.lookAt.copy(this.eye).add(this.dir));

    const fovTarget = this.zoomHeld ? TOWER_CONTROL.zoomFovDeg : this.pose.fov;
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, (ZOOM_RATE * deltaTime) / 1000);
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    const onTarget = this.towerCombat.mannedAimTargetOf(tower.id) !== null;
    if (onTarget !== this.onTarget()) this.onTarget.set(onTarget);
    const interval = tower.combat.fireRate > 0 ? 1000 / tower.combat.fireRate : 1;
    const reload = Math.round((1 - tower.combat.cooldownRemaining / interval) * 20) / 20;
    if (reload !== this.reload()) this.reload.set(reload);
  }

  // ── Input ─────────────────────────────────────────────────────

  // On window in the capture phase, ahead of InputHandlerService and the
  // camera controls on document and canvas: what lands on the map is the
  // tower's, the header stays clickable while the mouse is free.

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.onCanvas(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.aiming()) {
      // The first click (or one after the capture was refused) captures the mouse
      this.capturePointer();
      return;
    }
    this.readButtons(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.readButtons(event);
    if (this.onCanvas(event)) event.stopImmediatePropagation();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.aiming()) {
      // No hover ring on the towers under the free pointer
      if (this.onCanvas(event)) event.stopImmediatePropagation();
      return;
    }
    event.stopImmediatePropagation();
    this.readButtons(event);
    if (!this.gameState.getMannedTower()) return;
    // Slower look while zoomed, so the crosshair moves as far on screen
    const scale = TOWER_CONTROL.lookRadPerPx * (this.zoomHeld ? TOWER_CONTROL.zoomFovDeg / (this.pose?.fov ?? 60) : 1);
    // From the local aim, not the tower's: in coop that one comes a tick later
    this.aimHeading = wrapAngle(this.aimHeading + event.movementX * scale);
    this.aimPitch = Math.min(TOWER_CONTROL.pitchMax, Math.max(TOWER_CONTROL.pitchMin, this.aimPitch - event.movementY * scale));
    this.aimMoved = true;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.onCanvas(event)) event.preventDefault();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.onCanvas(event)) event.stopImmediatePropagation();
  };

  /**
   * The capture ended. Esc ends it in the browser before any key event
   * reaches the page, so losing it means getting out, unless it never began.
   */
  private readonly onPointerLockChange = (): void => {
    const locked = this.canvas !== null && document.pointerLockElement === this.canvas;
    const wasAiming = this.aiming();
    this.aiming.set(locked);
    if (!locked) {
      this.setTrigger(false);
      this.zoomHeld = false;
      if (wasAiming) this.exit();
    }
  };

  private attach(engine: ThreeTilesEngine): void {
    if (this.canvas) return;
    this.canvas = engine.getRenderer().domElement;
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointerup', this.onPointerUp, { capture: true });
    window.addEventListener('pointermove', this.onPointerMove, { capture: true });
    window.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    window.addEventListener('wheel', this.onWheel, { capture: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private detach(): void {
    if (!this.canvas) return;
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    window.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    window.removeEventListener('wheel', this.onWheel, { capture: true });
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.canvas = null;
    this.aiming.set(false);
  }

  private capturePointer(): void {
    const canvas = this.canvas;
    if (!canvas || document.pointerLockElement === canvas) return;
    try {
      // A promise in current browsers, undefined in older ones; refused without a gesture
      const request = canvas.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => undefined);
    } catch {
      // Not captured: the HUD asks for a click
    }
  }

  /**
   * Trigger and zoom from the buttons held now. A second button pressed or
   * let go while the first is down comes as a pointermove, not as
   * pointerdown or pointerup (Pointer Events chorded buttons), so every
   * pointer event reads the whole set: left fires, right zooms.
   */
  private readButtons(event: PointerEvent): void {
    this.setTrigger((event.buttons & 1) !== 0);
    this.zoomHeld = (event.buttons & 2) !== 0;
  }

  private onCanvas(event: Event): boolean {
    const canvas = this.canvas;
    return canvas !== null && (event.target === canvas || canvas.contains(event.target as Node));
  }

  private setTrigger(held: boolean): void {
    if (!this.gameState.getMannedTower() || this.triggerSent === held) return;
    this.triggerSent = held;
    this.gameState.getEventBus().emit({ type: 'command:tower-trigger', held });
  }

  // ── Feedback ──────────────────────────────────────────────────

  private onShot(towerId: string): void {
    if (towerId !== this.store.mannedTowerId()) return;
    this.recoilMs = RECOIL_MS;
    this.shots.update((n) => n + 1);
  }

  /** A kill outranks a hit that lands in the same moment. */
  private showMarker(kind: 'hit' | 'kill'): void {
    if (kind === 'hit' && this.marker() === 'kill') return;
    this.marker.set(kind);
    this.playTone(kind === 'kill' ? UI_SOUNDS.towerKill : UI_SOUNDS.towerHit);
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = setTimeout(() => {
      this.markerTimer = null;
      this.marker.set(null);
    }, kind === 'kill' ? TOWER_CONTROL.killMarkerMs : TOWER_CONTROL.hitMarkerMs);
  }

  private playTone(tone: typeof UI_SOUNDS.towerHit | typeof UI_SOUNDS.towerKill): void {
    const audio = this.engineInit.getEngine()?.spatialAudio;
    if (!audio) return;
    if (!audio.getSoundConfig(tone.id)) audio.registerSound(tone.id, toneWavDataUrl(tone.notes), { volume: tone.volume });
    audio.playGlobal(tone.id).catch(() => undefined);
  }

  // ── Camera ────────────────────────────────────────────────────

  private cleanUp(): void {
    const engine = this.engineInit.getEngine();
    engine?.towerBadges.hideFor(null);
    engine?.spatialAudio.setFeedbackMinDistance(0);
    this.detach();
    this.restoreCamera();
    this.zoomHeld = false;
    this.recoilMs = 0;
    this.onTarget.set(false);
    this.reload.set(1);
    this.marker.set(null);
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = null;
    this.announcer.announce('Out of the tower.');
  }

  private saveCamera(engine: ThreeTilesEngine): CameraPose {
    const camera = engine.getCamera();
    return {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      fov: camera.fov,
      controlsEnabled: engine.getControls()?.enabled ?? true,
    };
  }

  /**
   * The camera back where the player got in. Switching the controls off and
   * on again around it lets them take their pivot from the camera, as after
   * the replay.
   */
  private restoreCamera(): void {
    const pose = this.pose;
    this.pose = null;
    const engine = this.engineInit.getEngine();
    if (!pose || !engine) return;
    const camera = engine.getCamera();
    const controls = engine.getControls();
    if (controls) controls.enabled = false;
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.up.copy(pose.up);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (controls) controls.enabled = pose.controlsEnabled;
    cameraTimeline.record('camera.towerControl.restore', {}, true);
  }
}

/** An angle into (-π, π]. */
function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}
