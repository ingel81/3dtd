import { signal } from '@angular/core';
import { Vector3 } from 'three';
import type { EventSubscription, GameEvent, GameEventBus } from '../game-engine/game-event-bus';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { WaveConfig } from '../managers/wave.manager';
import type { RouteBodyStations } from '../utils/route-body';
import { isBloodMoonWave } from '../configs/blood-moon.config';
import { ENEMY_END, ENEMY_FLAG, ReplayRecording, TOWER_FLAG, heroPoseCode, type ReplayHeroPose } from './replay-recording';
import { isPresentationEvent, presentationEvent, toPlainData } from './replay-events';

/** What the recorder reads of an enemy; Enemy has all of it. */
export interface RecordableEnemy {
  readonly alive: boolean;
  readonly heightOffset: number;
  readonly position: { readonly lat: number; readonly lon: number };
  readonly typeConfig: { readonly id: string };
  readonly transform: { readonly terrainHeight: number; readonly rotation: number };
  readonly health: { readonly healthPercent: number };
  readonly movement: {
    readonly speedMps: number;
    readonly speedMultiplier: number;
    readonly statusEffects: readonly unknown[];
    getSlowMultiplier(gameTimeMs: number): number;
    isSlowed(gameTimeMs: number): boolean;
    isPoisoned(gameTimeMs: number): boolean;
    isBurning(gameTimeMs: number): boolean;
    isFrozen(gameTimeMs: number): boolean;
    isStunned(gameTimeMs: number): boolean;
  };
  readonly rush: { readonly running: boolean } | null;
  /** A body along the route (the oozes): its stretch, tailM to tipM on its stations */
  readonly body: { readonly stations: RouteBodyStations; readonly tailM: number; readonly tipM: number } | null;
}

/** What the recorder reads of the hero; HeroManager.getPresentation() gives it. */
export interface RecordableHero {
  readonly lat: number;
  readonly lon: number;
  readonly heading: number;
  readonly pose: ReplayHeroPose;
}

/** What the recorder reads of a projectile; Projectile has all of it. */
export interface RecordableProjectile {
  readonly typeConfig: { readonly id: string };
  readonly position: { readonly lat: number; readonly lon: number };
  readonly flightHeight: number;
}

/** What the recorder reads of a tower; Tower has all of it. */
export interface RecordableTower {
  readonly id: string;
  /** attackType 'passive' for a building that aims at nothing (the Research Center) */
  readonly typeConfig: { readonly id: string; readonly attackType?: string };
  readonly position: { readonly lat: number; readonly lon: number; readonly height?: number };
  readonly customRotation: number;
  readonly plinthHeight: number;
  readonly plinthOverhang: readonly number[];
}

/** The engine parts the recorder reads; ThreeTilesEngine has all of them. */
export interface ReplayRecorderEngine {
  readonly renderingEnabled: boolean;
  readonly sync: {
    geoToLocalSimpleInto(lat: number, lon: number, height: number, target: Vector3): Vector3;
  };
  readonly towers: {
    get(id: string): { readonly currentLocalRotation: number; readonly turretPart: object | null } | undefined;
  };
  readonly flameBeams: {
    getBeam(towerId: string): { readonly targetPosition: Vector3; readonly beamWidth: number } | null;
  };
  readonly tentacles: {
    getStrikeTarget(towerId: string): Vector3 | null;
  };
}

/** Where the recorder takes the live state from, see GameStateManager. */
export interface ReplaySources {
  enemies(): readonly RecordableEnemy[];
  projectiles(): readonly RecordableProjectile[];
  towers(): readonly RecordableTower[];
  /** The hero as shown this frame, null while none is hired */
  hero(): RecordableHero | null;
  engine(): ReplayRecorderEngine | null;
  gameTimeMs(): number;
  baseHealth(): number;
  credits(): number;
}

/**
 * Records the running wave for the replay (docs/REPLAY.md).
 *
 * Owned by the GameStateManager: it starts on wave:started, samples a frame
 * every ReplayRecording.stepsPerFrame sub-steps (onSubStep()), and is closed
 * by finish() when the wave ends or the HQ falls. Everything else comes from
 * the event bus, read on its catch-all path (onAny) while a wave is being
 * recorded: spawns, deaths, leaks, hits, towers placed and sold, the effect
 * events and every command:*, so a new command is logged without a change
 * here. The wave start, the start command and a wave jump come through
 * typed listeners; so between waves and in headless training nothing hangs
 * on the catch-all path and emit keeps its fast path. A failure in here
 * drops the recording and never reaches the game.
 *
 * Only the last wave is kept: the next wave:started overwrites it, a jump to
 * a later wave (wave:jumped, dev cheat) drops it: the wave it shows is then
 * no longer the one before the next. Nothing is recorded while the engine
 * does not render (headless training).
 *
 * Per frame the cost is one local conversion and a few typed-array writes
 * per body, no allocation; a Map entry per new enemy and projectile.
 */
