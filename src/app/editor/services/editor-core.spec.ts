import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { packForSave } from '../../world/custom-map/map-pack';
import { CatalogIndex, EMPTY_CATALOG, normalizeCatalog } from '../../map-ops/asset-catalog';
import { addNode, connect, spawnRoutes } from '../../map-ops/path-graph';
import { buildAreaInput, computeBuildAreas } from '../../map-ops/validation/build-areas';
import { assetCosts } from '../../map-ops/validation/map-budget';
import { validateMap } from '../../map-ops/validation/map-validation';
import { ObjectsCommand } from '../model/commands/objects';
import { SnapshotCommand } from '../model/commands/snapshot';
import { EditorDocument } from '../model/editor-document';
import { EditorCore } from './editor-core';
import { runTerrainJob } from '../workers/terrain-job';

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function editorOf(): EditorDocument {
  return new EditorDocument(createMapDocument({ id: 'core', name: 'Core', width: 256, depth: 256, cellSize: 4, seed: 3, ground: 'noise', relief: 6, now: new Date(0) }));
}

describe('EditorCore', () => {
  it('packs the map in its worker byte for byte as the map packed on the page, hash and summary included', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const check = async (level: 1 | 6, hash: boolean) => {
      const packed = await core.run('pack', { options: { level }, hash });
      const want = await packForSave({ doc: structuredClone(editor.doc), options: { level }, hash });
      expect(same(packed!.value.file, want.file)).toBe(true);
      expect(packed!.value.sum).toBe(want.sum);
      expect(packed!.value.summary).toEqual(want.summary);
      expect(packed!.state).toBe(editor.stateId);
    };
    await check(6, true);
    // Edits between the saves reach the worker as tiles and patches
    const g = editor.doc.terrain.grid;
    const tx = editor.begin('Raise');
    tx.touch('heights', { i0: 3, j0: 4, i1: 20, j1: 9 });
    for (let j = 4; j <= 9; j++) for (let i = 3; i <= 20; i++) g.heights[j * g.columns + i] += 2;
    tx.changed({ heights: { i0: 3, j0: 4, i1: 20, j1: 9 } });
    tx.commit();
    editor.execute(ObjectsCommand.add('Place', editor.doc, [{ id: 'o1', asset: 'house', x: 4, y: 5, z: 0, rotation: 0, scale: 1 }]));
    editor.execute(SnapshotCommand.record(editor.doc, 'Environment', ['environment'], (d) => (d.environment = { ...d.environment, fogDensity: 0.001 })));
    editor.doc.meta.updatedAt = new Date(1000).toISOString();
    await check(1, false);
    editor.undo();
    await check(6, true);
    core.dispose();
  });

  it('a result knows the parts it was worked out on', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const packed = await core.run('pack', { options: {}, hash: false });
    expect(core.current(packed!.versions, ['objects', 'terrain'])).toBe(true);
    editor.execute(ObjectsCommand.add('Place', editor.doc, [{ id: 'o1', asset: 'house', x: 4, y: 5, z: 0, rotation: 0, scale: 1 }]));
    expect(core.current(packed!.versions, ['objects'])).toBe(false);
    expect(core.current(packed!.versions, ['terrain'])).toBe(true);
    core.dispose();
  });

  it('still packs a save asked for as the map closes, and starts over with the next map', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    await core.run('pack', { options: {}, hash: false });
    const leaving = core.run('pack', { options: {}, hash: false });
    core.close();
    expect((await leaving)!.state).toBe(editor.stateId);
    const late = await core.run('pack', { options: {}, hash: false });
    expect(late!.state).toBe(editor.stateId);
    editor.replace(createMapDocument({ id: 'next', name: 'Next', width: 128, depth: 128, cellSize: 4, seed: 9, ground: 'noise', relief: 3, now: new Date(0) }));
    core.open(editor, EMPTY_CATALOG);
    const next = await core.run('pack', { options: {}, hash: true });
    expect(next!.value.summary.id).toBe('next');
    expect(same(next!.value.file, (await packForSave({ doc: editor.doc, options: {} })).file)).toBe(true);
    core.dispose();
  });

  it('checks the map and judges its build areas as the page did, the newest check of a kind winning', async () => {
    const editor = editorOf();
    const doc = editor.doc;
    // A road from a spawn to the HQ, a house beside it
    const a = addNode(doc.paths, { x: -80, y: 0 });
    const b = addNode(doc.paths, { x: 80, y: 0 });
    connect(doc.paths, a.id, b.id, 8, 'road');
    doc.spawns = [{ id: 's1', name: 'North', x: -80, y: 0 }];
    doc.hq = { x: 80, y: 0 };
    editor.execute(ObjectsCommand.add('Place', doc, [{ id: 'o1', asset: 'house', x: 0, y: 20, z: 0, rotation: 0, scale: 1 }]));
    const core = new EditorCore();
    core.open(editor, catalog.catalog);
    const routes = spawnRoutes(doc);
    const areas = computeBuildAreas(buildAreaInput(doc, (asset) => catalog.object(asset), doc.spawns.map((s) => ({ spawnId: s.id, name: s.name, points: routes.get(s.id)?.points ?? null }))));
    const judged = await core.run('buildAreas', {});
    // The raster came over from the worker's realm (a structured clone): held as numbers
    const plain = (a: typeof areas) => ({ ...a, kind: Array.from(a.kind) });
    expect(plain(judged!.value)).toEqual(plain(areas));
    const options = {
      blocksBuild: (asset: string) => catalog.object(asset).blocksBuild,
      roadThrough: (asset: string) => !!catalog.object(asset).roadThrough,
      footingOf: (asset: string) => catalog.object(asset).footing,
      costOf: assetCosts(catalog, doc),
    };
    // Asked twice before it ran: the first gives way to the second
    const first = core.run('check', { areas: true });
    const second = core.run('check', { areas: true });
    expect(await first).toBeNull();
    expect((await second)!.value).toEqual(validateMap(doc, { ...options, buildAreas: areas }));
    expect((await core.run('check', { areas: false }))!.value).toEqual(validateMap(doc, options));
    // A copy of the map (an agent's dry run), sent whole
    const copy = structuredClone(doc);
    copy.spawns = [];
    expect((await core.run('check', { areas: false, doc: copy }))!.value).toEqual(validateMap(copy, options));
    core.dispose();
  });

  it('runs a terrain job on its mirror slice by slice, the same as on the page, and stops when told to', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const g = editor.doc.terrain.grid;
    const want = runTerrainJob({ kind: 'erode', columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights.slice(), seed: 4, strength: 0.4 + 0.6 * 0.5, drops: Math.round(g.columns * g.rows * (0.15 + 0.85 * 0.5)) });
    let last: Float32Array | null = null;
    for (const m of want) if (m.kind === 'heights') last = m.heights;
    let got: Float32Array | null = null;
    await core.terrain({ kind: 'erode', strength: 0.5, seed: 4 }, (m) => {
      if (m.kind === 'heights') got = m.heights;
    });
    expect(same(new Uint8Array(got!.buffer), new Uint8Array(last!.buffer))).toBe(true);
    // The map itself is untouched: the job worked on copies
    expect(editor.doc.terrain.grid.heights).toBe(g.heights);
    const stop = new AbortController();
    let seen = 0;
    const run = core.terrain({ kind: 'generate', options: { preset: 'hills', seed: 1, strength: 0.5 } }, () => {
      if (++seen === 1) stop.abort();
    }, stop.signal);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toBe(1);
    core.dispose();
  });

  it('says an invalid map as the page would: a MapFileError with its problems', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    editor.doc.terrain.width = -1;
    await expect(core.run('pack', { options: {}, hash: false })).rejects.toMatchObject({ name: 'MapFileError' });
    core.dispose();
  });
});
