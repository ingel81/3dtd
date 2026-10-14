import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_MAP_BYTES } from '../../coop/protocol';
import { createMapDocument } from '../../world/custom-map/map-create';
import { SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { assetCosts, mapBudget, mapSceneCost } from './map-budget';
import { validateMap } from './map-validation';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function mapOf(size: number, assets: Record<string, number>) {
  const doc = createMapDocument({ id: 'm', name: 'M', width: size, depth: size, cellSize: 8, baseMaterial: 'grass', now: new Date(0) });
  let k = 0;
  for (const [asset, n] of Object.entries(assets)) for (let i = 0; i < n; i++) doc.objects.push({ id: `o${k++}`, asset, x: 0, y: 0, z: 0, rotation: 0, scale: 1 });
  return doc;
}

describe('mapBudget', () => {
  it('shows the scene cost in percent with the object count under it, the file against what coop sends', () => {
    const [cost, file] = mapBudget(SCENE_BUDGET * 0.62, 91_600, 6 * 2 ** 20);
    expect(cost).toMatchObject({ label: 'Scene cost', text: '62 %', detail: '91,600 objects', state: 'ok' });
    expect(cost.share).toBeCloseTo(0.62);
    expect(file).toMatchObject({ label: 'File', text: '6.0 MB of 32.0 MB', state: 'ok' });
  });

  it('warns from 80 % and says when a line is over', () => {
    expect(mapBudget(SCENE_BUDGET * 0.79, 0, null)[0].state).toBe('ok');
    expect(mapBudget(SCENE_BUDGET * 0.8, 0, null)[0].state).toBe('warn');
    expect(mapBudget(SCENE_BUDGET, 0, null)[0].state).toBe('warn');
    expect(mapBudget(SCENE_BUDGET * 1.01, 0, null)[0]).toMatchObject({ state: 'over', text: '101 %' });
    expect(mapBudget(0, 0, MAX_MAP_BYTES + 1)[1].state).toBe('over');
    // Before the first save the file's size is not known
    expect(mapBudget(0, 0, null)).toHaveLength(1);
  });
});

describe('mapSceneCost', () => {
  it('lets a Large meadow of 90 000 tufts and flowers stay light, where as many houses would not', () => {
    const meadow = mapOf(2048, { 'grass-clump': 45_000, flowers: 40_000, bush: 5_000, 'tree-oak': 800 });
    expect(mapSceneCost(meadow, catalog) / SCENE_BUDGET).toBeLessThan(0.1);
    const town = mapOf(1024, { house: 3_000 });
    expect(mapSceneCost(town, catalog) / SCENE_BUDGET).toBeGreaterThan(0.8);
  });

  it('counts an asset the catalogue does not know as a mid-sized prop, so an old file still adds up', () => {
    const doc = mapOf(512, { 'no-such-asset': 10 });
    const cost = mapSceneCost(doc, catalog);
    expect(cost).toBeGreaterThan(10 * 100);
    expect(cost).toBeLessThan(10 * 1000);
  });

  it('warns in the map check above 100 %, not below', () => {
    const issues = (doc: ReturnType<typeof mapOf>) => validateMap(doc, { costOf: assetCosts(catalog, doc) }).filter((i) => i.code === 'scene-cost');
    expect(issues(mapOf(1024, { house: 100 }))).toEqual([]);
    const heavy = issues(mapOf(1024, { 'house-large': 2_000 }));
    expect(heavy).toHaveLength(1);
    expect(heavy[0]).toMatchObject({ severity: 'warning' });
    expect(heavy[0].message).toMatch(/^Scene cost \d+ %/);
  });
});
