import type { WorldCoverage } from '../world-coverage';

/**
 * An own tileset: any georeferenced 3D Tiles set at a plain URL (no key),
 * covering one area. Listed in environment.ts or runtime-config.json
 * (`ownTilesets`), played through `?world=tileset:<id>` (docs/OWN_TILESETS.md),
 * e.g. `{ id: 'kalasatama', name: 'Helsinki Kalasatama', url:
 * 'http://localhost:4310/kalasatama/tileset/tileset.json', attribution:
 * 'Helsingin kaupunki, CC BY 4.0', center: { lat: 60.18449, lon: 24.97745 },
 * radiusM: 1400 }`.
 */
export interface OwnTileset {
  id: string;
  /** As the game names the world (else the id) */
  name: string;
  /** The tileset.json (or the root file of the set) */
  url: string;
  /** Shown where the map attribution stands */
  attribution: string;
  /** The area the set covers: HQ and spawns stay inside */
  coverage: WorldCoverage;
  /** Metres the set is lifted, for heights in another datum than the ellipsoid (default 0) */
  heightOffsetM?: number;
  /**
   * Factor on the set's geometric errors, so they read as Google's do
   * (default 1); see GeometricErrorScalePlugin. Kalasatama: 10
   */
  geometricErrorScale?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseOwnTileset(raw: unknown): OwnTileset | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const center = t['center'] as Record<string, unknown> | undefined;
  if (typeof t['id'] !== 'string' || !t['id'] || typeof t['url'] !== 'string' || !t['url']) return null;
  if (!center || !isFiniteNumber(center['lat']) || !isFiniteNumber(center['lon'])) return null;
  if (Math.abs(center['lat']) > 90 || Math.abs(center['lon']) > 180) return null;
  if (!isFiniteNumber(t['radiusM']) || t['radiusM'] <= 0) return null;
  const tileset: OwnTileset = {
    id: t['id'],
    name: typeof t['name'] === 'string' && t['name'] ? t['name'] : t['id'],
    url: t['url'],
    attribution: typeof t['attribution'] === 'string' ? t['attribution'] : '',
    coverage: { center: { lat: center['lat'], lon: center['lon'] }, radiusM: t['radiusM'] },
  };
  if (isFiniteNumber(t['heightOffsetM'])) tileset.heightOffsetM = t['heightOffsetM'];
  if (isFiniteNumber(t['geometricErrorScale']) && t['geometricErrorScale'] > 0) {
    tileset.geometricErrorScale = t['geometricErrorScale'];
  }
  return tileset;
}

/**
 * The own tilesets of a config source (`ownTilesets`), unchecked as they
 * come: `{ id, name?, url, attribution?, center: { lat, lon }, radiusM,
 * heightOffsetM?, geometricErrorScale? }`. An entry without id, url, center
 * or a positive radius is dropped with a warning, so one broken entry does
 * not take the others with it.
 */
export function parseOwnTilesets(raw: unknown): OwnTileset[] {
  if (!Array.isArray(raw)) return [];
  const tilesets: OwnTileset[] = [];
  for (const entry of raw) {
    const tileset = parseOwnTileset(entry);
    if (tileset) tilesets.push(tileset);
    else console.warn('[Config] ownTilesets: entry dropped, it needs id, url, center {lat, lon} and radiusM > 0', entry);
  }
  return tilesets;
}
