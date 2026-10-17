import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Raycaster, Vector3 } from 'three';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { checkTowerPlacement, type TowerPlacementContext } from '../../utils/tower-placement-rules';
import { footprintSampleOffsets, footprintSurroundingOffsets, resolveTowerFootprint } from '../../utils/tower-footprint';
import { BUILD_BLOCKED_OBJECT } from '../world-provider';
import { computeBuildAreas, BuildCell } from '../../editor/validation/build-areas';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { createMapDocument } from './map-create';
import { type CustomMapDocument, type MapObject, MAP_METERS_PER_DEGREE, mapToGeo } from './map-document';
import { type CatalogRoof, PlacedRoof } from './object-roof';
import { crownBraces, plinthCrown } from '../../three-engine/renderers/tower-plinth/plinth-braces';
import type { CatalogObject } from './render/asset-catalog';

/** A 2 x 1 cell roof of 1 m cells at heights 4 and 6, as base64 bytes of 0.5 m steps */
const SMALL: CatalogRoof = { x: -1, z: -0.5, cell: 1, columns: 2, rows: 1, step: 0.5, heights: btoa(String.fromCharCode(8, 12)) };

describe('PlacedRoof', () => {
  it('turns, scales and lifts the model grid onto the map', () => {
    // Turned a quarter: model +x points to map -y (object-ground.ts), twice the size, seated at 3 m
    const roof = new PlacedRoof(SMALL, 10, 20, Math.PI / 2, 2, 3);
    // Model (-0.5, 0) is the first cell (4 m), model (0.5, 0) the second (6 m): map (10, 21) and (10, 19)
    expect(roof.heightAt(10, 21)).toBeCloseTo(3 + 4 * 2, 5);
    expect(roof.heightAt(10, 19)).toBeCloseTo(3 + 6 * 2, 5);
    expect(roof.top).toBeCloseTo(15, 5);
    // Off the grid: no roof
    expect(roof.heightAt(12, 20)).toBeNaN();
    expect(roof.heightAt(10, 22.5)).toBeNaN();
  });

  it('meets a ray from above on the roof and one from the side at its edge', () => {
    const roof = new PlacedRoof(SMALL, 0, 0, 0, 1, 0);
    // Straight down onto the 6 m cell (model x 0.5 is map x -0.5)
    const down = roof.raycast(-0.5, 0, 50, 0, 0, -1, 1000);
    expect(50 - down).toBeCloseTo(6, 2);
    // Level at 2 m from map +x towards the roof: meets the side of the 4 m cell at map x 1
    const side = roof.raycast(10, 0, 2, -1, 0, 0, 1000);
    expect(10 - side).toBeCloseTo(1, 2);
    // Over it at 7 m, and short of it: misses
    expect(roof.raycast(10, 0, 7, -1, 0, 0, 1000)).toBe(-1);
    expect(roof.raycast(10, 0, 2, -1, 0, 0, 5)).toBe(-1);
  });
});

const catalog = JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')).objects as CatalogObject[];
const entry = (id: string) => catalog.find((o) => o.id === id)!;

