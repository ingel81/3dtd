import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import { MemoryStampBackend, StampLibrary } from '../model/stamp-store';
import { LandscapeStroke } from './landscape/landscape-stroke';
import { dominantLayer, paintDab } from './paint-ops';
import { ALL_PARTS, captureStamp, pasteStamp, stampBounds } from './stamp';
import { raiseDab } from './terrain-ops';
import { emptyWater } from './water-ops';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function source(): EditorDocument {
  const ed = new EditorDocument(createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 2, starter: false, now: new Date(0) }));
  const t = ed.doc.terrain;
  // A hill with sand and a pond and a tree at (-100, 100)
  raiseDab(t, -100, 100, { radius: 20, strength: 1, falloff: 0.6 }, 8);
  t.layers.push({ material: 'sand' });
  paintDab(t, -100, 100, { radius: 10, strength: 1, falloff: 0 }, 1, 1);
  t.water = emptyWater(t, -0.5);
  t.water.mask.fill(255, 0, 10);
  ed.doc.objects.push({ id: 'o1', asset: 'tree-oak', x: -95, y: 100, z: 0, rotation: 0, scale: 1 });
  ed.doc.paths = { nodes: [{ id: 'n1', x: -110, y: 90 }, { id: 'n2', x: -90, y: 90 }, { id: 'n3', x: 0, y: 0 }], edges: [{ id: 'e1', a: 'n1', b: 'n2', width: 6, kind: 'road', dress: { adapt: true, lamps: true, fences: false, objects: ['o1'] } }, { id: 'e2', a: 'n2', b: 'n3', width: 6, kind: 'road' }] };
  return ed;
}

describe('stamps', () => {
  it('copies heights relative to the rim, paint by material, objects and inner roads', () => {
    const ed = source();
    const stamp = captureStamp(ed.doc, { x0: -130, y0: 70, x1: -70, y1: 130 });
    expect(stamp.width).toBe(60);
    expect(Math.max(...stamp.heights)).toBeGreaterThan(6);
    expect(stamp.materials).toEqual(['grass', 'sand']);
    expect(stamp.objects).toHaveLength(1);
    expect(stamp.objects[0]).toMatchObject({ asset: 'tree-oak', x: 5, y: 0 });
    // e2 leaves the rectangle: only e1 comes along
    expect(stamp.roads.edges.map((e) => e.id)).toEqual(['e1']);
    // Without the road brush's record, whose objects and kept ground are of this place
    expect(stamp.roads.edges[0].dress).toBeUndefined();
  });

  it('pastes turned onto another map as one undo step, the hill on the ground there', () => {
    const stamp = captureStamp(source().doc, { x0: -130, y0: 70, x1: -70, y1: 130 });
    const target = new EditorDocument(createMapDocument({ id: 't', name: 'T', width: 400, depth: 400, cellSize: 2, starter: false, now: new Date(0) }));
    raiseDab(target.doc.terrain, 0, 0, { radius: 200, strength: 1, falloff: 0 }, 20);
    const stroke = new LandscapeStroke(target, 'Paste', 0, catalog);
    pasteStamp(stroke, stamp, { x: 50, y: 50 }, { parts: ALL_PARTS, rotation: Math.PI / 2, feather: 0.2 });
    stroke.finish();
    const t = target.doc.terrain;
    expect(heightAt(t, 50, 50)).toBeGreaterThan(26);
    expect(t.layers.map((l) => l.material)).toContain('sand');
    expect(dominantLayer(t, 50, 50)).toBe(t.layers.findIndex((l) => l.material === 'sand'));
    // The tree 5 m east of the middle, turned a quarter, stands 5 m north
    expect(target.doc.objects[0]).toMatchObject({ x: 50, y: 55, rotation: 1.571 });
    expect(target.doc.paths.edges).toHaveLength(1);
    expect(target.doc.paths.edges[0].dress).toBeUndefined();
    expect(target.historySteps).toBe(1);
    target.undo();
    expect(target.doc.objects).toHaveLength(0);
    expect(target.doc.paths.edges).toHaveLength(0);
    expect(heightAt(t, 50, 50)).toBeCloseTo(20, 4);
  });

  it('bounds a turned stamp', () => {
    const stamp = captureStamp(source().doc, { x0: -130, y0: 70, x1: -70, y1: 110 });
    const b = stampBounds(stamp, { x: 0, y: 0 }, Math.PI / 2);
    expect(b.x1 - b.x0).toBeCloseTo(40);
    expect(b.y1 - b.y0).toBeCloseTo(60);
  });

  it('keeps a library of named stamps', async () => {
    const lib = new StampLibrary(new MemoryStampBackend());
    const stamp = captureStamp(source().doc, { x0: -130, y0: 70, x1: -70, y1: 130 });
    const a = await lib.save('Hill', stamp, null, new Date(1000));
    await lib.save('Pond', stamp, null, new Date(2000));
    expect((await lib.list()).map((s) => s.name)).toEqual(['Pond', 'Hill']);
    await lib.rename(a, 'Big hill');
    await lib.delete((await lib.list())[0].id);
    expect((await lib.list()).map((s) => s.name)).toEqual(['Big hill']);
  });
});
