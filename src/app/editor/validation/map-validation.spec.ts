import { createMapDocument } from '../../world/custom-map/map-create';
import { emptyWater } from '../ops/water-ops';
import { validateMap } from './map-validation';

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

describe('validateMap, rocks', () => {
  it('reports rocks whose plate hangs over a slope, pointing at the worst', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400 });
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.4 * i * g.cellSize;
    const heap = { base: [3, 2, 0] as const, height: 2.6 };
    doc.objects.push(
      { id: 'o1', asset: 'heap', x: 50, y: 50, z: 0, rotation: 0, scale: 1 },
      { id: 'o2', asset: 'heap', x: 60, y: 50, z: 0, rotation: 0, scale: 1.5 },
      { id: 'o3', asset: 'heap', x: 70, y: 50, z: -3, rotation: 0, scale: 1 },
      { id: 'o4', asset: 'bush', x: 80, y: 50, z: 0, rotation: 0, scale: 1 },
    );
    const rockOf = (a: string) => (a === 'heap' ? heap : undefined);
    const issue = validateMap(doc, { rockOf }).find((i) => i.code === 'object-floating');
    expect(issue?.severity).toBe('warning');
    expect(issue?.target).toEqual({ kind: 'object', id: 'o2' });
    expect(issue?.message).toMatch(/^2 rocks hang up to 1\.8 m/);
    // Without the catalogue's rock shapes nothing is checked
    expect(codes(doc)).not.toContain('object-floating');
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
