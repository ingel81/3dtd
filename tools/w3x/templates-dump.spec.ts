/**
 * Every editor template on the demo valley's roads, spawns and HQ, as own maps
 * in tmp/w3x-out/ for load measurements (e2e/perf/map-load.ts --seed):
 *   npx vitest run tools/w3x/templates-dump.spec.ts --mode w3x
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { CatalogIndex, normalizeCatalog } from '../../src/app/editor/catalog/asset-catalog';
import { biomeById } from '../../src/app/editor/ops/landscape/biomes';
import { applyTemplate, MAP_TEMPLATES } from '../../src/app/editor/ops/landscape/templates';
import { createMapDocument } from '../../src/app/world/custom-map/map-create';
import { contentHash, packMapFile, unpackMapFile } from '../../src/app/world/custom-map/map-file';
import { summarize } from '../../src/app/world/custom-map/map-store';

const mode = (import.meta as { env?: Record<string, string> }).env?.['MODE'];
const outDir = resolve(__dirname, '../../tmp/w3x-out');

describe.skipIf(mode !== 'w3x')('template maps', () => {
  it('builds every template on the demo valley layout', async () => {
    const catalog = new CatalogIndex(normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'));
    const demo = unpackMapFile(readFileSync(resolve('public/maps/demo-valley.3dtdmap'))).doc;
    mkdirSync(outDir, { recursive: true });
    for (const template of MAP_TEMPLATES) {
      const biome = biomeById(template.biome);
      const base = biome.ground[0].material.find((m) => catalog.materials.has(m))!;
      const t = demo.terrain;
      const doc = createMapDocument({ id: `tpl-${template.id}`, name: `Template ${template.label}`, width: t.width, depth: t.depth, cellSize: t.grid.cellSize, baseMaterial: base, now: new Date(0) });
      await applyTemplate(doc, template, catalog, 7);
      doc.paths = structuredClone(demo.paths);
      doc.spawns = structuredClone(demo.spawns);
      doc.hq = { ...demo.hq };
      writeFileSync(join(outDir, `${doc.meta.id}.3dtdmap`), packMapFile(doc));
      writeFileSync(join(outDir, `${doc.meta.id}.summary.json`), JSON.stringify(summarize(doc, 'own', await contentHash(doc)), null, 1));
      console.log(`${doc.meta.id}: ${t.width} x ${t.depth} m, ${doc.objects.length} objects, ${doc.terrain.layers.length} layers, ${doc.terrain.waterBodies?.length ?? 0} pools`);
    }
  }, 300_000);
});
