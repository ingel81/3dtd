import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogIndex, normalizeCatalog } from '../../map-ops/asset-catalog';
import { LandscapeContext } from '../ops/landscape/landscape-context';
import { ObjectsCommand } from './commands/objects';
import { createMapDocument } from '../../world/custom-map/map-create';
import { packMapFile } from '../../world/custom-map/map-file';
import { addNode, connect, splitEdge } from '../../map-ops/path-graph';
import type { DocChange } from './doc-change';
import { DocMirror, MirrorTracker } from './doc-mirror';
import { EditorDocument } from './editor-document';

function editorWithRoad(): EditorDocument {
  const doc = createMapDocument({ id: 'tx', name: 'Tx', width: 64, depth: 64, ground: 'flat', now: new Date(0) });
  const a = addNode(doc.paths, { x: -20, y: 0 });
  const b = addNode(doc.paths, { x: 20, y: 0 });
  connect(doc.paths, a.id, b.id);
  return new EditorDocument(doc);
}

/** The worker's mirror of `editor`, synced as the worker gets it; returns whether it packs the file the document packs */
function mirrorOf(editor: EditorDocument): () => boolean {
  const tracker = new MirrorTracker(editor);
  const mirror = new DocMirror();
  return () => {
    const { sync, transfer } = tracker.sync();
    mirror.apply(structuredClone(sync, { transfer }));
    return Buffer.from(packMapFile(mirror.doc, { level: 0 })).equals(Buffer.from(packMapFile(editor.doc, { level: 0 })));
  };
}

/** A step kept by a transaction is told whole to what follows the document by its changes (TODO E292) */
describe('what a transaction tells when it is kept', () => {
  it('tells the parts it kept whole, changed in place without a word', () => {
    // The road brush split a road where its line began, then found no road to draw (both ends on the new node)
    const editor = editorWithRoad();
    const mirrored = mirrorOf(editor);
    expect(mirrored()).toBe(true);
    const heard: DocChange[] = [];
    editor.onChange((c) => heard.push(c));
    const tx = editor.begin('Road');
    tx.snapshot('paths');
    splitEdge(editor.doc.paths, editor.doc.paths.edges[0].id, { x: 0, y: 0 });
    tx.commit();
    expect(heard.some((c) => c.paths)).toBe(true);
    // The split road changed in place, which only the change of the roads makes the tracker look for
    expect(mirrored()).toBe(true);
    editor.undo();
    expect(mirrored()).toBe(true);
  });

  it('tells the objects it added, the symmetric images of a stroke too, so no later one takes their ids', () => {
    const editor = editorWithRoad();
    const catalog = new CatalogIndex(normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'));
    // The editor counts its object ids on from the map once it handed one out
    editor.execute(ObjectsCommand.add('Place', editor.doc, [{ id: editor.objectIds.take(), asset: 'bush', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]));
    // A landscape stroke under four-fold symmetry sets an object and tells it: its three images it does not tell
    const stroke = new LandscapeContext(editor.begin('City'), 1, catalog);
    stroke.symmetry = 'rot4';
    const sign = stroke.addObject({ asset: 'street-sign', x: 10, y: 20, z: 0, rotation: 0, scale: 1 });
    stroke.changed({ objects: [sign.id] });
    stroke.finish();
    expect(editor.doc.objects).toHaveLength(5);
    const next = editor.objectIds.take();
    expect(editor.doc.objects.map((o) => o.id)).not.toContain(next);
  });
});
