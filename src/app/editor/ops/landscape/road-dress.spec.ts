import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { contentBytes } from '../../../world/custom-map/map-file';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { heightAt } from '../../model/grid';
import { editRoads } from '../../tools/path-tool';
import { moveNode, nearestOnPolyline, edgePolyline } from '../path-graph';
import { LandscapeStroke } from './landscape-stroke';
import { DEFAULT_ROAD, buildRoad } from './road';
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
    expect(Math.abs(g.heights[k] - plain[k])).toBeLessThan(builtOff * 0.6);

    // Undo puts the road and all it built back exactly
    editor.undo();
    expect(Buffer.from(contentBytes(doc)).equals(Buffer.from(built))).toBe(true);
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
