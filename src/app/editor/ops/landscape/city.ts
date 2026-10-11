/**
 * The city biome's street grid: streets every `CITY_GRID.block` metres
 * along both axes, fixed to the map so separate strokes line up, with
 * sidewalks on both sides. Buildings stand in slots along the block edges,
 * facing the street; lamps in slots along the sidewalks.
 */
import { CITY_GRID } from './biomes';

/** Metres from a point to the middle line of the nearest street */
export function streetDistance(x: number, y: number): number {
  const b = CITY_GRID.block;
  return Math.min(Math.abs(x - Math.round(x / b) * b), Math.abs(y - Math.round(y / b) * b));
}

export interface CitySlot {
  /** Stable per slot, for the stroke's decided set */
  key: string;
  x: number;
  y: number;
  /** Turn so the object's front (+y at turn 0) faces the street */
  rotation: number;
}

/** Metres between building slots along a block edge, and their depth from the street's middle */
const BUILDING_STEP = 12;
const BUILDING_DEPTH = CITY_GRID.sidewalk + 6.5;
/** Metres between lamps along a street, and their distance from its middle */
const LAMP_STEP = 24;
const LAMP_OFFSET = CITY_GRID.sidewalk - 1.5;

/** Turn for a front facing (dx, dy) */
function facing(dx: number, dy: number): number {
  return Math.round(Math.atan2(-dx, dy) * 1000) / 1000;
}

/** The building or lamp slots inside a rectangle of the map */
export function citySlots(zone: 'block' | 'street', minX: number, maxX: number, minY: number, maxY: number): CitySlot[] {
  const b = CITY_GRID.block;
  const out: CitySlot[] = [];
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const i0 = Math.floor(minX / b) - 1;
  const i1 = Math.floor(maxX / b) + 1;
  const j0 = Math.floor(minY / b) - 1;
  const j1 = Math.floor(maxY / b) + 1;
  if (zone === 'block') {
    for (let bj = j0; bj <= j1; bj++) {
      for (let bi = i0; bi <= i1; bi++) {
        const x0 = bi * b;
        const y0 = bj * b;
        for (let t = CITY_GRID.sidewalk + BUILDING_STEP / 2, k = 0; t <= b - CITY_GRID.sidewalk - BUILDING_STEP / 2 + 0.01; t += BUILDING_STEP, k++) {
          const sides: [string, number, number, number, number][] = [
            ['s', x0 + t, y0 + BUILDING_DEPTH, 0, -1],
            ['n', x0 + t, y0 + b - BUILDING_DEPTH, 0, 1],
            ['w', x0 + BUILDING_DEPTH, y0 + t, -1, 0],
            ['e', x0 + b - BUILDING_DEPTH, y0 + t, 1, 0],
          ];
          for (const [side, x, y, dx, dy] of sides) {
            if (inside(x, y)) out.push({ key: `b:${bi}:${bj}:${side}:${k}`, x, y, rotation: facing(dx, dy) });
          }
        }
      }
    }
    return out;
  }
  // Lamps along both kinds of street, both sides, away from the crossings
  for (let m = Math.min(i0, j0); m <= Math.max(i1, j1); m++) {
    const line = m * b;
    for (let s = Math.floor(Math.min(minX, minY) / LAMP_STEP) - 1; s <= Math.ceil(Math.max(maxX, maxY) / LAMP_STEP) + 1; s++) {
      const along = (s + 0.5) * LAMP_STEP;
      if (Math.abs(along - Math.round(along / b) * b) < CITY_GRID.sidewalk + 2) continue;
      for (const side of [-1, 1]) {
        const off = side * LAMP_OFFSET;
        // A street along x (at y = line) and one along y (at x = line)
        if (inside(along, line + off)) out.push({ key: `l:x:${m}:${s}:${side}`, x: along, y: line + off, rotation: facing(0, -side) });
        if (inside(line + off, along)) out.push({ key: `l:y:${m}:${s}:${side}`, x: line + off, y: along, rotation: facing(-side, 0) });
      }
    }
  }
  return out;
}
