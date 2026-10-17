import { medianMs, perfBudget } from '../../../test/perf-budget';
import { createPerfMap } from '../../world/custom-map/perf-map';
import { createMapDocument } from '../../world/custom-map/map-create';
import { moveNode } from '../../map-ops/path-graph';
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

  it('syncs a road node dragged on a network of an OSM world without sending the roads whole', () => {
    // 7 500 nodes and 11 000 edges, as large as an OSM city (Stuttgart 7 508 / 9 745)
    const doc = createMapDocument({ id: 'g', name: 'G', width: 2048, depth: 2048, cellSize: 4, seed: 1, ground: 'flat', relief: 0, now: new Date(0) });
    const n = 87;
    const step = 2000 / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) doc.paths.nodes.push({ id: `n${j * n + i}`, x: -1000 + i * step, y: -1000 + j * step });
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (i + 1 < n) doc.paths.edges.push({ id: `e${doc.paths.edges.length}`, a: `n${j * n + i}`, b: `n${j * n + i + 1}`, width: 6, kind: 'road', via: [{ x: -1000 + (i + 0.5) * step, y: -1000 + j * step + 3 }] });
        if (j + 1 < n && i % 2 === 0) doc.paths.edges.push({ id: `e${doc.paths.edges.length}`, a: `n${j * n + i}`, b: `n${(j + 1) * n + i}`, width: 6, kind: 'road' });
      }
    }
    const editor = new EditorDocument(doc);
    const tracker = new MirrorTracker(editor);
    const mirror = new DocMirror();
    const send = () => {
      const { sync, transfer } = tracker.sync();
      mirror.apply(structuredClone(sync, { transfer }));
      return sync;
    };
    send();
    let k = 0;
    let sync = send();
    const ms = medianMs(() => {
      moveNode(doc.paths, `n${3000 + k}`, { x: doc.paths.nodes[3000 + k].x + 1, y: doc.paths.nodes[3000 + k].y });
      k++;
      editor.emit({ paths: true });
      sync = send();
    }, 15);
    expect(sync.paths?.whole).toBeUndefined();
    expect(mirror.doc.paths.nodes[3000].x).toBe(doc.paths.nodes[3000].x);
    expect(ms).toBeLessThan(perfBudget(4));
  });
});
