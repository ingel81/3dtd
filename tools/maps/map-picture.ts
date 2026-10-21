/**
 * The list picture of a shipped map: the maps' one picture
 * (src/app/map-ops/map-picture.ts) in the catalogue's colours, read from
 * the catalogue file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { mapPicturePng, pictureColours } from '../../src/app/map-ops/map-picture';

export function mapPicture(doc: CustomMapDocument, size: number, catalogPath: string): Uint8Array {
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), 'utf8')) as { materials: { id: string; average?: string }[] };
  return mapPicturePng(doc, pictureColours(catalog.materials), size);
}
