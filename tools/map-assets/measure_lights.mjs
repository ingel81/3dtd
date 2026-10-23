// Measures where the light of every catalogue object with a `light` sits in
// its model: the middle of its glowing parts (materials with an emissive
// colour: a lamp's glass, a lantern's flame, a brazier's embers), at scale 1
// in the model's own axes. The game puts the light's pool, its baked light
// and its halo there (EffectLayer), not on the model's axis at
// `light.height`: a street lamp's light hangs at the end of its arm.
// Writes tools/map-assets/lights.json ({ "id": { "at": [x, z], "height": y } }),
// which update_catalog.py puts into the catalogue's `light`. Objects without
// a glowing part (nor lamp glass by name) keep their light as objects.json gives it.
//
//   node tools/map-assets/measure_lights.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_lights.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const objects = JSON.parse(readFileSync(join(here, 'objects.json'), 'utf8'));

const r2 = (x) => Math.round(x * 100) / 100;
const out = {};
for (const o of objects) {
  if (!o.light || o.file === '') continue;
  const { root } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  root.updateMatrixWorld(true);
  // The glowing parts; a model whose lamp glass does not glow by itself (a scanned street lamp) by the glass's name
  const parts = (test) => {
    const box = new Box3();
    root.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(test)) box.union(new Box3().setFromObject(node, true));
    });
    return box;
  };
  let glow = parts((m) => m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.05);
  if (glow.isEmpty()) glow = parts((m) => /glass|bulb|lamp-head/i.test(m.name));
  if (glow.isEmpty()) continue;
  const c = glow.getCenter(new Vector3());
  out[o.id] = { at: [r2(c.x), r2(c.z)], height: r2(c.y) };
}
const lines = Object.entries(out).map(([id, l]) => `  ${JSON.stringify(id)}: ${JSON.stringify(l)}`);
writeFileSync(join(here, 'lights.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'lights measured');
