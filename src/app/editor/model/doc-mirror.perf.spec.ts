import { medianMs, perfBudget } from '../../../test/perf-budget';
import { createPerfMap } from '../../world/custom-map/perf-map';
import { EditorDocument } from './editor-document';
import { DocMirror, MirrorTracker } from './doc-mirror';

/**
 * What a save costs the page's thread on a big map (1025 height samples a
 * side, 50 000 objects) since the editor's worker mirrors the map: the sync
 * of a stroke's tiles and an object moved, sent as a worker gets it. Before,
 * the whole map went over by structured clone with every save.
 */
describe('the mirror on a big map', () => {
  it('syncs a stroke and a moved object in a few milliseconds', () => {
    const editor = new EditorDocument(createPerfMap(1025, 50_000));
    const tracker = new MirrorTracker(editor);
    const mirror = new DocMirror();
    const send = () => {
      const { sync, transfer } = tracker.sync();
      mirror.apply(structuredClone(sync, { transfer }));
    };
    send();
    const doc = editor.doc;
    const g = doc.terrain.grid;
    let k = 0;
    const ms = medianMs(() => {
      // A 32 m dab's samples and one object moved, then the sync a save sends
      const i0 = 100 + (k++ % 50) * 8;
      for (let j = 400; j < 416; j++) for (let i = i0; i < i0 + 16; i++) g.heights[j * g.columns + i] += 0.1;
      editor.emit({ heights: { i0, j0: 400, i1: i0 + 15, j1: 415 } });
      const at = (k * 977) % doc.objects.length;
      doc.objects[at] = { ...doc.objects[at], x: doc.objects[at].x + 0.5 };
      editor.emit({ objects: [doc.objects[at].id] });
      send();
    }, 15);
    expect(mirror.doc.objects.length).toBe(doc.objects.length);
    expect(ms).toBeLessThan(perfBudget(4));
  });
});
