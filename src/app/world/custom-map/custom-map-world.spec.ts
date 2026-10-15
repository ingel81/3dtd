import { Raycaster, Scene, Vector3 } from 'three';
import { hasLaneChoice } from './lane-choice';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { CustomMapStreets } from './custom-map-streets';
import { CUSTOM_MAP_ASSET_CREDIT, CustomMapWorld, customMapSpawnLimit, customMapStartWave, openCustomMap, openedCustomMap } from './custom-map-world';
import { runStartAt } from '../../sim/protocol/run-start';
import { RUN_PLAN_RULES } from '../../director/sources/budget/run-plan';
import { tableWaveRules } from '../../director/sources/table/table-source';
import { createMapDocument } from './map-create';
import { FALLEN_SCALE } from './custom-map-destruction';
import { type CustomMapDocument, mapToGeo } from './map-document';
import { MapStore, MemoryMapBackend } from './map-store';
import { BUILD_BLOCKED_OBJECT, BUILD_BLOCKED_WATER } from '../world-provider';

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
    expect(surface.getStreetHeightEstimate(geo.lat, geo.lon, geo.lat, geo.lon, geo.lat, geo.lon, 'bridge')).toBeCloseTo(14.8, 1);
    // Off the bridge way (a road through the ditch under it) the walker stays on the ground
    expect(surface.getGroundHeightEstimate(geo.lat, geo.lon)).toBeCloseTo(8, 1);
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

  it('puts the shadow focus on the ground ahead when the view ray misses the terrain', () => {
    // High over the map, looking up past the horizon: the ray hits nothing
    const eye = new Vector3(frame.sceneX(0), 120, frame.sceneZ(0));
    const up = new Vector3(frame.sceneX(1) - frame.sceneX(0), 0.2, 0).normalize();
    const hit = new Vector3();
    expect(surface.groundAlong(eye, up, hit)).toBe(false);
    const ahead = new Vector3();
    surface.groundAhead(eye, up, ahead);
    // On the ground, not in the air with the camera, toward where it looks (map +x), 1.5 x 120 m ahead
    expect(ahead.y).toBeCloseTo(surface.raycastTerrainHeight(ahead.x, ahead.z)!, 5);
    expect(frame.mapX(ahead.x)).toBeGreaterThan(0);
    expect(frame.mapX(ahead.x)).toBeLessThanOrEqual(100);
    // A low camera looking out over the far edge: the point stays short of it, where the look leaves the map
    const low = new Vector3(frame.sceneX(60), 200, frame.sceneZ(0));
    surface.groundAhead(low, up, ahead);
    expect(frame.mapX(ahead.x)).toBeCloseTo(100, 5);
    // Kept on the map, however far the camera stands beyond its edge
    const far = new Vector3(frame.sceneX(5000), 400, frame.sceneZ(0));
    surface.groundAhead(far, up, ahead);
    expect(surface.raycastTerrainHeight(ahead.x, ahead.z)).toBeCloseTo(ahead.y, 5);
    expect(Math.abs(frame.mapX(ahead.x))).toBeLessThan(5000);
  });

  it('forbids building near objects that block it, once the catalogue is known', () => {
    const map = testMap();
    map.objects = [
      { id: 'o1', asset: 'house', x: -50, y: 20, z: 0, rotation: 0, scale: 1 },
      { id: 'o2', asset: 'bush', x: -50, y: -20, z: 0, rotation: 0, scale: 1 },
      { id: 'o3', asset: 'bush', x: 20, y: 20, z: 0, rotation: 0, scale: 2, blocksBuild: true },
    ];
    const blocking = new CustomMapSurface(map, frame);
    const at = (x: number, y: number): [number, number] => {
      const g = mapToGeo({ x, y });
      return [g.lat, g.lon];
    };
    expect(blocking.buildBlocker(...at(-50, 20), 3)).toBeNull();
    blocking.setObjectCatalog([
      { id: 'house', footprint: 5, blocksBuild: true },
      { id: 'bush', footprint: 1, blocksBuild: false },
    ]);
    // The house's 5 m disc and a tower's 3 m
    expect(blocking.buildBlocker(...at(-50, 27.9), 3)).toBe(BUILD_BLOCKED_OBJECT);
    expect(blocking.buildBlocker(...at(-50, 28.1), 3)).toBeNull();
    // Bushes do not block, unless the map says so for one (scaled twice: 2 m)
    expect(blocking.buildBlocker(...at(-50, -20), 3)).toBeNull();
    expect(blocking.buildBlocker(...at(24.9, 20), 3)).toBe(BUILD_BLOCKED_OBJECT);
    expect(blocking.buildBlocker(...at(25.1, 20), 3)).toBeNull();
  });

  it("forbids building on a long building's turned rectangle, not on the disc of half its length", () => {
    const map = testMap();
    // A 46 x 15 m school, turned half a radian: footprint 20.9 m, rectangle 41.8 x 15.2 m about (0, 1.3)
    const school = { id: 's', asset: 'school', x: -40, y: 10, z: 0, rotation: 0.5, scale: 1 };
    map.objects = [school];
    const c = Math.cos(school.rotation);
    const s = Math.sin(school.rotation);
    // A point in the school's own x and z, on the map (object-ground.ts)
    const local = (x: number, z: number): [number, number] => {
      const g = mapToGeo({ x: school.x - (x * c + z * s), y: school.y - x * s + z * c });
      return [g.lat, g.lon];
    };
    const surface = new CustomMapSurface(map, frame);
    surface.setObjectCatalog([{ id: 'school', footprint: 20.9, blocksBuild: true, height: 14, box: [0, 1.3, 20.9, 7.6] }]);
    // 4 m off its long side: free for a 3 m tower (the disc reached 21 m, over the street)
    expect(surface.buildBlocker(...local(0, 1.3 + 7.6 + 4), 3)).toBeNull();
    expect(surface.buildBlocker(...local(0, 1.3 - 7.6 - 4), 3)).toBeNull();
    expect(surface.buildBlocker(...local(0, 1.3 + 7.6 + 2), 3)).toBe(BUILD_BLOCKED_OBJECT);
    // Along its length up to the disc
    expect(surface.buildBlocker(...local(19, 1.3), 3)).toBe(BUILD_BLOCKED_OBJECT);
    expect(surface.buildBlocker(...local(24.5, 1.3), 3)).toBeNull();
    // Without the rectangle (an older catalogue) the disc holds as before
    surface.setObjectCatalog([{ id: 'school', footprint: 20.9, blocksBuild: true }]);
    expect(surface.buildBlocker(...local(0, 1.3 + 7.6 + 4), 3)).toBe(BUILD_BLOCKED_OBJECT);
  });

  it("knows the roofs of a map's houses for the intro flight's skyline", () => {
    const map = testMap();
    map.objects = [{ id: 'o1', asset: 'house', x: -50, y: 20, z: 0, rotation: 0, scale: 1.5 }];
    const roofs = new CustomMapSurface(map, frame);
    roofs.setObjectCatalog([{ id: 'house', footprint: 5, blocksBuild: true, height: 8 }]);
    expect(roofs.skylineAt(frame.sceneX(-50), frame.sceneZ(22))).toBeCloseTo(roofs.heightAtMap(-50, 20) + 12, 5);
    expect(roofs.skylineAt(frame.sceneX(-50), frame.sceneZ(30))).toBeNull();
  });

  it('forbids building in water: a body under the tower or a river along it, not on the dry bank', () => {
    const map = testMap();
    const g = map.terrain.grid;
    // The ditch at x = 40 holds water up to 12 m (ground 8 m in it), the mask over x 30..50 reaches the banks
    const mask = new Uint8Array(g.columns * g.rows);
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) if (Math.abs(-100 + i * 2 - 40) <= 10) mask[j * g.columns + i] = 255;
    }
    map.terrain.water = { level: 12, mask, color: '#335566', kind: 'swamp' };
    map.terrain.rivers = [{ id: 'r', kind: 'water', points: [{ x: -20, y: -50, width: 10, height: 9 }, { x: -20, y: 50, width: 10, height: 9 }] }];
    const wet = new CustomMapSurface(map, frame);
    const at = (x: number, y: number): [number, number] => {
      const p = mapToGeo({ x, y });
      return [p.lat, p.lon];
    };
    expect(wet.buildBlocker(...at(40, -30), 3)).toBe(BUILD_BLOCKED_WATER);
    // In the mask, but the bank (ground 13 m) stands above the level
    expect(wet.buildBlocker(...at(49, -30), 1)).toBeNull();
    expect(wet.buildBlocker(...at(70, -30), 3)).toBeNull();
    // The river: half its 10 m and half the tower's 3 m from its line
    expect(wet.buildBlocker(...at(-14, 0), 3)).toBe(BUILD_BLOCKED_WATER);
    expect(wet.buildBlocker(...at(-26.6, 0), 3)).toBeNull();
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

