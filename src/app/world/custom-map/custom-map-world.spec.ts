import { Raycaster, Vector3 } from 'three';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { CustomMapStreets } from './custom-map-streets';
import { CustomMapWorld, customMapSpawnLimit, openCustomMap, openedCustomMap, stableGeo } from './custom-map-world';
import { createMapDocument } from './map-create';
import { type CustomMapDocument, mapToGeo } from './map-document';
import { MapStore, MemoryMapBackend } from './map-store';

/**
 * 200 x 100 m, 2 m cells, ground rising 0.1 m per metre to the east, a
 * 6 m deep ditch along x = 40 (north-south), roads from two spawns in the
 * west to the HQ in the east with a bridge over the ditch, 10 spawns.
 */
function testMap(): CustomMapDocument {
  const doc = createMapDocument({ id: 'test-map', name: 'Test Map', width: 200, depth: 100, cellSize: 2, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const x = -100 + i * 2;
      g.heights[j * g.columns + i] = 0.1 * (x + 100) - (Math.abs(x - 40) <= 4 ? 6 : 0);
    }
  }
  doc.paths = {
    nodes: [
      { id: 'w1', x: -90, y: 30 },
      { id: 'w2', x: -90, y: -30 },
      { id: 'j', x: 0, y: 0 },
      { id: 'b1', x: 30, y: 0 },
      { id: 'b2', x: 50, y: 0 },
      { id: 'hq', x: 90, y: 0 },
    ],
    edges: [
      { id: 'e1', a: 'w1', b: 'j', width: 8, kind: 'road' },
      { id: 'e2', a: 'w2', b: 'j', width: 8, kind: 'road', via: [{ x: -45, y: -30 }] },
      { id: 'e3', a: 'j', b: 'b1', width: 8, kind: 'road' },
      { id: 'e4', a: 'b1', b: 'b2', width: 8, kind: 'bridge' },
      { id: 'e5', a: 'b2', b: 'hq', width: 8, kind: 'road' },
    ],
  };
  doc.spawns = Array.from({ length: 10 }, (_, k) => ({
    id: `s${k + 1}`,
    name: `Spawn ${k + 1}`,
    x: -90,
    y: k === 0 ? 30 : -30,
  }));
  doc.hq = { x: 90, y: 0 };
  return doc;
}

/** The run's origin at the map's HQ, as the start flow sets it */
function hqOrigin(doc: CustomMapDocument): { lat: number; lon: number; height: number } {
  return { ...mapToGeo(doc.hq), height: 0 };
}

describe('CustomMapSurface', () => {
  const doc = testMap();
  const origin = hqOrigin(doc);
  const frame = new CustomMapFrame();
  frame.setOrigin(origin.lat, origin.lon);
  const surface = new CustomMapSurface(doc, frame);
  const sync = new EllipsoidSync(origin.lat, origin.lon, 0);

  it('agrees with the engine on where a map point lies in the scene', () => {
    for (const p of [{ x: -90, y: 30 }, { x: 25, y: -40 }, { x: 90, y: 0 }]) {
      const geo = mapToGeo(p);
      const local = sync.geoToLocalSimple(geo.lat, geo.lon, 0);
      expect(frame.sceneX(p.x)).toBeCloseTo(local.x, 6);
      expect(frame.sceneZ(p.y)).toBeCloseTo(local.z, 6);
      expect(frame.mapX(local.x)).toBeCloseTo(p.x, 6);
      expect(frame.mapY(local.z)).toBeCloseTo(p.y, 6);
    }
  });

  it('answers heights by geo and by scene position', () => {
    const geo = mapToGeo({ x: -50, y: 10 });
    expect(surface.getTerrainHeightAtGeo(geo.lat, geo.lon)).toBeCloseTo(5);
    // The HQ (x 90) is the scene origin
    expect(surface.sampleColumn(0, 0)!.groundY).toBeCloseTo(19);
    // 140 m west of it (scene +x is west)
    expect(surface.sampleColumn(140, 0)!.groundY).toBeCloseTo(5);
    expect(surface.raycastTerrainHeight(140, 0)).toBeCloseTo(5);
  });

  it('carries walkers over the bridge deck, not down into the ditch', () => {
    const geo = mapToGeo({ x: 40, y: 0 });
    expect(surface.getTerrainHeightAtGeo(geo.lat, geo.lon)).toBeCloseTo(8);
    const column = surface.sampleColumn(frame.sceneX(40), frame.sceneZ(0))!;
    expect(column.groundY).toBeCloseTo(8);
    // Deck from 13 m to 15 m with an arch of 0.8 m at the middle
    expect(column.topY).toBeCloseTo(14 + 0.8, 1);
    expect(surface.getGroundHeightEstimate(geo.lat, geo.lon)).toBeCloseTo(14.8, 1);
    expect(surface.getStreetHeightEstimate(geo.lat, geo.lon, geo.lat, geo.lon, geo.lat, geo.lon, 'bridge')).toBeCloseTo(14.8, 1);
    // Beside the bridge the ditch
    expect(surface.sampleColumn(frame.sceneX(40), frame.sceneZ(20))!.topY).toBeCloseTo(8);
  });

  it('sees over flat ground and not through the hill', () => {
    const a = new Vector3(frame.sceneX(-80), 0, frame.sceneZ(0));
    const b = new Vector3(frame.sceneX(-20), 6, frame.sceneZ(0));
    // A line 1 m over the ground from x -80 to x -20 rises with it
    expect(surface.raycastLineOfSight(a.x, 3, a.z, b.x, 9, b.z)).toBe(false);
    // From low in the west to the eastern slope: the ground in between is higher than the line
    expect(surface.raycastLineOfSight(a.x, 2.5, a.z, frame.sceneX(80), 2.5, a.z)).toBe(true);
  });

  it('picks the ground under a ray', () => {
    const raycaster = new Raycaster(new Vector3(frame.sceneX(-50), 100, frame.sceneZ(10)), new Vector3(0, -1, 0));
    const hit = surface.pickRay(raycaster)!;
    expect(hit.x).toBeCloseTo(frame.sceneX(-50), 3);
    expect(hit.y).toBeCloseTo(5, 2);
    expect(hit.z).toBeCloseTo(frame.sceneZ(10), 3);
  });
});

