import { REPLAY_CONFIG } from '../configs/replay.config';
import type { GameEvent } from '../game-engine/game-event-bus';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { WaveConfig } from '../managers/wave.manager';
import type { HeroPresentation } from '../managers/hero.manager';
import type { RouteBodyStations } from '../utils/route-body';

/**
 * The last wave as the replay plays it: what was on screen, frame by frame,
 * plus the effect events and the player's commands in between (docs/REPLAY.md).
 *
 * A presentation recording, not a re-simulation: frames hold what the
 * renderers showed (positions, headings, health, status tints, turret
 * rotations, the oozes' bodies, the hero), so playing it back never touches
 * the simulation. Filled by the ReplayRecorder, read by the ReplayPlayer.
 *
 * Samples live in growable typed arrays, one column per field. They are kept
 * from wave to wave, so after the first big wave recording allocates nothing
 * but the tables of new enemies and projectiles. All samples together stay
 * within REPLAY_CONFIG.sampleBudgetBytes: when a frame does not fit, every
 * second frame goes and the spacing doubles (thin()).
 */

/** How an enemy's part in the replay ended */
export const ENEMY_END = {
  /** Still on the route when the recording stopped (so far) */
  OPEN: 0,
  /** Killed; the death animation plays from here */
  DIED: 1,
  /** Reached the HQ */
  LEAKED: 2,
  /** Gone without either, game over or removed by a debug tool */
  CLEARED: 3,
} as const;

/** Status bits of an enemy sample */
export const ENEMY_FLAG = {
  SLOWED: 1,
  POISONED: 2,
  BURNING: 4,
  /** Running instead of walking (EnemyRush) */
  RUNNING: 8,
  /** Frozen solid (frost bomb) */
  FROZEN: 16,
  /** Stunned (EMP) */
  STUNNED: 32,
} as const;

/** Bits of a tower sample */
export const TOWER_FLAG = {
  /** Flame beam on; aux is the beam's target (local) and width */
  BEAM: 1,
  /** Tentacle striking; aux is the strike target (local) */
  STRIKE: 2,
} as const;

export type ReplayHeroPose = HeroPresentation['pose'];

/** The hero's pose per frame by code - 1; code 0 = no hero on the map */
const HERO_POSES: readonly ReplayHeroPose[] = ['idle', 'run', 'shoot', 'run-shoot'];

export function heroPoseCode(pose: ReplayHeroPose): number {
  return HERO_POSES.indexOf(pose) + 1;
}

/** The pose of a non-zero code */
export function heroPoseName(code: number): ReplayHeroPose {
  return HERO_POSES[code - 1] ?? 'idle';
}

/** Bytes of one sample, see the columns below */
export const ENEMY_SAMPLE_BYTES = 22;
export const PROJECTILE_SAMPLE_BYTES = 16;
export const TOWER_SAMPLE_BYTES = 23;
export const BODY_SAMPLE_BYTES = 12;

/** A tower of the wave: stood at its start, or placed during it */
export interface ReplayTower {
  id: string;
  typeId: TowerTypeId;
  lat: number;
  lon: number;
  /** The tower's foot (geo), on uneven ground the top of its plinth */
  height: number;
  customRotation: number;
  plinthHeight: number;
  /** Footprint probes the plinth hangs over a drop at, see Tower.plinthOverhang */
  plinthOverhang: readonly number[];
  /** Placed during the wave at this time (ms), -1 when it stood before */
  placedMs: number;
  /** Sold during the wave at this time (ms), Infinity when it still stands */
  soldMs: number;
}

/** A player command of the wave as plain data, see toPlainData() */
export interface ReplayCommand {
  ms: number;
  command: Record<string, unknown>;
}

/** What a frame reservation came to, see ReplayRecording.reserveFrame() */
export type FrameFit = 'ok' | 'thinned' | 'full';

type Column = Uint8Array | Uint16Array | Uint32Array | Int16Array | Float32Array | Float64Array;

