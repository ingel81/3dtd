import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../../catalog/asset-catalog';
import { biomeById } from './biomes';
import { applyTemplate, MAP_TEMPLATES } from './templates';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

describe('map templates', () => {
  it('build every template into a small map: biome ground, objects, mood', async () => {
    for (const template of MAP_TEMPLATES) {
      const biome = biomeById(template.biome);
      const base = biome.ground[0].material.find((m) => catalog.materials.has(m))!;
      const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 4, baseMaterial: base, now: new Date(0) });
      let steps = 0;
      await applyTemplate(doc, template, catalog, 5, async () => void steps++);
      expect(steps).toBeGreaterThan(0);
      expect(doc.objects.length, template.id).toBeGreaterThan(5);
      expect(doc.terrain.layers.length).toBeLessThanOrEqual(8);
      expect(doc.terrain.layers[0].material).toBe(base);
      expect(doc.environment).toMatchObject(template.environment);
      if (biome.pools) expect(doc.terrain.waterBodies?.[0].kind ?? doc.terrain.water?.kind ?? 'water').toBe(biome.water ?? 'water');
    }
  });
});