describe('CustomMapStreets', () => {
  it('turns the paths into streets with shared nodes, widths and bridges', async () => {
    const streets = new CustomMapStreets(testMap());
    const network = await streets.loadStreets();
    expect(network.streets.length).toBe(5);
    expect(network.streets[1].nodes.length).toBe(3);
    expect(network.streets[3]).toMatchObject({ bridge: 'yes', width: 8 });
    // e1 and e3 meet at the junction node
    expect(network.streets[0].nodes[1]).toBe(network.streets[2].nodes[0]);
    expect(streets.filterStreetsNearRoutes(network)).toBe(network);
    expect(streets.spawnLabel(network, 0, 0, 'Spawn 2')).toBe('Spawn 2');
  });

  it('routes a spawn along the roads to the HQ', async () => {
    const doc = testMap();
    const streets = new CustomMapStreets(doc);
    const network = await streets.loadStreets();
    const from = mapToGeo(doc.spawns[1]);
    const to = mapToGeo(doc.hq);
    const path = streets.findPath(network, from.lat, from.lon, to.lat, to.lon);
    const xs = path.map((n) => n.lon * 111320);
    // Over the curve point, the junction and the bridge onto the HQ's segment (PathAndRouteService walks its last metres)
    expect(xs[0]).toBeCloseTo(-90, 0);
    expect(xs.map(Math.round)).toEqual(expect.arrayContaining([-45, 0, 30, 50]));
    expect(xs[xs.length - 1]).toBeGreaterThanOrEqual(50);
  });
});

describe('CustomMapWorld', () => {
  it('starts with the HQ and the first spawns the run allows', () => {
    const doc = testMap();
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    const layout = world.startLayout();
    expect(layout.hq).toEqual(stableGeo(mapToGeo(doc.hq)));
    expect(layout.spawns.map((s) => s.name)).toEqual(['Spawn 1', 'Spawn 2', 'Spawn 3']);
    expect(world.ref).toEqual({ kind: 'custom-map', mapId: 'test-map', contentHash: 'abc', name: 'Test Map' });
    expect(world.capabilities).toMatchObject({ realPlace: false, credentials: false, ecef: false, streaming: false, destructible: false });
  });

  it('puts the origin where degrees survive the trip through radians', () => {
    const toRad = (v: number): number => ((v * Math.PI) / 180) * (180 / Math.PI);
    for (let y = -200; y <= 200; y += 0.5) {
      const geo = stableGeo(mapToGeo({ x: y * 0.7, y }));
      expect(toRad(geo.lat)).toBe(geo.lat);
      expect(toRad(geo.lon)).toBe(geo.lon);
      // Within the location's 6 decimals (11 cm) of the point
      expect(Math.abs(geo.lat * 111320 - y)).toBeLessThan(0.1);
    }
  });

  it('reads the spawn limit from the link', () => {
    expect(customMapSpawnLimit('?world=map:x')).toBe(MAX_SPAWN_PORTALS);
    expect(customMapSpawnLimit('?world=map:x&spawns=2')).toBe(2);
    expect(customMapSpawnLimit('?spawns=99')).toBe(MAX_SPAWN_PORTALS);
    expect(customMapSpawnLimit('?spawns=0')).toBe(MAX_SPAWN_PORTALS);
  });

  it('opens a stored map and names one that is missing or changed', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: () => Promise.resolve(new Response('', { status: 404 })) });
    const summary = await store.save(testMap());
    const ref = { kind: 'custom-map' as const, mapId: 'test-map', contentHash: '' };
    const loaded = await openCustomMap(ref, store);
    expect(loaded.contentHash).toBe(summary.contentHash);
    expect(openedCustomMap(ref)?.doc.meta.name).toBe('Test Map');
    await expect(openCustomMap({ ...ref, mapId: 'nope' }, store)).rejects.toThrow(/no map "nope"/);
    await expect(openCustomMap({ ...ref, contentHash: 'other' }, store)).rejects.toThrow(/not the one this run was played on/);
  });
});