/** `column` with room for at least `length` entries, the old ones copied. */
function withLength<T extends Column>(column: T, length: number): T {
  if (column.length >= length) return column;
  const grown = new (column.constructor as unknown as new (n: number) => T)(length);
  grown.set(column);
  return grown;
}

const TWO_PI = Math.PI * 2;
const HEADING_SCALE = 32767 / Math.PI;

/** An angle as a signed 16 bit fraction of a half turn. */
export function encodeHeading(radians: number): number {
  const wrapped = radians - Math.round(radians / TWO_PI) * TWO_PI;
  return Math.round(wrapped * HEADING_SCALE);
}

export function decodeHeading(encoded: number): number {
  return encoded / HEADING_SCALE;
}

/** First capacity of the sample columns; they double from here */
const INITIAL_SAMPLES = 4096;
/** Bodies along the route are few (the oozes), their column starts small */
const INITIAL_BODY_SAMPLES = 64;
const INITIAL_ENTITIES = 256;
/**
 * Share of its need a column grows past it once doubling no longer fits
 * the budget (makeRoom): one or two copies near the limit instead of one
 * per frame until thin()
 */
const GROWTH_SLACK = 0.5;
const INITIAL_FRAMES = 1024;

export class ReplayRecording {
  // ── Header ──────────────────────────────────────────────────────
  wave = 0;
  /** Game clock (ms) at the start of the wave; every time below counts from here */
  startGameMs = 0;
  /** Length of the replay (ms): the time of the last frame */
  durationMs = 0;
  /** Set once the recording is complete */
  outcome: 'completed' | 'gameover' | null = null;
  baseHealthAtStart = 0;
  creditsAtStart = 0;
  /** A blood moon wave (isBloodMoonWave): the replay wears its look */
  bloodMoon = false;
  /** The config of the command that started the wave, for a later re-simulation */
  waveConfig: WaveConfig | null = null;
  /** Sub-steps between two frames; doubles each time thin() runs */
  stepsPerFrame: number = REPLAY_CONFIG.stepsPerFrame;
  /** The budget ran out at the coarsest spacing: no frames after durationMs */
  truncated = false;
  /** Events past REPLAY_CONFIG.maxEvents, not kept */
  droppedEvents = 0;

  // ── Enemies: one entry per body of the wave ─────────────────────
  enemyCount = 0;
  readonly enemyTypeIds: string[] = [];
  private readonly enemyTypeIndex = new Map<string, number>();
  enemyType = new Uint16Array(INITIAL_ENTITIES);
  enemySpawnMs = new Float32Array(INITIAL_ENTITIES);
  /** Time the enemy died, leaked or was cleared; Infinity while open */
  enemyEndMs = new Float32Array(INITIAL_ENTITIES);
  /** ENEMY_END */
  enemyEnd = new Uint8Array(INITIAL_ENTITIES);
  /** Route stations of the enemies with a body along the route (the oozes), by table index */
  readonly bodyStations = new Map<number, RouteBodyStations>();

  // ── Projectiles ──────────────────────────────────────────────────
  projectileCount = 0;
  readonly projectileTypeIds: string[] = [];
  private readonly projectileTypeIndex = new Map<string, number>();
  projectileType = new Uint16Array(INITIAL_ENTITIES);
  /** Time it hit or vanished; Infinity while in flight */
  projectileEndMs = new Float32Array(INITIAL_ENTITIES);
  /** Where it hit (local x, y, z); NaN when it vanished without a hit event */
  projectileEndPos = new Float32Array(INITIAL_ENTITIES * 3);

  // ── Towers ───────────────────────────────────────────────────────
  readonly towers: ReplayTower[] = [];

  // ── Frames ───────────────────────────────────────────────────────
  frameCount = 0;
  frameMs = new Float64Array(INITIAL_FRAMES);
  /** First sample of each frame; the entry at frameCount ends the last frame */
  frameEnemyStart = new Uint32Array(INITIAL_FRAMES + 1);
  frameProjectileStart = new Uint32Array(INITIAL_FRAMES + 1);
  frameTowerStart = new Uint32Array(INITIAL_FRAMES + 1);
  frameBodyStart = new Uint32Array(INITIAL_FRAMES + 1);

