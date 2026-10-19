// Distance copies (-lod1) for the packed models that have none: the heavy ones (over 1500 triangles: houses,
// castles, vehicles, lamps) and walls of many copies. Each look of the model (its parts by material) is merged
// over its positions alone, simplified by meshoptimizer to a share of its triangles within an error of its size,
// shaded flat; textures go, each material becomes `<name>-lod` in its colour factor, which match_lods.py then
// sets to the full model's colour from afar. Foliage cards cannot be simplified: models with them are left out
// (the vegetation has its own impostors). The silhouette keeps: the simplifier collapses what moves the surface
// least, a roof's ridge and eaves last.
//
//   node tools/map-assets/make_far_lods.mjs public/maps/assets [<id> ...]
//   then: update_catalog.py (adds the lod entries), match_lods.py <ids>, update_catalog.py (triangle counts)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadGlb } from '../model-budget/glb-node.mjs';

/** Models with more triangles than this and no LOD get one */
const HEAVY = 1500;
/** Walls are many: from this many triangles they get one too */
const WALL = 150;
/** Share of the triangles a copy keeps at most, and the error it may make, as a share of the model's size */
const RATIO = 0.25;
const ERROR = 0.05;
/** Looks of at most this many triangles stay whole */
const SMALL = 24;

// GLTFExporter reads its blobs with a FileReader, which Node has not
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    void blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/make_far_lods.mjs <public/maps/assets> [<id> ...]');
  process.exit(1);
}
const only = new Set(process.argv.slice(3));
const catalog = JSON.parse(readFileSync(join(assets, 'catalog.json'), 'utf8'));
await MeshoptSimplifier.ready;

const wanted = catalog.objects.filter((o) => {
  if (!o.file || o.category === 'tree' || o.category === 'plant') return false;
  // Named ones are built anew, their copy and all
  if (only.size) return only.has(o.id);
  return !o.lod && (o.triangles ?? 0) > HEAVY || (o.category === 'wall' && (o.triangles ?? 0) >= WALL);
});

for (const o of wanted) {
  const out = join(assets, 'models', `${o.id}-lod1.glb`);
  if (existsSync(out) && !only.size) continue;
  const { root } = await loadGlb(join(assets, o.file));
  root.updateMatrixWorld(true);
  // The model's parts by look, in the model's frame
  const looks = new Map();
  let foliage = false;
  root.traverse((m) => {
    if (!m.isMesh) return;
    const materials = Array.isArray(m.material) ? m.material : [m.material];
    if (materials.some((x) => x.name.startsWith('foliage-'))) foliage = true;
    const g = m.geometry.index ? m.geometry : m.geometry;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = materials[grp.materialIndex ?? 0];
      let look = looks.get(mat.name);
      if (!look) looks.set(mat.name, (look = { material: mat, positions: [] }));
      const pos = g.attributes.position;
      const v = new Vector3();
      for (let k = grp.start; k < grp.start + grp.count; k++) {
        v.fromBufferAttribute(pos, g.index ? g.index.getX(k) : k).applyMatrix4(m.matrixWorld);
        look.positions.push(v.x, v.y, v.z);
      }
    }
  });
  if (foliage) {
    console.error(`${o.id}: foliage cards, left out`);
    continue;
  }
  const scene = new Group();
  let before = 0;
  let after = 0;
  for (const [name, look] of looks) {
    // Corners that meet weld into one vertex, whatever their normals and texture places
    const corners = new Float32Array(look.positions);
    const remap = MeshoptSimplifier.generatePositionRemap(corners, 3);
    const indices = new Uint32Array(remap);
    before += indices.length / 3;
    // A small look stays whole (a roof of a few big quads, a window's glass), as the builders' copies keep it
    const target = Math.max(SMALL * 3, Math.floor((indices.length * RATIO) / 3) * 3);
    let kept = indices;
    if (indices.length > SMALL * 3) {
      [kept] = MeshoptSimplifier.simplify(indices, corners, 3, target, ERROR, []);
      // A shape the error holds up (thin walls with many seams): collapsed regardless of topology
      if (kept.length > target * 2) kept = MeshoptSimplifier.simplifySloppy(indices, corners, 3, null, target, 1)[0];
      // Every look stays in the copy, if only as it was
      if (!kept.length) kept = indices;
    }
    after += kept.length / 3;
    // Flat: each triangle its own corners, the normals of its face
    const flat = new Float32Array(kept.length * 3);
    for (let k = 0; k < kept.length; k++) flat.set(corners.subarray(kept[k] * 3, kept[k] * 3 + 3), k * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(flat, 3));
    g.computeVertexNormals();
    const src = look.material;
    const m = new MeshStandardMaterial({
      name: `${name}-lod`,
      color: src.color ?? new Color(1, 1, 1),
      roughness: src.roughness ?? 0.8,
      metalness: src.metalness ?? 0,
      emissive: src.emissive ?? new Color(0, 0, 0),
      emissiveIntensity: src.emissiveIntensity ?? 1,
      side: src.side,
      transparent: src.transparent,
      opacity: src.opacity ?? 1,
    });
    scene.add(new Mesh(g, m));
  }
  if (!after) continue;
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  writeFileSync(out, Buffer.from(glb));
  console.error(`${o.id.padEnd(28)} ${before} -> ${after} triangles`);
}
