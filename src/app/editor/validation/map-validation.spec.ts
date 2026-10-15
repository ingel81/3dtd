import { createMapDocument } from '../../world/custom-map/map-create';
import { emptyWater } from '../ops/water-ops';
import type { ObjectFooting } from '../../world/custom-map/render/objects/object-seat';
import { bridgeDecks, deckHeightAt } from '../../world/custom-map/bridge-decks';
import { HeightField } from '../../world/custom-map/render/height-field';
import { objectsInAir, validateMap, waterInAir } from './map-validation';

const codes = (doc: ReturnType<typeof createMapDocument>) => validateMap(doc).map((i) => i.code);

describe('validateMap', () => {
  it('passes the starter map of a big enough size', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    expect(validateMap(doc).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('wants paths and spawns', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, starter: false });
    expect(codes(doc)).toEqual(expect.arrayContaining(['no-paths', 'no-spawns']));
  });

  it('finds a spawn off the path and one that cannot reach the HQ', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 800 });
    doc.spawns.push({ id: 's2', name: 'Far', x: 0, y: 300 });
    doc.paths.nodes.push({ id: 'n8', x: -200, y: -300 }, { id: 'n9', x: 200, y: -300 });
    doc.paths.edges.push({ id: 'e9', a: 'n8', b: 'n9', width: 8, kind: 'road' });
    doc.spawns.push({ id: 's3', name: 'Island', x: -200, y: -300 });
    const issues = validateMap(doc);
    expect(issues.find((i) => i.code === 'spawn-off-path')?.target).toEqual({ kind: 'spawn', id: 's2' });
    expect(issues.find((i) => i.code === 'spawn-unreachable')?.target).toEqual({ kind: 'spawn', id: 's3' });
    expect(issues.some((i) => i.code === 'paths-split')).toBe(true);
    // Errors come first
    expect(issues[0].severity).toBe('error');
  });

  it('finds water whose bed rose above its surface, and leaves a lake with its shore alone', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400 });
    const g = doc.terrain.grid;
    g.heights.fill(0);
    const ice = { ...emptyWater(doc.terrain, -1), kind: 'ice' as const };
    // A round lake of 30 m around (100, 100): 80 % of it dug 3 m deep, its rim above the surface
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const r = Math.hypot(i * g.cellSize - 200 - 100, j * g.cellSize - 200 - 100);
        if (r > 30) continue;
        ice.mask[j * g.columns + i] = 255;
        if (r < 27) g.heights[j * g.columns + i] = -3;
      }
    }
    doc.terrain.waterBodies = [ice];
    expect(codes(doc)).not.toContain('water-buried');
    // A brush raised the bed again
    for (let k = 0; k < g.heights.length; k++) if (ice.mask[k]) g.heights[k] = 2.2;
    const issue = validateMap(doc).find((i) => i.code === 'water-buried');
    expect(issue?.message).toBe('Water body 0 (ice) lies under the ground: 100 % of it has its bed above its surface (up to 3.2 m). Dig it out again or raise its level.');
    expect(issue?.focus?.x).toBeCloseTo(100, -1);
  });

  it('wants the HQ on a path', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 800 });
    doc.hq = { x: 0, y: 200 };
    expect(codes(doc)).toContain('hq-off-path');
  });

  it('warns about short lanes, paths under water and objects on the road', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 160, depth: 160 });
    doc.terrain.water = emptyWater(doc.terrain, 1);
    doc.terrain.water.mask.fill(255);
    doc.objects.push({ id: 'o1', asset: 'house', x: 0, y: 1, z: 0, rotation: 0, scale: 1, blocksBuild: true });
    expect(codes(doc)).toEqual(expect.arrayContaining(['lane-short', 'path-under-water', 'object-on-path']));
  });
});

