import type { OwnTileset } from '../tileset/own-tileset';

/**
 * Where a TilesWorld's tiles come from, with what it needs for it: Cesium
 * Ion and the Google Map Tiles API serve the same Google Photorealistic 3D
 * Tiles behind credentials; an own tileset is a georeferenced 3D Tiles set
 * at a plain URL (no key), covering one area (docs/OWN_TILESETS.md).
 */
export type TileSource =
  | { kind: 'cesium'; token: string; assetId: string }
  | { kind: 'google'; apiKey: string }
  | { kind: 'own'; tileset: OwnTileset };

/**
 * The height the ReorientationPlugin puts on (0, 0, 0) for an origin
 * height: an own tileset with `heightOffsetM` stands that much higher.
 */
export function reorientationHeight(source: TileSource, height: number): number {
  return source.kind === 'own' ? height - (source.tileset.heightOffsetM ?? 0) : height;
}
