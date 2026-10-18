import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../../../map-ops/asset-catalog';
import { biomeById } from './biomes';
import { applyTemplate, MAP_TEMPLATES } from './templates';
import { buffersOf, runTemplateJob } from './template-off-thread';

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
      // Lily pads float out on the swamp's pools, ice floes on the arctic's
      if (template.id === 'swamp') expect(doc.objects.some((o) => o.asset === 'lily-pads')).toBe(true);
      if (biome.pools) expect(doc.terrain.waterBodies?.[0].kind ?? doc.terrain.water?.kind ?? 'water').toBe(biome.water ?? 'water');
    }
  });
});

describe('map templates off the page', () => {
  /** On a 2048 m map the biome held the page for a third of a second in one frame */
  it('builds the same map through the job as in place, the progress told, a structured copy of the map in and out', async () => {
    const template = MAP_TEMPLATES.find((t) => t.id === 'forest') ?? MAP_TEMPLATES[0];
    const base = biomeById(template.biome).ground[0].material.find((m) => catalog.materials.has(m))!;
    const fresh = () => createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 4, baseMaterial: base, now: new Date(0) });
    const inPlace = fresh();
    await applyTemplate(inPlace, template, catalog, 5);
    const shares: number[] = [];
    // What a worker gets: a structured copy, the catalogue's plain data
    const job = structuredClone({ doc: fresh(), template: template.id, catalog: catalog.catalog, seed: 5 });
    const built = await runTemplateJob(job, (done) => shares.push(done));
    expect(structuredClone(built)).toEqual(structuredClone(inPlace));
    expect(shares.at(-1)).toBe(1);
    // The arrays a reply hands over: every one of the terrain's, each once
    const buffers = buffersOf(built.terrain);
    expect(buffers).toContain(built.terrain.grid.heights.buffer);
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});
