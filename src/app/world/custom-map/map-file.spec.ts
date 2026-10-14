import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createMapDocument } from './map-create';
import { MAP_VERSION, fitSplatMaps, type CustomMapDocument } from './map-document';
import {
  MAX_ENTRY_BYTES,
  MAX_GRID_SIDE,
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

/** A zip whose one entry claims `size` bytes uncompressed (local and central header patched) */
function zipClaiming(name: string, size: number): Uint8Array {
  const zip = zipSync({ [name]: new Uint8Array(16) }, { level: 0 });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 4 <= zip.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, size, true);
    if (sig === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return zip;
}

describe('map file limits', () => {
  it('refuses a small file that claims huge entries, before inflating them', () => {
    expect(() => unpackMapFile(zipClaiming('terrain/heights.f32', 0x7fff0000))).toThrow(/too large/);
    expect(MAX_ENTRY_BYTES).toBeLessThan(0x7fff0000);
  });

  it('skips entries a map does not have', () => {
    const doc = sample();
    const file = packMapFile(doc);
    const extra = zipSync({ ...Object.fromEntries(Object.entries(unzipSync(file))), 'junk/big.bin': new Uint8Array(1000) });
    expect(unpackMapFile(extra).doc.meta.id).toBe(doc.meta.id);
  });

  it('refuses grids past the limit and checks meta, lists and the look', () => {
    const doc = sample();
    doc.terrain.grid.columns = MAX_GRID_SIDE + 1;
    expect(validateMapDocument(doc).join()).toMatch(/more than/);
    const bad = sample() as unknown as { meta: Record<string, unknown>; objects: unknown; environment: Record<string, unknown> };
    bad.meta['updatedAt'] = 5;
    bad.environment['biome'] = 'pluto';
    const problems = validateMapDocument(bad as unknown as CustomMapDocument);
    expect(problems).toContain('meta.updatedAt must be a date');
    expect(problems.join()).toMatch(/biome pluto/);
    bad.objects = { o1: {} };
    expect(() => validateMapDocument(bad as unknown as CustomMapDocument)).not.toThrow();
    expect(validateMapDocument(bad as unknown as CustomMapDocument)).toContain('objects must be a list');
    const rivers = sample();
    (rivers.terrain as unknown as Record<string, unknown>)['rivers'] = { a: 1 };
    expect(validateMapDocument(rivers)).toContain('rivers must be a list');
  });

  it('hashes the same world the same in every file version', async () => {
    const doc = sample();
    const before = await contentHash(doc);
    (doc as unknown as { version: number }).version = 99;
    expect(await contentHash(doc)).toBe(before);
  });
});

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

  it('round-trips further water bodies with their kinds', () => {
    const doc = sample();
    const n = doc.terrain.grid.heights.length;
    doc.terrain.water!.kind = 'water';
    doc.terrain.waterBodies = [
      { level: 6, mask: new Uint8Array(n).fill(255, 20, 30), color: '#223344', kind: 'ice' },
      { level: 9, mask: new Uint8Array(n).fill(255, 40, 45), color: '#ff5a10', kind: 'lava' },
    ];
    doc.terrain.rivers = [
      {
        id: 'r1',
        kind: 'water',
        points: [
          { x: 0, y: 0, width: 6, height: 2 },
          { x: 10, y: 4, width: 7, height: 1.5 },
        ],
      },
    ];
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back).toEqual(doc);
    expect(back.terrain.waterBodies?.[1].mask).toBeInstanceOf(Uint8Array);
    doc.terrain.waterBodies[0].mask = new Uint8Array(3);
    expect(validateMapDocument(doc).some((m) => m.includes('water body 1'))).toBe(true);
    doc.terrain.rivers[0].points.pop();
    expect(validateMapDocument(doc).some((m) => m.includes('river r1'))).toBe(true);
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

  it('reads version 1 maps and keeps gameplay rules through a round trip', () => {
    const doc = sample();
    const v1 = JSON.parse(JSON.stringify({ format: '3dtd-map', version: 1 }));
    expect(migrateMapJson(v1)['version']).toBe(MAP_VERSION);
    doc.gameplay = {
      startCredits: 250,
      hqHealth: 300,
      towers: ['archer', 'cannon'],
      waves: { kind: 'table', table: { cycle: { fromWave: 1, hpGrowth: 1.5 }, waves: [{ wave: 1, name: 'First', enemies: { zombie: 10 }, hpMult: 1, spawnDelay: 800 }] } },
    };
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.gameplay).toEqual(doc.gameplay);
    doc.gameplay = { hqHealth: 0, waves: { kind: 'table', table: { cycle: { fromWave: 1, hpGrowth: 0 }, waves: [] } } };
    const problems = validateMapDocument(doc);
    expect(problems).toEqual(expect.arrayContaining(['gameplay.hqHealth must be above 0', 'the wave list is empty', 'the wave list has no valid repeat rule']));
  });

  it('carries 12 ground layers in three splat maps and refuses a thirteenth (TODO E175)', () => {
    const doc = sample();
    const twelve = ['grass', 'dirt', 'sand', 'rock', 'snow', 'mud', 'gravel', 'forest-floor', 'hell-ground', 'cinders', 'brimstone', 'lava-crust'];
    doc.terrain.layers = twelve.map((material) => ({ material }));
    fitSplatMaps(doc.terrain);
    expect(doc.terrain.splat.maps).toHaveLength(3);
    doc.terrain.splat.maps[2][7] = 123;
    const file = packMapFile(doc);
    expect(Object.keys(unzipSync(file))).toContain('terrain/splat2.u8');
    const { doc: back } = unpackMapFile(file);
    expect(back.terrain.layers.map((l) => l.material)).toEqual(twelve);
    expect(back.terrain.splat.maps.map((m) => Array.from(m))).toEqual(doc.terrain.splat.maps.map((m) => Array.from(m)));
    doc.terrain.layers.push({ material: 'basalt' });
    expect(validateMapDocument(doc)).toContain('terrain needs 1 to 12 ground layers');
    // Nine layers need the third map, eight have none
    doc.terrain.layers.length = 9;
    doc.terrain.splat.maps.length = 2;
    expect(validateMapDocument(doc)).toContain(`splat needs three maps of ${doc.terrain.splat.resolution} x ${doc.terrain.splat.resolution} RGBA`);
  });

  it('reads a version 2 file unchanged: two splat maps, the same content hash', async () => {
    const doc = sample();
    const file = packMapFile(doc);
    const entries = unzipSync(file);
    expect(Object.keys(entries)).not.toContain('terrain/splat2.u8');
    const json = JSON.parse(new TextDecoder().decode(entries['map.json']));
    const v2 = zipSync({ ...entries, 'map.json': strToU8(JSON.stringify({ ...json, version: 2 })) });
    const { doc: back } = unpackMapFile(v2);
    expect(back.version).toBe(MAP_VERSION);
    expect(back.terrain.splat.maps).toHaveLength(2);
    expect(Array.from(back.terrain.splat.maps[0])).toEqual(Array.from(doc.terrain.splat.maps[0]));
    expect(await contentHash(back)).toBe(await contentHash(doc));
  });

  it('carries the lane rules and the optional flag of a spawn, and checks them (TODO E130)', () => {
    const doc = sample();
    doc.gameplay = { lanes: { min: 1, max: 2, vacant: 'host' } };
    doc.spawns = [{ id: 's1', name: 'North', x: 0, y: 0, optional: true }];
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.gameplay).toEqual(doc.gameplay);
    expect(back.spawns[0].optional).toBe(true);
    expect(validateMapDocument(doc)).toEqual([]);
    doc.gameplay = { lanes: { min: 3, max: 2, vacant: 'all' as never } };
    expect(validateMapDocument(doc)).toEqual(expect.arrayContaining([
      'gameplay.lanes.min is above max', 'gameplay.lanes.vacant must be close, host or split',
    ]));
    doc.gameplay = { lanes: { min: 0.5 } };
    expect(validateMapDocument(doc)).toContain('gameplay.lanes.min must be a whole number from 1');
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

  it('packs the same map into the same bytes', () => {
    const doc = sample();
    expect(packMapFile(doc)).toEqual(packMapFile(cloneMapDocument(doc)));
    const old = cloneMapDocument(doc);
    old.meta.updatedAt = new Date(0).toISOString();
    expect(() => unpackMapFile(packMapFile(old))).not.toThrow();
  });

  it('sorts keys in canonical JSON', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
