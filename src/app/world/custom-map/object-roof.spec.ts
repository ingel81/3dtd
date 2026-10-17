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

  it('takes the inner ring off a wall top as an edge: a slim tower fits on a fort wall, a wide one does not', () => {
    // fort-wall: 3.5 m walk, about 8 m up
    const walk = surface.roofAt(frame.sceneX(0), frame.sceneZ(40 - 0.35))!;
    expect(walk - surface.heightAtMap(0, 40)).toBeGreaterThan(6);
    expect(footprintAt('archer', 0, 40 - 0.35).refusal).toBe('edge');
    const slim = (Object.keys(TOWER_TYPES) as (keyof typeof TOWER_TYPES)[]).find((id) => TOWER_TYPES[id].footprintRadius <= 3.1)!;
    expect(footprintAt(slim, 0, 40 - 0.35).refusal).toBeUndefined();
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
