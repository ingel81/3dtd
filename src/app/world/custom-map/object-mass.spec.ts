import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from './map-document';
import {
  MASS_PARAPET,
  massApex,
  massArea,
  massBodies,
  massBox,
  massRectFrame,
  massRoofAt,
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
import { wordsOf } from './testing/map-words';

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
    expect(wordsOf(massProblem(court))).toBeNull();
    expect(wordsOf(massProblem(null))).toMatch(/not an object/);
    expect(wordsOf(massProblem({ ...court, rings: [] }))).toMatch(/no outline/);
    expect(wordsOf(massProblem({ ...court, rings: [[0, 0, 1, 1]] }))).toMatch(/broken ring/);
    expect(wordsOf(massProblem({ ...court, rings: [[0, 0, 1, 0, Number.NaN, 1]] }))).toMatch(/broken ring/);
    expect(wordsOf(massProblem({ ...court, height: 0 }))).toMatch(/height/);
    expect(wordsOf(massProblem({ ...court, floors: 0 }))).toMatch(/storeys/);
    expect(wordsOf(massProblem({ ...court, roof: 'dome' }))).toMatch(/roof/);
    expect(wordsOf(massProblem({ ...court, facade: 'glass' }))).toMatch(/facade/);
    expect(wordsOf(massProblem({ ...court, ridge: -1 }))).toMatch(/ridge/);
    expect(wordsOf(massProblem({ ...court, shop: [0, 3] }))).toBeNull();
    expect(wordsOf(massProblem({ ...court, shop: [4] }))).toMatch(/shop/);
    expect(wordsOf(massProblem({ ...court, shop: 'all' }))).toMatch(/shop/);
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

describe('raised buildings: their parts (E297 L3)', () => {
  /** A hall 30 x 10 m under a gable along x, a tower 6 x 6 m at its east end, a helm on the tower from 24 m */
  const church: MapMass = {
    rings: [[-15, -5, 15, -5, 15, 5, -15, 5]],
    height: 24,
    floors: 1,
    roof: 'flat',
    facade: 'stone',
    roofTint: '#5f6368',
    roofCover: 'slate',
    parts: [
      { rings: [[-15, -5, 9, -5, 9, 5, -15, 5]], height: 12, floors: 1, roof: 'gable', ridge: 6 },
      { rings: [[9, -3, 15, -3, 15, 3, 9, 3]], height: 24.9, floors: 6, roof: 'flat', facade: 'brick', tint: '#c65843' },
      { rings: [[9, -3, 15, -3, 15, 3, 9, 3]], base: 24, height: 26, floors: 7, roof: 'pyramid', ridge: 14, roofTint: '#5f8f78', roofCover: 'metal' },
    ],
  };

  it('reads its parts: the top of the highest, the roofs of all, the helm over the tower', () => {
    expect(massProblem(church)).toBeNull();
    expect(massTop(church)).toBeCloseTo(40);
    expect(massRoofAt(church, 12, 0)).toBeCloseTo(40, 0);
    expect(massRoofAt(church, 0, 0)).toBeCloseTo(18);
    expect(massRoofAt(church, 0, 4)).toBeCloseTo(12 + 6 * 0.2);
    // The tower's flat roof in its corner, beside the helm's foot; outside nothing
    expect(massRoofAt(church, 12, 2.9)).toBeGreaterThan(24);
    expect(massRoofAt(church, 20, 0)).toBe(0);
    // The parts' own facade, colours and covering, else the building's
    const [hall, tower, helm] = massBodies(church);
    expect(hall).toMatchObject({ facade: 'stone', roofTint: '#5f6368', roofCover: 'slate' });
    expect(tower).toMatchObject({ facade: 'brick', tint: '#c65843' });
    expect(helm).toMatchObject({ base: 24, roofCover: 'metal', roofTint: '#5f8f78' });
    expect(massBodies(church)).toBe(massBodies(church));
    expect(massBodies(court)).toEqual([court]);
    // Walls, slopes and gables of all parts
    expect(massTriangles(church)).toBe(16 + (4 * 2 + 2 + 4 * 4) + 4 * 3);
  });

  it('pitches a roof over a rectangle turned any way, a pyramid over an outline its middle sees whole', () => {
    // 12 x 8 m turned 30 degrees: the ridge along the longer side
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const turn = (x: number, z: number) => [x * c - z * s, x * s + z * c];
    const ring = [turn(-6, -4), turn(6, -4), turn(6, 4), turn(-6, 4)].flat();
    const turned: MapMass = { rings: [ring], height: 6, floors: 2, roof: 'gable', ridge: 3, facade: 'plaster' };
    expect(massPitched(turned)).toBe(true);
    const f = massRectFrame(ring)!;
    expect([f.halfS, f.halfT]).toEqual([expect.closeTo(6, 5), expect.closeTo(4, 5)]);
    expect(Math.abs(f.ux * c + f.uz * s)).toBeCloseTo(1);
    const [rx, rz] = turn(3, 0);
    expect(massRoofAt(turned, rx, rz)).toBeCloseTo(9);
    // An octagon under a helm: its top over the middle, the slopes down to the eaves
    const oct = Array.from({ length: 8 }, (_, k) => [5 * Math.cos((k * Math.PI) / 4), 5 * Math.sin((k * Math.PI) / 4)]).flat();
    const helm: MapMass = { rings: [oct], height: 10, floors: 3, roof: 'pyramid', ridge: 8, facade: 'stone' };
    expect(massApex(helm)!.x).toBeCloseTo(0);
    expect(massTop(helm)).toBe(18);
    expect(massRoofAt(helm, 0, 0)).toBeCloseTo(18);
    expect(massRoofAt(helm, 2.4, 0)).toBeCloseTo(10 + 8 * (1 - 2.4 / 5));
    // An L its middle does not see whole stands flat
    expect(massApex({ ...helm, rings: [[0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]] })).toBeNull();
  });

  it('finds what is wrong with its parts', () => {
    expect(wordsOf(massProblem({ ...church, parts: [] }))).toMatch(/parts/);
    expect(wordsOf(massProblem({ ...church, parts: [{ ...church.parts![0], rings: [[0, 0, 1, 1]] }] }))).toMatch(/parts/);
    expect(wordsOf(massProblem({ ...church, parts: [{ ...church.parts![2], base: 30 }] }))).toMatch(/parts/);
    expect(wordsOf(massProblem({ ...church, parts: [{ ...church.parts![1], tint: 'red' }] }))).toMatch(/colour/);
    expect(wordsOf(massProblem({ ...church, roofCover: 'straw' }))).toMatch(/roof/);
    expect(wordsOf(massProblem({ ...church, roofTint: '#12345' }))).toMatch(/colour/);
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
      // The first floor's sill over the ground floor, under the top
      expect(f.sill).toBeGreaterThan(f.ground);
      expect(f.sill).toBeLessThan(f.top);
    }
    expect(fronts.map((f) => f.edge).sort()).toEqual([0, 1, 2, 3]);
    expect(fronts.map((f) => Math.round(f.width)).sort((a, b) => a - b)).toEqual([30, 30, 40, 40]);
    expect(massFronts({ ...o, asset: 'house-modern' })).toEqual([]);
  });
});
