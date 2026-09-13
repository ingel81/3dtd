// @vitest-environment node
/**
 * Offscreen arrows at 20k enemies: what one tick of
 * OffscreenIndicatorsComponent costs.
 *
 * Runs the component's own tick() and scan() on a stand-in `this` holding
 * the fields its constructor would inject, with real Enemy entities, the
 * real EllipsoidSync, a real camera and the real OffscreenClusterer. The tick
 * runs on an 8 Hz timer, so ms per tick times 8 is the cost per second.
 *
 *   npm run bench -- offscreen
 *
 * Conditions: Node, no DOM, no rendering, no game loop. "compact" builds the
 * enemies back to back; "scattered" retains 0.5 to 4 KB of garbage between
 * two enemies, so they spread over the heap as enemies spawned during a game
 * do. The enemy hot path in the game is bound by touching cold heap objects,
 * so the scattered rows are the closer ones, and a Chrome trace has the last
 * word.
 */
// The component's imports pull in partly compiled Angular classes (JIT fallback)
import '@angular/compiler';
import { describe, test } from 'vitest';
import { signal } from '@angular/core';
import { PerspectiveCamera, Vector3 } from 'three';
import { Enemy } from '../../src/app/entities/enemy.entity';
import { EllipsoidSync } from '../../src/app/three-engine/ellipsoid-sync';
import { OffscreenClusterer, NEAR_HQ_PROGRESS } from '../../src/app/utils/offscreen-indicators';
import { OffscreenIndicatorsComponent } from '../../src/app/components/offscreen-indicators/offscreen-indicators.component';
import type { GeoPosition } from '../../src/app/models/game.types';

const ENEMIES = 20_000;
const BOSSES = 10;
const ORIGIN = { lat: 48.137, lon: 11.575 };

/** Deterministic 0..1, so every run builds the same wave. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2.4 km from the north-east into the HQ at the origin, 60 waypoints. */
const PATH: GeoPosition[] = Array.from({ length: 60 }, (_, i) => {
  const t = 1 - i / 59;
  return { lat: ORIGIN.lat + t * 0.015, lon: ORIGIN.lon + t * 0.015 + Math.sin(i / 5) * 0.0008, height: 0 };
});

/** Kept alive so the scattered enemies stay apart. */
const retained: unknown[] = [];

/**
 * The wave: bosses first, the rest zombies, at a random place on the route.
 * `nearHq` puts everyone on the last stretch, a leak wave's worst case.
 */
function wave(nearHq: boolean, scattered: boolean): Enemy[] {
  const random = mulberry32(nearHq ? 2 : 1);
  const enemies: Enemy[] = [];
  const segments = PATH.length - 1;
  for (let i = 0; i < ENEMIES; i++) {
    const along = nearHq ? NEAR_HQ_PROGRESS + random() * (1 - NEAR_HQ_PROGRESS) : random();
    const at = along * segments;
    const index = Math.min(segments - 1, Math.floor(at));
    enemies.push(new Enemy(i < BOSSES ? 'herbert' : 'zombie', PATH, undefined, index, at - index));
    if (scattered) retained.push(new Uint8Array(512 + Math.floor(random() * 3584)));
  }
  return enemies;
}

/** Screen and camera as at the game start: 1920 x 1080, 400 m over the HQ, looking north. */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  cam.position.set(0, 400, -145);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

interface Indicators {
  tick(): void;
  scan(): void;
  threats: Enemy[];
  arrows: () => unknown[];
}

/** The component without Angular: its prototype with the fields the constructor injects. */
function indicators(enemies: Enemy[], paused: boolean): Indicators {
  const cam = camera();
  const sync = new EllipsoidSync(ORIGIN.lat, ORIGIN.lon);
  const self = Object.create(OffscreenIndicatorsComponent.prototype) as Indicators;
  Object.assign(self, {
    gameState: {
      tilesEngine: { getCamera: () => cam, sync },
      enemyManager: { getAlive: () => enemies },
    },
    gameStore: { phase: () => 'wave', renderingEnabled: () => true, paused: () => paused },
    host: { nativeElement: { clientWidth: 1920, clientHeight: 1080 } },
    arrows: signal([]),
    clusterer: new OffscreenClusterer(8),
    threats: [],
    point: new Vector3(),
  });
  // Paused, the tick re-projects the threats of the last scan
  if (paused) self.scan();
  return self;
}

for (const scattered of [false, true]) {
  for (const nearHq of [false, true]) {
    const enemies = wave(nearHq, scattered);
    const running = indicators(enemies, false);
    const paused = indicators(enemies, true);
    running.tick();
    const label = `${ENEMIES / 1000}k ${nearHq ? 'all near the HQ' : 'along the route'}, ${scattered ? 'scattered' : 'compact'}`;
    console.log(`[offscreen bench] ${label}: ${running.threats.length} threats, ${running.arrows().length} arrows`);

    describe(label, () => {
      test('one tick', async ({ bench }) => {
        await bench.compare(
          bench('tick, wave running (scan + projection)', () => running.tick()),
          bench('tick, paused (projection only)', () => paused.tick()),
          bench('scan only', () => running.scan()),
        );
      });
    });
  }
}