export class ReplayRecorder {
  /** Wave of the finished recording, null while there is none (none yet, a wave running, reset) */
  readonly readyWave = signal<number | null>(null);

  private readonly rec = new ReplayRecording();
  private active = false;
  /** Sub-steps since the wave started; frames fall on multiples of stepsPerFrame */
  private stepIndex = 0;
  /** Config of the command:start-wave that is about to start a wave */
  private pendingConfig: WaveConfig | null = null;

  private readonly enemyIndex = new Map<object, number>();
  private readonly projectileIndex = new Map<object, number>();
  private readonly towerIndex = new Map<string, number>();
  /** Projectiles in flight: their table index, and the object for the Map */
  private inFlight = new Int32Array(256);
  private inFlightCount = 0;
  private projectileRefs: (object | null)[] = [];
  /** Capture a projectile was last sampled in, by table index */
  private projectileSeen = new Uint32Array(256);
  private captureSerial = 0;

  private readonly local = new Vector3();
  /** The wave start, its command and a wave jump */
  private readonly triggers: EventSubscription[];
  /** Every event, while a wave is being recorded (begin() to stop()) */
  private catchAll: EventSubscription | null = null;

  constructor(private readonly eventBus: GameEventBus, private readonly sources: ReplaySources) {
    this.triggers = [
      eventBus.on('command:start-wave', (event) => {
        this.pendingConfig = event.config ?? null;
      }),
      eventBus.on('wave:started', (event) => this.guarded(() => this.begin(event.wave))),
      eventBus.on('wave:jumped', () => this.clear()),
    ];
  }

  /** The finished recording of the last wave, null while there is none. */
  get recording(): ReplayRecording | null {
    return this.readyWave() !== null ? this.rec : null;
  }

  /** A wave is being recorded. */
  get isRecording(): boolean {
    return this.active;
  }

  /** Once per gameplay sub-step, after the turrets turned (GameStateManager.update). */
  onSubStep(): void {
    if (!this.active) return;
    this.stepIndex++;
    if (this.stepIndex % this.rec.stepsPerFrame === 0) this.guarded(this.captureRegularFrame);
  }

  /**
   * Close the recording: a last frame of what is on screen now, open
   * enemies and projectiles end here. Called when the wave is over and when
   * the HQ falls, before the enemies are cleared.
   */
  finish(outcome: 'completed' | 'gameover'): void {
    if (!this.active) return;
    this.guarded(() => {
      this.captureFrame(true);
      this.rec.finish(this.nowMs(), outcome);
      this.stop();
      this.readyWave.set(this.rec.wave);
    });
  }

  /** Drop the recording (restart, new location, new world). */
  clear(): void {
    this.stop();
    this.pendingConfig = null;
    this.rec.reset(0, 0, 0, 0, null);
    this.readyWave.set(null);
  }

  dispose(): void {
    for (const trigger of this.triggers) trigger.dispose();
    this.clear();
  }

  /**
   * Run a step of the recording. A recording that failed on the way is not
   * to be trusted: it is dropped, logged, and the game goes on.
   */
  private guarded(step: () => void): void {
    try {
      step();
    } catch (err) {
      console.error('[ReplayRecorder] Dropped the recording:', err);
      this.clear();
    }
  }

  private readonly captureRegularFrame = (): void => this.captureFrame(false);

  private readonly onEvent = (event: GameEvent): void => {
    this.guarded(() => this.record(event));
  };

  private record(event: GameEvent): void {
    if (!this.active) return;

    const ms = this.nowMs();
    switch (event.type) {
      case 'enemy:spawned':
        this.enemyIndexOf(event.enemy, ms);
        break;
      case 'enemy:died':
        this.endEnemy(event.enemy, ms, ENEMY_END.DIED);
        break;
      case 'enemy:reached-base':
        this.endEnemy(event.enemy, ms, ENEMY_END.LEAKED);
        break;
      case 'projectile:hit':
        this.endProjectileAtHit(event.projectile, ms);
        break;
      case 'tower:placed':
        this.addTower(event.tower, ms);
        break;
      case 'tower:sold':
        this.sellTower(event.tower.id, ms);
        break;
      case 'health:changed':
        this.rec.pushHealth(ms, event.health);
        break;
    }

    if (event.type.startsWith('command:')) {
      this.rec.pushCommand(ms, toPlainData(event) as Record<string, unknown>);
    } else if (isPresentationEvent(event.type)) {
      const kept = presentationEvent(event);
      if (kept) this.rec.pushEvent(ms, kept);
    }
  }

