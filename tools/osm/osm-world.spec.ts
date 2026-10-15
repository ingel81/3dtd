/**
 * Makes OSM worlds (src/app/world/osm) from data downloaded before, and
 * writes what came out to tmp/osm-out/: `<id>.3dtdmap` (the map file),
 * `<id>.summary.json` (its map store summary, to seed IndexedDB for
 * e2e/perf/map-load.ts --seed), `<id>.json` (the report with the editor
 * check's time and findings) and `<id>.png` (top-down picture).
 *
 *   OSM_RAW=<dir> OSM_PLACES="miltenberg:49.7036,9.2647 stuttgart:48.7784,9.18" \
 *     npx vitest run tools/osm/osm-world.spec.ts --mode osm --silent=false
 *
 * <dir> holds per place `<name>.json` (the Overpass answer of osmWorldQuery)
 * and `dem/<name>-mapterhorn-z14.json` with `.f32` (a DemMosaic's fields and
 * its heights, Float32 little endian); a place without the heights is flat.
 * Runs only in vitest's "osm" mode, not with the normal test suite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { contentHash, packMapFile } from '../../src/app/world/custom-map/map-file';
import { summarize } from '../../src/app/world/custom-map/map-store';
import { convertOsm } from '../../src/app/world/osm/import-osm';
import type { DemMosaic } from '../../src/app/world/osm/dem-tiles';
import { validateMap } from '../../src/app/editor/validation/map-validation';
import { renderTopDown } from '../w3x/top-down';

const mode = (import.meta as { env?: Record<string, string> }).env?.['MODE'];
const raw = process.env['OSM_RAW'] ?? '';
const places = (process.env['OSM_PLACES'] ?? '').split(/\s+/).filter(Boolean).map((p) => {
  const [name, at] = p.split(':');
  const [lat, lon] = at.split(',').map(Number);
  return { name, lat, lon };
});
const outDir = resolve(__dirname, '../../tmp/osm-out');

function readMosaic(name: string): DemMosaic | null {
  const base = join(raw, 'dem', `${name}-mapterhorn-z14`);
  if (!existsSync(`${base}.json`)) return null;
  const meta = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const bytes = readFileSync(`${base}.f32`);
  const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { source: meta.source, zoom: meta.zoom, tileSize: meta.tileSize, left: meta.x0 * meta.tileSize, top: meta.y0 * meta.tileSize, columns: meta.columns, rows: meta.rows, heights };
}

describe.skipIf(mode !== 'osm')('OSM world dump', () => {
  for (const place of places) {
    it(`makes ${place.name}`, async () => {
      const overpass = JSON.parse(readFileSync(join(raw, `${place.name}.json`), 'utf8'));
      const t0 = performance.now();
      const { doc, report } = convertOsm(
        { lat: place.lat, lon: place.lon, address: place.name, overpass, dem: readMosaic(place.name), fetchedAt: new Date().toISOString() },
        { id: `osm-${place.name}`, name: `OSM ${place.name}` },
      );
      const convertMs = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const file = packMapFile(doc);
      const packMs = Math.round(performance.now() - t1);
      const t2 = performance.now();
      const issues = validateMap(doc);
      const checkMs = Math.round(performance.now() - t2);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${doc.meta.id}.3dtdmap`), file);
      writeFileSync(join(outDir, `${doc.meta.id}.summary.json`), JSON.stringify(summarize(doc, 'own', await contentHash(doc)), null, 1));
      writeFileSync(join(outDir, `${doc.meta.id}.png`), renderTopDown(doc, 0.5).png);
      const out = { convertMs, packMs, checkMs, fileBytes: file.length, issues: issues.map((i) => `${i.severity} ${i.code}: ${i.message}`), ...report };
      writeFileSync(join(outDir, `${doc.meta.id}.json`), JSON.stringify(out, null, 1));
      console.log(JSON.stringify({ place: place.name, convertMs, packMs, checkMs, fileMB: +(file.length / 1e6).toFixed(2), ms: report.ms, roads: report.roads, layout: report.layout, issues: out.issues, warnings: report.warnings }, null, 1));
    }, 600_000);
  }
});