describe('validateMap, objects in the air', () => {
  const footings: Record<string, ObjectFooting> = {
    heap: { category: 'rock', footprint: 3, height: 2.6, base: [3, 2, 0] },
    slab: { category: 'rock', footprint: 10, height: 2 },
    'cliff-wall': { category: 'rock', footprint: 18, height: 9.5 },
    'crater-rim': { category: 'rock', footprint: 10, height: 1 },
    bush: { category: 'plant', footprint: 1, height: 1 },
    house: { category: 'building', footprint: 4, height: 6 },
    quay: { category: 'structure', footprint: 4, height: 2 },
    lamp: { category: 'prop', footprint: 0.2, height: 0.5 },
    buoy: { category: 'prop', footprint: 1, height: 2.3, float: true },
    span: { category: 'structure', footprint: 2.6, height: 0.1, aloft: true },
    smoke: { category: 'fx', footprint: 1, height: 1 },
  };
  const footingOf = (a: string) => footings[a];
  const place = (id: string, asset: string, x: number, z = 0, scale = 1) => ({ id, asset, x, y: 50, z, rotation: 0, scale });
  const inAir = (doc: ReturnType<typeof createMapDocument>) =>
    objectsInAir(doc, footingOf)
      .map(({ o }) => o.id)
      .sort();

  it('reports rocks whose plate hangs over a slope, pointing at the worst', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400 });
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.4 * i * g.cellSize;
    doc.objects.push(place('o1', 'heap', 50), place('o2', 'heap', 60, 0, 1.5), place('o3', 'heap', 70, -3), place('o4', 'bush', 80));
    const issue = validateMap(doc, { footingOf }).find((i) => i.code === 'object-floating');
    expect(issue?.severity).toBe('warning');
    expect(issue?.target).toEqual({ kind: 'object', id: 'o2' });
    expect(issue?.message).toMatch(/^2 objects hang in the air \(worst: heap, 1\.8 m up\)/);
    // Without the catalogue's footings nothing is checked
    expect(codes(doc)).not.toContain('object-floating');
  });

  it('measures floating assets from the water, the rest from the ground; what stands on another object is held', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, starter: false });
    doc.terrain.grid.heights.fill(-5);
    doc.terrain.water = emptyWater(doc.terrain, 0);
    doc.terrain.water.mask.fill(255);
    doc.objects.push(
      // A buoy with the depth in its z (the Archipelago's) hangs 5 m over the water; one at the waterline does not
      place('deep', 'buoy', 0, 5),
      place('afloat', 'buoy', 10, -0.4),
      // One sunk deeper than half its height
      place('sunk', 'buoy', 20, -2),
      // A house raised by 2 m, a lamp on a quay, a lamp beside it in the air
      place('raised', 'house', 30, 2),
      place('quay', 'quay', 50),
      place('on-quay', 'lamp', 51, 2),
      place('beside', 'lamp', 60, 2),
      // Cable spans and smoke stand in the air by design
      place('span', 'span', 70, 20),
      place('smoke', 'smoke', 80, 8),
    );
    expect(inAir(doc)).toEqual(['beside', 'deep', 'raised', 'sunk']);
    const issue = validateMap(doc, { footingOf }).find((i) => i.code === 'object-floating');
    expect(issue?.target).toEqual({ kind: 'object', id: 'deep' });
    expect(issue?.message).toMatch(/^3 objects hang in the air, a boat or buoy sinks under the water \(worst: buoy, 5\.0 m up\)/);
  });

  it('measures a flat set piece without a plate on its footprint, crater rims and cliff walls left out', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400 });
    const g = doc.terrain.grid;
    // A 20 degree slope: a 10 m slab level on it hangs some 3.6 m over the ground on its low side
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.36 * i * g.cellSize;
    // A cliff wall on the slope stands on its foot, sunk in a little as the Cliff rocks brush sets it
    doc.objects.push(place('slab', 'slab', 50), place('rim', 'crater-rim', 80), place('wall', 'cliff-wall', 120, -2));
    expect(inAir(doc)).toEqual(['slab']);
    // On level ground it lies flat
    g.heights.fill(0);
    expect(inAir(doc)).toEqual([]);
  });

  it('holds what stands on ice', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, starter: false });
    doc.terrain.grid.heights.fill(-2);
    doc.terrain.water = { ...emptyWater(doc.terrain, 0), kind: 'ice' };
    doc.terrain.water.mask.fill(255);
    doc.objects.push(place('hut', 'house', 0, 2), place('hut-high', 'house', 20, 3));
    expect(inAir(doc)).toEqual(['hut-high']);
  });

  it("holds what stands on a road bridge's deck, not what hangs beside it", () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, starter: false });
    doc.terrain.grid.heights.fill(-2);
    doc.terrain.water = emptyWater(doc.terrain, 0);
    doc.terrain.water.mask.fill(255);
    doc.paths.nodes.push({ id: 'a', x: -20, y: 50 }, { id: 'b', x: 20, y: 50 });
    doc.paths.edges.push({ id: 'e', a: 'a', b: 'b', width: 4, kind: 'bridge' });
    const t = doc.terrain;
    const deck = deckHeightAt(bridgeDecks(doc.paths, t, new HeightField(t.grid, t.width, t.depth)), 0, 51.7);
    // On the deck's edge, and one beside the deck 0.6 m over the water (the Witch Marsh's torches)
    doc.objects.push({ ...place('on-deck', 'lamp', 0, deck + 2), y: 51.7 }, { ...place('beside', 'lamp', 0, 2.6), y: 52.6 });
    expect(inAir(doc)).toEqual(['beside']);
  });
});