describe('CustomMapStreets on the starter road', () => {
  it('routes one straight road whose ends are the spawn and the HQ', async () => {
    // createMapDocument's starter: one road from the spawn at its west end to the HQ at its east end
    const doc = createMapDocument({ id: 'starter', name: 'Starter', width: 512, depth: 512 });
    const streets = new CustomMapStreets(doc);
    const network = await streets.loadStreets();
    const from = mapToGeo(doc.spawns[0]);
    const to = mapToGeo(doc.hq);
    const xs = streets.findPath(network, from.lat, from.lon, to.lat, to.lon).map((n) => Math.round(n.lon * 111320));
    // It was the start node alone, which the game drops as no route
    expect(xs).toEqual([doc.spawns[0].x, doc.hq.x]);

    // The HQ beside the road's middle: along the road to its foot
    const beside = mapToGeo({ x: 0, y: 20 });
    const mid = streets.findPath(network, from.lat, from.lon, beside.lat, beside.lon).map((n) => Math.round(n.lon * 111320));
    expect(mid).toEqual([doc.spawns[0].x, 0]);
  });
});

describe('CustomMapWorld', () => {
  it('starts with the HQ and the first spawns the run allows', () => {
    const doc = testMap();
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    const layout = world.startLayout();
    expect(layout.hq).toEqual(mapToGeo(doc.hq));
    expect(layout.spawns.map((s) => s.name)).toEqual(['Spawn 1', 'Spawn 2', 'Spawn 3']);
    expect(world.ref).toEqual({ kind: 'custom-map', mapId: 'test-map', contentHash: 'abc', name: 'Test Map' });
    // The credit line: the map (with its author where it has one) and the assets' licence, no Google, no OSM
    expect(world.attribution()).toEqual([expect.stringContaining('Test Map'), CUSTOM_MAP_ASSET_CREDIT]);
    expect(world.capabilities).toMatchObject({ realPlace: false, credentials: false, ecef: false, streaming: false, destructible: false });
  });

  it('credits the data an OSM world was made of beside the map and the assets', () => {
    const doc = testMap();
    const attribution = ['Map data © OpenStreetMap contributors', 'Heights: Mapterhorn (mapterhorn.com) and its sources'];
    doc.meta.source = { kind: 'osm', lat: 49.7, lon: 9.26, address: 'Miltenberg', sideM: 2400, fetchedAt: '2026-10-15T00:00:00Z', dem: 'mapterhorn', zeroM: 120, attribution };
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    expect(world.attribution()).toEqual([expect.stringContaining('Test Map'), ...attribution, CUSTOM_MAP_ASSET_CREDIT]);
  });

  it('opens the lanes the player picks before wave 1: the start layout has them, each in its colour slot (TODO E130)', () => {
    const doc = testMap();
    // Without an optional lane there is no choice; a coop room may still close a lane nobody holds
    const fixed = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3).lanes()!;
    expect(hasLaneChoice(fixed.choice)).toBe(false);
    expect(fixed.setOpen([doc.spawns[0].id])).toBe(false);
    expect(fixed.setOpen([doc.spawns[0].id], true)).toBe(true);
    expect(fixed.open()).toEqual([doc.spawns[0].id]);
    expect(fixed.setOpen([], true)).toBe(false);

    doc.spawns[1].optional = true;
    doc.spawns[2].optional = true;
    doc.gameplay = { lanes: { max: 2 } };
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    const lanes = world.lanes()!;
    expect(lanes.choice).toMatchObject({ min: 1, max: 2 });
    // At first: the always-open lane, then optional ones up to the most
    expect(lanes.open()).toEqual([doc.spawns[0].id, doc.spawns[1].id]);
    expect(world.startLayout().spawns.map((s) => [s.name, s.slot])).toEqual([['Spawn 1', 0], ['Spawn 2', 1]]);

    expect(lanes.setOpen([doc.spawns[0].id, doc.spawns[2].id])).toBe(true);
    expect(world.startLayout().spawns.map((s) => [s.name, s.slot])).toEqual([['Spawn 1', 0], ['Spawn 3', 2]]);
    // The always-open lane stays, the most stays the most
    expect(lanes.setOpen([doc.spawns[2].id])).toBe(false);
    expect(lanes.setOpen([doc.spawns[0].id, doc.spawns[1].id, doc.spawns[2].id])).toBe(false);
    expect(lanes.open()).toEqual([doc.spawns[0].id, doc.spawns[2].id]);
  });

  it("plays the game's rules and waves unless the map sets its own", () => {
    const doc = testMap();
    const world = () => new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    expect(world().runRules()).toBeNull();
    expect(world().worldWaves()).toBeNull();

    doc.gameplay = { startCredits: 300, towers: ['cannon', 'archer'], waves: { kind: 'budget' } };
    expect(world().runRules()).toMatchObject({ startCredits: 300, towers: ['archer', 'cannon'] });
    expect(world().worldWaves()).toEqual({ source: 'budget' });

    const table = { cycle: { fromWave: 1, hpGrowth: 1.5 }, waves: [{ wave: 1, name: 'One', enemies: { zombie: 2 }, hpMult: 1, spawnDelay: 400 }] };
    doc.gameplay = { waves: { kind: 'table', table } };
    expect(world().runRules()).toBeNull();
    expect(world().worldWaves()).toEqual({ source: 'table', table });

    // The difficulty goes with the waves; without a wave choice the player's source plays
    doc.gameplay = { difficulty: 150 };
    expect(world().worldWaves()).toEqual({ source: null, difficulty: 1.5 });
    doc.gameplay = { difficulty: 100, waves: { kind: 'budget' } };
    expect(world().worldWaves()).toEqual({ source: 'budget' });
    doc.gameplay = { difficulty: 400, waves: { kind: 'budget' } };
    expect(world().worldWaves()).toEqual({ source: 'budget', difficulty: 2 });

    // A list with mistakes is left out: the game's choice plays
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    doc.gameplay = { waves: { kind: 'table', table: { ...table, cycle: { fromWave: 5, hpGrowth: 0 } } } };
    expect(world().worldWaves()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the camera over the map, between the ground and a whole-map view', () => {
    const doc = testMap();
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    const b = world.cameraBounds();
    // 200 x 100 m, a third of the larger side beyond the edge; the HQ (x 90) is the scene origin, -x east
    expect(b.minX).toBeCloseTo(90 - 100 - 200 / 3, 3);
    expect(b.maxX).toBeCloseTo(90 + 100 + 200 / 3, 3);
    expect(b.minZ).toBeCloseTo(-50 - 200 / 3, 3);
    expect(b.groundAt(0, 0)).toBeCloseTo(19);
    expect(b.maxHeight).toBeGreaterThan(280);
  });

  it('tours from the HQ past every spawn of the run, farthest first and round the HQ', () => {
    const doc = testMap();
    doc.spawns = [
      { id: 'a', name: 'A', x: -90, y: 30 },
      { id: 'b', name: 'B', x: 0, y: -45 },
      { id: 'c', name: 'C', x: 60, y: 45 },
    ];
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 8);
    const tour = world.introTour()!;
    expect(tour.points[0].x).toBeCloseTo(0, 1);
    expect(tour.points[0].z).toBeCloseTo(0, 1);
    // Scene x = HQ x - map x: A at 180, B at 90, C at 30
    // A (farthest) first, then counter-clockwise in the scene's x/z: C, B
    expect(tour.portals.map((p) => Math.round(p.x))).toEqual([180, 30, 90]);
    expect(new CustomMapWorld({ doc: { ...doc, spawns: doc.spawns.slice(0, 1) }, contentHash: '' }, hqOrigin(doc)).introTour()).toBeNull();
  });

  it('lets its buildings fall when the map says so, on its own copy of the map (TODO E131)', () => {
    const doc = testMap();
    doc.objects = [{ id: 'barn', asset: 'barn', x: 20, y: 20, z: 0, rotation: 0, scale: 1 }];
    const catalog = [{ id: 'barn', category: 'building', footprint: 5, height: 6, blocksBuild: true }];
    const geo = mapToGeo({ x: 20, y: 20 });

    const plain = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    expect(plain.destruction).toBeNull();
    expect(plain.capabilities.destructible).toBe(false);

    doc.gameplay = { destructible: true };
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    expect(world.capabilities.destructible).toBe(true);
    world.useCatalog(catalog);
    expect(world.surface.buildBlocker(geo.lat, geo.lon, 1)).toBe(BUILD_BLOCKED_OBJECT);
    // The simulation gets the barn in the run rules
    expect(world.runRules()!.structures).toEqual([expect.objectContaining({ id: 'barn', lat: geo.lat, lon: geo.lon, radius: 5, height: 6 })]);

    const fallen = world.destruction!.setFallen(['barn']);
    expect(fallen.map((s) => s.id)).toEqual(['barn']);
    // Gone from the run's map and its build blocking; the opened map keeps its barn
    expect(world.doc.objects[0].scale).toBe(FALLEN_SCALE);
    expect(world.surface.buildBlocker(geo.lat, geo.lon, 1)).toBeNull();
    expect(doc.objects[0].scale).toBe(1);

    world.destruction!.setFallen([]);
    expect(world.doc.objects[0].scale).toBe(1);
    expect(world.surface.buildBlocker(geo.lat, geo.lon, 1)).toBe(BUILD_BLOCKED_OBJECT);
  });

  it('hands its wave events to the simulation with the objects placed, and shows sky and objects as far as it says (TODO E170)', () => {
    const doc = testMap();
    doc.objects = [
      { id: 'gate', asset: 'barn', x: 20, y: 20, z: 0, rotation: 0, scale: 1.5 },
      { id: 'wall', asset: 'barn', x: -20, y: 20, z: 0, rotation: 0, scale: 1 },
    ];
    doc.environment = { ...doc.environment, sky: 'day', weather: 'clear' };
    doc.gameplay = {
      events: [
        { wave: 3, kind: 'objects', ids: ['gate'], show: true },
        { wave: 4, kind: 'objects', ids: ['wall'], show: false },
        { wave: 4, kind: 'weather', weather: 'rain', strength: 0.8 },
        { wave: 5, kind: 'time', hour: 21.5 },
        { wave: 2, kind: 'message', text: 'Hold' },
      ],
    };
    const catalog = [{ id: 'barn', category: 'building', footprint: 5, height: 6, blocksBuild: true }];
    const gate = mapToGeo({ x: 20, y: 20 });
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    world.useCatalog(catalog);
    // Before wave 3 the gate is hidden: out of the picture and the build blocking, on the run's own copy only
    expect(world.doc.objects[0].scale).toBe(FALLEN_SCALE);
    expect(doc.objects[0].scale).toBe(1.5);
    expect(world.surface.buildBlocker(gate.lat, gate.lon, 1)).toBeNull();
    // The rules carry the events, the gate at its own scale
    const events = world.runRules()!.events!;
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual({ wave: 3, kind: 'objects', ids: ['gate'], show: true, objects: [{ id: 'gate', ...gate, radius: 7.5 }] });

    world.showWaveEvents(3);
    expect(world.doc.objects[0].scale).toBe(1.5);
    expect(world.surface.buildBlocker(gate.lat, gate.lon, 1)).toBe(BUILD_BLOCKED_OBJECT);
    expect(world.doc.environment.weather).toBe('clear');
    world.showWaveEvents(5);
    expect(world.doc.objects[1].scale).toBe(FALLEN_SCALE);
    expect(world.doc.environment).toMatchObject({ weather: 'rain', weatherStrength: 0.8, sky: 'night' });
    expect(doc.environment.weather).toBe('clear');
    // Back (a restore): as before
    world.showWaveEvents(1);
    expect(world.doc.objects.map((o) => o.scale)).toEqual([FALLEN_SCALE, 1]);
    expect(world.doc.environment).toEqual(doc.environment);
  });

  it('has no minimap picture before the map stands', () => {
    const doc = testMap();
    expect(new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3).minimap()).toBeNull();
  });

  it('builds nothing into the scene when it is disposed while the renderer still loads', async () => {
    const doc = testMap();
    const world = new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3);
    const scene = new Scene();
    const cameraRig = { setupEnvironmentControls: vi.fn(), setBounds: vi.fn() };
    const attached = world.attach({ scene, renderer: {}, cameraRig } as never);
    world.dispose();
    await attached;
    expect(scene.children).toHaveLength(0);
    expect(cameraRig.setupEnvironmentControls).not.toHaveBeenCalled();
    expect(world.ready()).toBe(false);
  });

  it('starts a test run at the wave the link names, with the gold of the waves the map plays', () => {
    expect(customMapStartWave('?world=map:x')).toBe(1);
    expect(customMapStartWave('?world=map:x&fromWave=12')).toBe(12);
    expect(customMapStartWave('?fromWave=1')).toBe(1);
    expect(customMapStartWave('?fromWave=9999')).toBe(200);
    const doc = testMap();
    const at = (wave: number) => new CustomMapWorld({ doc, contentHash: 'abc' }, hqOrigin(doc), 3, null, undefined, wave);
    expect(at(1).runRules()).toBeNull();
    expect(at(12).runRules()!.start).toEqual(runStartAt(12, RUN_PLAN_RULES));
    // A map with its own list pays its own gold
    const table = { cycle: { fromWave: 1, hpGrowth: 1.5 }, waves: [{ wave: 1, name: 'One', enemies: { zombie: 2 }, hpMult: 1, spawnDelay: 400 }] };
    doc.gameplay = { waves: { kind: 'table', table } };
    expect(at(6).runRules()!.start).toEqual(runStartAt(6, tableWaveRules(table as never)));
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

    // Only the last map opened is kept: a page plays one
    const other = testMap();
    other.meta.id = 'other-map';
    await store.save(other);
    await openCustomMap({ kind: 'custom-map', mapId: 'other-map', contentHash: '' }, store);
    expect(openedCustomMap({ kind: 'custom-map', mapId: 'other-map', contentHash: '' })).not.toBeNull();
    expect(openedCustomMap(ref)).toBeNull();
  });
});

