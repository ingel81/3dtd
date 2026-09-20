import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { Vector3 } from 'three';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { GameClock } from '../managers/game-state/game-clock';
import { ReplayRecorder, type RecordableHero } from './replay-recorder';
import { ENEMY_END, ENEMY_FLAG, TOWER_FLAG, decodeHeading, heroPoseName } from './replay-recording';
import type { RouteBodyStations } from '../utils/route-body';

const STEP = GameClock.FIXED_STEP_MS;

function fakeEnemy(typeId = 'zombie', lat = 0, lon = 0) {
  return {
    alive: true,
    heightOffset: 1,
    position: { lat, lon },
    typeConfig: { id: typeId },
    transform: { terrainHeight: 10, rotation: 0.5 },
    health: { healthPercent: 1 },
    movement: {
      speedMps: 2,
      speedMultiplier: 1,
      statusEffects: [] as unknown[],
      hasStatusEffects: false,
      getSlowMultiplier: () => 0.5,
      isSlowed: () => true,
      isPoisoned: () => false,
      isBurning: () => true,
      isFrozen: () => false,
      isStunned: () => false,
    },
    rush: null as { running: boolean } | null,
    body: null as { stations: RouteBodyStations; tailM: number; tipM: number } | null,
    worm: null as { head: boolean; tail: boolean } | null,
  };
}

function fakeProjectile(lat = 0, lon = 0) {
  return { typeConfig: { id: 'arrow' }, position: { lat, lon }, flightHeight: 20 };
}

function fakeTower(id: string, typeConfig: { id: string; attackType?: string } = { id: 'archer' }) {
  return {
    id,
    typeConfig,
    position: { lat: 0.001, lon: 0.002, height: 5 },
    customRotation: 0.3,
    plinthHeight: 1.5,
    plinthOverhang: [4, 5],
  };
}

/** A game with fake entities, its clock and a recorder on a real event bus. */
class Harness {
  readonly bus = new GameEventBus();
  readonly enemies: ReturnType<typeof fakeEnemy>[] = [];
  readonly projectiles: ReturnType<typeof fakeProjectile>[] = [];
  readonly towers: ReturnType<typeof fakeTower>[] = [];
  readonly turrets = new Map<string, { currentLocalRotation: number; turretPart: object | null }>();
  readonly beams = new Map<string, { targetPosition: Vector3; beamWidth: number }>();
  readonly strikes = new Map<string, Vector3>();
  readonly engine = {
    renderingEnabled: true,
    // Local x from the longitude, z from the latitude, y the height
    sync: {
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon * 100, height, lat * 100),
    },
    towers: { get: (id: string) => this.turrets.get(id) },
    flameBeams: { getBeam: (id: string) => this.beams.get(id) ?? null },
    tentacles: { getStrikeTarget: (id: string) => this.strikes.get(id) ?? null },
  };
  time = 1000;
  hero: RecordableHero | null = null;
  readonly recorder: ReplayRecorder;

  constructor() {
    this.recorder = new ReplayRecorder(this.bus, {
      enemies: () => this.enemies,
      projectiles: () => this.projectiles,
      towers: () => this.towers,
      hero: () => this.hero,
      engine: () => this.engine,
      gameTimeMs: () => this.time,
      baseHealth: () => 80,
      credits: () => 300,
    });
  }

  startWave(wave = 3): void {
    this.bus.emit({ type: 'command:start-wave', config: { schedule: { entries: [], baseDelay: 100 } } });
    this.bus.emit({ type: 'wave:started', wave, enemyCount: 10 });
  }

  steps(n: number): void {
    for (let i = 0; i < n; i++) {
      this.time += STEP;
      this.recorder.onSubStep();
    }
  }

  emit(event: GameEvent): void {
    this.bus.emit(event);
  }
}

