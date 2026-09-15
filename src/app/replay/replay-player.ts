import { Vector3 } from 'three';
import { GameEventBus, VFXService, AudioService, ScreenShakeService } from '../game-engine';
import type { ThreeTilesEngine } from '../three-engine';
import type { EnemyInstanceState } from '../three-engine/renderers/instanced-enemy/enemy-instance.manager';
import type { TentacleStrike } from '../three-engine/renderers/three-tentacle.renderer';
import type { OozeGround } from '../three-engine/renderers/ooze/ooze-band-geometry';
import type { HeroPresentation } from '../managers/hero.manager';
import { ENEMY_TYPES, enemyDeathDuration, type EnemyTypeId } from '../configs/enemy-types.config';
import { BURST_PALETTES, OOZE_LOOK, STUN_SPARKS } from '../configs/visual-effects.config';
import { PROJECTILE_TYPES, type ProjectileTypeId } from '../configs/projectile-types.config';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { REPLAY_CONFIG } from '../configs/replay.config';
import { GameClock } from '../managers/game-state/game-clock';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import {
  ENEMY_END,
  ENEMY_FLAG,
  TOWER_FLAG,
  decodeHeading,
  heroPoseName,
  type ReplayRecording,
  type ReplayTower,
} from './replay-recording';

/** What the player needs besides the recording and the engine */
export interface ReplayPlayerOptions {
  /** The route grid's ground, which the oozes' bands lie on; without it no bands */
  ground?: OozeGround | null;
}

/** Status bits followed every frame while on: their auras move, the sparks repeat */
const FOLLOWED_FLAGS = ENEMY_FLAG.SLOWED | ENEMY_FLAG.POISONED | ENEMY_FLAG.FROZEN | ENEMY_FLAG.STUNNED;

/** What an enemy of the recording shows right now */
const SHOWN_NONE = 0;
const SHOWN_ALIVE = 1;
const SHOWN_DYING = 2;

/** A tower's turret as the live game left it, put back on exit */
interface SavedTower {
  current: number;
  target: number;
  hasTarget: boolean;
  scanPhase: number;
  scanStart: number;
  scanDelay: number;
  turretY: number | null;
  meshVisible: boolean;
  /** Its tentacle's strike, null without a tentacle */
  tentacle: TentacleStrike | null;
}

/** A tower of the recording in the renderers during the replay */
interface TowerView {
  tower: ReplayTower;
  /** Id in the tower renderer: the live tower's own, a replay one for a tower sold during the wave */
  renderId: string;
  /** The live tower's state on entry; null for a replay tower, which goes on exit */
  saved: SavedTower | null;
  /** What the model shows; a model still loading keeps its default (shown) */
  visible: boolean;
  /** The tower's tip (local), where a flame beam starts */
  tip: Vector3;
  beamOn: boolean;
  strikeOn: boolean;
  strikeTarget: Vector3;
  /** apply() pass that last had a sample of it */
  stamp: number;
}

/** How far a tentacle's target has to move to count as a new strike (m²) */
const NEW_STRIKE_DISTANCE_SQ = 0.25;

/**
 * Plays a ReplayRecording back through the live renderers (docs/REPLAY.md).
 *
 * The live game stands still meanwhile (ReplayService pauses it), so the
 * renderers are free: replay enemies and projectiles get instances of their
 * own under `replay-*` ids, the live towers turn to the recorded turret
 * rotations and hide until they were placed, towers sold during the wave
 * come back as replay models. The oozes get bands of their own, the hero
 * renderer shows the recorded hero, the blood moon look is the recorded
 * wave's. Effect events go out on a bus of the player's own, heard by its
 * own VFXService, AudioService and ScreenShakeService (ability strikes
 * included). Ground marks are held meanwhile, so the replay adds none to the
 * live ground. exit() takes every instance down and puts the live towers
 * and the blood moon look back as they were; the live hero is the caller's
 * to show again (HeroManager.presentFrame).
 *
 * The game state is never touched: the player writes to renderers only.
 * Between two frames it interpolates positions, headings and turrets.
 */
export class ReplayPlayer {
  private timeMs = 0;
  private playing = false;
  private speed = 1;
  /** Next recorded event to play */
  private eventCursor = 0;
  /** Enemies alive on screen at timeMs, for the replay bar */
  private aliveNow = 0;
  /** Id of every apply() pass; stamps say which entries a pass reached */
  private stamp = 0;

  private bus: GameEventBus | null = null;
  /** The AudioService's bus: only what is to be heard goes on it, nothing above REPLAY_CONFIG.maxAudioSpeed */
  private audioBus: GameEventBus | null = null;
  private vfx: VFXService | null = null;
  private audio: AudioService | null = null;
  private shake: ScreenShakeService | null = null;

  // Enemies, by table index
  private readonly enemyShown: Uint8Array;
  private readonly enemyFlags: Uint8Array;
  private readonly enemyStamp: Uint32Array;
  private readonly enemyNext: Int32Array;
  private readonly enemyNextStamp: Uint32Array;
  private readonly enemyLastSample: Int32Array;
  private readonly enemySlots: (EnemyInstanceState | null)[];
  private readonly enemyIds: string[] = [];
  private readonly shownEnemies: Int32Array;
  private shownEnemyCount = 0;
  /** Killed enemies of types with a death animation, by time of death */
  private readonly died: Int32Array;
  /** Time from kill to removal of each recorded type (enemyDeathDuration), by type index */
  private readonly deathMs: Float64Array;
  /** The longest of them: an enemy killed longer ago than this is gone */
  private readonly longestDeathMs: number;
  /** 1 for an enemy with a body along the route (an ooze): a band, no instance */
  private readonly isBody: Uint8Array;
  /** Body sample of the current and the next frame, valid where the stamp is this pass's */
  private readonly bodyCur: Int32Array;
  private readonly bodyCurStamp: Uint32Array;
  private readonly bodyNext: Int32Array;
  private readonly bodyNextStamp: Uint32Array;
  /** Replay time of a stunned enemy's next spark burst */
  private readonly stunSparkAt: Float64Array;
  /** Spark bursts this pass, at most STUN_SPARKS.perFrame like the live game */
  private sparkBursts = 0;
  /** This apply() pass moves forward in play, not a jump */
  private forward = false;

