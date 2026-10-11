/**
 * The city biome's street grid: streets every `CITY_GRID.block` metres
 * along both axes, fixed to the map so separate strokes line up, with
 * sidewalks on both sides. Buildings stand in slots along the block edges,
 * facing the street; lamps, furniture, trees and parked cars in slots along
 * the streets.
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
const BUILDING_STEP = 15;
const BUILDING_DEPTH = CITY_GRID.sidewalk + 8;
/**
 * Slots along the streets: lamps on the sidewalk's outer edge, furniture
 * and street trees on its inner side, parked cars at the curb. Step and
 * offset in metres from the street's middle; `along` turns the object
 * with the street (cars), else it faces the street.
 */
const STREET_SLOTS = {
  street: { step: 24, offset: CITY_GRID.sidewalk - 1.5, along: false, phase: 0.5 },
  walk: { step: 9, offset: CITY_GRID.sidewalk - 3, along: false, phase: 0.2 },
  curb: { step: 7, offset: CITY_GRID.street - 1.4, along: true, phase: 0 },
} as const;

export type StreetZone = keyof typeof STREET_SLOTS;

/** Turn for a front facing (dx, dy) */
function facing(dx: number, dy: number): number {
  return Math.round(Math.atan2(-dx, dy) * 1000) / 1000;
}

/** The building or lamp slots inside a rectangle of the map */
export function citySlots(zone: 'block' | StreetZone, minX: number, maxX: number, minY: number, maxY: number): CitySlot[] {
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
  // Along both kinds of street, both sides, away from the crossings
  const z = STREET_SLOTS[zone];
  for (let m = Math.min(i0, j0); m <= Math.max(i1, j1); m++) {
    const line = m * b;
    for (let s = Math.floor(Math.min(minX, minY) / z.step) - 1; s <= Math.ceil(Math.max(maxX, maxY) / z.step) + 1; s++) {
      const along = (s + z.phase) * z.step;
      if (Math.abs(along - Math.round(along / b) * b) < CITY_GRID.sidewalk + 2) continue;
      for (const side of [-1, 1]) {
        const off = side * z.offset;
        // A street along x (at y = line) and one along y (at x = line); cars keep to the right
        const alongX = z.along ? facing(-side, 0) : facing(0, -side);
        const alongY = z.along ? facing(0, side) : facing(-side, 0);
        if (inside(along, line + off)) out.push({ key: `${zone}:x:${m}:${s}:${side}`, x: along, y: line + off, rotation: alongX });
        if (inside(line + off, along)) out.push({ key: `${zone}:y:${m}:${s}:${side}`, x: line + off, y: along, rotation: alongY });
      }
    }
  }
  return out;
}
