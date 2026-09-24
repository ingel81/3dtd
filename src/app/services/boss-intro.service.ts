import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { UIStore } from '../store/ui.store';
import { BotClientService } from '../bots/bot-client.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { DebugFacadeService } from './debug/debug-facade.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { portalCorridorWidth, portalScaleForWidth } from '../three-engine/renderers/marker/spawn-portal-pose';
import type { ThreeTilesEngine } from '../three-engine';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';
import { routePathToLocalPoints } from '../utils/route-path.util';
import { cameraTimeline } from '../utils/camera-timeline';
import { ownsKey } from '../utils/keyboard-target';
import { raycastStats } from '../utils/raycast-stats';
import {
  BOSS_INTRO_TIMING,
  BOSS_SHOT,
  BOSS_SHOT_RAYS,
  BossIntroGate,
  PortalShotSearch,
  bossClearDistance,
  bossIntroBlock,
  bossIntroCutMs,
  bossIntroReturnMs,
  bossIntroStage,
  type BossIntroBlock,
  type BossIntroStage,
  type PortalShot,
  type ShotProbe,
} from '../utils/boss-intro';
import { BOSS_INTRO_SOUNDS } from '../configs/game-sounds.config';

/** Route the shot may stand on, from the portal (m); the framing needs about 60 at most. */
const SHOT_ROUTE_M = 150;
/** Longest frame the timeline advances by, so a stall does not eat the hold (ms). */
const MAX_FRAME_MS = 100;

/** What the title card shows: the type's display name and the wave. */
export interface BossIntroCard {
  name: string;
  /** The boss's honorific, a smaller line under `name`. Solo bosses only, dropped when combined with others. */
  epithet?: string;
  wave: number;
}

/** A boss the gate let through, until it has stepped out of its portal. */
interface WaitingBoss {
  enemy: Enemy;
  wave: number;
  portalScale: number;
  /** Route distance at which it stands in front of the portal (m), an ooze's tip further out (bossClearDistance) */
  clearDistance: number;
}

interface IntroRun {
  boss: WaitingBoss;
  /** Looks for a shot with a clear view while the veil comes down */
  search: PortalShotSearch;
  /** Its pick, taken at the cut */
  shot: PortalShot | null;
  elapsedMs: number;
  /** The player's view and the game are back (reveal) */
  returned: boolean;
  controlsWereEnabled: boolean;
  /** The player had paused the game before the intro did */
  pausedBefore: boolean;
}

/**
 * Boss intro: when a wave's boss (EnemyTypeConfig.isBoss, enemy:spawned with
 * viaPortal) has stepped out of its spawn portal, the camera cuts to the
 * portal behind a short dark veil, holds on the boss, and cuts back to the
 * pose it had. Rules in utils/boss-intro.ts: one intro per boss type and
 * wave (BossIntroGate), none in photo mode, training runs, above 4x or
 * while a dialog is open (bossIntroBlock). Bosses of the wave still waiting when an intro starts
 * (two types out of the portals at once, a Custom Wave) share it: the card
 * names them all, the shot stays on the first. The shot comes from
 * PortalShotSearch: while the first veil comes down it checks its
 * candidates against the tiles, a few rays a frame, and the cut takes its
 * pick (`bossShot` in `__raycastStats()`).
 *
 * Presentation only: it moves the camera and pauses the game the way the
 * pause button does (GameStore.paused), nothing in the simulation changes.
 * The player's own pause survives it: paused before, paused after. A click
 * on the veil (BossIntroComponent) or Esc skips straight back. The camera
 * controls are off while it runs; a running quick jump (Home, N) ends, the
 * game keys wait (handleKeyDown). Ticked per frame from
 * GameLoopFacadeService.onEngineUpdate, after
 * the game's sub-steps, so a boss that clears its portal in a frame cuts in
 * that frame. Provided by the game component: it listens on the
 * component-scoped GameStateManager's bus.
 */
