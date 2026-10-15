// Measures the ground rectangle of every building and wall model: the middle
// (model x, z) and the half sides of its bounds at scale 1, each times
// BOX_SHARE like the catalogue's footprint radius (eaves overhang). A long
// building's footprint radius is half its length, a circle that reached far
// past its sides (a 46 m school: 21 m, over the street); the game and the
// editor block building and seat the model by this turned rectangle instead.
// Writes tools/map-assets/boxes.json, which update_catalog.py puts into the
// catalogue as `box`.
//
//   node tools/map-assets/measure_boxes.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

/** Share of the half extent that counts as occupied ground (update_catalog.py's footprint share for buildings and walls) */
const BOX_SHARE = 0.9;
const CATEGORIES = new Set(['building', 'wall']);

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_boxes.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const objects = JSON.parse(readFileSync(join(here, 'objects.json'), 'utf8'));
const out = {};
for (const o of objects) {
  if (!CATEGORIES.has(o.category) || o.file === '') continue;
  const { root } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  root.updateMatrixWorld(true);
  const b = new Box3().setFromObject(root, true);
  const r = (x) => Math.round(x * 10) / 10 || 0;
  out[o.id] = [r((b.min.x + b.max.x) / 2), r((b.min.z + b.max.z) / 2), r(((b.max.x - b.min.x) / 2) * BOX_SHARE), r(((b.max.z - b.min.z) / 2) * BOX_SHARE)];
}
// One line per model: "id": [middle x, middle z, half width, half depth]
const lines = Object.entries(out).map(([id, b]) => `  ${JSON.stringify(id)}: ${JSON.stringify(b)}`);
writeFileSync(join(here, 'boxes.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'models measured');
