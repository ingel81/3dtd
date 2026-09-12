// Height trace of a skinned clip in bake space: centroid, lowest and highest
// vertex every `step` seconds. Shows when a death clip falls (zombie_v2's
// Electrocuted_Fall stands until 3.0 s and lies from about 5.5 s).
//
// usage (from the repo root, Node 24):
//   node tools/model-budget/clip-trace.mjs <model.glb> <clip> [step=0.25]
import * as THREE from 'three';
import { loadGlb } from './glb-node.mjs';

const [path, clipName, stepArg] = process.argv.slice(2);
const step = parseFloat(stepArg ?? '0.25');

const { root, animations } = await loadGlb(path);
const clip = animations.find((c) => c.name === clipName);
if (!clip) throw new Error(`clip ${clipName} missing: ${animations.map((c) => c.name).join(', ')}`);
const skins = [];
root.traverse((n) => { if (n.isSkinnedMesh) skins.push(n); });
root.updateMatrixWorld(true);
const rootInverse = root.matrixWorld.clone().invert();
const toRoot = skins.map((m) => new THREE.Matrix4().multiplyMatrices(rootInverse, m.matrixWorld));
const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();
const v = new THREE.Vector3();
console.log(`${clipName}: ${clip.duration.toFixed(3)} s`);
for (let t = 0; t <= clip.duration + 1e-6; t += step) {
  mixer.setTime(Math.min(t, clip.duration - 1e-4));
  root.updateMatrixWorld(true);
  let sum = 0, n = 0, low = Infinity, high = -Infinity;
  skins.forEach((mesh, mi) => {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(toRoot[mi]);
      sum += v.y;
      n++;
      low = Math.min(low, v.y);
      high = Math.max(high, v.y);
    }
  });
  console.log(`  t ${t.toFixed(2)}  centroid y ${(sum / n).toFixed(3)}  min ${low.toFixed(3)}  max ${high.toFixed(3)}`);
}
