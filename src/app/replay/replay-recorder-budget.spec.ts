import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));
// Room for a handful of frames of 1000 enemies, so the recorder has to thin
vi.mock('../configs/replay.config', () => ({
  REPLAY_CONFIG: {
    stepsPerFrame: 6,
    maxStepsPerFrame: 48,
    sampleBudgetBytes: 400_000,
    maxEvents: 100,
    speeds: [0.25, 0.5, 1, 2, 4],
    maxAudioSpeed: 1,
  },
}));

import { Vector3 } from 'three';
import { GameEventBus } from '../game-engine/game-event-bus';
import { GameClock } from '../managers/game-state/game-clock';
import { ReplayRecorder } from './replay-recorder';
import type { RouteBodyStations } from '../utils/route-body';

describe('ReplayRecorder under the memory budget', () => {
  it('keeps every frame on the grid of the current spacing while thinning, bodies and hero with them', () => {
    const bus = new GameEventBus();
    const enemy = {
      alive: true,
      heightOffset: 0,
      position: { lat: 0, lon: 0 },
      typeConfig: { id: 'rat' },
      transform: { terrainHeight: 0, rotation: 0 },
      health: { healthPercent: 1 },
      movement: {
        speedMps: 1, speedMultiplier: 1, statusEffects: [], hasStatusEffects: false,
        getSlowMultiplier: () => 1, isSlowed: () => false, isPoisoned: () => false, isBurning: () => false,
        isFrozen: () => false, isStunned: () => false,
      },
      rush: null,
      body: null as { stations: RouteBodyStations; tailM: number; tipM: number } | null,
    };
    // Every tenth one an ooze with its body along the route
    const stations = {} as RouteBodyStations;
    const enemies = Array.from({ length: 1000 }, (_, i) =>
      ({ ...enemy, body: i % 10 === 0 ? { stations, tailM: i, tipM: i + 5 } : null }));
    let time = 0;
    const recorder = new ReplayRecorder(bus, {
      enemies: () => enemies,
      projectiles: () => [],
      towers: () => [],
      hero: () => ({ lat: 0, lon: 0, heading: 0, pose: 'idle' }),
      engine: () => ({
        renderingEnabled: true,
        sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, t: Vector3) => t },
        towers: { get: () => undefined },
        flameBeams: { getBeam: () => null },
        tentacles: { getStrikeTarget: () => null },
      }),
      gameTimeMs: () => time,
      baseHealth: () => 100,
      credits: () => 0,
    });

    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1000 });
    const steps = 6 * 60;
    for (let i = 0; i < steps; i++) {
      time += GameClock.FIXED_STEP_MS;
      recorder.onSubStep();
    }
    recorder.finish('completed');

    const rec = recorder.recording!;
    expect(rec.stepsPerFrame).toBeGreaterThan(6);
    expect(rec.sampleBytes).toBeLessThanOrEqual(400_000);
    const spacingMs = rec.stepsPerFrame * GameClock.FIXED_STEP_MS;
    // Every frame but the closing one sits on a multiple of the spacing
    for (let f = 0; f < rec.frameCount - 1; f++) {
      expect(rec.frameMs[f] / spacingMs).toBeCloseTo(f, 6);
    }
    // Each kept frame still holds its 100 bodies, in table order, and the hero
    for (let f = 0; f < rec.frameCount; f++) {
      const b = rec.frameBodyStart[f];
      expect(rec.frameBodyStart[f + 1] - b).toBe(100);
      expect([rec.bIndex[b + 1], rec.bTail[b + 1], rec.bTip[b + 1]]).toEqual([10, 10, 15]);
      expect(rec.heroPose[f]).toBeGreaterThan(0);
    }
  });
});