  private begin(wave: number): void {
    this.stop();
    this.readyWave.set(null);
    const config = this.pendingConfig;
    this.pendingConfig = null;
    this.rec.reset(wave, this.sources.gameTimeMs(), this.sources.baseHealth(), this.sources.credits(), config);
    this.rec.bloodMoon = isBloodMoonWave(wave);

    // Headless training draws nothing, and nobody watches a replay of it
    const engine = this.sources.engine();
    if (!engine || !engine.renderingEnabled) return;

    for (const tower of this.sources.towers()) {
      this.addTower(tower, -1);
    }
    this.active = true;
    this.stepIndex = 0;
    this.catchAll ??= this.eventBus.onAny(this.onEvent);
    this.captureFrame(false);
  }

  private stop(): void {
    this.active = false;
    this.catchAll?.dispose();
    this.catchAll = null;
    this.enemyIndex.clear();
    this.projectileIndex.clear();
    this.towerIndex.clear();
    this.projectileRefs.length = 0;
    this.inFlightCount = 0;
  }

  private nowMs(): number {
    return this.sources.gameTimeMs() - this.rec.startGameMs;
  }

  private captureFrame(final: boolean): void {
    const engine = this.sources.engine();
    if (!engine) return;
    const rec = this.rec;
    const ms = this.nowMs();
    // A finish on the sub-step of a regular frame has nothing to add
    if (final && rec.frameCount > 0 && rec.frameMs[rec.frameCount - 1] >= ms) return;

    const enemies = this.sources.enemies();
    const projectiles = this.sources.projectiles();
    const towers = this.sources.towers();
    let bodies = 0;
    for (const enemy of enemies) {
      if (enemy.body !== null && enemy.alive) bodies++;
    }
    const fit = rec.reserveFrame(enemies.length, projectiles.length, towers.length, bodies);
    if (fit === 'full') return;
    // The spacing just doubled: a frame between two of the new grid waits
    if (fit === 'thinned' && !final && this.stepIndex % rec.stepsPerFrame !== 0) return;

    rec.beginFrame(ms);
    this.sampleEnemies(enemies, engine, ms);
    this.sampleProjectiles(projectiles, engine, ms);
    this.sampleTowers(towers, engine);
    this.sampleHero(engine);
    rec.endFrame();
  }

  /** The hero on the route grid's ground, so his local x and z are all there is to keep. */
  private sampleHero(engine: ReplayRecorderEngine): void {
    const hero = this.sources.hero();
    if (!hero) return;
    const local = engine.sync.geoToLocalSimpleInto(hero.lat, hero.lon, 0, this.local);
    this.rec.pushHero(local.x, local.z, hero.heading, heroPoseCode(hero.pose));
  }

  private sampleEnemies(enemies: readonly RecordableEnemy[], engine: ReplayRecorderEngine, ms: number): void {
    const rec = this.rec;
    const now = this.sources.gameTimeMs();
    const local = this.local;
    for (const enemy of enemies) {
      // Dying ones are in the list until their death animation ends; the
      // player plays that from the end the table holds
      if (!enemy.alive) continue;
      const index = this.enemyIndexOf(enemy, ms);
      engine.sync.geoToLocalSimpleInto(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + enemy.heightOffset,
        local,
      );
      const movement = enemy.movement;
      let flags = 0;
      let slow = 1;
      if (movement.statusEffects.length !== 0) {
        slow = movement.getSlowMultiplier(now);
        if (movement.isSlowed(now)) flags |= ENEMY_FLAG.SLOWED;
        if (movement.isPoisoned(now)) flags |= ENEMY_FLAG.POISONED;
        if (movement.isBurning(now)) flags |= ENEMY_FLAG.BURNING;
        if (movement.isFrozen(now)) flags |= ENEMY_FLAG.FROZEN;
        if (movement.isStunned(now)) flags |= ENEMY_FLAG.STUNNED;
      }
      if (enemy.rush !== null && enemy.rush.running) flags |= ENEMY_FLAG.RUNNING;
      // An ooze's sample is its tip, health and status; the body adds its stretch
      const body = enemy.body;
      if (body !== null) rec.pushBody(index, body.stations, body.tailM, body.tipM);
      rec.pushEnemy(
        index,
        local.x,
        local.y,
        local.z,
        enemy.transform.rotation,
        movement.speedMps * movement.speedMultiplier * slow,
        enemy.health.healthPercent,
        flags,
      );
    }
  }

