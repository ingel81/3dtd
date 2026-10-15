import { describe, expect, it } from 'vitest';
import type { MapLifeArea } from './map-document';
import { areaShown, insideOutline, lifeProblems, lifeSpots, lifeSwitches, loopInside, nearestOnShape, outlineArea, resampleShape, shapeLength } from './map-life';
import { createMapDocument } from './map-create';
import { packMapFile, unpackMapFile } from './map-file';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
// An L: the square's upper right quarter cut away
const ell = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 }];

describe('map life', () => {
  it('fills in the switches: own life on, sparks and waving banners off, density 1', () => {
    expect(lifeSwitches(undefined)).toEqual({ smoke: true, fireflies: true, birds: true, sparks: false, density: 1, flags: false });
    expect(lifeSwitches({ auto: { birds: false, sparks: true }, density: 5, flags: true })).toEqual({
      smoke: true,
      fireflies: true,
      birds: false,
      sparks: true,
      density: 2,
      flags: true,
    });
  });

  it('shows no area on Low and those asking for High only there', () => {
    const area = { quality: 'high' } as MapLifeArea;
    expect(areaShown({} as MapLifeArea, 0)).toBe(false);
    expect(areaShown({} as MapLifeArea, 0.7)).toBe(true);
    expect(areaShown(area, 0.7)).toBe(false);
    expect(areaShown(area, 1)).toBe(true);
  });

  it('measures outlines and lines, inside and the nearest point', () => {
    expect(insideOutline(ell, 25, 75)).toBe(true);
    expect(insideOutline(ell, 75, 75)).toBe(false);
    expect(outlineArea(ell)).toBeCloseTo(7500, 6);
    expect(shapeLength(square, true)).toBe(400);
    expect(shapeLength(square, false)).toBe(300);
    const at = { x: 0, y: 0 };
    expect(nearestOnShape({ shape: 'area', points: ell }, 25, 75, at)).toBe(0);
    expect(nearestOnShape({ shape: 'area', points: ell }, 75, 75, at)).toBeCloseTo(25, 6);
    expect(nearestOnShape({ shape: 'route', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, 50, 30, at)).toBe(30);
    expect(at).toEqual({ x: 50, y: 0 });
    const even = resampleShape([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }], false, 5);
    expect(even.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10], [10, 20], [10, 30]]);
  });

  it('spreads spots inside an outline, along a line, and at most so many', () => {
    const area = { id: 'a', shape: 'area' as const, points: ell };
    const spots = lifeSpots(area, 10, 1000);
    expect(spots.length).toBeGreaterThan(60);
    expect(spots.length).toBeLessThan(80);
    expect(spots.every((p) => insideOutline(ell, p.x, p.y))).toBe(true);
    // The same spots again: seeded by the area's id
    expect(lifeSpots(area, 10, 1000)).toEqual(spots);
    expect(lifeSpots(area, 10, 20)).toHaveLength(20);
    const line = lifeSpots({ id: 'r', shape: 'route', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, 10, 1000);
    expect(line).toHaveLength(11);
    expect(line.every((p) => Math.abs(p.y) <= 2.5)).toBe(true);
  });

  it('draws a closed loop inside an outline', () => {
    const loop = loopInside(square, 7, 48);
    expect(loop).toHaveLength(48);
    expect(loop.every((p) => insideOutline(square, p.x, p.y))).toBe(true);
    // It goes round: points on every side of the middle
    expect(loop.some((p) => p.x < 35) && loop.some((p) => p.x > 65) && loop.some((p) => p.y < 35) && loop.some((p) => p.y > 65)).toBe(true);
  });

  it('names what is wrong with a life entry', () => {
    expect(lifeProblems(undefined)).toEqual([]);
    expect(lifeProblems({ areas: [{ id: 'a', kind: 'birds', shape: 'area', points: square }] })).toEqual([]);
    const bad = lifeProblems({
      density: 3,
      ambience: { sound: 'wind' },
      areas: [
        { id: 'a', kind: 'dragons', shape: 'area', points: square },
        { id: 'a', kind: 'birds', shape: 'area', points: square.slice(0, 2) },
        { id: 'b', kind: 'sound', shape: 'route', points: square, volume: 2, color: 'red' },
      ],
    });
    expect(bad).toEqual([
      'life.density must be 0 to 2',
      'life.ambience needs a sound and a volume 0 to 1',
      'life area a: kind dragons is unknown',
      'life area id "a" is missing or twice',
      'life area a needs 3 to 256 points',
      'life area b: volume must be 0 to 1',
      'life area b: color must be #rrggbb',
    ]);
  });

  it('goes into the map file and out again; a map without it keeps its file', () => {
    const doc = createMapDocument({ id: 'life', name: 'Life', width: 64, depth: 64, cellSize: 4 });
    const plain = unpackMapFile(packMapFile(doc)).doc;
    expect(plain.life).toBeUndefined();
    doc.life = { auto: { birds: false }, density: 1.5, ambience: { sound: 'biome', volume: 0.5 }, areas: [{ id: 's', kind: 'sound', shape: 'route', points: [{ x: 0, y: 0 }, { x: 20, y: 5 }], sound: 'stream' }] };
    expect(unpackMapFile(packMapFile(doc)).doc.life).toEqual(doc.life);
    doc.life = { areas: [{ id: 's', kind: 'sound', shape: 'route', points: [{ x: 0, y: 0 }] }] };
    expect(() => packMapFile(doc)).toThrow(/life area s needs 2 to 256 points/);
  });
});
