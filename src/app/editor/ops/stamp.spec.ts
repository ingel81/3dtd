import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import { MemoryStampBackend, StampLibrary } from '../model/stamp-store';
import { LandscapeStroke } from './landscape/landscape-stroke';
import { dominantLayer, paintDab } from './paint-ops';
import { ALL_PARTS, capturePrefab, captureStamp, pasteStamp, stampBounds } from './stamp';
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

  it('pastes a piece with groups into groups of its own, never those of where it came from', () => {
    const ed = source();
    ed.doc.objects.push({ id: 'o2', asset: 'tree-oak', x: -105, y: 100, z: 0, rotation: 0, scale: 1, group: 'g1' }, { id: 'o3', asset: 'tree-oak', x: -100, y: 105, z: 0, rotation: 0, scale: 1, group: 'g1' });
    const stamp = captureStamp(ed.doc, { x0: -130, y0: 70, x1: -70, y1: 130 });
    for (const at of [{ x: 100, y: 100 }, { x: 100, y: -100 }]) {
      const stroke = new LandscapeStroke(ed, 'Paste', 0, catalog);
      pasteStamp(stroke, stamp, at, { parts: ALL_PARTS, rotation: 0, feather: 0.2 });
      stroke.finish();
    }
    const groups = ed.doc.objects.map((o) => o.group ?? '-');
    // The original pair in g1, each paste's pair in a new group, the loose tree loose
    expect(groups).toEqual(['-', 'g1', 'g1', '-', 'g2', 'g2', '-', 'g3', 'g3']);
  });
});

describe('prefabs', () => {
  function village(): EditorDocument {
    const ed = source();
    ed.doc.objects.push(
      { id: 'h1', asset: 'house', x: 60, y: -40, z: 0, rotation: 0.5, scale: 1 },
      { id: 'h2', asset: 'tree-oak', x: 70, y: -40, z: 0, rotation: 0, scale: 1.5, tint: '#ff8800' },
      { id: 'far', asset: 'tree-oak', x: 66, y: -30, z: 0, rotation: 0, scale: 1 },
    );
    return ed;
  }
  const radius = (asset: string) => catalog.object(asset).radius;

  it('takes the selected objects only, around the middle of their footprints, without the ground unless asked', () => {
    const ed = village();
    const taken = capturePrefab(ed.doc, ['h1', 'h2'], false, radius)!;
    const st = taken.stamp;
    expect(st.prefab).toBe(true);
    expect(st.parts).toEqual({ heights: false, paint: false, water: false, objects: true, roads: false });
    expect(st.objects.map((o) => o.asset)).toEqual(['house', 'tree-oak']);
    // The rectangle holds both footprints and the margin; the objects sit relative to its middle
    expect(taken.rect.x0).toBeLessThan(60 - radius('house'));
    expect(taken.rect.x1).toBeGreaterThan(70 + radius('tree-oak') * 1.5);
    const cx = (taken.rect.x0 + taken.rect.x1) / 2;
    expect(st.objects[0].x).toBeCloseTo(60 - cx, 2);
    expect(st.objects[1]).toMatchObject({ scale: 1.5, tint: '#ff8800' });
    expect(st.roads.edges).toEqual([]);
    expect(st.materials).toEqual([]);
    const withGround = capturePrefab(ed.doc, ['h1'], true, radius)!.stamp;
    expect(withGround.parts?.heights).toBe(true);
    expect(withGround.materials.length).toBeGreaterThan(0);
    expect(capturePrefab(ed.doc, ['nothing'], false, radius)).toBeNull();
  });

  it('puts a prefab down as one group, leaves the ground alone without it, and is one undo step', () => {
    const ed = village();
    const prefab = capturePrefab(ed.doc, ['h1', 'h2'], false, radius)!.stamp;
    raiseDab(ed.doc.terrain, 100, 100, { radius: 30, strength: 1, falloff: 0 }, 6);
    const before = heightAt(ed.doc.terrain, 100, 100);
    const count = ed.doc.objects.length;
    const stroke = new LandscapeStroke(ed, 'Paste', 0, catalog);
    pasteStamp(stroke, prefab, { x: 100, y: 100 }, { parts: ALL_PARTS, rotation: Math.PI, feather: 0.25 });
    stroke.finish();
    const placed = ed.doc.objects.slice(count);
    expect(placed.map((o) => o.asset)).toEqual(['house', 'tree-oak']);
    expect(new Set(placed.map((o) => o.group)).size).toBe(1);
    expect(placed[0].group).toMatch(/^g\d+$/);
    // Turned half round: the tree east of the house now stands west of it
    expect(placed[1].x).toBeLessThan(placed[0].x);
    expect(heightAt(ed.doc.terrain, 100, 100)).toBeCloseTo(before, 5);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(count);
  });
});
