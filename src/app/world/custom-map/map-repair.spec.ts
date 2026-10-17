import { createMapDocument } from './map-create';
import { packMapFile, unpackMapFile } from './map-file';
import { MAX_MAP_TEXT, mapRepairs } from './map-repair';
import { MapStore, MemoryMapBackend } from './map-store';
import { validateMap } from '../../map-ops/validation/map-validation';

/** A map with values a file from outside may carry: none of them refused the map before the soft checks */
function untidy() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, starter: true, now: new Date(0) });
  const loose = doc as unknown as Record<string, Record<string, unknown>>;
  loose['environment']['fogDensity'] = null;
  loose['environment']['tint'] = 'red';
  loose['environment']['weather'] = 'hail';
  loose['environment']['snowCover'] = 3;
  doc.meta.description = 'x'.repeat(MAX_MAP_TEXT.description + 5);
  doc.objects.push({ id: 'o1', asset: 'tree', x: 0, y: 0, z: 0, rotation: 0, scale: 1, blocksBuild: 'false' as never, tint: 'green' });
  doc.spawns.push({ ...doc.spawns[0], name: 7 as never });
  (doc.paths.edges[0] as unknown as Record<string, unknown>)['kind'] = 'lane';
  return doc;
}

describe('soft map values (warn and set right)', () => {
  it('reads a file with values out of range: it opens, set right, and says what it changed', () => {
    const doc = untidy();
    expect(doc.paths.edges.length).toBeGreaterThan(0);
    const { doc: read, repaired } = unpackMapFile(packMapFile(doc));
    expect(repaired).toEqual([
      `meta.description is longer than ${MAX_MAP_TEXT.description} characters; it is cut there`,
      'environment fogDensity null is not 0 to 0.05; it is 0.0004 now',
      'environment tint red is no #rrggbb colour; it is white now',
      'environment weather hail is unknown; the map is clear now',
      'environment snowCover 3 is not 0 to 1; it is cut to that',
      'object o1: blocksBuild "false" is not true or false; the catalogue\'s holds',
      'object o1: tint green is no #rrggbb colour; it shows untinted',
      `path edge ${doc.paths.edges[0].id}: kind lane is unknown; it is a road now`,
      'spawn 2: id "s1" is twice; it is spawn-2 now',
      'spawn 2: the name is no text; it is Spawn 2 now',
    ]);
    expect(read.environment).toMatchObject({ fogDensity: 0.0004, tint: '#ffffff', snowCover: 1 });
    expect(read.environment.weather).toBeUndefined();
    expect(read.objects[0].blocksBuild).toBeUndefined();
    expect(read.spawns.map((s) => s.id)).toEqual(['s1', 'spawn-2']);
    expect(read.paths.edges[0].kind).toBe('road');
    expect(mapRepairs(read)).toEqual([]);
  });

  it('names them in the editor check as warnings, before they are set right', () => {
    const issues = validateMap(untidy()).filter((i) => i.code === 'map-values');
    expect(issues).toHaveLength(10);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.find((i) => i.message.includes('tint red'))).toMatchObject({ fixIn: 'environment' });
    expect(issues.find((i) => i.message.includes('object o1: tint'))).toMatchObject({ target: { kind: 'object', id: 'o1' } });
  });

  it('gives the corrected map its own content hash on loading, so a coop guest can confirm it', async () => {
    const backend = new MemoryMapBackend();
    const store = new MapStore({ backend, fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' });
    const doc = untidy();
    const saved = await store.save(doc);
    const loaded = await store.load('m');
    expect(loaded.repaired).toHaveLength(10);
    expect(loaded.summary.contentHash).not.toBe(saved.contentHash);
    // Saved as corrected, it reads clean
    await store.save(loaded.doc);
    expect((await store.load('m')).repaired).toBeUndefined();
  });
});
