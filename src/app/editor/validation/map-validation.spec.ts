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