@Injectable()
export class BossIntroService {
  private readonly gameState = inject(GameStateManager);
  private readonly gameStore = inject(GameStore);
  private readonly uiStore = inject(UIStore);
  private readonly botClient = inject(BotClientService);
  private readonly engineInit = inject(EngineInitializationService);
  /** Holds the display option (Display menu, "Boss Intro") */
  private readonly displayOptions = inject(DebugFacadeService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly introFlight = inject(IntroCameraFlightService);
  private readonly ngZone = inject(NgZone);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly dialog = inject(MatDialog);

  /** Stage of the running intro, null while none runs. */
  readonly stage = signal<BossIntroStage | null>(null);
  readonly active = computed(() => this.stage() !== null);
  /** Title card of the running intro, shown while the portal shot holds (BossIntroComponent) */
  readonly card = signal<BossIntroCard | null>(null);

  private readonly gate = new BossIntroGate();
  private readonly waiting: WaitingBoss[] = [];
  private run: IntroRun | null = null;

  /** The player's camera pose before the cut */
  private readonly savedPosition = new Vector3();
  private readonly savedQuaternion = new Quaternion();
  private readonly dollyPosition = new Vector3();

  /** A still shot for players who asked the system for less motion */
  private readonly dolly =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : BOSS_SHOT.dolly;

  constructor() {
    const bus = this.gameState.getEventBus();
    const subs = [
      bus.onLive('enemy:spawned', (event) => this.onSpawned(event.enemy, event.viaPortal === true)),
      // A worm is one boss out of the portal, its segments come without viaPortal
      bus.onLive('worm:spawned', (event) => this.onSpawned(event.head, event.viaPortal === true)),
      bus.onLive('game:reset', () => this.reset()),
    ];
    inject(DestroyRef).onDestroy(() => {
      for (const sub of subs) sub.dispose();
      this.abort();
    });
  }

  /**
   * Per frame, wall-clock ms: advance the running intro, else start the
   * first waiting boss once it is out of its portal.
   */
  update(deltaMs: number): void {
    if (this.run) {
      this.advance(Math.min(deltaMs, MAX_FRAME_MS));
      return;
    }
    while (this.waiting.length > 0) {
      const boss = this.waiting[0];
      if (!boss.enemy.active || !boss.enemy.alive) {
        this.waiting.shift();
        continue;
      }
      if (boss.enemy.movement.getDistanceAlongPath() < boss.clearDistance) return;
      this.waiting.shift();
      if (this.start(boss)) return;
    }
  }

  /** Why an intro would not play now, null when it would. */
  blocked(): BossIntroBlock | null {
    return bossIntroBlock({
      enabled: this.displayOptions.bossIntroEnabled(),
      photoMode: this.uiStore.photoMode(),
      botEnabled: this.botClient.botEnabled(),
      timescale: this.gameStore.gameSpeed(),
      renderingEnabled: this.gameStore.renderingEnabled(),
      introFlight: this.introFlight.active(),
      dialogOpen: this.dialog.openDialogs.length > 0,
    });
  }

  /** Inside a sub-step: only note the boss, update() decides once it is out. */
  private onSpawned(enemy: Enemy, viaPortal: boolean): void {
    if (!viaPortal || !enemy.typeConfig.isBoss) return;
    const wave = this.gameState.waveNumber();
    if (!this.gate.admit(enemy.typeConfig.id, wave)) return;
    const start = enemy.movement.path[0];
    if (!start) return;
    const portalScale = portalScaleForWidth(portalCorridorWidth(start));
    this.waiting.push({ enemy, wave, portalScale, clearDistance: bossClearDistance(portalScale, enemy.typeConfig) });
  }

  private start(boss: WaitingBoss): boolean {
    const engine = this.engineInit.getEngine();
    const block = this.blocked();
    if (!engine || block) {
      cameraTimeline.record('bossIntro.skip', { boss: boss.enemy.typeConfig.id, reason: block ?? 'no-engine' });
      return false;
    }
    const camera = engine.getCamera();
    const route = this.shotRoute(engine, boss.enemy.movement.path);
    const { heightOffset, healthBarOffset } = boss.enemy.typeConfig;
    // Up to its health bar, the top of what the shot shows of it
    const search = PortalShotSearch.create(
      route,
      camera.fov,
      boss.portalScale,
      boss.clearDistance,
      heightOffset + healthBarOffset,
      this.shotProbe(engine),
      this.dolly,
    );
    if (!search) return false;

    // Instead of a second intro right after this one, which would cut to a
    // boss that walked on during the reveal
    const names = [boss.enemy.typeConfig.name, ...this.takeWaiting(boss.wave)];

    this.savedPosition.copy(camera.position);
    this.savedQuaternion.copy(camera.quaternion);
    this.cameraControl.stopJump();
    this.keyboardPan.clearKeys();
    const controls = engine.getControls();
    this.run = {
      boss,
      search,
      shot: null,
      elapsedMs: 0,
      returned: false,
      controlsWereEnabled: controls?.enabled ?? false,
      pausedBefore: this.gameStore.paused(),
    };
    if (controls) controls.enabled = false;
    cameraTimeline.record('bossIntro.start', { boss: boss.enemy.typeConfig.id, wave: boss.wave }, true);
    // A combined intro names them all, so no single honorific fits under it
    const epithet = names.length === 1 ? boss.enemy.typeConfig.epithet : undefined;
    this.ngZone.run(() => {
      this.card.set({ name: names.join(' & '), epithet, wave: boss.wave });
      // The boss is heard while it is shown: its loops keep running
      this.gameStore.pauseKeepsLoops.set(true);
      this.gameStore.paused.set(true);
    });
    this.setStage('dip-in');
    // The boss's own sound, registered by GameSoundsService with the engine's sounds
    const signature = BOSS_INTRO_SOUNDS[boss.enemy.typeConfig.id];
    if (signature) engine.spatialAudio?.playGlobal(signature.id).catch(() => undefined);
    const said = names.length > 1 ? `Bosses: ${names.join(' and ')}` : `Boss: ${names[0]}`;
    this.announcer.announce(`${said}, wave ${boss.wave}. Escape skips.`);
    return true;
  }

  /** The names of the bosses of `wave` still waiting, taken out of the queue. */
  private takeWaiting(wave: number): string[] {
    const names: string[] = [];
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const { enemy } = this.waiting[i];
      if (this.waiting[i].wave !== wave || !enemy.active || !enemy.alive) continue;
      names.unshift(enemy.typeConfig.name);
      this.waiting.splice(i, 1);
    }
    return names;
  }