  private sampleProjectiles(projectiles: readonly RecordableProjectile[], engine: ReplayRecorderEngine, ms: number): void {
    const rec = this.rec;
    const serial = ++this.captureSerial;
    const local = this.local;
    for (const projectile of projectiles) {
      let index = this.projectileIndex.get(projectile);
      if (index === undefined) {
        index = rec.addProjectile(projectile.typeConfig.id);
        this.projectileIndex.set(projectile, index);
        this.projectileRefs[index] = projectile;
        this.trackInFlight(index);
      }
      engine.sync.geoToLocalSimpleInto(projectile.position.lat, projectile.position.lon, projectile.flightHeight, local);
      rec.pushProjectile(index, local.x, local.y, local.z);
      this.projectileSeen[index] = serial;
    }

    // In flight last time and gone now: it hit, or vanished without a hit
    // event (target lost, no splash), somewhere since the last frame
    let kept = 0;
    for (let i = 0; i < this.inFlightCount; i++) {
      const index = this.inFlight[i];
      if (this.projectileSeen[index] === serial) {
        this.inFlight[kept++] = index;
        continue;
      }
      rec.endProjectile(index, ms, NaN, NaN, NaN);
      this.releaseProjectile(index);
    }
    this.inFlightCount = kept;
  }

  private sampleTowers(towers: readonly RecordableTower[], engine: ReplayRecorderEngine): void {
    const rec = this.rec;
    for (const tower of towers) {
      const index = this.towerIndex.get(tower.id);
      if (index === undefined) continue;
      const data = engine.towers.get(tower.id);
      const rotation = data ? data.currentLocalRotation : 0;

      const beam = engine.flameBeams.getBeam(tower.id);
      if (beam) {
        const t = beam.targetPosition;
        rec.pushTower(index, rotation, TOWER_FLAG.BEAM, t.x, t.y, t.z, beam.beamWidth);
        continue;
      }
      const strike = engine.tentacles.getStrikeTarget(tower.id);
      if (strike) {
        rec.pushTower(index, rotation, TOWER_FLAG.STRIKE, strike.x, strike.y, strike.z, 0);
        continue;
      }
      // A passive building (the Research Center) aims at nothing. Every
      // other tower turns its aim, a tower without a turret part as well
      // (its blood moon searchlight follows it), so it gets a sample in
      // every frame: the player shows the samples of the frame it is at, a
      // sample only on change would leave a jump back with a later aim.
      if (data && (data.turretPart || tower.typeConfig.attackType !== 'passive')) {
        rec.pushTower(index, rotation, 0, 0, 0, 0, 0);
      }
    }
  }

  private enemyIndexOf(enemy: object & { typeConfig: { id: string } }, ms: number): number {
    let index = this.enemyIndex.get(enemy);
    if (index === undefined) {
      index = this.rec.addEnemy(enemy.typeConfig.id, ms);
      this.enemyIndex.set(enemy, index);
    }
    return index;
  }

  private endEnemy(enemy: object, ms: number, end: number): void {
    const index = this.enemyIndex.get(enemy);
    if (index === undefined) return;
    this.rec.endEnemy(index, ms, end);
    this.enemyIndex.delete(enemy);
  }

  private endProjectileAtHit(projectile: RecordableProjectile, ms: number): void {
    const index = this.projectileIndex.get(projectile);
    if (index === undefined) return;
    const engine = this.sources.engine();
    if (engine) {
      const p = this.local;
      engine.sync.geoToLocalSimpleInto(projectile.position.lat, projectile.position.lon, projectile.flightHeight, p);
      this.rec.endProjectile(index, ms, p.x, p.y, p.z);
    } else {
      this.rec.endProjectile(index, ms, NaN, NaN, NaN);
    }
    this.releaseProjectile(index);
  }

  /** Forget the projectile object; its table entry stays. */
  private releaseProjectile(index: number): void {
    const ref = this.projectileRefs[index];
    if (ref) this.projectileIndex.delete(ref);
    this.projectileRefs[index] = null;
  }

  private trackInFlight(index: number): void {
    if (this.inFlightCount === this.inFlight.length) {
      const grown = new Int32Array(this.inFlight.length * 2);
      grown.set(this.inFlight);
      this.inFlight = grown;
    }
    this.inFlight[this.inFlightCount++] = index;
    if (index >= this.projectileSeen.length) {
      const grown = new Uint32Array(Math.max(index + 1, this.projectileSeen.length * 2));
      grown.set(this.projectileSeen);
      this.projectileSeen = grown;
    }
  }

  private addTower(tower: RecordableTower, placedMs: number): void {
    if (this.towerIndex.has(tower.id)) return;
    const index = this.rec.addTower({
      id: tower.id,
      typeId: tower.typeConfig.id as TowerTypeId,
      lat: tower.position.lat,
      lon: tower.position.lon,
      height: tower.position.height ?? 0,
      customRotation: tower.customRotation,
      plinthHeight: tower.plinthHeight,
      plinthOverhang: tower.plinthOverhang,
      placedMs,
      soldMs: Infinity,
    });
    this.towerIndex.set(tower.id, index);
  }

  private sellTower(id: string, ms: number): void {
    const index = this.towerIndex.get(id);
    if (index === undefined) return;
    this.rec.towers[index].soldMs = ms;
    this.towerIndex.delete(id);
  }
}
