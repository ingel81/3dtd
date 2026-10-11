/**
 * Map templates for a new map: a terrain from the generator, the whole map
 * painted with one biome (ground, relief, pools, objects) and a mood for
 * sky, light, fog and weather. The starting point for themed maps.
 */
import type { CustomMapDocument, MapEnvironment } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../catalog/asset-catalog';
import { EditorDocument } from '../../model/editor-document';
import { finishGenerated, generateTerrain, type TerrainPreset } from '../generate';
import { biomeBand } from './biome-brush';
import { biomeById, type BiomeId } from './biomes';
import { LandscapeStroke } from './landscape-stroke';

export interface MapTemplate {
  id: string;
  label: string;
  hint: string;
  biome: BiomeId;
  terrain: TerrainPreset;
  /** 0..1, how high and rough the terrain */
  strength: number;
  environment: Partial<MapEnvironment>;
}

export const MAP_TEMPLATES: readonly MapTemplate[] = [
  {
    id: 'meadows',
    label: 'Meadows',
    hint: 'Rolling green hills under a summer sky',
    biome: 'meadow',
    terrain: 'hills',
    strength: 0.5,
    environment: { biome: 'temperate', sky: 'day' },
  },
  {
    id: 'woods',
    label: 'Woods',
    hint: 'Forested valleys',
    biome: 'forest',
    terrain: 'valleys',
    strength: 0.6,
    environment: { biome: 'temperate', sky: 'day', fogDensity: 0.0008 },
  },
  {
    id: 'mountains',
    label: 'Mountains',
    hint: 'High ridges, scree and lone pines',
    biome: 'mountains',
    terrain: 'valleys',
    strength: 0.9,
    environment: { biome: 'mountain', sky: 'day', sunElevation: 35 },
  },
  {
    id: 'swamp',
    label: 'Swamp',
    hint: 'Murky pools, reeds and dead trees in the mist',
    biome: 'swamp',
    terrain: 'flat',
    strength: 0.3,
    environment: {
      biome: 'swamp',
      sky: 'overcast',
      fogDensity: 0.0025,
      tint: '#c8d2b0',
      weather: 'fog',
      weatherStrength: 0.5,
    },
  },
  {
    id: 'desert',
    label: 'Desert',
    hint: 'Dunes and wind-cut rocks in a hot haze',
    biome: 'desert',
    terrain: 'hills',
    strength: 0.4,
    environment: {
      biome: 'desert',
      sky: 'day',
      sunElevation: 60,
      tint: '#fff0d8',
      fogDensity: 0.0006,
    },
  },
  {
    id: 'arctic',
    label: 'Arctic',
    hint: 'Ice, drifts and frozen pools in falling snow',
    biome: 'arctic',
    terrain: 'hills',
    strength: 0.5,
    environment: {
      biome: 'arctic',
      sky: 'overcast',
      tint: '#dce8f0',
      weather: 'snow',
      weatherStrength: 0.5,
      fogDensity: 0.0012,
    },
  },
  {
    id: 'city',
    label: 'City',
    hint: 'A street grid with blocks, at dusk',
    biome: 'city',
    terrain: 'flat',
    strength: 0.2,
    environment: { biome: 'city', sky: 'dusk', sunElevation: 12 },
  },
  {
    id: 'hell',
    label: 'Hell',
    hint: 'Cinders, lava pools and glowing cracks under a black sky',
    biome: 'hell',
    terrain: 'terraces',
    strength: 0.6,
    environment: { biome: 'hell', sky: 'night', tint: '#ffb08c', fogDensity: 0.0015 },
  },
  {
    id: 'wasteland',
    label: 'Wasteland',
    hint: 'Rubble, craters and smoke after the end',
    biome: 'wasteland',
    terrain: 'hills',
    strength: 0.3,
    environment: {
      biome: 'apocalypse',
      sky: 'overcast',
      tint: '#d8cbb0',
      fogDensity: 0.0015,
      weather: 'fog',
      weatherStrength: 0.3,
    },
  },
  {
    id: 'moon',
    label: 'Moon',
    hint: 'A cratered plain in hard light under black sky',
    biome: 'moon',
    terrain: 'flat',
    strength: 0.2,
    environment: { biome: 'moon', sky: 'night', sunElevation: 25, fogDensity: 0, tint: '#e8eaf0' },
  },
  {
    id: 'mars',
    label: 'Mars',
    hint: 'Rust dunes and a canyon in dusty light',
    biome: 'mars',
    terrain: 'canyon',
    strength: 0.7,
    environment: { biome: 'mars', sky: 'day', tint: '#ffc8a8', fogDensity: 0.001 },
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
    finishGenerated(
      doc,
      generateTerrain(t, { preset: template.terrain, seed, strength: template.strength }),
      () => false,
      false,
    );
  }
  doc.environment = { ...doc.environment, ...template.environment };
  const editor = new EditorDocument(doc);
  const biome = biomeById(template.biome);
  const stroke = new LandscapeStroke(editor, biome.label, seed, catalog);
  for (let y = -t.depth / 2; y < t.depth / 2; y += BAND) {
    biomeBand(stroke, biome, y, Math.min(t.depth / 2, y + BAND));
    await pause(Math.min(1, (y + t.depth / 2 + BAND) / t.depth));
  }
  stroke.finish();
}