  // ── The hero, one entry per frame (13 bytes, not in the budget) ─
  /** heroPoseCode(), 0 when he is not on the map */
  heroPose = new Uint8Array(INITIAL_FRAMES);
  /** Local x, z; his feet stand on the route grid's ground */
  heroPos = new Float32Array(INITIAL_FRAMES * 2);
  /** Heading, TransformComponent's convention */
  heroHeading = new Float32Array(INITIAL_FRAMES);

  // ── Enemy samples (ENEMY_SAMPLE_BYTES) ──────────────────────────
  enemySamples = 0;
  eIndex = new Uint32Array(INITIAL_SAMPLES);
  /** Render position in local coordinates, height offset included (x, y, z) */
  ePos = new Float32Array(INITIAL_SAMPLES * 3);
  /** encodeHeading() of the model's heading */
  eHeading = new Int16Array(INITIAL_SAMPLES);
  /** Ground speed in cm/s, drives the walk cycle */
  eSpeed = new Uint16Array(INITIAL_SAMPLES);
  /** Health share, 0-255 */
  eHp = new Uint8Array(INITIAL_SAMPLES);
  /** ENEMY_FLAG */
  eFlags = new Uint8Array(INITIAL_SAMPLES);

  // ── Projectile samples (PROJECTILE_SAMPLE_BYTES) ────────────────
  projectileSamples = 0;
  pIndex = new Uint32Array(INITIAL_SAMPLES);
  pPos = new Float32Array(INITIAL_SAMPLES * 3);

  // ── Tower samples (TOWER_SAMPLE_BYTES) ──────────────────────────
  towerSamples = 0;
  tIndex = new Uint16Array(INITIAL_SAMPLES);
  /** Turret rotation relative to the tower model (TowerRenderData.currentLocalRotation) */
  tRot = new Float32Array(INITIAL_SAMPLES);
  /** TOWER_FLAG */
  tFlags = new Uint8Array(INITIAL_SAMPLES);
  /** Beam or strike target (local x, y, z) and the beam width */
  tAux = new Float32Array(INITIAL_SAMPLES * 4);

  // ── Body samples (BODY_SAMPLE_BYTES): a body's stretch along its route ─
  bodySamples = 0;
  /** Enemy table index; the enemy has its own sample (tip, health, status) in the same frame */
  bIndex = new Uint32Array(INITIAL_BODY_SAMPLES);
  /** Rear end and tip, metres from path[0] (RouteBody) */
  bTail = new Float32Array(INITIAL_BODY_SAMPLES);
  bTip = new Float32Array(INITIAL_BODY_SAMPLES);

  // ── Events ───────────────────────────────────────────────────────
  /** Effect and sound events in time order, played back on the replay's own bus */
  readonly events: GameEvent[] = [];
  readonly eventMs: number[] = [];
  /** Every command:* of the wave in time order */
  readonly commands: ReplayCommand[] = [];
  /** HQ health after each change (health:changed) */
  readonly healthMs: number[] = [];
  readonly healthValue: number[] = [];

  /** Start a new recording; the columns keep their capacity. */
  reset(wave: number, startGameMs: number, baseHealth: number, credits: number, waveConfig: WaveConfig | null): void {
    this.wave = wave;
    this.startGameMs = startGameMs;
    this.durationMs = 0;
    this.outcome = null;
    this.baseHealthAtStart = baseHealth;
    this.creditsAtStart = credits;
    this.bloodMoon = false;
    this.waveConfig = waveConfig;
    this.stepsPerFrame = REPLAY_CONFIG.stepsPerFrame;
    this.truncated = false;
    this.droppedEvents = 0;
    this.enemyCount = 0;
    this.enemyTypeIds.length = 0;
    this.enemyTypeIndex.clear();
    this.bodyStations.clear();
    this.projectileCount = 0;
    this.projectileTypeIds.length = 0;
    this.projectileTypeIndex.clear();
    this.towers.length = 0;
    this.frameCount = 0;
    this.frameEnemyStart[0] = 0;
    this.frameProjectileStart[0] = 0;
    this.frameTowerStart[0] = 0;
    this.frameBodyStart[0] = 0;
    this.enemySamples = 0;
    this.projectileSamples = 0;
    this.towerSamples = 0;
    this.bodySamples = 0;
    this.events.length = 0;
    this.eventMs.length = 0;
    this.commands.length = 0;
    this.healthMs.length = 0;
    this.healthValue.length = 0;
  }

