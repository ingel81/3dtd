/**
 * Map templates for a new map: a terrain from the generator, the whole map
 * painted with one biome (ground, relief, pools, objects) and the
 * renderer's look for sky, light, haze and particles. The starting point for themed maps.
 */
import type { CustomMapDocument, MapEnvironment } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../../map-ops/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { finishGenerated, generateTerrain, type TerrainPreset } from '../../../map-ops/generate';
import { biomeBand } from './biome-brush';
import { biomeById, type BiomeId } from './biomes';
import { LandscapeContext } from './landscape-context';

export type MapTemplateId = 'meadows' | 'woods' | 'mountains' | 'swamp' | 'desert' | 'arctic' | 'city' | 'hell' | 'wasteland' | 'moon' | 'mars';

/** A template; its name and hint are the dictionary's (i18n `editor.templates`) */
export interface MapTemplate {
  id: MapTemplateId;
  biome: BiomeId;
  terrain: TerrainPreset;
  /** 0..1, how high and rough the terrain */
  strength: number;
  /** The renderer's look sets sky colours, haze and particles; this adds sky, sun and weather */
  environment: Partial<MapEnvironment>;
  /** No water from the generator (a dry canyon) */
  dry?: boolean;
  /**
   * Scales the biome's own relief over the whole map (default 1): a brush
   * stroke of ridges is a range, the same ridges everywhere a field of pits
   */
  relief?: number;
}

export const MAP_TEMPLATES: readonly MapTemplate[] = [
  {
    id: 'meadows',
    biome: 'meadow',
    terrain: 'hills',
    strength: 0.5,
    environment: { biome: 'temperate', sky: 'day' },
  },
  {
    id: 'woods',
    biome: 'forest',
    terrain: 'valleys',
    strength: 0.6,
    environment: { biome: 'temperate', sky: 'day' },
  },
  {
    id: 'mountains',
    biome: 'mountains',
    // Broad hills under the biome's ridges: sharp valleys on top made the whole map a field of pits
    terrain: 'hills',
    strength: 0.9,
    relief: 0.3,
    environment: { biome: 'mountain', sky: 'day', sunElevation: 35 },
  },
  {
    id: 'swamp',
    biome: 'swamp',
    terrain: 'flat',
    strength: 0.3,
    environment: { biome: 'swamp', sky: 'overcast' },
  },
  {
    id: 'desert',
    biome: 'desert',
    terrain: 'hills',
    strength: 0.4,
    environment: { biome: 'desert', sky: 'day', sunElevation: 60 },
  },
  {
    id: 'arctic',
    biome: 'arctic',
    terrain: 'hills',
    strength: 0.3,
    environment: { biome: 'arctic', sky: 'overcast', weather: 'snow', weatherStrength: 0.3 },
  },
  {
    id: 'city',
    biome: 'city',
    terrain: 'flat',
    strength: 0.2,
    environment: { biome: 'city', sky: 'dusk', sunElevation: 20 },
  },
  {
    id: 'hell',
    biome: 'hell',
    terrain: 'hills',
    strength: 0.3,
    environment: { biome: 'hell', sky: 'day' },
  },
  {
    id: 'wasteland',
    biome: 'wasteland',
    terrain: 'hills',
    strength: 0.3,
    environment: { biome: 'apocalypse', sky: 'overcast' },
  },
  {
    id: 'moon',
    biome: 'moon',
    terrain: 'flat',
    strength: 0.2,
    environment: { biome: 'moon', sky: 'day', sunElevation: 25 },
  },
  {
    id: 'mars',
    biome: 'mars',
    terrain: 'canyon',
    strength: 0.7,
    dry: true,
    environment: { biome: 'mars', sky: 'day' },
  },
];

export function templateById(id: string): MapTemplate | undefined {
  return MAP_TEMPLATES.find((t) => t.id === id);
}

/** Metres of map painted between two pauses */
const BAND = 48;

/**
 * Builds a template into a fresh map: terrain, biome over all of it, mood.
 * Paints in bands and awaits `pause` between them (so a page stays
 * responsive), reporting the share done.
 */
export async function applyTemplate(
  doc: CustomMapDocument,
  template: MapTemplate,
  catalog: CatalogIndex,
  seed: number,
  pause: (done: number) => Promise<void> = async () => undefined,
): Promise<void> {
  const t = doc.terrain;
  if (template.terrain !== 'flat') {
    const generated = generateTerrain(t, {
      preset: template.terrain,
      seed,
      strength: template.strength,
    });
    finishGenerated(
      doc,
      template.dry ? { ...generated, water: null } : generated,
      () => false,
      false,
    );
  }
  doc.environment = { ...doc.environment, ...template.environment };
  const editor = new EditorDocument(doc);
  const own = biomeById(template.biome);
  const scale = template.relief ?? 1;
  const biome = scale === 1 || !own.relief ? own : { ...own, relief: { ...own.relief, amplitude: own.relief.amplitude * scale } };
  const stroke = new LandscapeContext(editor.begin(editor.words().editor.landscape.biomes[biome.id].label), seed, catalog);
  for (let y = -t.depth / 2; y < t.depth / 2; y += BAND) {
    biomeBand(stroke, biome, y, Math.min(t.depth / 2, y + BAND));
    await pause(Math.min(1, (y + t.depth / 2 + BAND) / t.depth));
  }
  stroke.finish();
}
