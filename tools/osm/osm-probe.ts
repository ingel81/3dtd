/**
 * The frozen OSM world probe (src/app/integration/fixtures/osm/README.md,
 * OSM worlds): Miltenberg, a 1.2 km square, its Overpass answer and heights
 * as convertOsm reads them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { DemMosaic } from '../../src/app/world/osm/dem-tiles';
import type { OsmImportInput } from '../../src/app/world/osm/import-osm';

/** Side of the probe's square, metres */
export const OSM_PROBE_SIDE = 1200;

export function osmProbe(): OsmImportInput {
  const dir = join(__dirname, '../../src/app/integration/fixtures/osm');
  const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString('utf8'));
  const over = read('world-miltenberg.overpass.json.gz');
  const dem = read('world-miltenberg.dem.json.gz');
  const bytes = Buffer.from(dem.heights, 'base64');
  const raw = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const mosaic: DemMosaic = {
    source: dem.source, zoom: dem.zoom, tileSize: dem.tileSize, left: dem.left, top: dem.top, columns: dem.columns, rows: dem.rows,
    heights: Float32Array.from(raw, (v) => v * dem.unit),
  };
  return { lat: over.place.lat, lon: over.place.lon, address: 'Miltenberg', overpass: { elements: over.elements }, dem: mosaic, fetchedAt: over.source.fetchedAt };
}