describe('validateMap, ground and limits', () => {
  it('reports spawns beyond the 32 the game uses', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    const s = doc.spawns[0];
    for (let k = 1; k <= 32; k++) doc.spawns.push({ ...s, id: `x${k}`, name: `X${k}` });
    const issue = validateMap(doc).find((i) => i.code === 'too-many-spawns');
    expect(issue?.severity).toBe('error');
    expect(issue?.target).toEqual({ kind: 'spawn', id: 'x32' });
  });

  it('finds the HQ and a spawn in a water body or a river, but not a spawn on a bridge', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    expect(codes(doc)).not.toContain('hq-in-water');
    const lake = emptyWater(doc.terrain, 2);
    lake.mask.fill(255);
    doc.terrain.waterBodies = [lake];
    expect(codes(doc)).toEqual(expect.arrayContaining(['hq-in-water', 'spawn-in-water']));
    doc.terrain.waterBodies = [];
    const s = doc.spawns[0];
    doc.terrain.rivers = [{ id: 'r', kind: 'water', points: [{ x: s.x, y: -50, width: 12, height: 0 }, { x: s.x, y: 50, width: 12, height: 0 }] }];
    expect(codes(doc)).toContain('spawn-in-water');
    for (const e of doc.paths.edges) e.kind = 'bridge';
    expect(codes(doc)).not.toContain('spawn-in-water');
  });

  it('finds markers on steep ground', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    const g = doc.terrain.grid;
    // A 45 degree slope northwards over the whole map
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = j * g.cellSize;
    expect(codes(doc)).toEqual(expect.arrayContaining(['hq-steep', 'spawn-steep']));
  });

  it('finds roads running off the map', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    doc.paths.nodes[0].x = -500;
    const issue = validateMap(doc).find((i) => i.code === 'path-outside');
    expect(issue?.severity).toBe('error');
    expect(issue?.target?.kind).toBe('edge');
  });

  it('warns about red plants by a road only', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    doc.objects.push({ id: 'far', asset: 'mushrooms-red', x: 0, y: 150, z: 0, rotation: 0, scale: 1 });
    expect(codes(doc)).not.toContain('danger-color');
    doc.objects.push({ id: 'near', asset: 'flowers-red', x: 0, y: 10, z: 0, rotation: 0, scale: 1 });
    doc.objects.push({ id: 'oak', asset: 'tree-oak', x: 0, y: 12, z: 0, rotation: 0, scale: 1 });
    const issue = validateMap(doc).find((i) => i.code === 'danger-color');
    expect(issue?.target).toEqual({ kind: 'object', id: 'near' });
  });
});

