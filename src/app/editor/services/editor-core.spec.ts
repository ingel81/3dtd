import { createMapDocument } from '../../world/custom-map/map-create';
import { packForSave } from '../../world/custom-map/map-pack';
import { EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { ObjectsCommand } from '../model/commands/objects';
import { SnapshotCommand } from '../model/commands/snapshot';
import { EditorDocument } from '../model/editor-document';
import { EditorCore } from './editor-core';

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

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

  it('says an invalid map as the page would: a MapFileError with its problems', async () => {
    const editor = editorOf();
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    editor.doc.terrain.width = -1;
    await expect(core.run('pack', { options: {}, hash: false })).rejects.toMatchObject({ name: 'MapFileError' });
    core.dispose();
  });
});