describe('ReplayRecorder', () => {
  it('records nothing before a wave starts', () => {
    const h = new Harness();
    h.steps(60);
    expect(h.recorder.isRecording).toBe(false);
    expect(h.recorder.recording).toBeNull();
  });

  it('starts on wave:started with the towers standing and a first frame at 0', () => {
    const h = new Harness();
    h.towers.push(fakeTower('tower-1'));
    h.turrets.set('tower-1', { currentLocalRotation: 1.25, turretPart: {} });
    h.startWave(7);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.wave).toBe(7);
    expect(rec.baseHealthAtStart).toBe(80);
    expect(rec.creditsAtStart).toBe(300);
    expect(rec.waveConfig).toEqual({ schedule: { entries: [], baseDelay: 100 } });
    expect(rec.towers).toEqual([{
      id: 'tower-1', typeId: 'archer', lat: 0.001, lon: 0.002, height: 5,
      customRotation: 0.3, plinthHeight: 1.5, plinthOverhang: [4, 5], placedMs: -1, soldMs: Infinity,
    }]);
    expect(rec.frameCount).toBe(1);
    expect(rec.frameMs[0]).toBe(0);
    expect(rec.tRot[0]).toBeCloseTo(1.25);
  });

  it('samples a frame every stepsPerFrame sub-steps, in game time', () => {
    const h = new Harness();
    h.enemies.push(fakeEnemy());
    h.startWave();
    h.steps(13);
    h.recorder.finish('completed');
    const rec = h.recorder.recording!;
    // 0, 6 and 12 steps, then the finish one step later
    expect(rec.frameCount).toBe(4);
    expect(rec.frameMs[1]).toBeCloseTo(6 * STEP);
    expect(rec.frameMs[2]).toBeCloseTo(12 * STEP);
    expect(rec.frameMs[3]).toBeCloseTo(13 * STEP);
    expect(rec.durationMs).toBeCloseTo(13 * STEP);
  });

  it('adds no second frame when the wave ends on the step of a regular one', () => {
    const h = new Harness();
    h.startWave();
    h.steps(12);
    h.recorder.finish('completed');
    expect(h.recorder.recording!.frameCount).toBe(3);
  });

  it('keeps an enemy\'s render state per frame: position with height offset, heading, speed, health, status', () => {
    const h = new Harness();
    const enemy = fakeEnemy('rat', 0.01, 0.02);
    enemy.movement.statusEffects.push({});
    enemy.movement.hasStatusEffects = true;
    enemy.rush = { running: true };
    enemy.health.healthPercent = 0.25;
    h.enemies.push(enemy);
    h.startWave();
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.enemyTypeIds).toEqual(['rat']);
    expect(Array.from(rec.ePos.subarray(0, 3))).toEqual([2, 11, 1]);
    expect(decodeHeading(rec.eHeading[0])).toBeCloseTo(0.5, 3);
    expect(rec.eSpeed[0]).toBe(100); // 2 m/s × slow 0.5
    expect(rec.eHp[0]).toBe(64);
    expect(rec.eFlags[0]).toBe(ENEMY_FLAG.SLOWED | ENEMY_FLAG.BURNING | ENEMY_FLAG.RUNNING);
  });

  it('keeps which model draws a worm segment: its type\'s (the head), the ring or the tail', () => {
    const h = new Harness();
    const parts = [{ head: true, tail: false }, { head: false, tail: false }, { head: false, tail: true }];
    for (const worm of parts) {
      const segment = fakeEnemy('worm');
      segment.worm = worm;
      h.enemies.push(segment);
    }
    h.startWave();
    h.recorder.finish('completed');

    const part = ENEMY_FLAG.WORM_BODY | ENEMY_FLAG.WORM_TAIL;
    const flags = Array.from(h.recorder.recording!.eFlags.subarray(0, 3), (f) => f & part);
    expect(flags).toEqual([0, ENEMY_FLAG.WORM_BODY, ENEMY_FLAG.WORM_TAIL]);
  });

  it('takes spawns, deaths and leaks from the bus, and leaves dying enemies out of the frames', () => {
    const h = new Harness();
    h.startWave();
    h.steps(3);
    const a = fakeEnemy();
    const b = fakeEnemy();
    h.enemies.push(a, b);
    h.emit({ type: 'enemy:spawned', enemy: a as never });
    h.emit({ type: 'enemy:spawned', enemy: b as never });
    h.steps(3);
    h.emit({ type: 'enemy:died', enemy: a as never, credits: 1 , killedBy: null });
    a.alive = false;
    h.emit({ type: 'enemy:reached-base', enemy: b as never, damage: 5 });
    h.enemies.splice(1, 1);
    h.steps(6);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.enemyCount).toBe(2);
    expect(rec.enemySpawnMs[0]).toBeCloseTo(3 * STEP);
    expect(rec.enemyEnd[0]).toBe(ENEMY_END.DIED);
    expect(rec.enemyEndMs[0]).toBeCloseTo(6 * STEP);
    expect(rec.enemyEnd[1]).toBe(ENEMY_END.LEAKED);
    // Frame 1 (step 6) has both, frame 2 (step 12) neither: a is dying, b is gone
    expect(rec.frameEnemyStart[2] - rec.frameEnemyStart[1]).toBe(2);
    expect(rec.frameEnemyStart[3] - rec.frameEnemyStart[2]).toBe(0);
  });

  it('closes the enemies still on the route at game over as cleared', () => {
    const h = new Harness();
    const enemy = fakeEnemy();
    h.enemies.push(enemy);
    h.startWave();
    h.steps(5);
    h.recorder.finish('gameover');
    const rec = h.recorder.recording!;
    expect(rec.outcome).toBe('gameover');
    expect(rec.enemyEnd[0]).toBe(ENEMY_END.CLEARED);
    // The last frame still shows it
    expect(rec.frameEnemyStart[rec.frameCount] - rec.frameEnemyStart[rec.frameCount - 1]).toBe(1);
  });

  it('ends a projectile at its hit, or at the first frame it is missing from', () => {
    const h = new Harness();
    const hit = fakeProjectile(0.01, 0.01);
    const lost = fakeProjectile(0.02, 0.02);
    h.projectiles.push(hit, lost);
    h.startWave();
    hit.position.lat = 0.03;
    h.emit({ type: 'projectile:hit', projectile: hit as never, target: {} as never, damage: 1, damageType: 'physical' });
    h.projectiles.length = 0;
    h.steps(6);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.projectileCount).toBe(2);
    expect(rec.projectileEndMs[0]).toBe(0);
    expect(Array.from(rec.projectileEndPos.subarray(0, 3))).toEqual([1, 20, 3]);
    expect(rec.projectileEndMs[1]).toBeCloseTo(6 * STEP);
    expect(Number.isNaN(rec.projectileEndPos[3])).toBe(true);
  });

  it('follows towers placed and sold during the wave and their beams and strikes', () => {
    const h = new Harness();
    h.towers.push(fakeTower('fire-1'), fakeTower('research-1', { id: 'research-center', attackType: 'passive' }));
    h.turrets.set('fire-1', { currentLocalRotation: 0, turretPart: {} });
    h.turrets.set('research-1', { currentLocalRotation: 0, turretPart: null });
    h.startWave();
    h.steps(3);
    const tentacle = fakeTower('tentacle-1');
    h.towers.push(tentacle);
    h.turrets.set('tentacle-1', { currentLocalRotation: 0, turretPart: null });
    h.emit({ type: 'tower:placed', tower: tentacle as never, position: tentacle.position, cost: 100 });
    h.beams.set('fire-1', { targetPosition: new Vector3(1, 2, 3), beamWidth: 8 });
    h.strikes.set('tentacle-1', new Vector3(4, 5, 6));
    h.steps(3);
    h.emit({ type: 'tower:sold', tower: tentacle as never, refund: 50 });
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.towers.map((t) => t.id)).toEqual(['fire-1', 'research-1', 'tentacle-1']);
    expect(rec.towers[0].placedMs).toBe(-1);
    expect(rec.towers[1].soldMs).toBe(Infinity);
    expect(rec.towers[2].placedMs).toBeCloseTo(3 * STEP);
    expect(rec.towers[2].soldMs).toBeCloseTo(6 * STEP);
    // Frame 0: the fire tower's turret only, the research center aims at nothing
    expect(rec.frameTowerStart[1] - rec.frameTowerStart[0]).toBe(1);
    // Frame 1: beam and strike with their targets
    const s = rec.frameTowerStart[1];
    expect(rec.tFlags[s]).toBe(TOWER_FLAG.BEAM);
    expect(Array.from(rec.tAux.subarray(s * 4, s * 4 + 4))).toEqual([1, 2, 3, 8]);
    expect(rec.tFlags[s + 1]).toBe(TOWER_FLAG.STRIKE);
    expect(Array.from(rec.tAux.subarray((s + 1) * 4, (s + 1) * 4 + 3))).toEqual([4, 5, 6]);
  });

  it('samples the aim of a tower without a turret part in every frame, for its searchlight', () => {
    const h = new Harness();
    const archer = { currentLocalRotation: 0.5, turretPart: null };
    h.towers.push(fakeTower('archer-1'));
    h.turrets.set('archer-1', archer);
    h.startWave();
    archer.currentLocalRotation = 0.9;
    h.steps(6);
    // Unchanged, still a sample: a jump back to this frame shows it
    h.steps(6);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.frameCount).toBe(3);
    for (let f = 0; f < 3; f++) expect(rec.frameTowerStart[f + 1] - rec.frameTowerStart[f]).toBe(1);
    expect(rec.tRot[0]).toBeCloseTo(0.5);
    expect(rec.tRot[1]).toBeCloseTo(0.9);
    expect(rec.tRot[2]).toBeCloseTo(0.9);
  });

  it('logs every command of the wave as plain data, the hero\'s and one it does not know as well', () => {
    const h = new Harness();
    h.startWave();
    h.steps(2);
    h.emit({ type: 'command:place-tower', position: { lat: 1, lon: 2, height: 3 }, typeId: 'archer', rotation: 0.5, plinthHeight: 2 });
    h.emit({ type: 'command:hire-hero' });
    h.emit({ type: 'command:hero-move', target: { lat: 4, lon: 5 } });
    h.emit({ type: 'command:hero-ammo', ammo: 'explosive' });
    h.emit({ type: 'command:not-there-yet', x: 1 } as never);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.commands.map((c) => c.command)).toEqual([
      { type: 'command:place-tower', position: { lat: 1, lon: 2, height: 3 }, typeId: 'archer', rotation: 0.5, plinthHeight: 2 },
      { type: 'command:hire-hero' },
      { type: 'command:hero-move', target: { lat: 4, lon: 5 } },
      { type: 'command:hero-ammo', ammo: 'explosive' },
      { type: 'command:not-there-yet', x: 1 },
    ]);
    expect(rec.commands[0].ms).toBeCloseTo(2 * STEP);
  });

  it('keeps frozen and stunned in the status bits', () => {
    const h = new Harness();
    const enemy = fakeEnemy();
    enemy.movement.statusEffects.push({});
    enemy.movement.hasStatusEffects = true;
    enemy.movement.isSlowed = () => false;
    enemy.movement.isBurning = () => false;
    enemy.movement.isFrozen = () => true;
    enemy.movement.isStunned = () => true;
    h.enemies.push(enemy);
    h.startWave();
    h.recorder.finish('completed');
    expect(h.recorder.recording!.eFlags[0]).toBe(ENEMY_FLAG.FROZEN | ENEMY_FLAG.STUNNED);
  });

  it('keeps an ooze\'s stretch along its route per frame, its stations once', () => {
    const h = new Harness();
    const stations = {} as RouteBodyStations;
    const ooze = fakeEnemy('ooze');
    ooze.body = { stations, tailM: 2, tipM: 10 };
    h.enemies.push(fakeEnemy(), ooze);
    h.startWave();
    ooze.body.tailM = 3;
    ooze.body.tipM = 12;
    h.steps(6);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect([...rec.bodyStations]).toEqual([[1, stations]]);
    expect(rec.frameBodyStart[1] - rec.frameBodyStart[0]).toBe(1);
    const b = rec.frameBodyStart[1];
    expect([rec.bIndex[b], rec.bTail[b], rec.bTip[b]]).toEqual([1, 3, 12]);
    // Its tip, health and status are an enemy sample like any other
    expect(rec.frameEnemyStart[2] - rec.frameEnemyStart[1]).toBe(2);
  });

  it('keeps the hero per frame: where he stands, heading and pose; nothing before he is hired', () => {
    const h = new Harness();
    h.startWave();
    h.hero = { lat: 0.01, lon: 0.02, heading: 1.5, pose: 'run-shoot' };
    h.steps(6);
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.heroPose[0]).toBe(0);
    expect(heroPoseName(rec.heroPose[1])).toBe('run-shoot');
    expect(rec.heroPos[2]).toBeCloseTo(2);
    expect(rec.heroPos[3]).toBeCloseTo(1);
    expect(rec.heroHeading[1]).toBeCloseTo(1.5);
  });

  it('keeps the hero\'s level-up, not his kills (they hold the enemy)', () => {
    const h = new Harness();
    h.startWave();
    h.emit({ type: 'hero:kill', enemy: {} as never });
    h.emit({ type: 'hero:level-up', level: 2, position: { lat: 1, lon: 2 } });
    h.recorder.finish('completed');
    expect(h.recorder.recording!.events.map((e) => e.type)).toEqual(['hero:level-up']);
  });

  it('marks a blood moon wave', () => {
    const h = new Harness();
    h.startWave(14);
    h.recorder.finish('completed');
    expect(h.recorder.recording!.bloodMoon).toBe(true);
    h.startWave(15);
    h.recorder.finish('completed');
    expect(h.recorder.recording!.bloodMoon).toBe(false);
  });

  it('drops the recording on a jump to a later wave', () => {
    const h = new Harness();
    h.startWave(4);
    h.recorder.finish('completed');
    h.emit({ type: 'wave:jumped', from: 4, wave: 10, skipped: 5, credits: 0 });
    expect(h.recorder.readyWave()).toBeNull();
    expect(h.recorder.recording).toBeNull();
  });

  it('keeps effect events and HQ health changes with their time', () => {
    const h = new Harness();
    h.startWave();
    h.steps(1);
    const impact: GameEvent = { type: 'vfx:projectile-impact', lat: 1, lon: 2, height: 3, projectileType: 'cannonball', targetLost: false };
    h.emit(impact);
    h.emit({ type: 'health:changed', health: 70, delta: -10 });
    h.emit({ type: 'credits:changed', credits: 5, delta: 5 , source: 'kill' });
    h.recorder.finish('completed');

    const rec = h.recorder.recording!;
    expect(rec.events[0]).toBe(impact);
    expect(rec.events.map((e) => e.type)).toEqual(['vfx:projectile-impact', 'health:changed']);
    expect(rec.eventMs[0]).toBeCloseTo(STEP);
    expect(rec.healthAt(0)).toBe(80);
    expect(rec.healthAt(STEP + 1)).toBe(70);
  });

  it('keeps only the last wave: the next start drops the finished recording', () => {
    const h = new Harness();
    h.startWave(4);
    h.recorder.finish('completed');
    expect(h.recorder.readyWave()).toBe(4);
    h.startWave(5);
    expect(h.recorder.readyWave()).toBeNull();
    expect(h.recorder.recording).toBeNull();
    h.recorder.finish('completed');
    expect(h.recorder.recording!.wave).toBe(5);
  });

  it('forgets the recording on clear()', () => {
    const h = new Harness();
    h.startWave();
    h.recorder.finish('completed');
    h.recorder.clear();
    expect(h.recorder.recording).toBeNull();
  });

  it('records nothing while the engine does not render (headless training)', () => {
    const h = new Harness();
    h.engine.renderingEnabled = false;
    h.startWave();
    h.steps(12);
    h.recorder.finish('completed');
    expect(h.recorder.isRecording).toBe(false);
    expect(h.recorder.recording).toBeNull();
  });

  it('stops listening on dispose()', () => {
    const h = new Harness();
    h.recorder.dispose();
    h.startWave();
    expect(h.recorder.isRecording).toBe(false);
  });

  it('hangs on the catch-all path only while it records, so emit keeps its fast path otherwise', () => {
    const h = new Harness();
    expect(h.bus.catchAllListenerCount).toBe(0);
    h.startWave();
    expect(h.bus.catchAllListenerCount).toBe(1);
    h.recorder.finish('completed');
    expect(h.bus.catchAllListenerCount).toBe(0);
    // Headless training records nothing and listens to nothing but the wave start
    h.engine.renderingEnabled = false;
    h.startWave();
    expect(h.bus.catchAllListenerCount).toBe(0);
  });

  it('drops the recording when it fails on an event; the game still gets the event', () => {
    const h = new Harness();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spawned = vi.fn();
    h.bus.on('enemy:spawned', spawned);
    h.startWave();
    const broken = {
      get typeConfig(): never {
        throw new Error('broken');
      },
    };

    expect(() => h.emit({ type: 'enemy:spawned', enemy: broken as never })).not.toThrow();
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(h.recorder.isRecording).toBe(false);
    expect(h.recorder.recording).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

/**
 * Cost of recording in live play (coarse, see game-engine/performance.spec.ts
 * on why wall-clock bounds stay loose here). Logs the measured numbers.
 */
describe('ReplayRecorder cost', () => {
  const SANITY_CAP_MS = 3000;

  it('records a W19-sized swarm and reuses its columns in the next wave', () => {
    const h = new Harness();
    for (let i = 0; i < 2800; i++) h.enemies.push(fakeEnemy('skeleton', i * 1e-5, i * 2e-5));
    for (let i = 0; i < 300; i++) h.projectiles.push(fakeProjectile(i * 1e-5, 0));
    for (let i = 0; i < 60; i++) {
      h.towers.push(fakeTower(`tower-${i}`));
      h.turrets.set(`tower-${i}`, { currentLocalRotation: i, turretPart: {} });
    }
    const frames = 300;

    h.startWave(19);
    const t0 = performance.now();
    h.steps(frames * 6);
    const firstWaveMs = performance.now() - t0;
    h.recorder.finish('completed');
    const rec = h.recorder.recording!;
    const columns = rec.eIndex;
    expect(rec.frameCount).toBe(frames + 1);
    expect(rec.enemySamples).toBe((frames + 1) * 2800);

    h.startWave(20);
    const t1 = performance.now();
    h.steps(frames * 6);
    const secondWaveMs = performance.now() - t1;
    h.recorder.finish('completed');
    expect(h.recorder.recording!.eIndex).toBe(columns);

    const perFrameUs = (secondWaveMs / frames) * 1000;
    console.log(
      `[replay bench] 2800 enemies, 300 projectiles, 60 towers: ` +
      `first wave ${(firstWaveMs / frames * 1000).toFixed(0)} µs/frame (columns growing), ` +
      `next wave ${perFrameUs.toFixed(0)} µs/frame = ${(perFrameUs * 10 / 1000).toFixed(2)} ms per game second at 10 frames/s; ` +
      `columns ${(rec.sampleBytes / 1024 / 1024).toFixed(1)} MB for ${(frames / 10).toFixed(0)} s`,
    );
    expect(firstWaveMs + secondWaveMs).toBeLessThan(SANITY_CAP_MS);
  });
});
