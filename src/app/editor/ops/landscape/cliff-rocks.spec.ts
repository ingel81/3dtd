import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { heightAt } from '../../model/grid';
import { emptyWater } from '../water-ops';
import { CLIFF_MODELS, cliffModelIds, cliffModelsFor, cliffRocksDab } from './cliff-rocks';
import { LandscapeStroke } from './landscape-stroke';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

/** A map with a 20 m step running north-south at x = 0: high in the west */
function stepMap() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, starter: false });
  const g = doc.terrain.grid;
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const x = -128 + i * 2;
      g.heights[j * g.columns + i] = 20 / (1 + Math.exp(x / 2.5));
    }
  }
  return doc;
}

describe('cliff rocks', () => {
  it('stands walls along a steep edge, faced to the low side, and none on flat ground', () => {
    const doc = stepMap();
    const editor = new EditorDocument(doc);
    const stroke = new LandscapeStroke(editor, 'Cliff rocks', 5, catalog);
    const models = cliffModelsFor(undefined, 'auto', catalog);
    expect(models.length).toBeGreaterThan(0);
    const brush = { radius: 40, strength: 1, falloff: 0.2 };
    for (const y of [-60, -30, 0, 30, 60]) cliffRocksDab(stroke, { x: 0, y }, brush, models, catalog);
    const walls = doc.objects;
    expect(walls.length).toBeGreaterThan(3);
    for (const w of walls) {
      expect(Math.abs(w.x)).toBeLessThan(10);
      expect(models).toContain(w.asset);
      // Facing east (downhill): north turned to east
      expect(Math.abs(Math.sin(w.rotation) + 1)).toBeLessThan(0.1);
      expect(w.scale).toBeGreaterThanOrEqual(0.5);
      // Standing from below its spot on the step (the foot of the drop it covers) to over it
      const ground = heightAt(doc.terrain, w.x, w.y);
      expect(w.z).toBeLessThan(-1);
      expect(ground + w.z + catalog.object(w.asset).height * w.scale).toBeGreaterThan(ground);
    }
    // Flat ground in the east takes none
    const before = doc.objects.length;
    cliffRocksDab(stroke, { x: 90, y: 0 }, brush, models, catalog);
    expect(doc.objects.length).toBe(before);
    // One undo step for the stroke
    stroke.finish();
    expect(editor.historySteps).toBe(1);
    editor.undo();
    expect(doc.objects).toHaveLength(0);
  });

  it('stands none in the water at the cliff foot', () => {
    const doc = stepMap();
    doc.terrain.water = emptyWater(doc.terrain, 13);
    doc.terrain.water.mask.fill(1);
    const stroke = new LandscapeStroke(new EditorDocument(doc), 'Cliff rocks', 5, catalog);
    const models = cliffModelsFor(undefined, 'auto', catalog);
    for (const y of [-60, -30, 0, 30, 60]) cliffRocksDab(stroke, { x: 0, y }, { radius: 40, strength: 1, falloff: 0.2 }, models, catalog);
    expect(doc.objects.length).toBeGreaterThan(0);
    for (const w of doc.objects) expect(heightAt(doc.terrain, w.x, w.y)).toBeGreaterThanOrEqual(13);
  });

  it('keeps one colouring a list: tinted walls without the grey ones', () => {
    expect(CLIFF_MODELS.desert).toEqual(['cliff-wall-sandstone']);
    expect(CLIFF_MODELS.hell).toEqual(['cliff-wall-basalt']);
    expect(CLIFF_MODELS.mars).toEqual(['mars-cliff', 'cliff-face-red']);
  });

  it('picks the models of the map look or the one chosen', () => {
    expect(cliffModelsFor('desert', 'auto', catalog)[0]).toBe('cliff-wall-sandstone');
    expect(cliffModelsFor('mars', 'auto', catalog)[0]).toBe('mars-cliff');
    expect(cliffModelsFor(undefined, 'cliff-coast', catalog)).toEqual(['cliff-coast']);
    expect(cliffModelIds(catalog)).toContain('cliff-wall-basalt');
  });
});
