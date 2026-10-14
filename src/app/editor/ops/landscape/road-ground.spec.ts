import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { edgePolyline } from '../path-graph';
import { LandscapeStroke } from './landscape-stroke';
import { DEFAULT_ROAD, buildRoad, undressEdge } from './road';
import { bandSamples, packGround, unpackGround } from './road-ground';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function hills(cellSize = 2) {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 512, depth: 512, cellSize, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 12 * Math.sin((i * cellSize) / 31) + 7 * Math.cos((j * cellSize) / 23);
  return doc;
}

describe('road ground', () => {
  it('packs the band before and after levelling and reads it back to the millimetre', () => {
    const doc = hills();
    const g = doc.terrain.grid;
    const line = [{ x: -150, y: 0 }, { x: 150, y: 10 }];
    const samples = bandSamples(g, doc.terrain.width, doc.terrain.depth, line, 16);
    const before = Float32Array.from(samples, (k) => g.heights[k]);
    for (const k of samples) g.heights[k] += 1.234;
    const ground = packGround(g, samples, before);
    const back = unpackGround(g, ground)!;
    expect(back.map((s) => s.k)).toEqual(samples);
    back.forEach((s, n) => {
      expect(Math.abs(s.before - before[n])).toBeLessThan(0.0006);
      expect(Math.abs(s.built - g.heights[s.k])).toBeLessThan(0.0006);
    });
    // Another grid (resized, refined): not used
    expect(unpackGround({ ...g, columns: g.columns + 1 }, ground)).toBeNull();
  });

  it('a 300 m road on a 2 m grid keeps its ground in about 12 kB of text and gives it back to the millimetre', () => {
    const doc = hills();
    const editor = new EditorDocument(doc);
    const plain = doc.terrain.grid.heights.slice();
    const stroke = new LandscapeStroke(editor, 'Road', 1, catalog);
    const result = buildRoad(stroke, [{ x: -150, y: 0 }, { x: 0, y: 5 }, { x: 150, y: 0 }], { ...DEFAULT_ROAD, lamps: false });
    stroke.finish();
    const edge = doc.paths.edges.find((e) => e.id === result!.edgeId)!;
    const text = edge.dress!.ground!.data.length;
    expect(text).toBeGreaterThan(8000);
    expect(text).toBeLessThan(16000);
    // Take it back: every sample of the band as before
    const line = edgePolyline(doc.paths, edge);
    const back = new LandscapeStroke(editor, 'Unbuild', 1, catalog);
    undressEdge(back, edge, line);
    back.finish();
    const g = doc.terrain.grid;
    let worst = 0;
    for (let k = 0; k < g.heights.length; k++) worst = Math.max(worst, Math.abs(g.heights[k] - plain[k]));
    expect(worst).toBeLessThan(0.0006);
  });
});
