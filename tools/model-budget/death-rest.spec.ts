// @vitest-environment node
/**
 * Death clips come to rest before their enemy is removed.
 *
 * A killed enemy plays its death clip at animationSpeed and goes
 * enemyDeathDuration() after the kill; the VAT is cut there and holds the
 * frame shown then (vatClips). Whatever the clip still does after that point
 * is never on screen: the enemy vanishes in mid-fall. With the default 2 s
 * that happened to zombie_v2's Dead, the stone golem's dying_backwards and
 * the zombie soldier's zombie_02_Death (playtest 2026-09-15).
 *
 * Loads every model with its clips (no images, glb-node.mjs) and poses the
 * meshes the baker takes frame by frame, as the baker does.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnimationMixer,
  LoopOnce,
  Matrix4,
  Vector3,
  type AnimationClip,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';

import { ENEMY_TYPES, type EnemyTypeConfig } from '../../src/app/configs/enemy-types.config';
import { DEFAULT_BAKE_FPS, vatDeathSeconds } from '../../src/app/three-engine/renderers/instanced-enemy/vat-clips';
import { loadGlb } from './glb-node.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** How far a vertex may still move after the removal, as a share of the model's height. */
const REST_TOLERANCE = 0.05;
/** Every n-th vertex is posed, enough to see a limb move. */
const VERTEX_STEP = 5;

type Model = { root: Object3D; animations: AnimationClip[] };

/** The meshes the baker takes: every skinned one, or else the rigid ones (bakeObjectAnimVAT). */
function bakedMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if ((node as Mesh).isMesh) meshes.push(node as Mesh);
  });
  const skinned = meshes.filter((m) => (m as SkinnedMesh).isSkinnedMesh);
  return skinned.length > 0 ? skinned : meshes;
}

/** Positions of every VERTEX_STEP-th vertex in the model root's space, as posed now. */
function posedVertices(root: Object3D, meshes: Mesh[]): number[] {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const toRoot = new Matrix4();
  const v = new Vector3();
  const out: number[] = [];
  for (const mesh of meshes) {
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += VERTEX_STEP) {
      v.fromBufferAttribute(position, i);
      if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).applyBoneTransform(i, v);
      v.applyMatrix4(toRoot);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

/**
 * How far `clip` still moves after clip time `cut`: the longest way a vertex
 * gets from where it is in the frame shown at `cut`, as a share of the
 * model's height in the clip's first frame. 0 when the clip ends before.
 */
function motionAfter({ root }: Model, clip: AnimationClip, cut: number): number {
  const fps = DEFAULT_BAKE_FPS;
  const lastFrame = Math.floor(clip.duration * fps + 1e-3);
  const cutFrame = Math.floor(cut * fps + 1e-3);
  if (cutFrame >= lastFrame) return 0;

  const meshes = bakedMeshes(root);
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const pose = (frame: number): number[] => {
    // A fresh setTime() starts over from 0 (see vat-baker.ts).
    mixer.setTime(Math.min(frame / fps, clip.duration - 1e-4));
    return posedVertices(root, meshes);
  };

  const first = pose(0);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < first.length; i += 3) {
    low = Math.min(low, first[i]);
    high = Math.max(high, first[i]);
  }
  const shown = pose(cutFrame);
  let most = 0;
  for (let frame = cutFrame + 1; frame <= lastFrame; frame++) {
    const later = pose(frame);
    for (let i = 0; i < later.length; i += 3) {
      most = Math.max(most, Math.hypot(later[i] - shown[i], later[i + 1] - shown[i + 1], later[i + 2] - shown[i + 2]));
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return most / (high - low);
}

function deathClips(config: EnemyTypeConfig): string[] {
  const names = [config.deathAnimation, ...(config.deathAnimations ?? [])];
  return [...new Set(names.filter((n): n is string => !!n))];
}

async function load(config: EnemyTypeConfig): Promise<Model> {
  return loadGlb(resolve(ROOT, 'public', config.modelUrl));
}

describe('death clips', () => {
  it('lie still once their enemy is removed', async () => {
    const moving: string[] = [];
    for (const [id, config] of Object.entries(ENEMY_TYPES)) {
      const names = deathClips(config);
      if (!config.hasAnimations || names.length === 0) continue;
      const model = await load(config);
      const cut = vatDeathSeconds(config);
      for (const name of names) {
        const clip = model.animations.find((c) => c.name === name);
        // generate.spec.ts reports a configured clip the model lacks
        if (!clip) continue;
        const motion = motionAfter(model, clip, cut);
        if (motion > REST_TOLERANCE) {
          moving.push(`${id} ${name}: moves ${(motion * 100).toFixed(0)} % of its height after ${cut.toFixed(2)} s of clip time`);
        }
      }
    }
    expect(moving).toEqual([]);
  }, 60_000);

  it("sees zombie_v2's Dead still falling at the default 2 s", async () => {
    const model = await load(ENEMY_TYPES['zombie-v2']);
    const dead = model.animations.find((c) => c.name === 'Dead')!;
    expect(motionAfter(model, dead, 2)).toBeGreaterThan(REST_TOLERANCE);
    expect(motionAfter(model, dead, dead.duration)).toBe(0);
  });
});
