/**
 * Imports a Warcraft 3 map and writes what came out to tmp/w3x-out/:
 * `<id>.png` (top-down picture), `<id>.json` (the import report),
 * `<id>.3dtdmap` (the map file, for the editor) and `<id>.summary.json`
 * (its map store summary, to seed IndexedDB in browser runs).
 *
 *   npm run w3x-import                       (the test map in tmp/wc3/)
 *   W3X_FILE=path/to/map.w3x npm run w3x-import
 *
 * Runs only in vitest's "w3x" mode, not with the normal test suite.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { contentHash, packMapFile } from '../../src/app/world/custom-map/map-file';
import { summarize } from '../../src/app/world/custom-map/map-store';
import { importW3x } from '../../src/app/world/w3x/import-w3x';
import { findTestMap } from '../../src/test/w3x-fixtures';
import { renderTopDown } from './top-down';

const mode = (import.meta as { env?: Record<string, string> }).env?.['MODE'];
const file = process.env['W3X_FILE'] ?? findTestMap(existsSync) ?? 'tmp/wc3/Mafa-Td-Queen-v14.6.w3x';
const outDir = resolve(__dirname, '../../tmp/w3x-out');

describe.skipIf(mode !== 'w3x')('w3x import dump', () => {
  it.skipIf(!existsSync(file))(`imports ${basename(file)}`, async () => {
    const t0 = performance.now();
    const { doc, report } = await importW3x(new Uint8Array(readFileSync(file)), { fileName: basename(file) });
    const ms = Math.round(performance.now() - t0);
    mkdirSync(outDir, { recursive: true });
    const { png, width, height } = renderTopDown(doc, 2);
    writeFileSync(join(outDir, `${doc.meta.id}.png`), png);
    writeFileSync(join(outDir, `${doc.meta.id}.json`), JSON.stringify({ importMs: ms, ...report }, null, 1));
    writeFileSync(join(outDir, `${doc.meta.id}.3dtdmap`), packMapFile(doc));
    // The map store's summary of it as an own map, for seeding IndexedDB in browser runs
    writeFileSync(join(outDir, `${doc.meta.id}.summary.json`), JSON.stringify(summarize(doc, 'own', await contentHash(doc)), null, 1));
    console.log(`${doc.meta.name}: ${ms} ms, ${width} x ${height} px, strategy ${report.strategy}, out ${outDir}`);
  });
});
