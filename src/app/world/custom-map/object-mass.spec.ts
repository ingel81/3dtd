import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from './map-document';
import {
  MASS_PARAPET,
  massArea,
  massBox,
  massContains,
  massDistance,
  massFronts,
  massInset,
  massPitched,
  massProblem,
  massRadius,
  massRoof,
  massTop,
  massTriangles,
  objectFooting,
  objectShape,
} from './object-mass';
import { PlacedRoof, roofHeights } from './object-roof';

/** A block of 40 x 30 m round a courtyard of 20 x 10 m, flat roof */
const court: MapMass = {
  rings: [
    [-20, -15, 20, -15, 20, 15, -20, 15],
    [-10, -5, 10, -5, 10, 5, -10, 5],
  ],
  height: 12,
  floors: 4,
  roof: 'flat',
  facade: 'plaster',
};

const house: MapMass = { rings: [[-6, -4, 6, -4, 6, 4, -6, 4]], height: 6.2, floors: 2, roof: 'gable', ridge: 3, facade: 'plaster' };

describe('raised buildings: what the rules read of one', () => {
  it('takes its ground from the outline less the courtyards, either way round', () => {
    expect(massArea(court)).toBeCloseTo(40 * 30 - 20 * 10);
    const turned: MapMass = { ...court, rings: court.rings.map((r) => r.flatMap((_, i) => (i % 2 ? [] : [r[r.length - 2 - i], r[r.length - 1 - i]]))) };
    expect(massArea(turned)).toBeCloseTo(massArea(court));
    expect(massContains(court, 15, 0)).toBe(true);
    // The courtyard is no ground of the building, nor is the street beside it
    expect(massContains(court, 0, 0)).toBe(false);
    expect(massContains(court, 25, 0)).toBe(false);
    expect(massDistance(court, 15, 0)).toBe(0);
    expect(massDistance(court, 0, 0)).toBeCloseTo(5);
    expect(massDistance(court, 23, 0)).toBeCloseTo(3);
  });

  it('measures its rectangle, radius and top like a model, and its footing in place of the entry', () => {
    expect(massBox(court)).toEqual([0, 0, 20, 15]);
    expect(massRadius(court)).toBeCloseTo(25);
    expect(massTop(court)).toBe(12);
    expect(massPitched(court)).toBe(false);
    expect(massPitched(house)).toBe(true);
    expect(massTop(house)).toBeCloseTo(9.2);
    // A pitched roof stands only over a lone rectangle along the axes
    expect(massPitched({ ...house, rings: [[-6, -4, 6, -4, 7, 4, -6, 4]] })).toBe(false);
    const o: Pick<MapObject, 'asset' | 'mass'> = { asset: MASS_ASSET, mass: court };
    const footing = objectFooting(o, { category: 'building', footprint: 16.7, height: 4 });
    expect(footing).toEqual({ category: 'building', footprint: massRadius(court), height: 12, box: [0, 0, 20, 15] });
    expect(objectFooting({ asset: 'house-modern' }, { category: 'building', footprint: 5, height: 9 })?.footprint).toBe(5);
    expect(objectShape(o, { footprint: 16.7 }).footprint).toBeCloseTo(25);
  });

  it('carries towers on its roof inside the parapet, nothing over the courtyard, on the slope of a pitched one', () => {
    const roof = massRoof(court);
    expect(massRoof(court)).toBe(roof);
    const heights = roofHeights(roof);
    const at = (x: number, z: number) => heights[Math.floor((z - roof.z) / roof.cell) * roof.columns + Math.floor((x - roof.x) / roof.cell)];
    expect(at(15, 0)).toBeCloseTo(12 - MASS_PARAPET, 1);
    expect(at(0, 0)).toBeNaN();
    // Placed on the map: turned and lifted as a model's roof
    const placed = new PlacedRoof(roof, 100, 50, 0, 1, 20);
    expect(placed.heightAt(85, 50)).toBeCloseTo(20 + 12 - MASS_PARAPET, 1);
    expect(placed.heightAt(100, 50)).toBeNaN();
    const pitched = massRoof(house);
    const h = roofHeights(pitched);
    const mid = h[Math.floor((0 - pitched.z) / pitched.cell) * pitched.columns + Math.floor((0 - pitched.x) / pitched.cell)];
    const eave = h[Math.floor((3.6 - pitched.z) / pitched.cell) * pitched.columns + Math.floor((0 - pitched.x) / pitched.cell)];
    expect(mid).toBeGreaterThan(eave);
    expect(mid).toBeLessThanOrEqual(9.2 + 0.1);
  });

  it('costs its walls, roof and parapet in triangles: a few hundred for a block, a dozen or so for a house', () => {
    // 8 walls: 16 for the walls, 8 - 2 + 2 for the roof, 32 for the parapet
    expect(massTriangles(court)).toBe(16 + 8 + 32);
    expect(massTriangles(house)).toBeLessThan(20);
  });

  it('finds what is wrong with a building in a map file', () => {
    expect(massProblem(court)).toBeNull();
    expect(massProblem(null)).toMatch(/not an object/);
    expect(massProblem({ ...court, rings: [] })).toMatch(/no outline/);
    expect(massProblem({ ...court, rings: [[0, 0, 1, 1]] })).toMatch(/broken ring/);
    expect(massProblem({ ...court, rings: [[0, 0, 1, 0, Number.NaN, 1]] })).toMatch(/broken ring/);
    expect(massProblem({ ...court, height: 0 })).toMatch(/height/);
    expect(massProblem({ ...court, floors: 0 })).toMatch(/storeys/);
    expect(massProblem({ ...court, roof: 'dome' })).toMatch(/roof/);
    expect(massProblem({ ...court, facade: 'glass' })).toMatch(/facade/);
    expect(massProblem({ ...court, ridge: -1 })).toMatch(/ridge/);
  });
});

