// Compares two enemy GLBs in bake space, sampled the way vat-baker.ts bakes:
// 30 fps, skinned meshes through applyBoneTransform, otherwise the meshes'
// animated node transforms, death clips cut at 2 s x animationSpeed. Prints
// vertex counts, clip lengths and the bounding box per clip; with two files
// also the largest bounding-box and centroid deviation per frame and a
// nearest-vertex distance at three frames, all in % of the model height.
//
// usage (from the repo root, Node 24):
//   node tools/model-budget/bake-compare.mjs <a.glb> [<b.glb>] --clips walk,run
//        [--death die1,die2] [--speed animationSpeed]
//        [--offset s]        sample <a> from clip time s on (a cut clip against its source window)
//        [--scale f]         multiply the positions of <b> (a unit change)
//        [--rename a=b,...]  clips named differently in <b>
//        [--where pct]       where the vertices of <a> lie that are more than pct % off
import * as THREE from 'three';
import { loadGlb } from './glb-node.mjs';

const FPS = 30;
const DEATH_SECONDS = 2; // TIMING.deathAnimationDuration

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const files = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const list = (name) => (opt(name, '') || '').split(',').filter(Boolean);
const renames = Object.fromEntries(list('rename').map((pair) => pair.split('=')));

function bakedMeshes(root) {
  const skinned = [];
  const rigid = [];
  root.traverse((n) => {
    if (n.isSkinnedMesh) skinned.push(n);
    else if (n.isMesh) rigid.push(n);
  });
  return skinned.length ? { mode: 'skinned', meshes: skinned } : { mode: 'object', meshes: rigid };
}

/** Positions per frame (Float32Array of xyz), relative to the model root. */
function bake({ root, animations }, clipName, seconds, offset = 0) {
  const clip = animations.find((c) => c.name === clipName);
  if (!clip) return null;
  const { mode, meshes } = bakedMeshes(root);
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const restToRoot = meshes.map((m) => new THREE.Matrix4().multiplyMatrices(rootInverse, m.matrixWorld));
  const whole = Math.max(1, Math.ceil((clip.duration - offset) * FPS));
  const frames = seconds < clip.duration ? Math.min(whole, Math.floor(seconds * FPS) + 1) : whole;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const v = new THREE.Vector3();
  const meshToRoot = new THREE.Matrix4();
  const out = [];
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(offset + f / FPS, clip.duration - 0.0001));
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const points = [];
    meshes.forEach((mesh, mi) => {
      const pos = mesh.geometry.getAttribute('position');
      if (mode === 'object') meshToRoot.multiplyMatrices(inverse, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (mode === 'skinned') {
          mesh.applyBoneTransform(i, v);
          v.applyMatrix4(restToRoot[mi]);
        } else {
          v.applyMatrix4(meshToRoot);
        }
        points.push(v.x, v.y, v.z);
      }
    });
    out.push(new Float32Array(points));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return { duration: clip.duration, frames: out };
}

function stats(p) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const c = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = p[i + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
      c[k] += x;
    }
  }
  const n = p.length / 3;
  return { min, max, c: c.map((x) => x / n) };
}

/** Mean, 99th percentile and max distance from each point of a to the nearest point of b (grid search). */
function nearest(a, b, cell) {
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < b.length; i += 3) {
    const k = key(b[i], b[i + 1], b[i + 2]);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(i);
  }
  const d = [];
  for (let i = 0; i < a.length; i += 3) {
    const cx = Math.floor(a[i] / cell), cy = Math.floor(a[i + 1] / cell), cz = Math.floor(a[i + 2] / cell);
    let best = Infinity;
    for (let r = 1; r <= 4 && best === Infinity; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const e = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 + (a[i + 2] - b[j + 2]) ** 2;
          if (e < best) best = e;
        }
      }
    }
    d.push(Math.sqrt(best));
  }
  d.sort((x, y) => x - y);
  return { mean: d.reduce((s, x) => s + x, 0) / d.length, p99: d[Math.floor(d.length * 0.99)], max: d[d.length - 1] };
}

