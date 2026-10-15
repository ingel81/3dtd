// Measures the underside of every rock model: half its width (model x) and
// depth (model z) over the vertices within a hand's breadth of its lowest
// point, and how far that point lies below the pivot (some models reach into
// the ground by design). Scanned boulders are cut flat underneath, and that
// plate reaches well past the catalogue's footprint (the heap `rock-large`:
// footprint 1.8 m, plate 7.4 by 3.6 m); settling a rock on a slope needs the
// plate. Set pieces (NO_PLATE) get none. Writes tools/map-assets/bases.json,
// which update_catalog.py puts into the catalogue as `base`.
//
//   node tools/map-assets/measure_bases.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

/** Vertices this close above the lowest one count as the underside: 8 % of the height, at most 15 cm */
const BAND_SHARE = 0.08;
const BAND_MAX = 0.15;
/**
 * Set pieces that do not rest on a plate: rings and pools around a hollow, an
 * arch over a road, cliff pieces leaning into a slope, landforms and ice in the
 * sea. They keep their place as the author set it
 */
const NO_PLATE = new Set([
  'crater-rim',
  'mars-crater-rim',
  'lava-pool',
  'oasis-pool',
  'rock-arch',
  'rock-arch-large',
  'rock-coast',
  'cliff-face',
  'cliff-face-b',
  'cliff-wall',
  'cliff-wall-b',
  'cliff-wall-sandstone',
  'cliff-wall-basalt',
  'cliff-coast',
  'mars-cliff',
  'mesa',
  'iceberg',
  'glacier',
  'snowfield',
]);

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_bases.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
// The objects as a person lists them (objects.json); the packed models next to the catalogue
const objects = JSON.parse(readFileSync(join(here, 'objects.json'), 'utf8'));
const out = {};
const v = new Vector3();
for (const o of objects) {
  if (o.category !== 'rock' || o.file === '' || o.float || NO_PLATE.has(o.id)) continue;
  const { root } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  root.updateMatrixWorld(true);
  const points = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) points.push(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).toArray());
  });
  let low = Infinity;
  let high = -Infinity;
  for (const p of points) {
    low = Math.min(low, p[1]);
    high = Math.max(high, p[1]);
  }
  const band = Math.min(BAND_MAX, (high - low) * BAND_SHARE);
  let hx = 0;
  let hz = 0;
  for (const [x, y, z] of points) {
    if (y > low + band) continue;
    hx = Math.max(hx, Math.abs(x));
    hz = Math.max(hz, Math.abs(z));
  }
  const r = (x) => Math.round(x * 10) / 10 || 0;
  out[o.id] = [r(hx), r(hz), r(Math.max(0, -low))];
}
// One line per rock: "id": [half width, half depth, depth of the lowest point below the pivot]
const lines = Object.entries(out).map(([id, b]) => `  ${JSON.stringify(id)}: ${JSON.stringify(b)}`);
writeFileSync(join(here, 'bases.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'rocks measured');
