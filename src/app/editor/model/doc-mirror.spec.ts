import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../world/custom-map/map-create';
import { packFootprints } from '../../world/custom-map/map-footprints';
import { packMapFile } from '../../world/custom-map/map-file';
import { EditorDocument } from './editor-document';
import { DocMirror, MirrorTracker } from './doc-mirror';

/** An OSM world's footprints in the editor's worker mirror (TODO E290): there for its saves, sent once */
describe('the mirror and the footprints an OSM world keeps', () => {
  it('sends them with the first sync only and packs the file the document packs', () => {
    const doc = createMapDocument({ id: 'osm-test', name: 'OSM test', width: 64, depth: 64, ground: 'flat', now: new Date('2026-10-21T00:00:00Z') });
    doc.footprints = packFootprints([{ points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }], levels: 2, kind: 'ground' }]);
    const editor = new EditorDocument(doc);
    const tracker = new MirrorTracker(editor);
    const mirror = new DocMirror();
    const send = () => {
      const { sync, transfer } = tracker.sync();
      mirror.apply(structuredClone(sync, { transfer }));
      return sync;
    };

    const first = send();
    expect(first.footprints).toBe(doc.footprints);
    expect(first.shell.footprints).not.toBe(doc.footprints);
    expect(Array.from(mirror.doc.footprints!.rings)).toEqual(Array.from(doc.footprints.rings));
    expect(mirror.doc.footprints!.rings).not.toBe(doc.footprints.rings);

    editor.emit({ meta: true });
    expect(send().footprints).toBeUndefined();
    expect(packMapFile(mirror.doc, { level: 0 })).toEqual(packMapFile(editor.doc, { level: 0 }));
  });
});