  // ── Tables ───────────────────────────────────────────────────────

  addEnemy(typeId: string, spawnMs: number): number {
    const i = this.enemyCount++;
    if (i >= this.enemyType.length) {
      const n = this.enemyType.length * 2;
      this.enemyType = withLength(this.enemyType, n);
      this.enemySpawnMs = withLength(this.enemySpawnMs, n);
      this.enemyEndMs = withLength(this.enemyEndMs, n);
      this.enemyEnd = withLength(this.enemyEnd, n);
    }
    this.enemyType[i] = typeIndex(typeId, this.enemyTypeIds, this.enemyTypeIndex);
    this.enemySpawnMs[i] = spawnMs;
    this.enemyEndMs[i] = Infinity;
    this.enemyEnd[i] = ENEMY_END.OPEN;
    return i;
  }

  /** Close an open enemy; one that already ended keeps its end. */
  endEnemy(index: number, ms: number, end: number): void {
    if (this.enemyEnd[index] !== ENEMY_END.OPEN) return;
    this.enemyEnd[index] = end;
    this.enemyEndMs[index] = ms;
  }

  addProjectile(typeId: string): number {
    const i = this.projectileCount++;
    if (i >= this.projectileType.length) {
      const n = this.projectileType.length * 2;
      this.projectileType = withLength(this.projectileType, n);
      this.projectileEndMs = withLength(this.projectileEndMs, n);
      this.projectileEndPos = withLength(this.projectileEndPos, n * 3);
    }
    this.projectileType[i] = typeIndex(typeId, this.projectileTypeIds, this.projectileTypeIndex);
    this.projectileEndMs[i] = Infinity;
    return i;
  }

  /** Close a projectile in flight at local (x, y, z), NaN when the spot is unknown. */
  endProjectile(index: number, ms: number, x: number, y: number, z: number): void {
    if (this.projectileEndMs[index] !== Infinity) return;
    this.projectileEndMs[index] = ms;
    this.projectileEndPos[index * 3] = x;
    this.projectileEndPos[index * 3 + 1] = y;
    this.projectileEndPos[index * 3 + 2] = z;
  }

  addTower(tower: ReplayTower): number {
    this.towers.push(tower);
    return this.towers.length - 1;
  }

  // ── Frames ───────────────────────────────────────────────────────

  /**
   * Room for one more frame of up to `enemies`, `projectiles`, `towers` and
   * `bodies` samples. 'ok' with room, 'thinned' after thin() made room (the
   * caller skips a frame that is off the new spacing), 'full' when even the
   * coarsest spacing leaves none (the recording stops growing, `truncated`).
   */
  reserveFrame(enemies: number, projectiles: number, towers: number, bodies = 0): FrameFit {
    if (this.truncated) return 'full';
    let fit: FrameFit = 'ok';
    while (!this.makeRoom(
      this.enemySamples + enemies,
      this.projectileSamples + projectiles,
      this.towerSamples + towers,
      this.bodySamples + bodies,
    )) {
      if (this.stepsPerFrame * 2 > REPLAY_CONFIG.maxStepsPerFrame || this.frameCount < 2) {
        this.truncated = true;
        return 'full';
      }
      this.thin();
      fit = 'thinned';
    }
    return fit;
  }

