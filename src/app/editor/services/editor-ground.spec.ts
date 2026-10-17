import { createMapDocument } from '../../world/custom-map/map-create';
import { EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { HeightField } from '../../world/custom-map/render/height-field';
import { GroundOcclusion } from '../../world/custom-map/render/terrain/ground-occlusion';
import { farShadowData, lavaSamples } from '../../world/custom-map/render/terrain/ground-shape';
import { contourLines } from '../ops/contours';
import { EditorDocument } from '../model/editor-document';
import { EditorCore } from './editor-core';
import { EditorGround } from './editor-ground';

/** The jobs asked for so far have answered */
const settled = () => new Promise((r) => setTimeout(r, 0));
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, k: number) => v === b[k]);

describe('EditorGround', () => {
  it('works the ground shape, the lava, the far shadow and the height lines out in the worker as in place', async () => {
    const doc = createMapDocument({ id: 'g', name: 'G', width: 256, depth: 256, cellSize: 4, seed: 5, ground: 'noise', relief: 12, now: new Date(0) });
    const mask = new Uint8Array(doc.terrain.grid.heights.length);
    for (let k = 0; k < 300; k++) mask[k * 7] = 255;
    doc.terrain.waterBodies = [{ level: 50, mask, color: '#ff4400', kind: 'lava' }];
    const editor = new EditorDocument(doc);
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const ground = new EditorGround(core);
    const field = new HeightField(doc.terrain.grid, doc.terrain.width, doc.terrain.depth);
    const here = new GroundOcclusion(field);
    const there = new GroundOcclusion(field);
    there.baker = ground;
    // A hill raised: in place and by the worker
    const rect = { i0: 20, j0: 24, i1: 34, j1: 30 };
    const g = doc.terrain.grid;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) g.heights[j * g.columns + i] += 9;
    editor.emit({ heights: rect });
    here.updateTerrain(rect);
    there.updateTerrain(rect);
    await settled();
    expect(same(there['pixels'], here['pixels'])).toBe(true);
    // Two hills far apart, asked one after the other: neither gives way to the other
    for (const r of [{ i0: 2, j0: 2, i1: 8, j1: 8 }, { i0: 50, j0: 52, i1: 58, j1: 60 }]) {
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) g.heights[j * g.columns + i] += 6;
      editor.emit({ heights: r });
      here.updateTerrain(r);
      there.updateTerrain(r);
    }
    await settled();
    await settled();
    expect(same(there['pixels'], here['pixels'])).toBe(true);
    // All of it, with the drainage
    here.updateTerrain();
    there.updateTerrain();
    await settled();
    expect(same(there['pixels'], here['pixels'])).toBe(true);
    here.setLava(lavaSamples(doc.terrain, field));
    const lava = await ground.lava();
    expect(lava!.any).toBe(true);
    there.setLavaCloseness(lava!.closeness);
    expect(same(there['pixels'], here['pixels'])).toBe(true);
    const sun = { x: 0.6, y: 0.4, z: -0.2 };
    const shadow = await ground.farShadow(sun);
    expect(same(shadow!.data, farShadowData(field, sun, 256, 256).data)).toBe(true);
    const lines = await ground.contours(5);
    const want = contourLines(doc.terrain, 5);
    expect(same(lines!.minor, want.minor) && same(lines!.major, want.major)).toBe(true);
    core.dispose();
    expect(await ground.lava()).toBeNull();
  });
});