  private advance(deltaMs: number): void {
    const run = this.run!;
    const engine = this.engineInit.getEngine();
    if (!engine) {
      this.abort();
      return;
    }
    run.elapsedMs += deltaMs;
    const stage = bossIntroStage(run.elapsedMs);

    if (stage === 'dip-in') {
      this.searchShot(run, BOSS_SHOT_RAYS.perFrame);
    } else if (stage === 'hold' || stage === 'dip-out') {
      this.frameShot(engine.getCamera(), run);
    } else if (stage === 'reveal' || stage === null) {
      if (!run.returned) this.returnCamera(engine, run);
    }

    if (stage === null) this.run = null;
    if (stage !== this.stage()) this.setStage(stage);
  }

  /**
   * Candidates for the shot while the veil comes down, `rays` of them a
   * frame (PortalShotSearch); Infinity finishes the search. Booked as
   * `bossShot` in `__raycastStats()`.
   */
  private searchShot(run: IntroRun, rays: number): void {
    const scope = raycastStats.enter('bossShot');
    try {
      run.search.step(rays);
    } finally {
      raycastStats.exit(scope);
    }
  }

  /** At the cut: what the search has not looked at yet within its budget, then its pick. */
  private pickShot(run: IntroRun): PortalShot {
    this.searchShot(run, Infinity);
    const choice = run.search.result();
    run.shot = choice.shot;
    cameraTimeline.record('bossIntro.shot', {
      boss: run.boss.enemy.typeConfig.id,
      shot: choice.label,
      clear: choice.clear,
      score: choice.score,
      rays: choice.rays,
      tried: choice.tried,
    });
    return choice.shot;
  }