  /** Open frame `frameCount` at `ms`; samples follow, endFrame() closes it. Returns its index. */
  beginFrame(ms: number): number {
    const f = this.frameCount;
    if (f + 1 >= this.frameMs.length) {
      const n = this.frameMs.length * 2;
      this.frameMs = withLength(this.frameMs, n);
      this.frameEnemyStart = withLength(this.frameEnemyStart, n + 1);
      this.frameProjectileStart = withLength(this.frameProjectileStart, n + 1);
      this.frameTowerStart = withLength(this.frameTowerStart, n + 1);
      this.frameBodyStart = withLength(this.frameBodyStart, n + 1);
      this.heroPose = withLength(this.heroPose, n);
      this.heroPos = withLength(this.heroPos, n * 2);
      this.heroHeading = withLength(this.heroHeading, n);
    }
    this.frameMs[f] = ms;
    this.frameEnemyStart[f] = this.enemySamples;
    this.frameProjectileStart[f] = this.projectileSamples;
    this.frameTowerStart[f] = this.towerSamples;
    this.frameBodyStart[f] = this.bodySamples;
    this.heroPose[f] = 0;
    return f;
  }

  /** Samples go in after reserveFrame() and beginFrame(); nothing is range checked here. */
  pushEnemy(index: number, x: number, y: number, z: number, heading: number, speed: number, hp: number, flags: number): void {
    const s = this.enemySamples++;
    this.eIndex[s] = index;
    this.ePos[s * 3] = x;
    this.ePos[s * 3 + 1] = y;
    this.ePos[s * 3 + 2] = z;
    this.eHeading[s] = encodeHeading(heading);
    this.eSpeed[s] = Math.min(65535, Math.round(speed * 100));
    this.eHp[s] = Math.round(Math.max(0, Math.min(1, hp)) * 255);
    this.eFlags[s] = flags;
  }

  pushProjectile(index: number, x: number, y: number, z: number): void {
    const s = this.projectileSamples++;
    this.pIndex[s] = index;
    this.pPos[s * 3] = x;
    this.pPos[s * 3 + 1] = y;
    this.pPos[s * 3 + 2] = z;
  }

  pushTower(index: number, rotation: number, flags: number, ax: number, ay: number, az: number, aw: number): void {
    const s = this.towerSamples++;
    this.tIndex[s] = index;
    this.tRot[s] = rotation;
    this.tFlags[s] = flags;
    this.tAux[s * 4] = ax;
    this.tAux[s * 4 + 1] = ay;
    this.tAux[s * 4 + 2] = az;
    this.tAux[s * 4 + 3] = aw;
  }

  /** The stretch of enemy `index`'s body this frame; its stations go in once. */
  pushBody(index: number, stations: RouteBodyStations, tailM: number, tipM: number): void {
    if (!this.bodyStations.has(index)) this.bodyStations.set(index, stations);
    const s = this.bodySamples++;
    this.bIndex[s] = index;
    this.bTail[s] = tailM;
    this.bTip[s] = tipM;
  }

  /** The hero in the open frame, at local (x, z). */
  pushHero(x: number, z: number, heading: number, poseCode: number): void {
    const f = this.frameCount;
    this.heroPose[f] = poseCode;
    this.heroPos[f * 2] = x;
    this.heroPos[f * 2 + 1] = z;
    this.heroHeading[f] = heading;
  }

  endFrame(): void {
    const next = ++this.frameCount;
    this.frameEnemyStart[next] = this.enemySamples;
    this.frameProjectileStart[next] = this.projectileSamples;
    this.frameTowerStart[next] = this.towerSamples;
    this.frameBodyStart[next] = this.bodySamples;
    this.durationMs = this.frameMs[next - 1];
  }

  /** Last frame at or before `ms`, -1 before the first. */
  frameAt(ms: number): number {
    let lo = 0;
    let hi = this.frameCount - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frameMs[mid] <= ms) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  // ── Events ───────────────────────────────────────────────────────

  /** Keep an effect event; past REPLAY_CONFIG.maxEvents it is counted and dropped. */
  pushEvent(ms: number, event: GameEvent): void {
    if (this.events.length >= REPLAY_CONFIG.maxEvents) {
      this.droppedEvents++;
      return;
    }
    this.events.push(event);
    this.eventMs.push(ms);
  }

  pushCommand(ms: number, command: Record<string, unknown>): void {
    this.commands.push({ ms, command });
  }

  pushHealth(ms: number, health: number): void {
    this.healthMs.push(ms);
    this.healthValue.push(health);
  }