describe('CustomMapSurface bridge decks', () => {
  const deckAt = (doc: CustomMapDocument): number => {
    const frame = new CustomMapFrame();
    const origin = hqOrigin(doc);
    frame.setOrigin(origin.lat, origin.lon);
    return new CustomMapSurface(doc, frame).sampleColumn(frame.sceneX(40), frame.sceneZ(0))!.topY;
  };

  it('lifts a deck only over water it crosses, not to a lake elsewhere on the map', () => {
    const plain = deckAt(testMap());
    // Ground at the bridge ends (x 30 and 50) is 13 and 15 m: the deck spans the ditch in between
    expect(plain).toBeGreaterThan(13);
    expect(plain).toBeLessThan(16);

    // A mountain lake at 30 m in the north-west corner, far from the bridge
    const lake = testMap();
    const g = lake.terrain.grid;
    const mask = new Uint8Array(g.columns * g.rows);
    for (let j = g.rows - 6; j < g.rows; j++) for (let i = 0; i < 6; i++) mask[j * g.columns + i] = 255;
    lake.terrain.water = { level: 30, mask, color: '' };
    expect(deckAt(lake)).toBeCloseTo(plain);

    // A stream in the ditch at 16 m: the deck clears it by a metre
    const stream = testMap();
    const sm = new Uint8Array(g.columns * g.rows);
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (Math.abs(-100 + i * 2 - 40) <= 4) sm[j * g.columns + i] = 255;
    stream.terrain.waterBodies = [{ level: 16, mask: sm, color: '' }];
    expect(deckAt(stream)).toBeGreaterThanOrEqual(17);

    // A river across the bridge at 18 m
    const river = testMap();
    river.terrain.rivers = [{ id: 'r', kind: 'water', points: [{ x: 40, y: -50, width: 6, height: 18 }, { x: 40, y: 50, width: 6, height: 18 }] }];
    expect(deckAt(river)).toBeGreaterThanOrEqual(19);
  });
});
