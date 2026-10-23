// Measures where the door of every building model is: the middle of its
// biggest door (the parts with a `door-*` material) at its foot, in model x
// and z at scale 1, and the side of the wall box it is on (front +z, back -z,
// east +x, west -x). An OSM world turns a house's door side to the street or
// to its mapped entrance and lays the footpath from the door
// (convert/buildings.ts, convert/plots.ts). Writes tools/map-assets/doors.json,
// which update_catalog.py puts into the catalogue as `door`.
//
//   node tools/map-assets/measure_doors.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Matrix4, Vector3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_doors.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const objects = JSON.parse(readFileSync(join(here, 'objects.json'), 'utf8'));
const out = {};
for (const o of objects) {
  if (o.category !== 'building' || o.file === '') continue;
  const { root } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  root.updateMatrixWorld(true);
  const whole = new Box3().setFromObject(root, true);
  // Each door: the parts with a door material, split into pieces that share no corner (one material holds every
  // door of a model, front and back), in model space
  const doors = [];
  root.traverse((m) => {
    if (!m.isMesh || !/^door/.test(m.material?.name ?? '')) return;
    const pos = m.geometry.attributes.position;
    const index = m.geometry.index;
    const count = m.isInstancedMesh ? m.count : 1;
    for (let k = 0; k < count; k++) {
      const at = new Matrix4();
      if (m.isInstancedMesh) m.getMatrixAt(k, at);
      at.premultiply(m.matrixWorld);
      const pts = Array.from({ length: pos.count }, (_, i) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(at));
      // Corners at one place (to the centimetre) are one; pieces by the triangles that share them
      const keyOf = (v) => `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`;
      const parent = new Map();
      const find = (x) => {
        while (parent.get(x) !== x) x = parent.get(x);
        return x;
      };
      const join = (a, b) => parent.set(find(a), find(b));
      for (const v of pts) if (!parent.has(keyOf(v))) parent.set(keyOf(v), keyOf(v));
      const tri = index ? index.array : Array.from({ length: pos.count }, (_, i) => i);
      for (let i = 0; i < tri.length; i += 3) {
        join(keyOf(pts[tri[i]]), keyOf(pts[tri[i + 1]]));
        join(keyOf(pts[tri[i]]), keyOf(pts[tri[i + 2]]));
      }
      const boxes = new Map();
      for (const v of pts) {
        const r = find(keyOf(v));
        if (!boxes.has(r)) boxes.set(r, new Box3());
        boxes.get(r).expandByPoint(v);
      }
      doors.push(...boxes.values());
    }
  });
  // A door: a piece at least 1.6 m high and 0.6 m wide, standing on the ground floor (its foot under 1.5 m)
  const width = (b) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  const found = doors.filter((b) => b.max.y - b.min.y >= 1.6 && width(b) >= 0.6 && b.min.y < 1.5);
  if (!found.length) continue;
  const r = (v) => Math.round(v * 100) / 100 || 0;
  out[o.id] = found
    .map((b) => {
      const x = (b.min.x + b.max.x) / 2;
      const z = (b.min.z + b.max.z) / 2;
      // The side of the model's box the door is nearest
      const gaps = { front: whole.max.z - z, back: z - whole.min.z, east: whole.max.x - x, west: x - whole.min.x };
      const side = Object.entries(gaps).reduce((best, e) => (e[1] < best[1] ? e : best))[0];
      return [r(x), r(z), side, r(width(b))];
    })
    // Biggest first, the same door once
    .sort((p, q) => q[3] - p[3])
    .filter((d, k, all) => all.findIndex((e) => Math.hypot(e[0] - d[0], e[1] - d[1]) < 0.5) === k)
    .map(([x, z, side]) => [x, z, side]);
}
// One line per model: "id": [[door x, door z, side], ...], the biggest door first
const lines = Object.entries(out).map(([id, d]) => `  ${JSON.stringify(id)}: ${JSON.stringify(d)}`);
writeFileSync(join(here, 'doors.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'doors measured');