  /** HQ health at `ms`. */
  healthAt(ms: number): number {
    let health = this.baseHealthAtStart;
    for (let i = 0; i < this.healthMs.length && this.healthMs[i] <= ms; i++) {
      health = this.healthValue[i];
    }
    return health;
  }

  /** First event after `ms`, events.length when there is none. */
  eventAfter(ms: number): number {
    let lo = 0;
    let hi = this.eventMs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.eventMs[mid] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Close the recording at `ms`: open enemies count as cleared, projectiles
   * still in flight vanish there.
   */
  finish(ms: number, outcome: 'completed' | 'gameover'): void {
    for (let i = 0; i < this.enemyCount; i++) {
      if (this.enemyEnd[i] === ENEMY_END.OPEN) this.endEnemy(i, ms, ENEMY_END.CLEARED);
    }
    for (let i = 0; i < this.projectileCount; i++) {
      if (this.projectileEndMs[i] === Infinity) this.endProjectile(i, ms, NaN, NaN, NaN);
    }
    this.outcome = outcome;
  }

  /** Bytes the sample columns hold now, the memory the budget counts. */
  get sampleBytes(): number {
    return sampleBytes(this.eIndex.length, this.pIndex.length, this.tIndex.length, this.bIndex.length);
  }

  // ── Memory ───────────────────────────────────────────────────────

  /**
   * Grow the sample columns so they hold the given totals: doubling where
   * that fits the budget, else to the need plus up to GROWTH_SLACK of it
   * again, as far as the budget goes. False when not even the need fits.
   */
  private makeRoom(enemies: number, projectiles: number, towers: number, bodies: number): boolean {
    const eCap = this.eIndex.length;
    const pCap = this.pIndex.length;
    const tCap = this.tIndex.length;
    const bCap = this.bIndex.length;
    if (enemies <= eCap && projectiles <= pCap && towers <= tCap && bodies <= bCap) return true;

    const budget = REPLAY_CONFIG.sampleBudgetBytes;
    const doubled = (cap: number, need: number) => (need <= cap ? cap : Math.max(need, cap * 2));
    let e = doubled(eCap, enemies);
    let p = doubled(pCap, projectiles);
    let t = doubled(tCap, towers);
    let b = doubled(bCap, bodies);
    if (sampleBytes(e, p, t, b) > budget) {
      // Growing to just the need would copy the columns again in the next
      // frame, and in every one after until thin() steps in: the columns
      // that must grow take some slack, whatever the budget has left
      e = Math.max(eCap, enemies);
      p = Math.max(pCap, projectiles);
      t = Math.max(tCap, towers);
      b = Math.max(bCap, bodies);
      const spare = budget - sampleBytes(e, p, t, b);
      if (spare < 0) return false;
      const extraE = enemies > eCap ? Math.ceil(enemies * GROWTH_SLACK) : 0;
      const extraP = projectiles > pCap ? Math.ceil(projectiles * GROWTH_SLACK) : 0;
      const extraT = towers > tCap ? Math.ceil(towers * GROWTH_SLACK) : 0;
      const extraB = bodies > bCap ? Math.ceil(bodies * GROWTH_SLACK) : 0;
      const wish = sampleBytes(extraE, extraP, extraT, extraB);
      const share = wish > 0 ? Math.min(1, spare / wish) : 0;
      e += Math.floor(extraE * share);
      p += Math.floor(extraP * share);
      t += Math.floor(extraT * share);
      b += Math.floor(extraB * share);
    }
    if (e > eCap) {
      this.eIndex = withLength(this.eIndex, e);
      this.ePos = withLength(this.ePos, e * 3);
      this.eHeading = withLength(this.eHeading, e);
      this.eSpeed = withLength(this.eSpeed, e);
      this.eHp = withLength(this.eHp, e);
      this.eFlags = withLength(this.eFlags, e);
    }
    if (p > pCap) {
      this.pIndex = withLength(this.pIndex, p);
      this.pPos = withLength(this.pPos, p * 3);
    }
    if (t > tCap) {
      this.tIndex = withLength(this.tIndex, t);
      this.tRot = withLength(this.tRot, t);
      this.tFlags = withLength(this.tFlags, t);
      this.tAux = withLength(this.tAux, t * 4);
    }
    if (b > bCap) {
      this.bIndex = withLength(this.bIndex, b);
      this.bTail = withLength(this.bTail, b);
      this.bTip = withLength(this.bTip, b);
    }
    return true;
  }

  /**
   * Drop every second frame (the odd ones) and double the spacing. Frames
   * sit on multiples of stepsPerFrame sub-steps from the wave start, so the
   * even ones are exactly those on multiples of the doubled spacing, and
   * recording continues on the new grid. Copies the samples forward in place.
   */
  thin(): void {
    let w = 0;
    let we = 0;
    let wp = 0;
    let wt = 0;
    let wb = 0;
    for (let f = 0; f < this.frameCount; f += 2) {
      const es = this.frameEnemyStart[f];
      const ee = this.frameEnemyStart[f + 1];
      const ps = this.frameProjectileStart[f];
      const pe = this.frameProjectileStart[f + 1];
      const ts = this.frameTowerStart[f];
      const te = this.frameTowerStart[f + 1];
      const bs = this.frameBodyStart[f];
      const be = this.frameBodyStart[f + 1];

      this.frameMs[w] = this.frameMs[f];
      this.frameEnemyStart[w] = we;
      this.frameProjectileStart[w] = wp;
      this.frameTowerStart[w] = wt;
      this.frameBodyStart[w] = wb;
      this.heroPose[w] = this.heroPose[f];
      this.heroPos[w * 2] = this.heroPos[f * 2];
      this.heroPos[w * 2 + 1] = this.heroPos[f * 2 + 1];
      this.heroHeading[w] = this.heroHeading[f];

      if (we !== es) {
        this.eIndex.copyWithin(we, es, ee);
        this.ePos.copyWithin(we * 3, es * 3, ee * 3);
        this.eHeading.copyWithin(we, es, ee);
        this.eSpeed.copyWithin(we, es, ee);
        this.eHp.copyWithin(we, es, ee);
        this.eFlags.copyWithin(we, es, ee);
      }
      if (wp !== ps) {
        this.pIndex.copyWithin(wp, ps, pe);
        this.pPos.copyWithin(wp * 3, ps * 3, pe * 3);
      }
      if (wt !== ts) {
        this.tIndex.copyWithin(wt, ts, te);
        this.tRot.copyWithin(wt, ts, te);
        this.tFlags.copyWithin(wt, ts, te);
        this.tAux.copyWithin(wt * 4, ts * 4, te * 4);
      }
      if (wb !== bs) {
        this.bIndex.copyWithin(wb, bs, be);
        this.bTail.copyWithin(wb, bs, be);
        this.bTip.copyWithin(wb, bs, be);
      }
      we += ee - es;
      wp += pe - ps;
      wt += te - ts;
      wb += be - bs;
      w++;
    }
    this.frameCount = w;
    this.frameEnemyStart[w] = we;
    this.frameProjectileStart[w] = wp;
    this.frameTowerStart[w] = wt;
    this.frameBodyStart[w] = wb;
    this.enemySamples = we;
    this.projectileSamples = wp;
    this.towerSamples = wt;
    this.bodySamples = wb;
    this.durationMs = w > 0 ? this.frameMs[w - 1] : 0;
    this.stepsPerFrame *= 2;
  }
}

/** Bytes of sample columns with these capacities. */
export function sampleBytes(enemies: number, projectiles: number, towers: number, bodies = 0): number {
  return enemies * ENEMY_SAMPLE_BYTES
    + projectiles * PROJECTILE_SAMPLE_BYTES
    + towers * TOWER_SAMPLE_BYTES
    + bodies * BODY_SAMPLE_BYTES;
}

/** Index of `id` in a type table, added on first sight. */
function typeIndex(id: string, ids: string[], index: Map<string, number>): number {
  let i = index.get(id);
  if (i === undefined) {
    i = ids.length;
    ids.push(id);
    index.set(id, i);
  }
  return i;
}
