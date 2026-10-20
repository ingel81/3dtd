/**
 * The guard's baseline (TODO E245, docs/I18N_PLAN.md 7.2): the English texts
 * still hard-coded, by file, outside the developer and agent areas and the
 * closed ones (scan.mjs CLOSED_AREAS, which have none). The guard
 * (guard.spec.ts) fails on any text not in it; after a package is translated
 * this is run again and the list shrinks.
 *   node tools/i18n/baseline.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { guardedTexts } from './scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const texts = guardedTexts(join(here, '..', '..'));
writeFileSync(join(here, 'baseline.json'), JSON.stringify(texts, null, 1) + '\n');
const count = Object.values(texts).reduce((n, list) => n + list.length, 0);
console.log(`baseline: ${count} texts in ${Object.keys(texts).length} files`);
