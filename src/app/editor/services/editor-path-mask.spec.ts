import { createMapDocument } from '../../world/custom-map/map-create';
import { EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { addNode, connect, moveNode } from '../../map-ops/path-graph';
import { pathMaskResolution, rasterizePathMask, type RoadCover } from '../../world/custom-map/render/paths/path-mask';
import { EditorDocument } from '../model/editor-document';
import type { PathMaskRect } from '../workers/path-mask-job';
import { EditorCore } from './editor-core';
import { EditorPathMask, type PathMaskView } from './editor-path-mask';

/** The jobs asked for so far have answered */
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('EditorPathMask', () => {
  it('keeps the view mask as the whole map painted anew, from the texels the worker sends', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 192, cellSize: 4, seed: 2, ground: 'noise', relief: 4, now: new Date(0) });
    const a = addNode(doc.paths, { x: -80, y: 0 });
    const b = addNode(doc.paths, { x: 80, y: 10 });
    const c = addNode(doc.paths, { x: 0, y: 70 });
    connect(doc.paths, a.id, b.id, 8, 'road');
    connect(doc.paths, b.id, c.id, 3, 'path');
    doc.terrain.rivers = [{ id: 'r1', kind: 'water', points: [{ x: -100, y: -60, width: 6, height: 0 }, { x: 0, y: -50, width: 8, height: 0 }, { x: 100, y: -70, width: 6, height: 0 }] }];
    let covers: RoadCover[] = [{ id: 'k1', line: [{ x: -80, y: 0 }, { x: 80, y: 10 }], half: 3 }];
    const t = doc.terrain;
    const res = pathMaskResolution(t.width, t.depth);
    const whole = () => rasterizePathMask(doc.paths, t.width, t.depth, res, t.rivers ?? [], covers);
    // The view's mask, painted with the map
    const mask = whole();
    const rects: PathMaskRect[] = [];
    const view: PathMaskView = {
      roadCovers: () => covers,
      setPathMask: (r) => {
        rects.push(r);
        const row = (r.rect.i1 - r.rect.i0 + 1) * 4;
        for (let j = r.rect.j0; j <= r.rect.j1; j++) mask.set(r.data.subarray((j - r.rect.j0) * row, (j - r.rect.j0 + 1) * row), (j * res + r.rect.i0) * 4);
        return true;
      },
    };
    const editor = new EditorDocument(doc);
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const masks = new EditorPathMask(core);
    masks.built(view);
    await settled();
    // Primed: nothing comes back
    expect(rects).toHaveLength(0);
    // A node dragged: only the texels round it come back
    moveNode(doc.paths, b.id, { x: 60, y: 30 });
    editor.emit({ paths: true });
    masks.changed();
    await settled();
    expect(rects).toHaveLength(1);
    const r = rects[0].rect;
    expect((r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1)).toBeLessThan(res * res * 0.4);
    expect(Buffer.from(mask).equals(Buffer.from(whole()))).toBe(true);
    // A river bent, a cover gone and one come
    doc.terrain.rivers = [{ ...doc.terrain.rivers[0], points: doc.terrain.rivers[0].points.map((p) => ({ ...p, y: p.y + 12 })) }];
    covers = [{ id: 'k2', line: [{ x: 0, y: 70 }, { x: 60, y: 30 }], half: 1 }];
    editor.emit({ water: true });
    masks.changed();
    await settled();
    expect(Buffer.from(mask).equals(Buffer.from(whole()))).toBe(true);
    // Two changes before the worker ran: the newer one paints both
    moveNode(doc.paths, a.id, { x: -90, y: -5 });
    editor.emit({ paths: true });
    masks.changed();
    moveNode(doc.paths, c.id, { x: 10, y: 80 });
    editor.emit({ paths: true });
    masks.changed();
    await settled();
    expect(Buffer.from(mask).equals(Buffer.from(whole()))).toBe(true);
    core.dispose();
  });
});