  /** The tile rays of the shot search: TerrainQueries, in DevWorld its terrain and buildings. */
  private shotProbe(engine: ThreeTilesEngine): ShotProbe {
    const terrain = engine.terrain;
    return {
      blocked: (from, to) => terrain.raycastLineOfSight(from.x, from.y, from.z, to.x, to.y, to.z),
      column: (x, z) => terrain.sampleColumn(x, z),
    };
  }

  /**
   * The portal shot, pushed in by how far the hold has run. Written every
   * frame: nothing else may move the camera meanwhile.
   */
  private frameShot(camera: PerspectiveCamera, run: IntroRun): void {
    const { position, dollyTo, target } = run.shot ?? this.pickShot(run);
    const raw = Math.min(1, Math.max(0, (run.elapsedMs - bossIntroCutMs()) / BOSS_INTRO_TIMING.holdMs));
    const eased = raw * raw * (3 - 2 * raw);
    this.dollyPosition.set(
      position.x + (dollyTo.x - position.x) * eased,
      position.y + (dollyTo.y - position.y) * eased,
      position.z + (dollyTo.z - position.z) * eased,
    );
    camera.position.copy(this.dollyPosition);
    camera.lookAt(target.x, target.y, target.z);
  }

  /** The player's pose back, the controls with it, and the game as it was. */
  private returnCamera(engine: ThreeTilesEngine, run: IntroRun): void {
    run.returned = true;
    const camera = engine.getCamera();
    camera.position.copy(this.savedPosition);
    camera.quaternion.copy(this.savedQuaternion);
    camera.updateMatrixWorld();
    const controls = engine.getControls();
    if (controls) controls.enabled = run.controlsWereEnabled;
    this.ngZone.run(() => {
      this.gameStore.pauseKeepsLoops.set(false);
      this.gameStore.paused.set(run.pausedBefore);
    });
    cameraTimeline.record('bossIntro.return', { boss: run.boss.enemy.typeConfig.id }, true);
  }

  /**
   * Click on the veil or Esc: the player's view and the game come back at
   * once, the veil fades out from wherever it is.
   */
  skip(): void {
    const run = this.run;
    if (!run || run.returned) return;
    cameraTimeline.record('bossIntro.skipped', { stage: this.stage() });
    run.elapsedMs = bossIntroReturnMs();
    this.advance(0);
  }

  /**
   * Window keydown, before the game's own handlers. Until the view is back,
   * Esc skips and every other game key waits: the camera and the pause
   * belong to the intro. Typing in a field and a key a dialog took (Esc
   * closing it) stay theirs.
   *
   * @returns true when the game must leave the key alone
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.run || this.run.returned) return false;
    if (event.defaultPrevented || ownsKey(event.target, event.key)) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.skip();
    }
    return true;
  }

  /** Restart or location change: waiting bosses go, a running intro ends where it is. */
  private reset(): void {
    this.gate.reset();
    this.waiting.length = 0;
    this.abort();
  }

  /**
   * End a running intro without cutting back: the reset that calls it moves
   * the camera itself and lifts the pause. The controls come back.
   */
  private abort(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    if (!run.returned) {
      const controls = this.engineInit.getEngine()?.getControls();
      if (controls) controls.enabled = run.controlsWereEnabled;
    }
    cameraTimeline.record('bossIntro.abort', { boss: run.boss.enemy.typeConfig.id });
    this.setStage(null);
  }

  /** The route from the portal on as local ground points, as far as the shot can reach. */
  private shotRoute(engine: ThreeTilesEngine, path: readonly RouteWaypoint[]): Vector3[] {
    const points: Vector3[] = [];
    let length = 0;
    for (const waypoint of path) {
      const [point] = routePathToLocalPoints(engine, [waypoint], 0);
      const last = points[points.length - 1];
      if (last) length += Math.hypot(point.x - last.x, point.z - last.z);
      points.push(point);
      if (length >= SHOT_ROUTE_M) break;
    }
    return points;
  }

  /** The render loop runs outside Angular; the veil and the card follow this signal. */
  private setStage(stage: BossIntroStage | null): void {
    this.ngZone.run(() => {
      this.stage.set(stage);
      if (stage === null) this.card.set(null);
    });
  }
}