/** Where (in % of the bounding box of a) the points of a lie that are more than t away from every point of b. */
function whereOff(a, b, t) {
  const off = [];
  for (let i = 0; i < a.length; i += 3) {
    let best = Infinity;
    for (let j = 0; j < b.length; j += 3) {
      const e = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 + (a[i + 2] - b[j + 2]) ** 2;
      if (e < best) best = e;
    }
    if (Math.sqrt(best) > t) off.push(a[i], a[i + 1], a[i + 2]);
  }
  if (!off.length) return null;
  const all = stats(a);
  const s = stats(Float32Array.from(off));
  const rel = (v, k) => ((v - all.min[k]) / (all.max[k] - all.min[k]) * 100).toFixed(0);
  return `${off.length / 3} vertices: x ${rel(s.min[0], 0)}-${rel(s.max[0], 0)} %, `
    + `y ${rel(s.min[1], 1)}-${rel(s.max[1], 1)} %, z ${rel(s.min[2], 2)}-${rel(s.max[2], 2)} % of the bbox`;
}

const pct = (x, h) => (x / h * 100).toFixed(2) + ' %';
const fmt = (a) => a.map((x) => x.toFixed(3)).join(',');

const models = await Promise.all(files.map(loadGlb));
models.forEach((m, i) => {
  const { mode, meshes } = bakedMeshes(m.root);
  const vertices = meshes.reduce((s, x) => s + x.geometry.getAttribute('position').count, 0);
  const clips = m.animations.map((c) => `${c.name}(${c.duration.toFixed(2)})`).join(' ');
  console.log(`[${i}] ${files[i]}: ${mode}, ${meshes.length} meshes, ${vertices} vertices, clips: ${clips}`);
});

const deathSeconds = DEATH_SECONDS * parseFloat(opt('speed', '1'));
const offset = parseFloat(opt('offset', '0'));
const scale = parseFloat(opt('scale', '1'));
const plan = [...list('clips').map((n) => [n, Infinity]), ...list('death').map((n) => [n, deathSeconds])];
for (const [name, seconds] of plan) {
  const a = bake(models[0], name, seconds, offset);
  if (!a) {
    console.log(`clip ${name}: missing in [0]`);
    continue;
  }
  const sa = a.frames.map(stats);
  const all = stats(Float32Array.from(a.frames.flatMap((f) => Array.from(f))));
  const h = all.max[1] - all.min[1];
  console.log(`\nclip ${name}: [0] ${a.duration.toFixed(3)} s, ${a.frames.length} frames, bbox ${fmt(all.min)} .. ${fmt(all.max)}, height ${h.toFixed(3)}`);
  if (models.length < 2) continue;
  const b = bake(models[1], renames[name] ?? name, seconds);
  if (!b) {
    console.log('  missing in [1]');
    continue;
  }
  if (scale !== 1) b.frames.forEach((f) => { for (let i = 0; i < f.length; i++) f[i] *= scale; });
  const sb = b.frames.map(stats);
  const allB = stats(Float32Array.from(b.frames.flatMap((f) => Array.from(f))));
  console.log(`  [1] ${b.duration.toFixed(3)} s, ${b.frames.length} frames, bbox ${fmt(allB.min)} .. ${fmt(allB.max)}`);
  const n = Math.min(sa.length, sb.length);
  let bboxDev = 0;
  let centroidDev = 0;
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 3; k++) {
      bboxDev = Math.max(bboxDev, Math.abs(sa[f].min[k] - sb[f].min[k]), Math.abs(sa[f].max[k] - sb[f].max[k]));
      centroidDev = Math.max(centroidDev, Math.abs(sa[f].c[k] - sb[f].c[k]));
    }
  }
  console.log(`  per-frame max bbox dev ${pct(bboxDev, h)}, centroid dev ${pct(centroidDev, h)}`);
  for (const f of [...new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3)])]) {
    const ab = nearest(a.frames[f], b.frames[f], h / 40);
    const ba = nearest(b.frames[f], a.frames[f], h / 40);
    console.log(`  frame ${f}: a->b mean ${pct(ab.mean, h)} p99 ${pct(ab.p99, h)} max ${pct(ab.max, h)}`
      + ` | b->a mean ${pct(ba.mean, h)} p99 ${pct(ba.p99, h)}`);
    if (args.includes('--where')) {
      const where = whereOff(a.frames[f], b.frames[f], parseFloat(opt('where', '3')) / 100 * h);
      if (where) console.log(`    off by more than ${opt('where', '3')} %: ${where}`);
    }
  }
}
