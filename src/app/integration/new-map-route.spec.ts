/**
 * A map fresh from the editor has a route in the game: its starter road
 * runs from the spawn at one end to the HQ at the other, blank or under any
 * template. The game drops a path of fewer than two points as no route
 * (PathAndRouteService), so a route of the start node alone left the map
 * without enemies and the bot's trial without a result (2026-10-11).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../world/custom-map/map-create';
import { CustomMapStreets } from '../world/custom-map/custom-map-streets';
import { mapToGeo, type CustomMapDocument } from '../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from '../editor/catalog/asset-catalog';
import { biomeById } from '../editor/ops/landscape/biomes';
import { applyTemplate, MAP_TEMPLATES } from '../editor/ops/landscape/templates';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

/** Each spawn's route to the HQ as map metres, the HQ's x last */
async function routes(doc: CustomMapDocument): Promise<{ x: number; y: number }[][]> {
  const streets = new CustomMapStreets(doc);
  const network = await streets.loadStreets();
  const hq = mapToGeo(doc.hq);
  return doc.spawns.map((s) => {
    const from = mapToGeo(s);
    return streets.findPath(network, from.lat, from.lon, hq.lat, hq.lon).map((n) => ({ x: n.lon * 111320, y: n.lat * 111320 }));
  });
}

describe('a new map from the editor', () => {
  it('routes its spawn to the HQ, blank and under every template', async () => {
    const blank = createMapDocument({ id: 'blank', name: 'Blank', width: 512, depth: 512, now: new Date(0) });
    const docs: [string, CustomMapDocument][] = [['blank', blank]];
    for (const template of MAP_TEMPLATES) {
      const base = biomeById(template.biome).ground[0].material.find((m) => catalog.materials.has(m))!;
      const doc = createMapDocument({ id: template.id, name: template.id, width: 256, depth: 256, cellSize: 4, baseMaterial: base, now: new Date(0) });
      await applyTemplate(doc, template, catalog, 5, async () => undefined);
      docs.push([template.id, doc]);
    }
    for (const [name, doc] of docs) {
      expect(doc.spawns.length, name).toBeGreaterThan(0);
      for (const route of await routes(doc)) {
        // Two points at least, from the spawn to the HQ's foot on its road
        expect(route.length, name).toBeGreaterThanOrEqual(2);
        expect(Math.hypot(route[0].x - doc.spawns[0].x, route[0].y - doc.spawns[0].y), name).toBeLessThan(1);
        const last = route[route.length - 1];
        expect(Math.hypot(last.x - doc.hq.x, last.y - doc.hq.y), name).toBeLessThan(10);
      }
    }
  });
});
