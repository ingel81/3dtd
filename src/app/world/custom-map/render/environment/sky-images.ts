import type { MapEnvironment } from '../../map-document';
import { mapDataFetch, mapDataUrl } from '../../map-data';
import { DEFAULT_ASSET_BASE } from '../map-asset-library';
import rawSkies from '../../../../../../public/maps/assets/skies/skies.json';

/**
 * Image skies (E172): photographed skies from Poly Haven (CC0) a map can
 * take instead of the procedural dome. `tools/map-assets/build_skies.py`
 * writes the pictures (the upper hemisphere, equirect, sRGB WebP) and
 * `skies.json` with what the renderer needs before a picture has loaded:
 * the sky preset whose lights it takes, the direction and colour of its sun
 * and its mean colours at the zenith, at the horizon and over the
 * hemisphere (linear). A map names one in `environment.skyImage`; without
 * it, or with an id this game does not ship, the sky is procedural.
 *
 * The map keeps its sun: the picture turns about the vertical so its sun
 * stands at the map's sun azimuth (`skyImageYaw`). Choosing a picture sets
 * the sun's elevation to the picture's (`chooseSkyImage`); the map maker
 * may still raise it, the visible sun stays where the picture has it.
 */

export interface SkyImage {
  id: string;
  label: string;
  /** The sky preset whose lights, exposure and darkness the picture takes */
  preset: MapEnvironment['sky'];
  file: string;
  width: number;
  height: number;
  source: string;
  /** Where the picture's sun or moon stands (degrees, azimuth from north clockwise); null: none shows */
  sun: { azimuth: number; elevation: number } | null;
  /** Linear RGB, brightest channel 1 */
  sunColor: [number, number, number] | null;
  /** Mean colours (linear): above 60 degrees, between 0 and 8 degrees, the whole hemisphere */
  zenith: [number, number, number];
  horizon: [number, number, number];
  sky: [number, number, number];
}

export const SKY_IMAGES: readonly SkyImage[] = (rawSkies as { skies: SkyImage[] }).skies;

/** The map's image sky, or null for the procedural one (no field, or an id this game does not ship) */
export function skyImageOf(env: Pick<MapEnvironment, 'skyImage'>): SkyImage | null {
  return env.skyImage ? (SKY_IMAGES.find((s) => s.id === env.skyImage) ?? null) : null;
}

/**
 * How far (radians) the picture turns so its sun stands at the map's sun
 * azimuth; a picture without a sun turns with the azimuth from north. Added
 * to a direction's atan(z, x) before the lookup (three's equirect
 * convention: the angle grows with the map azimuth).
 */
export function skyImageYaw(image: SkyImage, sunAzimuth: number): number {
  return (((image.sun?.azimuth ?? 0) - sunAzimuth) * Math.PI) / 180;
}

/**
 * The environment change for choosing a sky: a picture brings its preset
 * (lights, darkness, moonlight at night) and the elevation of its sun
 * (at least 2 degrees, the editor's lowest); null goes back to the
 * procedural sky and leaves the rest as it is.
 */
export function chooseSkyImage(id: string | null): Partial<MapEnvironment> {
  const image = id ? SKY_IMAGES.find((s) => s.id === id) : undefined;
  if (!image) return { skyImage: undefined };
  const patch: Partial<MapEnvironment> = { skyImage: image.id, sky: image.preset };
  if (image.sun) patch.sunElevation = Math.round(Math.min(90, Math.max(2, image.sun.elevation)));
  return patch;
}

/** The picture's file, through the map data's cache like every map file (map-data.ts) */
export async function fetchSkyImage(image: SkyImage): Promise<Blob> {
  const res = await mapDataFetch(mapDataUrl(`${DEFAULT_ASSET_BASE}skies/${image.file}`));
  if (!res.ok) throw new Error(`HTTP ${res.status} for sky ${image.id}`);
  return res.blob();
}

/**
 * The Earth over moon maps (E194): NASA's Blue Marble with clouds,
 * equirect 1024 x 512, sRGB, alpha where the sun glints on open sea
 * (`tools/map-assets/build_planet.py`). Loaded only for a map that shows a
 * planet (`planetOf`).
 */
export const PLANET_IMAGE = { file: 'earth.webp', source: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57735/land_ocean_ice_cloud_2048.jpg' } as const;

/** The planet's picture, through the map data's cache like the image skies */
export async function fetchPlanetImage(): Promise<Blob> {
  const res = await mapDataFetch(mapDataUrl(`${DEFAULT_ASSET_BASE}skies/${PLANET_IMAGE.file}`));
  if (!res.ok) throw new Error(`HTTP ${res.status} for planet ${PLANET_IMAGE.file}`);
  return res.blob();
}
