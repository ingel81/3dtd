import { zipSync, strToU8 } from 'fflate';
import { createMapDocument } from './map-create';
import type { CustomMapDocument } from './map-document';
import {
  MapFileError,
  canonicalJson,
  cloneMapDocument,
  contentHash,
  migrateMapJson,
  packMapFile,
  unpackMapFile,
  validateMapDocument,
} from './map-file';

function sample(): CustomMapDocument {
  const doc = createMapDocument({
    id: 'test-map',
    name: 'Test map',
    width: 64,
    depth: 48,
    ground: 'noise',
    seed: 7,
    now: new Date('2026-10-11T00:00:00Z'),
  });
  doc.terrain.layers.push({ material: 'dirt', scale: 3 });
  doc.terrain.splat.maps[0][5] = 200;
  doc.terrain.water = { level: 1.5, mask: new Uint8Array(doc.terrain.grid.heights.length).fill(255, 0, 10), color: '#335566' };
  doc.objects.push({ id: 'o1', asset: 'tree-oak', x: 3, y: -4, z: 0, rotation: 1.2, scale: 1.1, blocksLos: true });
  return doc;
}

describe('map file', () => {
  it('round-trips every field and array', () => {
    const doc = sample();
    const preview = new Uint8Array([137, 80, 78, 71]);
    const { doc: back, preview: backPreview } = unpackMapFile(packMapFile(doc, { preview }));
    expect(back).toEqual(doc);
    expect(back.terrain.grid.heights).toBeInstanceOf(Float32Array);
    expect(back.terrain.water?.mask).toBeInstanceOf(Uint8Array);
    expect(backPreview).toEqual(preview);
  });

  it('round-trips a map without water and without preview', () => {
    const doc = createMapDocument({ id: 'dry', name: 'Dry', width: 16, depth: 16 });
    const { doc: back, preview } = unpackMapFile(packMapFile(doc).buffer as ArrayBuffer);
    expect(back.terrain.water).toBeNull();
    expect(preview).toBeNull();
    expect(back).toEqual(doc);
  });

  it('refuses an invalid document when packing', () => {
    const doc = sample();
    doc.paths.edges.push({ id: 'bad', a: 'n1', b: 'nope', width: 4, kind: 'road' });
    expect(() => packMapFile(doc)).toThrow(MapFileError);
  });

  it('says clearly what is wrong with a file', () => {
    expect(() => unpackMapFile(new Uint8Array([1, 2, 3]))).toThrow(/not a map file/);
    expect(() => unpackMapFile(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/map.json is missing/);
    expect(() => unpackMapFile(zipSync({ 'map.json': strToU8('{oops') }))).toThrow(/not valid JSON/);
    expect(() => unpackMapFile(zipSync({ 'map.json': strToU8('{"format":"other"}') }))).toThrow(/not a 3DTD map/);
    const json = JSON.stringify({ format: '3dtd-map', version: 1, terrain: { grid: { heights: { $bin: 'terrain/heights.f32' } }, splat: { maps: [] } } });
    expect(() => unpackMapFile(zipSync({ 'map.json': strToU8(json) }))).toThrow(/misses the terrain heights/);
  });

  it('refuses a map from a newer version and migrates older ones', () => {
    expect(() => migrateMapJson({ version: 9 }, {}, 1)).toThrow(/version 9/);
    const out = migrateMapJson({ version: 1, a: 1 }, { 1: (j) => ({ ...j, b: 2 }) }, 2);
    expect(out).toEqual({ version: 2, a: 1, b: 2 });
    expect(() => migrateMapJson({ version: 1 }, {}, 2)).toThrow(/No way to read/);
  });

  it('validates the grid and the references', () => {
    const doc = sample();
    expect(validateMapDocument(doc)).toEqual([]);
    doc.terrain.grid.heights = new Float32Array(3);
    doc.spawns[0].x = NaN;
    doc.meta.id = 'Bad Id';
    const problems = validateMapDocument(doc);
    expect(problems.some((p) => p.includes('heights hold 3'))).toBe(true);
    expect(problems.some((p) => p.includes('spawn'))).toBe(true);
    expect(problems.some((p) => p.includes('meta.id'))).toBe(true);
  });

  it('hashes the world, not its name or times', async () => {
    const doc = sample();
    const hash = await contentHash(doc);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const renamed = cloneMapDocument(doc);
    renamed.meta.name = 'Other name';
    renamed.meta.updatedAt = '2030-01-01T00:00:00Z';
    renamed.meta.description = 'changed';
    expect(await contentHash(renamed)).toBe(hash);

    const reordered = JSON.parse(JSON.stringify({ env: doc.environment }));
    expect(canonicalJson(reordered)).toBe(canonicalJson({ env: { ...doc.environment } }));

    const moved = cloneMapDocument(doc);
    moved.objects[0].x += 0.5;
    expect(await contentHash(moved)).not.toBe(hash);

    const raised = cloneMapDocument(doc);
    raised.terrain.grid.heights[3] += 1;
    expect(await contentHash(raised)).not.toBe(hash);
  });

  it('keeps the hash through a file round-trip', async () => {
    const doc = sample();
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(await contentHash(back)).toBe(await contentHash(doc));
  });

  it('sorts keys in canonical JSON', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