  // The hero
  /** The hero renderer shows someone: the recorded hero, or on entry the live one */
  private heroShown = false;
  private readonly heroView: HeroPresentation = { lat: 0, lon: 0, heading: 0, pose: 'idle', anchor: { lat: 0, lon: 0 } };
  /** The live blood moon state, put back on exit */
  private bloodMoonBefore = false;

  // Projectiles, by table index
  private readonly projectileShown: Uint8Array;
  private readonly projectileStamp: Uint32Array;
  private readonly projectileNext: Int32Array;
  private readonly projectileNextStamp: Uint32Array;
  private readonly projectileDir: Float32Array;
  private readonly projectileIds: string[] = [];
  private readonly shownProjectiles: Int32Array;
  private shownProjectileCount = 0;

  // Towers, by recording index
  private views: TowerView[] = [];
  private readonly viewById = new Map<string, TowerView>();
  private towerNext: Int32Array = new Int32Array(0);
  private towerNextStamp: Uint32Array = new Uint32Array(0);

  /** Strikes whose marker the replay put up and no impact took down yet */
  private readonly pendingStrikes = new Set<number>();
  /** An ability landed in the replay, its clouds go on exit */
  private abilityLanded = false;
  /** Live towers built after the wave, hidden while the replay runs, and whether they showed */
  private readonly laterTowers: { id: string; visible: boolean }[] = [];

  private readonly origin: { lat: number; lon: number; height: number };
  private readonly metersPerDegreeLon: number;
  private readonly pos = new Vector3();
  private readonly aux = new Vector3();
  private readonly geo = { lat: 0, lon: 0, height: 0 };
  private readonly dir = { dx: 0, dy: 0, dz: 1 };

  constructor(
    private readonly rec: ReplayRecording,
    private readonly engine: ThreeTilesEngine,
    private readonly options: ReplayPlayerOptions = {},
  ) {
    const enemies = rec.enemyCount;
    this.isBody = new Uint8Array(enemies);
    for (const i of rec.bodyStations.keys()) this.isBody[i] = 1;
    this.bodyCur = new Int32Array(enemies);
    this.bodyCurStamp = new Uint32Array(enemies);
    this.bodyNext = new Int32Array(enemies);
    this.bodyNextStamp = new Uint32Array(enemies);
    this.stunSparkAt = new Float64Array(enemies);
    this.enemyShown = new Uint8Array(enemies);
    this.enemyFlags = new Uint8Array(enemies);
    this.enemyStamp = new Uint32Array(enemies);
    this.enemyNext = new Int32Array(enemies);
    this.enemyNextStamp = new Uint32Array(enemies);
    this.enemySlots = new Array<EnemyInstanceState | null>(enemies).fill(null);
    this.shownEnemies = new Int32Array(enemies);
    this.enemyLastSample = new Int32Array(enemies).fill(-1);
    for (let s = 0; s < rec.enemySamples; s++) {
      this.enemyLastSample[rec.eIndex[s]] = s;
    }
    this.died = diedWithDeathAnimation(rec);
    this.deathMs = Float64Array.from(rec.enemyTypeIds, (id) => enemyDeathDuration(ENEMY_TYPES[id as EnemyTypeId] ?? {}));
    this.longestDeathMs = Math.max(0, ...this.deathMs);

    const projectiles = rec.projectileCount;
    this.projectileShown = new Uint8Array(projectiles);
    this.projectileStamp = new Uint32Array(projectiles);
    this.projectileNext = new Int32Array(projectiles);
    this.projectileNextStamp = new Uint32Array(projectiles);
    this.projectileDir = new Float32Array(projectiles * 3);
    this.shownProjectiles = new Int32Array(projectiles);

    this.origin = engine.sync.getOrigin();
    this.metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(this.origin.lat * DEG_TO_RAD);
  }

  // ── State for the replay bar ─────────────────────────────────────

  get currentMs(): number {
    return this.timeMs;
  }

