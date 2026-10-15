import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { contentBytes } from '../../../world/custom-map/map-file';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { heightAt } from '../../model/grid';
import { editRoads, rebuildRoads, setRoadSurface } from '../../tools/path-tool';
import { moveNode, nearestOnPolyline, edgePolyline } from '../path-graph';
import { LandscapeStroke } from './landscape-stroke';
import { DEFAULT_ROAD, buildRoad } from './road';
import { readWeights } from '../paint-ops';
import { DEFAULT_RIVER, carveRiver, moveRiverBed } from './river';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

/** Rolling ground, so a road cuts and fills */
function hills() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 4, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 6 * Math.sin(i / 7) + 4 * Math.cos(j / 9);
  return doc;
}

describe('roads laid anew', () => {
  it('keeps what the road brush built and lays it anew where the road moves, as one step', () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    const plain = doc.terrain.grid.heights.slice();
    const stroke = new LandscapeStroke(editor, 'Road', 1, catalog);
    const result = buildRoad(stroke, [{ x: -150, y: -20 }, { x: 0, y: -20 }, { x: 150, y: -20 }], { ...DEFAULT_ROAD, lamps: true, fences: false });
    stroke.finish();
    expect(result).not.toBeNull();
    const edge = doc.paths.edges.find((e) => e.id === result!.edgeId)!;
    expect(edge.dress).toMatchObject({ adapt: true, lamps: true });
    expect(edge.dress!.objects.length).toBe(result!.lamps);
    expect(result!.lamps).toBeGreaterThan(3);
    const built = contentBytes(doc);
    const g = doc.terrain.grid;
    // The spot on the old east half where the road changed the ground most
    let k = 0;
    for (let x = 90; x <= 140; x += 4) {
      const c = Math.round((-20 + 200) / 4) * g.columns + Math.round((x + 200) / 4);
      if (Math.abs(g.heights[c] - plain[c]) > Math.abs(g.heights[k] - plain[k])) k = c;
    }
    const builtOff = Math.abs(g.heights[k] - plain[k]);
    expect(builtOff).toBeGreaterThan(0.3);

    // The east end moves 100 m north
    const steps = editor.historySteps;
    editRoads(editor, catalog, 'Move node', (paths) => moveNode(paths, edge.b, { x: 150, y: 80 }));
    expect(editor.historySteps).toBe(steps + 1);
    const moved = doc.paths.edges.find((e) => e.id === edge.id)!;
    const line = edgePolyline(doc.paths, moved);
    // Every lamp stands beside the new line, none where the old east half was
    const lamps = doc.objects.filter((o) => moved.dress!.objects.includes(o.id));
    expect(lamps.length).toBeGreaterThan(3);
    for (const l of lamps) expect(nearestOnPolyline(line, l)!.dist).toBeLessThan(DEFAULT_ROAD.width);
    // Where the old road ran, far from the new one, the ground is back near the land before the road
    // exactly, to the millimetre the dress keeps it in
    expect(Math.abs(g.heights[k] - plain[k])).toBeLessThan(0.0006);
    expect(moved.dress!.ground).toBeDefined();

    // Undo puts the road and all it built back exactly
    editor.undo();
    expect(Buffer.from(contentBytes(doc)).equals(Buffer.from(built))).toBe(true);
  });

  it('reads a road without a record off the map when it moves, and rebuilds a plain one on request', () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    const stroke = new LandscapeStroke(editor, 'Road', 1, catalog);
    const result = buildRoad(stroke, [{ x: -150, y: -20 }, { x: 150, y: -20 }], { ...DEFAULT_ROAD, lamps: true });
    stroke.finish();
    const edge = doc.paths.edges.find((e) => e.id === result!.edgeId)!;
    const lamps = edge.dress!.objects.length;
    // As a map of before the dress: no record
    delete edge.dress;
    editRoads(editor, catalog, 'Move node', (paths) => moveNode(paths, edge.b, { x: 150, y: 80 }));
    const moved = doc.paths.edges.find((e) => e.id === edge.id)!;
    expect(moved.dress).toMatchObject({ lamps: true, surface: 'cobblestone' });
    const line = edgePolyline(doc.paths, moved);
    const standing = doc.objects.filter((o) => o.asset === 'lamp-post');
    expect(standing.length).toBeGreaterThanOrEqual(lamps - 2);
    for (const l of standing) expect(nearestOnPolyline(line, l)!.dist).toBeLessThan(DEFAULT_ROAD.width);

    // A plain road from the Roads tool: nothing to read, Rebuild uses the brush's settings
    doc.paths.nodes.push({ id: 'p1', x: -100, y: 120 }, { id: 'p2', x: 100, y: 120 });
    doc.paths.edges.push({ id: 'plain', a: 'p1', b: 'p2', width: 8, kind: 'road' });
    const steps = editor.historySteps;
    rebuildRoads(editor, catalog, ['plain'], { ...DEFAULT_ROAD, lamps: true });
    expect(editor.historySteps).toBe(steps + 1);
    const plain = doc.paths.edges.find((e) => e.id === 'plain')!;
    expect(plain.dress!.objects.length).toBeGreaterThan(3);
    expect(plain.dress!.ground).toBeDefined();
  });

  it("sets a road's own surface at once, keeps it when the dressing is laid anew, as one step", () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    const stroke = new LandscapeStroke(editor, 'Road', 1, catalog);
    const result = buildRoad(stroke, [{ x: -150, y: -20 }, { x: 150, y: -20 }], { ...DEFAULT_ROAD, lamps: true });
    stroke.finish();
    const id = result!.edgeId;
    const edge = () => doc.paths.edges.find((e) => e.id === id)!;
    expect(edge().dress!.surface).toBe('cobblestone');
    const built = contentBytes(doc);
    const lamps = edge().dress!.objects.length;
    // The weight of a material on the road's middle
    const t = doc.terrain;
    const w = new Float32Array(8);
    const weight = (material: string) => {
      const res = t.splat.resolution;
      readWeights(t, Math.floor(((-20 + 200) / 400) * res) * res + Math.floor(0.5 * res), w);
      return w[t.layers.findIndex((l) => l.material === material)] ?? 0;
    };

    const steps = editor.historySteps;
    setRoadSurface(editor, catalog, [id], 'asphalt');
    expect(editor.historySteps).toBe(steps + 1);
    expect(edge().surface).toBe('asphalt');
    expect(edge().dress).toMatchObject({ surface: 'asphalt', lamps: true });
    expect(weight('asphalt')).toBeGreaterThan(250);
    expect(weight('cobblestone')).toBeLessThan(5);

    // Laid anew: still asphalt, the lamps again
    rebuildRoads(editor, catalog, [id], DEFAULT_ROAD);
    expect(edge().surface).toBe('asphalt');
    expect(edge().dress!.objects.length).toBe(lamps);
    expect(weight('asphalt')).toBeGreaterThan(250);

    // None: the drawn road again, the paint stays
    setRoadSurface(editor, catalog, [id], null);
    expect(edge().surface).toBeUndefined();
    expect(edge().dress!.surface).toBeUndefined();

    editor.undo();
    editor.undo();
    editor.undo();
    expect(Buffer.from(contentBytes(doc)).equals(Buffer.from(built))).toBe(true);
  });

  it('gives a road without a record a surface of its own, bridges left out', () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    editRoads(editor, catalog, 'Roads', (paths) => {
      const a = { id: 'n1', x: -100, y: 50 };
      const b = { id: 'n2', x: 100, y: 50 };
      const c = { id: 'n3', x: 100, y: 120 };
      paths.nodes.push(a, b, c);
      paths.edges.push({ id: 'e1', a: 'n1', b: 'n2', width: 8, kind: 'road' }, { id: 'e2', a: 'n2', b: 'n3', width: 8, kind: 'bridge' });
    });
    expect(setRoadSurface(editor, catalog, ['e1', 'e2'], 'gravel')).toBe(1);
    const [e1, e2] = doc.paths.edges;
    expect(e1.surface).toBe('gravel');
    expect(e1.dress).toMatchObject({ adapt: false, surface: 'gravel', lamps: false, fences: false });
    expect(e2.surface).toBeUndefined();
    expect(doc.terrain.layers.some((l) => l.material === 'gravel')).toBe(true);
  });

  it('moves a river bed with its course', () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    const stroke = new LandscapeStroke(editor, 'River', 1, catalog);
    carveRiver(stroke, [{ x: -150, y: 0 }, { x: 0, y: 10 }, { x: 150, y: 0 }], { ...DEFAULT_RIVER, bridges: false, reeds: true });
    stroke.finish();
    const river = doc.terrain.rivers![0];
    const before = structuredClone(doc.terrain.rivers!);
    const mid = Math.floor(river.points.length / 2);
    const old = { ...river.points[mid] };
    // A whole stretch swings 30 m north
    for (let k = mid - 4; k <= mid + 4; k++) river.points[k] = { ...river.points[k], y: river.points[k].y + 30 };
    const relay = new LandscapeStroke(editor, 'Move river point', 1, catalog);
    relay.markRivers();
    moveRiverBed(relay, before[0], river);
    relay.finish();
    // The new course has a bed under its surface, the old one is filled toward the land around it
    const surface = river.points[mid].height;
    expect(heightAt(doc.terrain, river.points[mid].x, river.points[mid].y)).toBeLessThan(surface);
    expect(heightAt(doc.terrain, old.x, old.y)).toBeGreaterThan(old.height - 0.5);
    // Reeds and stones along the new band, as at the first carving, none left out on the filled bed
    const decor = doc.objects.filter((o) => /reed|stone|rock|grass/.test(o.asset));
    expect(decor.length).toBeGreaterThan(10);
    const newPoint = river.points[mid];
    expect(decor.some((o) => Math.hypot(o.x - newPoint.x, o.y - newPoint.y) < newPoint.width + 6)).toBe(true);
    expect(decor.some((o) => Math.hypot(o.x - old.x, o.y - old.y) < old.width / 2 + 1)).toBe(false);
  });
});