describe('raised buildings: a mansard over a crooked outline', () => {
  const l: MapMass = { rings: [[0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]], height: 6, floors: 2, roof: 'mansard', ridge: 3, facade: 'timber' };

  it('draws the outline in for its top, rises from the walls to it, and carries towers on both', () => {
    const inset = massInset(l)!;
    expect(inset.run).toBeGreaterThan(1);
    expect(inset.run).toBeLessThanOrEqual(4);
    expect(inset.ring.length).toBe(12);
    expect(massTop(l)).toBe(9);
    expect(massPitched(l)).toBe(false);
    const roof = massRoof(l);
    const heights = roofHeights(roof);
    const at = (x: number, z: number) => heights[Math.floor((z - roof.z) / roof.cell) * roof.columns + Math.floor((x - roof.x) / roof.cell)];
    // At the wall the eaves, deep inside the wing the top
    expect(at(15, 0.5)).toBeLessThan(7.5);
    expect(at(5, 20)).toBeCloseTo(9, 0);
    // A courtyard or a second ring: no mansard, the roof is flat
    expect(massInset({ ...l, rings: [...l.rings, [2, 2, 4, 2, 4, 4]] })).toBeNull();
    expect(massInset({ ...l, roof: 'flat' })).toBeNull();
  });
});

describe('raised buildings: their fronts on the map', () => {
  it('gives the walls of the outline with outward normals, turned and placed like the object, courtyards left out', () => {
    const o = { asset: MASS_ASSET, mass: court, x: 100, y: 50, rotation: Math.PI / 2, scale: 1 };
    const fronts = massFronts(o);
    expect(fronts.length).toBe(4);
    for (const f of fronts) {
      expect(Math.hypot(f.nx, f.ny)).toBeCloseTo(1);
      // The normal points away from the building's middle
      expect((f.x - 100) * f.nx + (f.y - 50) * f.ny).toBeGreaterThan(0);
      expect(f.top).toBe(12);
      expect(f.ground).toBeGreaterThan(0.45);
      expect(f.ground).toBeLessThan(5);
    }
    expect(fronts.map((f) => Math.round(f.width)).sort((a, b) => a - b)).toEqual([30, 30, 40, 40]);
    expect(massFronts({ ...o, asset: 'house-modern' })).toEqual([]);
  });
});