  get durationMs(): number {
    return this.rec.durationMs;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentSpeed(): number {
    return this.speed;
  }

  get enemiesAlive(): number {
    return this.aliveNow;
  }

  get baseHealth(): number {
    return this.rec.healthAt(this.timeMs);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /** Take over the renderers and show the start of the wave, playing. */
  enter(): void {
    const engine = this.engine;
    engine.effects.holdGroundMarks(true);
    this.bus = new GameEventBus();
    this.audioBus = new GameEventBus();
    this.vfx = new VFXService(this.bus, engine);
    this.audio = new AudioService(this.audioBus, engine);
    this.shake = new ScreenShakeService(this.bus, engine);

    // Towers built after the wave were not there yet
    const recorded = new Set(this.rec.towers.map((tower) => tower.id));
    for (const { id, mesh } of engine.towers.getAllMeshes()) {
      if (recorded.has(id)) continue;
      this.laterTowers.push({ id, visible: mesh.visible });
      mesh.visible = false;
      engine.plinths.setVisible(id, false);
      engine.tentacles.setVisible(id, false);
      engine.searchlights.setVisible(id, false);
    }

    this.views = this.rec.towers.map((tower, i) => this.createView(tower, i));
    for (const view of this.views) this.viewById.set(view.tower.id, view);
    this.towerNext = new Int32Array(this.views.length);
    this.towerNextStamp = new Uint32Array(this.views.length);

    // The look of the recorded wave, at once
    this.bloodMoonBefore = engine.bloodMoon.isActive;
    engine.bloodMoon.setActive(this.rec.bloodMoon, true);
    // The live hero goes unless the recording has him on the map
    this.heroShown = true;

    this.seek(0);
    this.playing = true;
  }

  /** Give the renderers back as the live game left them. */
  exit(): void {
    const engine = this.engine;
    for (let k = 0; k < this.shownEnemyCount; k++) this.hideEnemy(this.shownEnemies[k]);
    this.shownEnemyCount = 0;
    this.clearProjectiles();

    for (const view of this.views) {
      if (view.beamOn) engine.flameBeams.stopBeam(view.renderId);
      if (view.saved) {
        this.restoreTower(view, view.saved);
      } else {
        engine.towers.remove(view.renderId);
        engine.plinths.remove(view.renderId);
        engine.tentacles.remove(view.renderId);
        engine.searchlights.remove(view.renderId);
      }
    }
    this.views = [];
    this.viewById.clear();
    for (const { id, visible } of this.laterTowers) {
      const data = engine.towers.get(id);
      if (data) data.mesh.visible = visible;
      engine.plinths.setVisible(id, true);
      engine.tentacles.setVisible(id, true);
      engine.searchlights.setVisible(id, true);
    }
    this.laterTowers.length = 0;
    this.clearStrikes();
    // A killed ooze's band, still mid-collapse, and whatever it already threw don't outlive the replay
    engine.oozes.clear();
    if (this.heroShown) engine.hero.clear();
    this.heroShown = false;
    engine.bloodMoon.setActive(this.bloodMoonBefore, true);

    this.vfx?.destroy();
    this.audio?.destroy();
    this.shake?.destroy();
    this.bus?.clear();
    this.audioBus?.clear();
    this.vfx = this.audio = this.shake = null;
    this.bus = this.audioBus = null;
    engine.effects.holdGroundMarks(false);
    this.playing = false;
  }

  // ── Controls ─────────────────────────────────────────────────────

  play(): void {
    if (this.timeMs >= this.rec.durationMs) this.seek(0);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    // Flames would keep pouring out of a paused tower
    for (const view of this.views) this.stopBeam(view);
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Jump to `ms`: no events in between, projectile trails start over. */
  seek(ms: number): void {
    const t = Math.max(0, Math.min(this.rec.durationMs, ms));
    this.clearProjectiles();
    this.timeMs = t;
    // Stunned enemies spark again from the new time on
    this.stunSparkAt.fill(0);
    // A rumbling tail from before the jump is not heard after it
    this.audio?.clearAbilitySounds();
    this.clearStrikes();
    // Debris a killed ooze threw before the jump would lie on beside the set
    // its band throws again when the jump passes the kill once more
    this.engine.oozes.clearDebris();
    // From the start the events at 0 are still to come (the first sounds of the wave)
    this.eventCursor = t > 0 ? this.rec.eventAfter(t) : 0;
    this.apply(t, false);
  }

  /**
   * Once per rendered frame, wall-clock ms: advance by that times the
   * speed, play the events on the way, show the state at the new time.
   * Sets the engine's timescale, which runs the walk cycles and death
   * animations, to the replay speed (0 while paused).
   */
  update(realDeltaMs: number): void {
    if (this.playing) {
      // A long frame (GC, a shader compile, tiles streaming in) moves the
      // replay no further than the game clock would move the game
      const deltaMs = Math.min(realDeltaMs, GameClock.MAX_CATCHUP_MS);
      const to = Math.min(this.rec.durationMs, this.timeMs + deltaMs * this.speed);
      const gameDeltaMs = to - this.timeMs;
      this.emitEventsUpTo(to);
      this.timeMs = to;
      this.apply(to, true);
      // The rumbling tail of an ability's impact sound, in replay time; too
      // fast for sound, what is left of it goes
      if (this.speed <= REPLAY_CONFIG.maxAudioSpeed) this.audio?.update(gameDeltaMs);
      else this.audio?.clearAbilitySounds();
      if (to >= this.rec.durationMs) this.pause();
    }
    this.engine.setTimescale(this.playing ? this.speed : 0);
  }

  // ── Frame state ──────────────────────────────────────────────────

  private apply(t: number, forward: boolean): void {
    const rec = this.rec;
    const f = rec.frameAt(t);
    if (f < 0) return;
    const g = f + 1 < rec.frameCount ? f + 1 : -1;
    const t0 = rec.frameMs[f];
    const t1 = g >= 0 ? rec.frameMs[g] : t0;
    const alpha = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 0;
    this.stamp++;
    this.forward = forward;
    this.sparkBursts = 0;
    this.applyEnemies(f, g, alpha, t);
    this.applyProjectiles(f, g, t, forward);
    this.applyTowers(f, g, alpha, t);
    this.applyHero(f, g, alpha);
  }

  /** The recorded hero between frame f and g, or none where he was not on the map. */
  private applyHero(f: number, g: number, alpha: number): void {
    const rec = this.rec;
    const code = rec.heroPose[f];
    if (code === 0) {
      if (this.heroShown) this.engine.hero.clear();
      this.heroShown = false;
      return;
    }
    let x = rec.heroPos[f * 2];
    let z = rec.heroPos[f * 2 + 1];
    let heading = rec.heroHeading[f];
    if (g >= 0 && rec.heroPose[g] !== 0) {
      x += (rec.heroPos[g * 2] - x) * alpha;
      z += (rec.heroPos[g * 2 + 1] - z) * alpha;
      heading = lerpAngle(heading, rec.heroHeading[g], alpha);
    }
    // His renderer stands him on the route grid's ground, the height does not matter
    const geo = this.localToGeo(this.pos.set(x, 0, z));
    const view = this.heroView;
    view.lat = geo.lat;
    view.lon = geo.lon;
    view.heading = heading;
    view.pose = heroPoseName(code);
    // His post shows only while he is selected, which he is not in the replay
    view.anchor.lat = geo.lat;
    view.anchor.lon = geo.lon;
    this.engine.hero.present(view);
    this.heroShown = true;
  }

  private applyEnemies(f: number, g: number, alpha: number, t: number): void {
    const rec = this.rec;
    const stamp = this.stamp;
    if (g >= 0) {
      for (let s = rec.frameEnemyStart[g], end = rec.frameEnemyStart[g + 1]; s < end; s++) {
        const i = rec.eIndex[s];
        this.enemyNext[i] = s;
        this.enemyNextStamp[i] = stamp;
      }
      for (let b = rec.frameBodyStart[g], end = rec.frameBodyStart[g + 1]; b < end; b++) {
        const i = rec.bIndex[b];
        this.bodyNext[i] = b;
        this.bodyNextStamp[i] = stamp;
      }
    }
    for (let b = rec.frameBodyStart[f], end = rec.frameBodyStart[f + 1]; b < end; b++) {
      const i = rec.bIndex[b];
      this.bodyCur[i] = b;
      this.bodyCurStamp[i] = stamp;
    }

    let alive = 0;
    const pos = this.pos;
    for (let s = rec.frameEnemyStart[f], end = rec.frameEnemyStart[f + 1]; s < end; s++) {
      const i = rec.eIndex[s];
      // Died, leaked or cleared between this frame and t
      if (t >= rec.enemyEndMs[i]) continue;
      if (this.isBody[i] !== 0) {
        if (this.showBody(i, s, alpha)) alive++;
        continue;
      }
      const n = this.enemyNextStamp[i] === stamp ? this.enemyNext[i] : s;
      lerpSample(rec.ePos, s, n, alpha, pos);
      const heading = lerpAngle(decodeHeading(rec.eHeading[s]), decodeHeading(rec.eHeading[n]), alpha);
      if (this.showAlive(i, s, pos, heading)) alive++;
    }
    this.aliveNow = alive;

    // Death animations running at t, each as long as its type's
    const died = this.died;
    for (let k = this.firstDiedAfter(t - this.longestDeathMs); k < died.length; k++) {
      const i = died[k];
      const diedMs = rec.enemyEndMs[i];
      if (diedMs > t) break;
      if (t - diedMs >= this.deathMs[rec.enemyType[i]]) continue;
      if (this.enemyStamp[i] !== stamp) this.showDying(i);
    }

    let kept = 0;
    for (let k = 0; k < this.shownEnemyCount; k++) {
      const i = this.shownEnemies[k];
      if (this.enemyStamp[i] === stamp || (this.isBody[i] !== 0 && this.sinkBody(i, t))) this.shownEnemies[kept++] = i;
      else this.hideEnemy(i);
    }
    this.shownEnemyCount = kept;
  }

  /**
   * An ooze's band between frame f and the next: its stretch interpolated,
   * health and status from the enemy sample `s` of the same frame.
   * @returns false without a ground to lay it on or a body sample
   */
  private showBody(i: number, s: number, alpha: number): boolean {
    const ground = this.options.ground;
    const stations = this.rec.bodyStations.get(i);
    if (!ground || !stations || this.bodyCurStamp[i] !== this.stamp) return false;
    const rec = this.rec;
    const oozes = this.engine.oozes;
    const id = this.enemyId(i);
    const listed = this.enemyShown[i] !== SHOWN_NONE;
    // Scrubbed back before it went: a sinking band cannot rise again
    if (this.enemyShown[i] === SHOWN_DYING) {
      oozes.discard(id);
      this.enemyShown[i] = SHOWN_NONE;
    }
    if (this.enemyShown[i] === SHOWN_NONE) {
      oozes.add(id, stations, ground);
      this.enemyShown[i] = SHOWN_ALIVE;
      if (!listed) this.shownEnemies[this.shownEnemyCount++] = i;
    }
    this.enemyStamp[i] = this.stamp;

    const b = this.bodyCur[i];
    const n = this.bodyNextStamp[i] === this.stamp ? this.bodyNext[i] : b;
    const flags = rec.eFlags[s];
    oozes.setFrame(
      id,
      rec.bTail[b] + (rec.bTail[n] - rec.bTail[b]) * alpha,
      rec.bTip[b] + (rec.bTip[n] - rec.bTip[b]) * alpha,
      rec.eHp[s] / 255,
      (flags & ENEMY_FLAG.SLOWED) !== 0,
      (flags & ENEMY_FLAG.POISONED) !== 0,
      (flags & ENEMY_FLAG.BURNING) !== 0,
      (flags & ENEMY_FLAG.FROZEN) !== 0,
      (flags & ENEMY_FLAG.STUNNED) !== 0,
    );
    return true;
  }

  /**
   * A killed ooze's band collapses over OOZE_LOOK.collapse, a leaked one's
   * sinks away over OOZE_LOOK.dissolve, as in the live game. @returns true
   * while it goes at `t`
   */
  private sinkBody(i: number, t: number): boolean {
    const end = this.rec.enemyEnd[i];
    const endMs = this.rec.enemyEndMs[i];
    if (end !== ENEMY_END.DIED && end !== ENEMY_END.LEAKED) return false;
    const killed = end === ENEMY_END.DIED;
    const seconds = killed ? OOZE_LOOK.collapse : OOZE_LOOK.dissolve;
    if (t < endMs || t >= endMs + seconds * 1000) return false;
    if (this.enemyShown[i] === SHOWN_ALIVE) {
      if (killed) this.engine.oozes.collapse(this.enemyId(i));
      else this.engine.oozes.remove(this.enemyId(i));
      this.enemyShown[i] = SHOWN_DYING;
    }
    return true;
  }

  /** @returns false when the enemy's type has no instance pool */
  private showAlive(i: number, s: number, pos: Vector3, heading: number): boolean {
    const engine = this.engine;
    const id = this.enemyId(i);
    const listed = this.enemyShown[i] !== SHOWN_NONE;
    // Scrubbed back before its death: a death animation cannot run backwards
    if (this.enemyShown[i] === SHOWN_DYING) {
      this.releaseEnemy(i);
      this.enemyShown[i] = SHOWN_NONE;
    }
    if (this.enemyShown[i] === SHOWN_NONE) {
      if (!this.spawnEnemy(i, id)) return false;
      this.enemyShown[i] = SHOWN_ALIVE;
      if (!listed) this.shownEnemies[this.shownEnemyCount++] = i;
    }
    this.enemyStamp[i] = this.stamp;

    let slot = this.enemySlots[i];
    if (slot === null || slot.released) slot = this.enemySlots[i] = engine.enemies.resolveSlot(id);
    if (slot === null) return false;
    this.applyStatus(i, id, this.rec.eFlags[s], pos);
    engine.enemies.updateSlot(slot, pos, heading, this.rec.eHp[s] / 255, this.rec.eSpeed[s] / 100);
    return true;
  }

  private showDying(i: number): void {
    const s = this.enemyLastSample[i];
    // Killed before it was ever sampled: nothing known of where
    if (s < 0) return;
    const engine = this.engine;
    const id = this.enemyId(i);
    const listed = this.enemyShown[i] !== SHOWN_NONE;
    if (this.enemyShown[i] === SHOWN_NONE) {
      if (!this.spawnEnemy(i, id)) return;
      const slot = this.enemySlots[i];
      if (slot !== null) {
        lerpSample(this.rec.ePos, s, s, 0, this.pos);
        engine.enemies.updateSlot(slot, this.pos, decodeHeading(this.rec.eHeading[s]), 0, 0);
      }
    }
    if (this.enemyShown[i] !== SHOWN_DYING) {
      // Its tints and auras go with it
      this.applyStatus(i, id, 0, this.pos);
      engine.enemies.playDeathAnimation(id);
      this.enemyShown[i] = SHOWN_DYING;
    }
    this.enemyStamp[i] = this.stamp;
    if (!listed) this.shownEnemies[this.shownEnemyCount++] = i;
  }

  private spawnEnemy(i: number, id: string): boolean {
    const engine = this.engine;
    const typeId = this.rec.enemyTypeIds[this.rec.enemyType[i]] as EnemyTypeId;
    // The pools are baked at load, so the instance is there before create() resolves
    void engine.enemies.create(id, typeId, this.origin.lat, this.origin.lon, this.origin.height);
    const slot = engine.enemies.resolveSlot(id);
    if (slot === null) return false;
    this.enemySlots[i] = slot;
    this.enemyFlags[i] = 0;
    engine.enemies.startWalkAnimation(id);
    return true;
  }

  /** Tints, auras and walk or run, switched where they changed. */
  private applyStatus(i: number, id: string, flags: number, pos: Vector3): void {
    const was = this.enemyFlags[i];
    if (flags === was && (flags & FOLLOWED_FLAGS) === 0) return;
    const { enemies, effects } = this.engine;

    const slowed = (flags & ENEMY_FLAG.SLOWED) !== 0;
    if (slowed && (was & ENEMY_FLAG.SLOWED) === 0) {
      enemies.setFreezeVisual(id, true);
      effects.spawnFrostAura(id, pos);
    } else if (slowed) {
      effects.updateFrostAuraPosition(id, pos);
    } else if ((was & ENEMY_FLAG.SLOWED) !== 0) {
      enemies.setFreezeVisual(id, false);
      effects.stopFrostAura(id);
    }

    const poisoned = (flags & ENEMY_FLAG.POISONED) !== 0;
    if (poisoned && (was & ENEMY_FLAG.POISONED) === 0) {
      enemies.setPoisonVisual(id, true);
      effects.spawnPoisonAura(id, pos);
    } else if (poisoned) {
      effects.updatePoisonAuraPosition(id, pos);
    } else if ((was & ENEMY_FLAG.POISONED) !== 0) {
      enemies.setPoisonVisual(id, false);
      effects.stopPoisonAura(id);
    }

    const burning = (flags & ENEMY_FLAG.BURNING) !== 0;
    if (burning !== ((was & ENEMY_FLAG.BURNING) !== 0)) enemies.setBurnVisual(id, burning);

    const frozen = (flags & ENEMY_FLAG.FROZEN) !== 0;
    if (frozen && (was & ENEMY_FLAG.FROZEN) === 0) {
      enemies.setIcedVisual(id, true);
      effects.spawnIceCrystals(id, pos);
    } else if (frozen) {
      effects.updateIceCrystalsPosition(id, pos);
    } else if ((was & ENEMY_FLAG.FROZEN) !== 0) {
      enemies.setIcedVisual(id, false);
      effects.stopIceCrystals(id);
    }

    // Stunned: the tint, and spark bursts every STUN_SPARKS.intervalMs of replay time while it plays
    const stunned = (flags & ENEMY_FLAG.STUNNED) !== 0;
    if (stunned !== ((was & ENEMY_FLAG.STUNNED) !== 0)) {
      enemies.setStunVisual(id, stunned);
      this.stunSparkAt[i] = this.timeMs;
    }
    if (stunned && this.forward && this.timeMs >= this.stunSparkAt[i] && this.sparkBursts < STUN_SPARKS.perFrame) {
      this.sparkBursts++;
      const geo = this.localToGeo(pos);
      effects.spawnBurstAtGeo(geo.lat, geo.lon, geo.height + STUN_SPARKS.height, STUN_SPARKS.particles, BURST_PALETTES.stun);
      this.stunSparkAt[i] = this.timeMs + STUN_SPARKS.intervalMs;
    }

    const running = (flags & ENEMY_FLAG.RUNNING) !== 0;
    if (running !== ((was & ENEMY_FLAG.RUNNING) !== 0)) {
      if (running) enemies.startRunAnimation(id);
      else enemies.startWalkAnimation(id);
    }
    this.enemyFlags[i] = flags;
  }

  /** Take the enemy's instance and auras down; its entry keeps its place in the list. */
  private releaseEnemy(i: number): void {
    const id = this.enemyId(i);
    // A band goes at once, sinking or not
    if (this.isBody[i] !== 0) {
      this.engine.oozes.discard(id);
      return;
    }
    const was = this.enemyFlags[i];
    if ((was & ENEMY_FLAG.SLOWED) !== 0) this.engine.effects.stopFrostAura(id);
    if ((was & ENEMY_FLAG.POISONED) !== 0) this.engine.effects.stopPoisonAura(id);
    if ((was & ENEMY_FLAG.FROZEN) !== 0) this.engine.effects.stopIceCrystals(id);
    this.engine.enemies.remove(id);
    this.enemySlots[i] = null;
    this.enemyFlags[i] = 0;
  }

  private hideEnemy(i: number): void {
    if (this.enemyShown[i] !== SHOWN_NONE) this.releaseEnemy(i);
    this.enemyShown[i] = SHOWN_NONE;
  }

  private enemyId(i: number): string {
    return (this.enemyIds[i] ??= `replay-enemy-${i}`);
  }

  /** First entry of `died` that died after `ms`. */
  private firstDiedAfter(ms: number): number {
    const died = this.died;
    const endMs = this.rec.enemyEndMs;
    let lo = 0;
    let hi = died.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (endMs[died[mid]] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private applyProjectiles(f: number, g: number, t: number, forward: boolean): void {
    const rec = this.rec;
    const stamp = this.stamp;
    if (g >= 0) {
      for (let s = rec.frameProjectileStart[g], end = rec.frameProjectileStart[g + 1]; s < end; s++) {
        const i = rec.pIndex[s];
        this.projectileNext[i] = s;
        this.projectileNextStamp[i] = stamp;
      }
    }

    const t0 = rec.frameMs[f];
    const pos = this.pos;
    const to = this.aux;
    for (let s = rec.frameProjectileStart[f], end = rec.frameProjectileStart[f + 1]; s < end; s++) {
      const i = rec.pIndex[s];
      const endMs = rec.projectileEndMs[i];
      if (t >= endMs) continue;

      // Towards its next sample, or towards where it hit
      let share = 0;
      if (this.projectileNextStamp[i] === stamp) {
        const n = this.projectileNext[i] * 3;
        to.set(rec.pPos[n], rec.pPos[n + 1], rec.pPos[n + 2]);
        share = (t - t0) / (rec.frameMs[g] - t0);
      } else if (endMs !== Infinity && !Number.isNaN(rec.projectileEndPos[i * 3])) {
        to.set(rec.projectileEndPos[i * 3], rec.projectileEndPos[i * 3 + 1], rec.projectileEndPos[i * 3 + 2]);
        share = endMs > t0 ? (t - t0) / (endMs - t0) : 0;
      } else {
        to.set(rec.pPos[s * 3], rec.pPos[s * 3 + 1], rec.pPos[s * 3 + 2]);
      }
      const x = rec.pPos[s * 3];
      const y = rec.pPos[s * 3 + 1];
      const z = rec.pPos[s * 3 + 2];
      pos.set(x + (to.x - x) * share, y + (to.y - y) * share, z + (to.z - z) * share);

      // Facing along its flight; a projectile that holds still keeps its last direction
      const d = i * 3;
      const dx = to.x - x;
      const dy = to.y - y;
      const dz = to.z - z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 1e-4) {
        this.projectileDir[d] = dx / len;
        this.projectileDir[d + 1] = dy / len;
        this.projectileDir[d + 2] = dz / len;
      }
      this.dir.dx = this.projectileDir[d];
      this.dir.dy = this.projectileDir[d + 1];
      this.dir.dz = this.projectileDir[d + 2];
      this.showProjectile(i, pos, forward);
    }

    let kept = 0;
    for (let k = 0; k < this.shownProjectileCount; k++) {
      const i = this.shownProjectiles[k];
      if (this.projectileStamp[i] === stamp) this.shownProjectiles[kept++] = i;
      else this.hideProjectile(i);
    }
    this.shownProjectileCount = kept;
  }

  private showProjectile(i: number, pos: Vector3, forward: boolean): void {
    const engine = this.engine;
    const id = (this.projectileIds[i] ??= `replay-projectile-${i}`);
    const geo = this.localToGeo(pos);
    if (this.projectileShown[i] === 0) {
      const typeId = this.rec.projectileTypeIds[this.rec.projectileType[i]] as ProjectileTypeId;
      const config = PROJECTILE_TYPES[typeId];
      if (!config) return;
      engine.projectiles.create(id, typeId, geo.lat, geo.lon, geo.height, this.dir);
      engine.trailStreaks.create(id, config.visualType);
      this.projectileShown[i] = 1;
      this.shownProjectiles[this.shownProjectileCount++] = i;
    } else {
      engine.projectiles.updateWithRotation(id, geo.lat, geo.lon, geo.height, this.dir);
    }
    if (forward) engine.trailStreaks.pushPosition(id, pos);
    this.projectileStamp[i] = this.stamp;
  }

  private hideProjectile(i: number): void {
    const id = this.projectileIds[i];
    this.engine.projectiles.remove(id);
    this.engine.trailStreaks.remove(id);
    this.projectileShown[i] = 0;
  }

  private clearProjectiles(): void {
    for (let k = 0; k < this.shownProjectileCount; k++) this.hideProjectile(this.shownProjectiles[k]);
    this.shownProjectileCount = 0;
  }

  private applyTowers(f: number, g: number, alpha: number, t: number): void {
    const rec = this.rec;
    const engine = this.engine;
    const stamp = this.stamp;

    for (const view of this.views) {
      const wanted = t >= view.tower.placedMs && t < view.tower.soldMs;
      if (wanted !== view.visible) this.setTowerVisible(view, wanted);
    }

    if (g >= 0) {
      for (let s = rec.frameTowerStart[g], end = rec.frameTowerStart[g + 1]; s < end; s++) {
        const i = rec.tIndex[s];
        this.towerNext[i] = s;
        this.towerNextStamp[i] = stamp;
      }
    }

    const target = this.aux;
    for (let s = rec.frameTowerStart[f], end = rec.frameTowerStart[f + 1]; s < end; s++) {
      const i = rec.tIndex[s];
      const view = this.views[i];
      if (!view || !view.visible) continue;
      view.stamp = stamp;

      const n = this.towerNextStamp[i] === stamp ? this.towerNext[i] : s;
      const rotation = lerpAngle(rec.tRot[s], rec.tRot[n], alpha);
      const data = engine.towers.get(view.renderId);
      if (data) {
        // Also on a tower without a turret part: its searchlight follows the aim
        data.currentLocalRotation = rotation;
        if (data.turretPart) data.turretPart.rotation.y = rotation;
      }

      const flags = rec.tFlags[s];
      const a = s * 4;
      target.set(rec.tAux[a], rec.tAux[a + 1], rec.tAux[a + 2]);
      if ((flags & TOWER_FLAG.BEAM) !== 0 && this.playing) {
        engine.flameBeams.startBeam(view.renderId, view.tip, target, 0, rec.tAux[a + 3]);
        view.beamOn = true;
      } else {
        this.stopBeam(view);
      }
      if ((flags & TOWER_FLAG.STRIKE) !== 0) {
        const st = view.strikeTarget;
        const moved = (st.x - target.x) ** 2 + (st.y - target.y) ** 2 + (st.z - target.z) ** 2;
        if (!view.strikeOn || moved > NEW_STRIKE_DISTANCE_SQ) {
          engine.tentacles.startStrike(view.renderId, target);
          st.copy(target);
        }
        view.strikeOn = true;
      } else {
        view.strikeOn = false;
      }
    }

    // Towers without a sample in this frame fire nothing
    for (const view of this.views) {
      if (view.stamp === stamp) continue;
      this.stopBeam(view);
      view.strikeOn = false;
    }
  }

  private createView(tower: ReplayTower, index: number): TowerView {
    const engine = this.engine;
    const config = TOWER_TYPES[tower.typeId];
    const tip = engine.sync.geoToLocalSimple(tower.lat, tower.lon, tower.height).clone();
    tip.y += (config?.heightOffset ?? 0) + (config?.shootHeight ?? 0);

    const live = tower.soldMs === Infinity ? engine.towers.get(tower.id) : undefined;
    let saved: SavedTower | null = null;
    let renderId = tower.id;
    if (live) {
      saved = {
        current: live.currentLocalRotation,
        target: live.targetLocalRotation,
        hasTarget: live.hasTarget,
        scanPhase: live.scanPhase,
        scanStart: live.scanStartRotation,
        scanDelay: live.scanDelayRemaining,
        turretY: live.turretPart ? live.turretPart.rotation.y : null,
        meshVisible: live.mesh.visible,
        tentacle: engine.tentacles.captureStrike(tower.id),
      };
      // The replay turns the turret itself; no sweep of its own in between
      live.scanPhase = 0;
    } else {
      // Sold during the wave: a model of the replay's own while the replay runs
      renderId = `replay-tower-${index}`;
      void engine.towers.create(renderId, tower.typeId, tower.lat, tower.lon, tower.height, tower.customRotation, null);
      if (tower.plinthHeight > 0 && config) {
        engine.plinths.create(
          renderId, tower.lat, tower.lon, tower.height, tower.plinthHeight, config.footprintRadius, tower.plinthOverhang,
        );
      }
      if (tower.typeId === 'tentacle') engine.tentacles.create(renderId, tip);
      // Its blood moon searchlight, turned with the recorded aim
      if (config) engine.searchlights.add(renderId, tower.lat, tower.lon, tower.height, config);
    }
    return {
      tower,
      renderId,
      saved,
      visible: true,
      tip,
      beamOn: false,
      strikeOn: false,
      strikeTarget: new Vector3(),
      stamp: 0,
    };
  }

  /** @returns false while the model is still loading; the next frame tries again */
  private setTowerVisible(view: TowerView, visible: boolean): boolean {
    const data = this.engine.towers.get(view.renderId);
    if (!data) return false;
    data.mesh.visible = visible;
    this.engine.plinths.setVisible(view.renderId, visible);
    this.engine.tentacles.setVisible(view.renderId, visible);
    this.engine.searchlights.setVisible(view.renderId, visible);
    view.visible = visible;
    if (!visible) {
      this.stopBeam(view);
      view.strikeOn = false;
    }
    return true;
  }

  private restoreTower(view: TowerView, saved: SavedTower): void {
    const data = this.engine.towers.get(view.renderId);
    this.engine.plinths.setVisible(view.renderId, true);
    this.engine.tentacles.setVisible(view.renderId, true);
    this.engine.searchlights.setVisible(view.renderId, true);
    // A strike of the replay's own does not stay on the live tentacle
    if (saved.tentacle) this.engine.tentacles.restoreStrike(view.renderId, saved.tentacle);
    if (!data) return;
    data.currentLocalRotation = saved.current;
    data.targetLocalRotation = saved.target;
    data.hasTarget = saved.hasTarget;
    data.scanPhase = saved.scanPhase;
    data.scanStartRotation = saved.scanStart;
    data.scanDelayRemaining = saved.scanDelay;
    if (data.turretPart && saved.turretY !== null) data.turretPart.rotation.y = saved.turretY;
    data.mesh.visible = saved.meshVisible;
  }

  private stopBeam(view: TowerView): void {
    if (!view.beamOn) return;
    this.engine.flameBeams.stopBeam(view.renderId);
    view.beamOn = false;
  }

  // ── Events ───────────────────────────────────────────────────────

  /**
   * Take down what the replay's strikes put up: the markers still waiting
   * for their impact and, once one landed, the clouds, bursts, pulses and
   * beams (those of the live game with them). On exit and on every jump: a
   * marker whose impact the jump skipped would stand to the end, an effect
   * from before a jump back would run on and land a second time.
   */
  private clearStrikes(): void {
    const engine = this.engine;
    for (const strikeId of this.pendingStrikes) engine.abilityMarkers.removeStrike(strikeId);
    this.pendingStrikes.clear();
    if (this.abilityLanded) {
      engine.mushroomClouds.clear();
      engine.frostBursts.clear();
      engine.empPulses.clear();
      engine.orbitalBeams.clear();
    }
  }

  /** Play the recorded events up to `ms` on the replay's own bus. */
  private emitEventsUpTo(ms: number): void {
    const bus = this.bus;
    if (!bus) return;
    const rec = this.rec;
    // Sounds go on the AudioService's bus, and only at a speed with sound
    const audioBus = this.speed <= REPLAY_CONFIG.maxAudioSpeed ? this.audioBus : null;
    while (this.eventCursor < rec.events.length && rec.eventMs[this.eventCursor] <= ms) {
      const event = rec.events[this.eventCursor++];
      switch (event.type) {
        case 'audio:play':
          audioBus?.emit(event);
          continue;
        case 'vfx:muzzle-flash': {
          // A tower sold during the wave flashes on its replay model
          const view = this.viewById.get(event.towerId);
          if (view && view.renderId !== event.towerId) {
            bus.emit({ ...event, towerId: view.renderId });
            continue;
          }
          break;
        }
        case 'ability:used':
          this.pendingStrikes.add(event.strikeId);
          break;
        case 'ability:impact':
          this.pendingStrikes.delete(event.strikeId);
          this.abilityLanded = true;
          // Its impact sound and tail (AudioService); the effects and shake below either way
          audioBus?.emit(event);
          break;
      }
      bus.emit(event);
    }
  }

  /** Local to geo, the exact inverse of EllipsoidSync.geoToLocalSimple. Reuses one object. */
  private localToGeo(p: Vector3): { lat: number; lon: number; height: number } {
    const geo = this.geo;
    geo.lat = this.origin.lat + p.z / METERS_PER_DEGREE_LAT;
    geo.lon = this.origin.lon - p.x / this.metersPerDegreeLon;
    geo.height = p.y + this.origin.height;
    return geo;
  }
}

/** Killed enemies whose type plays a death animation, by time of death; a band sinks instead. */
function diedWithDeathAnimation(rec: ReplayRecording): Int32Array {
  const hasAnimation = rec.enemyTypeIds.map((id) => {
    const config = ENEMY_TYPES[id as EnemyTypeId];
    return !!config && (!!config.deathAnimation || (config.deathAnimations?.length ?? 0) > 0);
  });
  const died: number[] = [];
  for (let i = 0; i < rec.enemyCount; i++) {
    if (rec.enemyEnd[i] === ENEMY_END.DIED && hasAnimation[rec.enemyType[i]] && !rec.bodyStations.has(i)) died.push(i);
  }
  died.sort((a, b) => rec.enemyEndMs[a] - rec.enemyEndMs[b]);
  return Int32Array.from(died);
}

/** Position between sample `a` and `b` of an (x, y, z) column. */
function lerpSample(column: Float32Array, a: number, b: number, t: number, out: Vector3): Vector3 {
  const i = a * 3;
  const j = b * 3;
  return out.set(
    column[i] + (column[j] - column[i]) * t,
    column[i + 1] + (column[j + 1] - column[i + 1]) * t,
    column[i + 2] + (column[j + 2] - column[i + 2]) * t,
  );
}

/** Angle between `a` and `b` the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return a + d * t;
}