describe('validateMap, gameplay rules', () => {
  it('checks the wave list and the allowed towers', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    doc.gameplay = {
      towers: ['research-center', 'laser-of-doom'],
      waves: { kind: 'table', table: { cycle: { fromWave: 1, hpGrowth: 1.2 }, waves: [{ wave: 1, name: 'x', enemies: { nobody: 3 }, hpMult: 1, spawnDelay: 500 }] } },
    };
    const issues = validateMap(doc);
    expect(issues.some((i) => i.code === 'wave-list' && i.message.includes('nobody'))).toBe(true);
    expect(issues.filter((i) => i.code === 'unknown-tower')).toHaveLength(2);
  });
});

describe('validateMap, room for towers', () => {
  const areas = (lanes: { spawnId: string; area: number; routed: boolean }[]) =>
    ({ cell: 4, columns: 1, rows: 1, x0: 0, y0: 0, kind: new Uint8Array(1), inReach: 0, buildable: 0, lanes: lanes.map((l) => ({ ...l, name: l.spawnId })) });

  it('warns about a lane with room for few towers in reach of its route, once the build areas are judged', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 800, depth: 400 });
    expect(codes(doc)).not.toContain('lane-little-room');
    const tight = validateMap(doc, { buildAreas: areas([{ spawnId: 's1', area: 19 * 64, routed: true }]) });
    const issue = tight.find((i) => i.code === 'lane-little-room');
    expect(issue?.target).toEqual({ kind: 'spawn', id: 's1' });
    expect(issue?.message).toContain('about 19 towers');
    expect(validateMap(doc, { buildAreas: areas([{ spawnId: 's1', area: 20 * 64, routed: true }]) }).map((i) => i.code)).not.toContain('lane-little-room');
    // A lane without a route has its own error
    expect(validateMap(doc, { buildAreas: areas([{ spawnId: 's1', area: 0, routed: false }]) }).map((i) => i.code)).not.toContain('lane-little-room');
  });
});

describe('validateMap, water in the air', () => {
  const lake = () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, starter: false });
    const t = doc.terrain;
    const g = t.grid;
    t.waterBodies = [{ ...emptyWater(t, 2), kind: 'water' }];
    // A hollow 1 m deep round the middle (radius 20 m), its mask the hollow
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const x = i * g.cellSize - 100;
        const y = j * g.cellSize - 100;
        const k = j * g.columns + i;
        const inside = Math.hypot(x, y) < 20;
        g.heights[k] = inside ? 1 : 3;
        if (inside) t.waterBodies[0].mask[k] = 255;
      }
    }
    return doc;
  };

  it('holds a lake in its hollow and reports one whose bank falls away', () => {
    const doc = lake();
    expect(waterInAir(doc)).toEqual([]);
    expect(validateMap(doc).map((i) => i.code)).not.toContain('water-floating');
    // The bank south of the lake cut down to the valley floor (a river's channel through the rim)
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const x = i * g.cellSize - 100;
        const y = j * g.cellSize - 100;
        if (Math.abs(x) < 4 && y < -19) g.heights[j * g.columns + i] = -2;
      }
    }
    const found = waterInAir(doc);
    expect(found.map((f) => f.what)).toEqual(['body 1']);
    expect(found[0].height).toBeGreaterThan(2);
    const issue = validateMap(doc).find((i) => i.code === 'water-floating');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toMatch(/^Water ends in the air: body 1 \(worst: body 1, /);
  });

  it('reports a river whose ribbon runs over its banks, not down a waterfall', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, starter: false });
    doc.terrain.grid.heights.fill(0);
    // Two metres over flat land: no bank holds it
    doc.terrain.rivers = [{ id: 'r1', kind: 'water', points: [{ x: -40, y: 0, width: 6, height: 2 }, { x: 40, y: 0, width: 6, height: 1.8 }] }];
    expect(waterInAir(doc).map((f) => f.what)).toEqual(['river 1']);
    // A fall: 20 m down over 4 m, the waterfall's sheet covers it
    doc.terrain.rivers[0].points = [{ x: -2, y: 0, width: 6, height: 20 }, { x: 2, y: 0, width: 6, height: 0 }];
    expect(waterInAir(doc)).toEqual([]);
  });
});
