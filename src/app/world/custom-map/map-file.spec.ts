import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createMapDocument } from './map-create';
import { MAP_VERSION, difficultyFactor, fitSplatMaps, type CustomMapDocument } from './map-document';
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
import { mapRepairs } from './map-repair';

/** What reading would set right or leave out, in words */
function soft(doc: CustomMapDocument): string[] {
  return mapRepairs(doc).map((q) => q.text);
}

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
    // A biome this game does not know is content, not structure: reading falls back to the default
    expect(problems.join()).not.toMatch(/pluto/);
    expect(mapRepairs(bad as unknown as CustomMapDocument).map((q) => q.text).join()).toMatch(/biome pluto is unknown/);
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
    // A broken river is content: reading leaves it out and says so
    doc.terrain.rivers[0].points.pop();
    expect(mapRepairs(doc).some((q) => q.text.includes('river r1 needs two points; it is left out'))).toBe(true);
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

  it('says a file of a newer map version was made with a newer game, before it reads the rest', () => {
    const entries = unzipSync(packMapFile(sample()));
    const json = JSON.parse(new TextDecoder().decode(entries['map.json']));
    // A newer file may change the structure too: the version is read first
    const newer = zipSync({ 'map.json': strToU8(JSON.stringify({ ...json, version: MAP_VERSION + 1, terrain: 'changed' })) });
    expect(() => unpackMapFile(newer)).toThrow(`This map was made with a newer version of the game (map version ${MAP_VERSION + 1}, this game reads up to ${MAP_VERSION}). Update the game to open it.`);
  });

  it('reads content it does not know softly: values to their default, broken things left out, the same on every read', async () => {
    const doc = sample();
    doc.objects.push({ id: 'o2', asset: 'rock', x: 1, y: 1, z: 0, rotation: 0, scale: 1 });
    doc.terrain.rivers = [{ id: 'r1', kind: 'water', points: [{ x: 0, y: 0, width: 6, height: 2 }, { x: 10, y: 4, width: 7, height: 1.5 }] }];
    doc.paths.nodes.push({ id: 'n8', x: 0, y: 30 }, { id: 'n9', x: 10, y: 30 });
    doc.paths.edges.push({ id: 'e9', a: 'n8', b: 'n9', width: 6, kind: 'bridge', style: 'wood' });
    doc.life = { areas: [{ id: 'a1', kind: 'birds', shape: 'area', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }] }] };
    doc.intro = { kind: 'orbit', seconds: 10, radius: 100, height: 30, angle: 1 };
    const unknown = (v: string) => v as never;
    // What a newer game may write: new values of lists, new kinds of things, and a few things broken
    doc.environment.sky = unknown('aurora');
    doc.environment.biome = unknown('ocean');
    doc.terrain.water!.kind = unknown('acid');
    doc.terrain.rivers[0].kind = unknown('tar');
    const bridge = doc.paths.edges.find((e) => e.id === 'e9')!;
    bridge.style = unknown('glass');
    bridge.kind = unknown('rail');
    doc.objects[1].scale = NaN;
    doc.life.areas!.push({ id: 'a2', kind: unknown('whales'), shape: 'area', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }] });
    doc.intro = { kind: unknown('drone'), seconds: 10 } as never;
    expect(validateMapDocument(doc)).toEqual([]);
    const file = packMapFile(doc);
    const read = unpackMapFile(file);
    expect(read.repaired).toEqual([
      'environment sky aurora is unknown; it is day now',
      'environment biome ocean is unknown; the map looks temperate',
      'the water: kind acid is unknown; it is water now',
      'river r1: kind tar is unknown; it is water now',
      'object o2 has a bad placement; it is left out',
      'path edge e9: kind rail is unknown; it is a road now',
      'path edge e9: bridge style glass is unknown; the default holds',
      'life area a2: kind whales is unknown; it is left out',
      "intro.kind must be path or orbit; the map's intro flight is left out, the game flies its own",
    ]);
    const back = read.doc;
    expect(back.environment.sky).toBe('day');
    expect(back.environment.biome).toBeUndefined();
    expect(back.terrain.water!.kind).toBeUndefined();
    expect(back.terrain.rivers![0].kind).toBe('water');
    expect(back.objects.map((o) => o.id)).toEqual(['o1']);
    const road = back.paths.edges.find((e) => e.id === 'e9')!;
    expect(road.kind).toBe('road');
    expect(road).not.toHaveProperty('style');
    expect(back.life!.areas!.map((a) => a.id)).toEqual(['a1']);
    expect(back.intro).toBeUndefined();
    // Set right once, nothing more to set right; and every read of the file (every coop client) gives the same map
    expect(mapRepairs(back)).toEqual([]);
    const again = unpackMapFile(file);
    expect(again.doc).toEqual(back);
    expect(await contentHash(again.doc)).toBe(await contentHash(back));
  });

  it('still refuses a file whose structure is broken', () => {
    const doc = sample();
    const entries = unzipSync(packMapFile(doc));
    const json = JSON.parse(new TextDecoder().decode(entries['map.json']));
    json.paths.edges = [{ id: 'e1', a: 'n1', b: 'gone', width: 4, kind: 'road' }];
    expect(() => unpackMapFile(zipSync({ ...entries, 'map.json': strToU8(JSON.stringify(json)) }))).toThrow(/The map is broken: path edge e1 names a node that does not exist/);
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

  it('reads a version 3 file unchanged and writes version 4: no raised buildings, no surfaces, the same content hash', async () => {
    const doc = sample();
    const entries = unzipSync(packMapFile(doc));
    const json = JSON.parse(new TextDecoder().decode(entries['map.json']));
    expect(json.version).toBe(4);
    const v3 = zipSync({ ...entries, 'map.json': strToU8(JSON.stringify({ ...json, version: 3 })) });
    const { doc: back, repaired } = unpackMapFile(v3);
    expect(back.version).toBe(4);
    expect(repaired).toEqual([]);
    expect(back.objects).toEqual(doc.objects);
    expect(back.surfaces).toBeUndefined();
    // The version is no world content: the hash of the unchanged map stays
    expect(await contentHash(back)).toBe(await contentHash(doc));
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
    expect(validateMapDocument(doc)).toEqual(['gameplay.lanes.min is above max']);
    expect(soft(doc)).toEqual(['gameplay.lanes.vacant all is unknown; the default holds']);
    doc.gameplay = { lanes: { min: 0.5 } };
    expect(validateMapDocument(doc)).toContain('gameplay.lanes.min must be a whole number from 1');
  });

  it('carries the difficulty, an optional percent; a map without it reads as 100', () => {
    const doc = sample();
    expect(difficultyFactor(doc.gameplay)).toBe(1);
    doc.gameplay = { difficulty: 140 };
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.gameplay).toEqual({ difficulty: 140 });
    expect(difficultyFactor(back.gameplay)).toBe(1.4);
    doc.gameplay = { difficulty: 20 };
    expect(validateMapDocument(doc)).toContain('gameplay.difficulty must be 50 to 200 (percent)');
  });

  it('carries the prefabs a map keeps for its editor, outside the content hash (TODO E170)', async () => {
    const doc = sample();
    const hash = await contentHash(doc);
    const piece = {
      width: 8, depth: 6, cell: 2, columns: 5, rows: 4, heights: new Float32Array(20).fill(0.5),
      paintCell: 1, paintColumns: 8, paintRows: 6, materials: ['grass', 'dirt'], paint: new Uint8Array(96).fill(7),
      water: { mask: new Uint8Array(20).fill(255, 0, 3), level: -0.2, color: '#335566' },
      objects: [{ asset: 'tree-oak', x: 1, y: 0, z: 0, rotation: 0, scale: 1 }], roads: { nodes: [], edges: [] }, prefab: true,
    };
    doc.prefabs = [
      { id: 'pf-1', name: 'Grove', createdAt: '2026-10-15T00:00:00Z', preview: null, stamp: piece },
      { id: 'pf-2', name: 'Dry', createdAt: '2026-10-15T00:00:00Z', preview: 'data:image/png;base64,AA', stamp: { ...piece, water: null } },
    ];
    expect(validateMapDocument(doc)).toEqual([]);
    expect(await contentHash(doc)).toBe(hash);
    const bytes = packMapFile(doc);
    expect(Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('prefabs/')).sort()).toEqual([
      'prefabs/0/heights.f32', 'prefabs/0/paint.u8', 'prefabs/0/water.u8', 'prefabs/1/heights.f32', 'prefabs/1/paint.u8',
    ]);
    const { doc: back } = unpackMapFile(bytes);
    expect(back.prefabs).toEqual(doc.prefabs);
    expect(back.prefabs![0].stamp.heights).toBeInstanceOf(Float32Array);
    expect(await contentHash(back)).toBe(hash);
    // A map without prefabs writes no key
    delete back.prefabs;
    expect(JSON.parse(new TextDecoder().decode(unzipSync(packMapFile(back))['map.json']))).not.toHaveProperty('prefabs');
    // A broken prefab is not written and reading leaves it out: the map itself is fine
    doc.prefabs[1].stamp = { ...piece, paint: new Uint8Array(3) };
    expect(validateMapDocument(doc)).toEqual([]);
    expect(soft(doc)).toEqual(['prefab 2: paint does not match its grid; it is left out']);
    expect(unpackMapFile(packMapFile(doc)).doc.prefabs!.map((p) => p.id)).toEqual(['pf-1']);
  });

  it('carries the wave events in the rules and checks their shape (TODO E170)', async () => {
    const doc = sample();
    const hash = await contentHash(doc);
    doc.gameplay = {
      events: [
        { wave: 3, kind: 'message', text: 'The gate opens' },
        { wave: 3, kind: 'objects', ids: ['o1'], show: false },
        { wave: 5, kind: 'weather', weather: 'snow', strength: 0.4 },
        { wave: 6, kind: 'weather', weather: 'storm', strength: 0.8 },
        { wave: 6, kind: 'time', hour: 20.5 },
        { wave: 8, kind: 'portal', spawn: 's1' },
      ],
    };
    expect(validateMapDocument(doc)).toEqual([]);
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.gameplay).toEqual(doc.gameplay);
    expect(await contentHash(back)).not.toBe(hash);
    doc.gameplay.events = [
      { wave: 0, kind: 'message', text: 'x' },
      { wave: 2, kind: 'message', text: '' },
      { wave: 2, kind: 'weather', weather: 'hail' as never },
      { wave: 2, kind: 'time', hour: 30 },
      { wave: 2, kind: 'objects', ids: [], show: true },
      { wave: 2, kind: 'party' } as never,
    ];
    // Each broken event is left out on reading, the map opens with the rest
    doc.gameplay.events.push({ wave: 9, kind: 'time', hour: 6 });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(soft(doc)).toEqual([
      'wave event 1: wave must be a whole number from 1 to 200; it is left out',
      'wave event 2: a message of 1 to 200 characters; it is left out',
      'wave event 3: weather hail is unknown; it is left out',
      'wave event 4: hour must be 0 to 24; it is left out',
      'wave event 5 names 1 to 500 objects; it is left out',
      'wave event 6: kind party is unknown; it is left out',
    ]);
    const read = unpackMapFile(packMapFile(doc));
    expect(read.doc.gameplay?.events).toEqual([{ wave: 9, kind: 'time', hour: 6 }]);
    expect(read.repaired).toHaveLength(6);
  });

  it('carries an image sky, an optional id; an old map has none and keeps its hash (TODO E172)', async () => {
    const doc = sample();
    const hash = await contentHash(doc);
    expect(doc.environment.skyImage).toBeUndefined();
    doc.environment.skyImage = 'starry-night';
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.environment.skyImage).toBe('starry-night');
    expect(await contentHash(back)).not.toBe(hash);
    // Back to procedural: the field goes, the hash is the old map's
    doc.environment = { ...doc.environment, skyImage: undefined };
    expect(await contentHash(doc)).toBe(hash);
    // An id this game does not ship is nothing to set right (procedural here); a non-string goes
    doc.environment.skyImage = 'from-a-newer-game';
    expect(soft(doc)).toEqual([]);
    doc.environment.skyImage = 7 as never;
    expect(validateMapDocument(doc)).toEqual([]);
    expect(soft(doc)).toEqual(['environment skyImage is no sky id; the procedural sky shows']);
  });

  it('carries a planet in the sky, an optional setting; an old map keeps its hash', async () => {
    const doc = sample();
    const hash = await contentHash(doc);
    doc.environment.planet = { azimuth: 20, elevation: 18, size: 9 };
    const { doc: back } = unpackMapFile(packMapFile(doc));
    expect(back.environment.planet).toEqual({ azimuth: 20, elevation: 18, size: 9 });
    doc.environment = { ...doc.environment, planet: undefined };
    expect(await contentHash(doc)).toBe(hash);
    doc.environment.planet = { azimuth: 20, elevation: 18, size: -1 };
    expect(soft(doc)).toEqual(["environment planet needs azimuth, elevation and a size of 0 or more; the look's own shows"]);
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
