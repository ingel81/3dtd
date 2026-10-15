import { Vector3 } from 'three';
import type { MapLifeArea, MapLifeKind, MapPoint } from '../../map-document';
import { areaDensity, catmullRomLoop, lifeSeed, lifeSpots, loopInside, outlineArea, resampleShape, shapeLength } from '../../map-life';
import { mapToScene } from '../map-coords';
import type { Flock } from './bird-flocks';
import { particleCount, type ParticleEmitter, type ParticleKind } from './particle-field';

/**
 * What a life area (map-life.ts) puts on the map, as the effects take it:
 * particle emitters spread over its outline or along its line, and the
 * loop a flock flies. Sizes per kind below; the area's density and the
 * map's scale the numbers.
 */

/** Ground under a map point, water where there is water over it */
export type SurfaceAt = (x: number, y: number) => number;

/** Per particle kind: metres between emitters, their radius share of that, how high over the ground they start */
const SPOTS: Partial<Record<MapLifeKind, { spacing: number; height: number }>> = {
  fireflies: { spacing: 14, height: 1.5 },
  fog: { spacing: 28, height: 0 },
  leaves: { spacing: 10, height: 7 },
  embers: { spacing: 8, height: 0.2 },
  sparks: { spacing: 10, height: 0.3 },
};
/** Most emitters one area gets (spread over it) */
const MOST_SPOTS = 160;

/** Birds of an area's flock at density 1, how high it flies by default */
const AREA_BIRDS = 10;
const ROUTE_BIRDS = 8;
export const FLOCK_HEIGHT = 40;

/** Whether the kind is drawn as particles */
export function isParticleLife(kind: MapLifeKind): kind is MapLifeKind & ParticleKind {
  return kind in SPOTS;
}

/**
 * Emitters over the area for its particle kind; `factor` is the map's
 * density, `share` the quality level's share of particles
 */
export function lifeEmitters(area: MapLifeArea, surface: SurfaceAt, factor: number, share: (count: number) => number): ParticleEmitter[] {
  const look = SPOTS[area.kind];
  if (!look || !isParticleLife(area.kind)) return [];
  const kind = area.kind;
  const spots = lifeSpots(area, look.spacing, MOST_SPOTS);
  const count = share(particleCount(kind, undefined) * areaDensity(area) * factor);
  const height = area.height ?? look.height;
  return spots.map((p) => ({
    kind,
    origin: mapToScene(p.x, p.y, surface(p.x, p.y), new Vector3()),
    radius: look.spacing * 0.6,
    height,
    count,
    color: area.color,
    scale: kind === 'fog' ? 1.4 : 1,
  }));
}

/**
 * The flock of a birds area: a loop inside its outline, or out along its
 * route on one side and back on the other; at `height` over the highest
 * ground near each point of the loop (so it clears the hills it crosses)
 */
export function lifeFlock(area: MapLifeArea, ground: SurfaceAt, factor: number): Flock {
  const density = areaDensity(area) * factor;
  const seed = lifeSeed(area.id);
  let loop: MapPoint[];
  let spread: number;
  let drift: number;
  if (area.shape === 'area') {
    loop = loopInside(area.points, seed, 48);
    const size = Math.sqrt(outlineArea(area.points));
    spread = Math.min(25, Math.max(4, size / 8));
    drift = Math.min(20, size / 10);
  } else {
    loop = routeLoop(area.points, 12);
    spread = 6;
    drift = 6;
  }
  const species = area.species ?? 'songbirds';
  // Birds of prey circle high and alone or in twos and threes, wide apart
  const raptors = species === 'raptors';
  const height = area.height ?? (raptors ? 2 * FLOCK_HEIGHT : FLOCK_HEIGHT);
  if (raptors) spread *= 1.6;
  const tops = loop.map((p) => ground(p.x, p.y));
  const path = loop.map((p, k) => {
    // The highest ground of the neighbouring points: a flock flies over a ridge, not into it
    let top = -Infinity;
    for (let d = -3; d <= 3; d++) top = Math.max(top, tops[(k + d + tops.length) % tops.length]);
    return mapToScene(p.x, p.y, top + height, new Vector3());
  });
  const birds = Math.max(raptors ? 1 : 2, Math.round((area.shape === 'area' ? AREA_BIRDS : ROUTE_BIRDS) * density * (raptors ? 0.3 : 1)));
  return { path, birds, spread, drift, seed: (seed % 1000) / 1000 || 0.37, species };
}

/**
 * A closed loop along a line: out on one side `offset` metres from it,
 * round its end and back on the other side; something on it goes there and
 * back without turning on the spot
 */
export function routeLoop(points: readonly MapPoint[], offset: number): MapPoint[] {
  const length = shapeLength(points, false);
  const count = Math.max(3, Math.min(24, Math.round(length / 40) + 1));
  const line = resampleShape(points, false, count);
  const side = (k: number): MapPoint => {
    const a = line[Math.max(0, k - 1)];
    const b = line[Math.min(line.length - 1, k + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  const keys: MapPoint[] = [];
  for (let k = 0; k < line.length; k++) {
    const n = side(k);
    keys.push({ x: line[k].x + n.x * offset, y: line[k].y + n.y * offset });
  }
  for (let k = line.length - 1; k >= 0; k--) {
    const n = side(k);
    keys.push({ x: line[k].x - n.x * offset, y: line[k].y - n.y * offset });
  }
  return catmullRomLoop(keys, Math.max(32, Math.min(96, keys.length * 4)));
}
