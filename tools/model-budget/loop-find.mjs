// Finds seamless loop windows in a skinned clip: for every start frame s and
// length L it compares the pose at s with the pose at s + L (and the motion
// from s to s + 1 with the motion from s + L to s + L + 1), in % of the model
// height, and prints the best windows. Used to cut the dragon's flight and the
// stone golem's walk (tools/blender/optimize_enemy.py, `trim`).
//
// usage (from the repo root, Node 24):
//   node tools/model-budget/loop-find.mjs <model.glb> <clip> <minFrames> <maxFrames> [fps=30] [top=10]
//   CENTER=1  compare poses with their centroids aligned (ignores drift of the root)
//   STEP=n    only windows whose start and length are multiples of n frames (a key raster)
import * as THREE from 'three';
import { loadGlb } from './glb-node.mjs';

const [path, clipName, minFrames, maxFrames, fpsArg, topArg] = process.argv.slice(2);
const fps = parseFloat(fpsArg ?? '30');
const top = parseInt(topArg ?? '10', 10);
const step = parseInt(process.env.STEP ?? '1', 10);

const { root, animations } = await loadGlb(path);
const clip = animations.find((c) => c.name === clipName);
if (!clip) throw new Error(`clip ${clipName} missing: ${animations.map((c) => c.name).join(', ')}`);
const skins = [];
root.traverse((n) => { if (n.isSkinnedMesh) skins.push(n); });
root.updateMatrixWorld(true);
const rootInverse = root.matrixWorld.clone().invert();
const toRoot = skins.map((m) => new THREE.Matrix4().multiplyMatrices(rootInverse, m.matrixWorld));
// About 1,500 sample vertices are enough to compare poses.
const total = skins.reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
const every = Math.max(1, Math.floor(total / 1500));
const frames = Math.floor(clip.duration * fps) + 1;
const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();
const v = new THREE.Vector3();
const poses = [];
let yMin = Infinity;
let yMax = -Infinity;
for (let f = 0; f < frames; f++) {
  mixer.setTime(Math.min(f / fps, clip.duration));
  root.updateMatrixWorld(true);
  const p = [];
  skins.forEach((mesh, mi) => {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += every) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(toRoot[mi]);
      p.push(v.x, v.y, v.z);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
  });
  poses.push(Float32Array.from(p));
}
if (process.env.CENTER === '1') {
  for (const p of poses) {
    const c = [0, 0, 0];
    for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; }
    const n = p.length / 3;
    for (let i = 0; i < p.length; i += 3) { p[i] -= c[0] / n; p[i + 1] -= c[1] / n; p[i + 2] -= c[2] / n; }
  }
}
const h = yMax - yMin;
const dist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / (a.length / 3));
};
let motion = 0;
for (let f = 1; f < frames; f++) motion += dist(poses[f], poses[f - 1]);
motion /= frames - 1;
console.log(`${clipName}: ${clip.duration.toFixed(3)} s, ${frames} frames at ${fps} fps, height ${h.toFixed(3)}, `
  + `mean motion per frame ${(motion / h * 100).toFixed(2)} %`);
console.log(`  seam of the clip itself (last frame -> first): ${(dist(poses[frames - 1], poses[0]) / h * 100).toFixed(2)} %`);

const results = [];
for (let L = parseInt(minFrames, 10); L <= parseInt(maxFrames, 10); L++) {
  if (L % step) continue;
  for (let s = 0; s + L + 1 < frames; s += step) {
    const a0 = poses[s], a1 = poses[s + 1], b0 = poses[s + L], b1 = poses[s + L + 1];
    let dv = 0;
    for (let i = 0; i < a0.length; i++) dv += ((a1[i] - a0[i]) - (b1[i] - b0[i])) ** 2;
    dv = Math.sqrt(dv / (a0.length / 3));
    results.push({ s, L, pose: dist(a0, b0) / h * 100, velocity: dv / h * 100 });
  }
}
results.sort((a, b) => (a.pose + a.velocity) - (b.pose + b.velocity));
const shown = [];
for (const r of results) {
  if (shown.some((x) => Math.abs(x.s - r.s) < 3 && Math.abs(x.L - r.L) < 3)) continue;
  shown.push(r);
  console.log(`  start ${r.s} (${(r.s / fps).toFixed(3)} s) length ${r.L} (${(r.L / fps).toFixed(3)} s): `
    + `pose ${r.pose.toFixed(2)} %, velocity ${r.velocity.toFixed(2)} %`);
  if (shown.length >= top) break;
}
