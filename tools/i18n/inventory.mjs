/**
 * The player-facing texts by area (TODO E245, docs/I18N_PLAN.md).
 *   node tools/i18n/inventory.mjs            table by area
 *   node tools/i18n/inventory.mjs --files    plus the files of each area
 *   node tools/i18n/inventory.mjs --area hud the texts of one area
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inventory, scanSources } from './scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const rows = inventory(scanSources(root));
const area = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;

if (area) {
  for (const f of rows.find((r) => r.area.id === area)?.files ?? []) {
    console.log(`\n${f.file}`);
    for (const t of f.texts) console.log(`  ${t}`);
    for (const t of f.errors) console.log(`  [Error] ${t}`);
  }
} else {
  const pad = (v, n) => String(v).padStart(n);
  console.log(`${'Bereich'.padEnd(64)} ${pad('Texte', 6)} ${pad('eindeutig', 9)} ${pad('Wörter', 7)} ${pad('Error()', 7)} ${pad('Dateien', 7)}`);
  const total = { texts: 0, unique: new Set(), words: 0, errors: 0, files: 0 };
  for (const r of rows) {
    console.log(`${(r.area.label + ` [${r.area.id}]`).padEnd(64)} ${pad(r.texts, 6)} ${pad(r.unique.size, 9)} ${pad(r.words, 7)} ${pad(r.errors, 7)} ${pad(r.files.length, 7)}`);
    total.texts += r.texts; total.words += r.words; total.errors += r.errors; total.files += r.files.length;
    r.unique.forEach((t) => total.unique.add(t));
    if (args.includes('--files')) {
      for (const f of [...r.files].sort((a, b) => b.texts.length - a.texts.length)) console.log(`    ${pad(f.texts.length, 4)}  ${f.file}`);
    }
  }
  console.log(`${'Summe'.padEnd(64)} ${pad(total.texts, 6)} ${pad(total.unique.size, 9)} ${pad(total.words, 7)} ${pad(total.errors, 7)} ${pad(total.files, 7)}`);
}