/** 200 x 200 m, 2 m cells, ground rising 0.05 m per metre to the east */
function slopeMap(objects: MapObject[]): CustomMapDocument {
  const doc = createMapDocument({ id: 'roofs', name: 'Roofs', width: 200, depth: 200, cellSize: 2, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.05 * i * 2;
  doc.objects = objects;
  doc.spawns = [{ id: 's1', name: 'Spawn', x: -90, y: -90 }];
  doc.hq = { x: 90, y: 90 };
  return doc;
}

describe('CustomMapSurface roofs (TODO E217)', () => {
  const frame = new CustomMapFrame();
  const objects: MapObject[] = [
    { id: 'tower', asset: 'castle-tower', x: -30, y: 0, z: 0, rotation: 0.3, scale: 1 },
    { id: 'house', asset: 'house', x: 30, y: 0, z: 0, rotation: 0, scale: 1 },
    { id: 'wall', asset: 'fort-wall', x: 0, y: 40, z: 0, rotation: 0, scale: 1 },
    { id: 'tree', asset: 'tree-oak', x: -30, y: 30, z: 0, rotation: 0, scale: 1 },
  ];
  const doc = slopeMap(objects);
  const surface = new CustomMapSurface(doc, frame);
  surface.setObjectCatalog(['castle-tower', 'house', 'fort-wall', 'tree-oak'].map(entry));
  const geo = (x: number, y: number): [number, number] => {
    const g = mapToGeo({ x, y });
    return [g.lat, g.lon];
  };

  /** Where a tower of the type stands with its cursor at map (x, y), as the build preview decides it */
  const footprintAt = (typeId: keyof typeof TOWER_TYPES, x: number, y: number) => {
    const radius = TOWER_TYPES[typeId].footprintRadius;
    const sx = frame.sceneX(x);
    const sz = frame.sceneZ(y);
    const columns = (list: readonly (readonly [number, number])[]) => list.map(([dx, dz]) => surface.footprintColumn(sx + dx, sz + dz));
    const surfaceY = surface.roofAt(sx, sz) ?? surface.heightAtMap(x, y);
    return resolveTowerFootprint(surfaceY, radius, columns(footprintSampleOffsets(radius)), () => columns(footprintSurroundingOffsets(radius)));
  };

  it('stands a tower on the platform of a castle tower', () => {
    const ground = surface.heightAtMap(-30, 0);
    const roof = surface.roofAt(frame.sceneX(-30), frame.sceneZ(0))!;
    // The platform about 13 m over the lowest corner of its ground (the seat)
    expect(roof - ground).toBeGreaterThan(11);
    expect(roof - ground).toBeLessThan(14);
    const column = surface.footprintColumn(frame.sceneX(-30), frame.sceneZ(0))!;
    expect(column.groundY).toBeCloseTo(ground, 5);
    expect(column.topY).toBeCloseTo(roof, 5);
    // On it the tower is not refused, standing on the platform (its battlements may lift it a little)
    expect(surface.buildBlocker(...geo(-30, 0), 3)).toBeNull();
    const footprint = footprintAt('archer', -30, 0);
    expect(footprint.refusal).toBeUndefined();
    expect(footprint.footY).toBeGreaterThanOrEqual(roof - 0.01);
    expect(footprint.footY - roof).toBeLessThan(1.5);
  });

  it('keeps blocking the ground beside a building, and trees everywhere', () => {
    // 6 m from the castle tower's middle, past its 4.5 m grid: the ground, its 4 m footprint and a 3 m tower
    expect(surface.roofAt(frame.sceneX(-36), frame.sceneZ(0))).toBeNull();
    expect(surface.buildBlocker(...geo(-36, 0), 3)).toBe(BUILD_BLOCKED_OBJECT);
    // A tree carries nothing and blocks as before
    expect(surface.roofAt(frame.sceneX(-30), frame.sceneZ(30))).toBeNull();
    expect(surface.buildBlocker(...geo(-30, 30), 3)).toBe(BUILD_BLOCKED_OBJECT);
  });

  it('stands a tower on the ridge of a house, its plinth down the roof to the eaves', () => {
    const footprint = footprintAt('archer', 30, 0);
    expect(footprint.refusal).toBeUndefined();
    const ridge = surface.roofAt(frame.sceneX(30), frame.sceneZ(0.3))!;
    expect(footprint.footY).toBeGreaterThanOrEqual(ridge - 0.3);
    expect(footprint.plinthHeight).toBeGreaterThan(0.5);
    // The facade is an edge, no slope: the plinth ends on the roof and hangs out on braces, the house shows below
    expect(footprint.footY - footprint.plinthHeight).toBeGreaterThan(surface.heightAtMap(30, 0) + 2);
    expect(footprint.overhang?.length).toBeGreaterThan(0);
  });

  it('stands a tower on the walk of a lone fort wall where it carries the tower the long way (E217 crown)', () => {
    // fort-wall: 3.5 m walk, about 8 m up, 14.7 m long; the cursor off the centre line, the tower on it
    const walk = surface.roofAt(frame.sceneX(0), frame.sceneZ(40 - 0.35))!;
    expect(walk - surface.heightAtMap(0, 40)).toBeGreaterThan(6);
    const placed = onCrown(surface, frame, 'archer', 0, 40 + 0.6)!;
    expect(placed.footprint.refusal).toBeUndefined();
    expect(Math.abs(placed.y - (40 - 0.35))).toBeLessThan(0.3);
    expect(placed.footprint.footY).toBeGreaterThanOrEqual(walk - 0.5);
    // Near its end the walk does not carry the inner ring the long way: refused
    expect(onCrown(surface, frame, 'archer', 6.9, 40)!.footprint.refusal).toBe('edge');
  });

  it('picks the roof under the cursor, not the ground behind the house', () => {
    // From high in the south-west, looking at the castle tower's platform
    const target = new Vector3(frame.sceneX(-30), surface.roofAt(frame.sceneX(-30), frame.sceneZ(0))!, frame.sceneZ(0));
    const eye = new Vector3(frame.sceneX(-80), target.y + 60, frame.sceneZ(-50));
    const ray = new Raycaster(eye, target.clone().sub(eye).normalize());
    const hit = surface.pickRay(ray)!;
    expect(hit.distanceTo(target)).toBeLessThan(0.1);
    // Past the house the ground as before
    const ground = new Raycaster(new Vector3(frame.sceneX(60), 100, frame.sceneZ(0)), new Vector3(0, -1, 0));
    expect(surface.pickRay(ground)!.y).toBeCloseTo(surface.heightAtMap(60, 0), 2);
  });

  it('carries nothing that may leave the map during the run', () => {
    const passing = new CustomMapSurface(doc, frame);
    passing.setObjectCatalog(['castle-tower', 'house', 'fort-wall', 'tree-oak'].map(entry), new Set(['tower']));
    expect(passing.roofAt(frame.sceneX(-30), frame.sceneZ(0))).toBeNull();
    expect(passing.buildBlocker(...geo(-30, 0), 3)).toBe(BUILD_BLOCKED_OBJECT);
    expect(passing.roofAt(frame.sceneX(30), frame.sceneZ(0))).not.toBeNull();
  });

  it('shows the roofs as build area in the editor, by the same rules', () => {
    const areas = computeBuildAreas({
      doc,
      catalog: ['castle-tower', 'house', 'fort-wall', 'tree-oak'].map(entry),
      routes: [{ spawnId: 's1', name: 'Spawn', points: [{ x: -90, y: -90 }, { x: 90, y: 90 }] }],
      cell: 4,
    });
    const at = (x: number, y: number) => {
      const i = Math.floor((x - areas.x0) / areas.cell);
      const j = Math.floor((y - areas.y0) / areas.cell);
      return areas.kind[j * areas.columns + i];
    };
    expect([BuildCell.InReach, BuildCell.OutOfReach]).toContain(at(-30, 0));
    expect(at(-30, 30)).toBe(BuildCell.Object);
  });

  it('lets the placement rules pass a tower on the roof', () => {
    const M = MAP_METERS_PER_DEGREE;
    const ctx: TowerPlacementContext = {
      bounds: { minLat: -100 / M, maxLat: 100 / M, minLon: -100 / M, maxLon: 100 / M },
      base: mapToGeo(doc.hq),
      spawns: doc.spawns.map((s) => mapToGeo(s)),
      towers: [],
      routes: [],
      geo: { haversineDistance: (la1, lo1, la2, lo2) => Math.hypot(la2 - la1, lo2 - lo1) * M },
      blocked: (lat, lon) => surface.buildBlocker(lat, lon, 3),
    };
    expect(checkTowerPlacement(...geo(-30, 0), ctx, footprintAt('archer', -30, 0)).valid).toBe(true);
  });
});

/**
 * Where a tower of the type stands with its cursor at map (x, y), as the
 * build preview decides it, crowns included: on a crown's centre line
 * (CustomMapSurface.crownAt), the long way asked of the roofs. The map point
 * it stands on and its footprint
 */
function onCrown(surface: CustomMapSurface, frame: CustomMapFrame, typeId: keyof typeof TOWER_TYPES, x: number, y: number) {
  const crown = surface.crownAt(frame.sceneX(x), frame.sceneZ(y));
  const sx = crown ? crown.x : frame.sceneX(x);
  const sz = crown ? crown.z : frame.sceneZ(y);
  const radius = TOWER_TYPES[typeId].footprintRadius;
  const columns = (list: readonly (readonly [number, number])[]) => list.map(([dx, dz]) => surface.footprintColumn(sx + dx, sz + dz));
  const surfaceY = surface.roofAt(sx, sz) ?? surface.heightAtMap(frame.mapX(sx), frame.mapY(sz));
  const carries = crown ? (reach: number) => surface.crownCarries(sx, sz, crown.axisX, crown.axisZ, crown.top, reach) : undefined;
  const footprint = resolveTowerFootprint(surfaceY, radius, columns(footprintSampleOffsets(radius)), () => columns(footprintSurroundingOffsets(radius)), carries);
  return { x: frame.mapX(sx), y: frame.mapY(sz), footprint, crown };
}

describe('Towers on crowns, houses, towers, corners and gates (E217)', () => {
  const frame = new CustomMapFrame();
  const all = Object.keys(TOWER_TYPES) as (keyof typeof TOWER_TYPES)[];
  const ids = ['castle-wall', 'fort-wall', 'palisade', 'castle-wall-corner', 'castle-gate', 'house', 'castle-tower'];

  /** A run of three segments of a wall along map x at y, each its length apart, the middle one at x */
  const run = (asset: string, x: number, y: number, length: number, rotation = 0): MapObject[] =>
    [-1, 0, 1].map((k) => ({ id: `${asset}-${x}-${k}`, asset, x: x + k * length, y, z: 0, rotation, scale: 1 }));

  const objects: MapObject[] = [
    ...run('castle-wall', -50, -60, 8),
    ...run('fort-wall', 30, -60, 14.7),
    ...run('palisade', -50, 60, 4),
    { id: 'corner', asset: 'castle-wall-corner', x: 50, y: 60, z: 0, rotation: 0, scale: 1 },
    { id: 'corner-w', asset: 'castle-wall', x: 50 - 2.5 - 4, y: 60, z: 0, rotation: 0, scale: 1 },
    { id: 'corner-e', asset: 'castle-wall', x: 50 + 2.5 + 4, y: 60, z: 0, rotation: 0, scale: 1 },
    { id: 'gate', asset: 'castle-gate', x: 0, y: 0, z: 0, rotation: 0.4, scale: 1 },
    { id: 'house', asset: 'house', x: -60, y: 0, z: 0, rotation: 0, scale: 1 },
    { id: 'tower', asset: 'castle-tower', x: 60, y: 0, z: 0, rotation: 0, scale: 1 },
  ];
  const doc = slopeMap(objects);
  const surface = new CustomMapSurface(doc, frame);
  surface.setObjectCatalog(ids.map(entry));

  it('marks walls and the gate with a solid walk as crowns, houses and towers as roofs, a palisade of stakes as nothing', () => {
    expect(ids.map((id) => entry(id).roof?.kind ?? (entry(id).roof ? 'roof' : 'none'))).toEqual(['crown', 'crown', 'none', 'crown', 'crown', 'roof', 'roof']);
  });

  it('gives fences, iron gates, chains and stake palisades no top to stand on: they block building as before', () => {
    for (const id of ['palisade', 'palisade-gate', 'fence-chainlink-barbed', 'iron-gate', 'chains']) {
      expect(entry(id).roof, id).toBeUndefined();
    }
    expect(surface.roofAt(frame.sceneX(-50), frame.sceneZ(60))).toBeNull();
    expect(surface.crownAt(frame.sceneX(-50), frame.sceneZ(60))).toBeNull();
    const g = mapToGeo({ x: -50, y: 60 });
    expect(surface.buildBlocker(g.lat, g.lon, 3)).toBe(BUILD_BLOCKED_OBJECT);
  });

  it('stands every tower on every wall with a walk: castle wall, fort wall, centred on it, braced on both sides', () => {
    for (const [x, y] of [[-50, -60], [30, -60]]) {
      for (const typeId of all) {
        // The cursor near the wall's face, the tower on its centre line
        const placed = onCrown(surface, frame, typeId, x + 0.4, y + 0.15)!;
        expect(placed.crown, `${typeId} at ${x}`).not.toBeNull();
        expect(placed.footprint.refusal, `${typeId} at ${x}`).toBeUndefined();
        // Hanging over both sides: a plinth with corbels on both sides of the wall
        expect(placed.footprint.plinthHeight).toBeGreaterThan(0);
        const braces = crownBraces(TOWER_TYPES[typeId].footprintRadius, placed.footprint.plinthHeight, plinthCrown(placed.crown)!);
        const sides = new Set(braces.map((b) => Math.sign(Math.cos(b.angle - Math.atan2(placed.crown!.axisZ, placed.crown!.axisX) - Math.PI / 2))));
        expect(sides.size, `${typeId} at ${x}`).toBe(2);
      }
    }
  });

  it('stands a tower on a corner of the wall and on a gatehouse', () => {
    expect(onCrown(surface, frame, 'archer', 50, 60).footprint.refusal).toBeUndefined();
    for (const typeId of ['archer', 'cannon'] as const) expect(onCrown(surface, frame, typeId, 0, 0).footprint.refusal).toBeUndefined();
  });

  it('keeps the roof rules on a house and a tower: on top, no crown, the inner ring on the roof', () => {
    const house = onCrown(surface, frame, 'archer', -60, 0);
    expect(house.crown).toBeNull();
    expect(house.footprint.refusal).toBeUndefined();
    const tower = onCrown(surface, frame, 'archer', 60, 0);
    expect(tower.crown).toBeNull();
    expect(tower.footprint.refusal).toBeUndefined();
    // The same castle tower's top refuses what hangs over its edge: no crown, no allowance
    expect(onCrown(surface, frame, 'research-center' as keyof typeof TOWER_TYPES, 60, 0).footprint.refusal).toBe('edge');
  });

  it('leaves the rule of the tiles as it is: a column without crown refuses an inner ring over a drop', () => {
    const radius = TOWER_TYPES.archer.footprintRadius;
    const offsets = footprintSampleOffsets(radius);
    // A 2 m wide ridge along x, 8 m up, as the tiles would show it
    const columns = offsets.map(([, dz]) => (Math.abs(dz) <= 1 ? { groundY: 0, topY: 8 } : { groundY: 0, topY: 0 }));
    expect(resolveTowerFootprint(8, radius, columns, undefined, () => true).refusal).toBe('edge');
  });
});
