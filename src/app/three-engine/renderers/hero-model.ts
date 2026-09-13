import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  Mesh,
  Object3D,
} from 'three';
import type { AssetManagerService } from '../../services/infrastructure/asset-manager.service';

/**
 * The hero's model: the one place that decides what he looks like.
 *
 * The renderer loads the GLB of `url`, scales it to `heightM`, puts its feet
 * on the ground and plays the clips named in `clips`. Another model is a
 * change here and of HERO.muzzle, nothing else.
 */
export interface HeroModelConfig {
  /** GLB of the soldier */
  url: string;
  /** Height he is scaled to, metres. Taller than a person, like the enemies, to read from the overview camera */
  heightM: number;
  /** Radians added to his heading when the model's front is not +Z */
  yawOffset: number;
  /** Clip names in the GLB; matched case-insensitively, a name contained in the clip's name is enough */
  clips: Record<HeroPose, string>;
}

/**
 * Quaternius SWAT, recoloured, with a rifle (CC0, attributions.config.ts):
 * 1.82 units tall, facing +Z. 4.5 m is the humanoid enemies' size (a 1.78 m
 * model at scale 2.5, ENEMY_MODEL_BUDGET.md). `aim` loops for sustained
 * fire; the GLB's `shoot` is one shot with a hard recoil and stays unused.
 */
export const HERO_MODEL: HeroModelConfig = {
  url: 'assets/models/hero/mercenary.glb',
  heightM: 4.5,
  yawOffset: 0,
  clips: { idle: 'idle', run: 'run', shoot: 'aim', 'run-shoot': 'run_shoot' },
};

/** What he is doing, as the model shows it: 'run-shoot' fires on his way to a new spot. */
export type HeroPose = 'idle' | 'run' | 'shoot' | 'run-shoot';

const POSES: readonly HeroPose[] = ['idle', 'run', 'shoot', 'run-shoot'];

export interface HeroModel {
  /** Feet at the origin, front along +Z */
  readonly root: Object3D;
  setPose(pose: HeroPose): void;
  /** Advance the animation by game-time ms */
  update(gameDeltaMs: number): void;
  dispose(): void;
}

/** Clip crossfade, seconds */
const CROSSFADE_S = 0.15;

/**
 * The GLB of `config.url`, scaled to `config.heightM` with its feet at the
 * origin, its clips crossfading by pose. Throws when the file does not load.
 */
export async function loadHeroModel(assets: AssetManagerService, config: HeroModelConfig = HERO_MODEL): Promise<HeroModel> {
  const url = config.url;
  const cached = await assets.loadModel(url);
  const scene = assets.cloneModel(url, { preserveSkeleton: true });
  if (!scene) throw new Error(`[HeroModel] ${url} did not clone`);

  const root = new Group();
  root.name = 'hero-model';
  root.add(scene);
  // A fresh skeleton clone carries stale bone world matrices; the skinned
  // box reads them, and mercenary.glb measured 63 units instead of 1.82
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  const scale = height > 0 ? config.heightM / height : 1;
  scene.scale.multiplyScalar(scale);
  scene.position.y -= box.min.y * scale;

  const mixer = cached.animations.length > 0 ? new AnimationMixer(scene) : null;
  const actions: Partial<Record<HeroPose, AnimationAction>> = {};
  if (mixer) {
    for (const pose of POSES) {
      const clip = findClip(cached.animations, config.clips[pose]);
      if (clip) actions[pose] = mixer.clipAction(clip);
    }
  }

  let current: AnimationAction | null = null;
  return {
    root,
    setPose(pose) {
      const fallback = pose === 'run-shoot' ? actions.run : undefined;
      const next = actions[pose] ?? fallback ?? actions.idle ?? null;
      if (!next || next === current) return;
      next.reset().play();
      if (current) current.crossFadeTo(next, CROSSFADE_S, false);
      current = next;
    },
    update(gameDeltaMs) {
      mixer?.update(gameDeltaMs / 1000);
    },
    dispose() {
      mixer?.stopAllAction();
      scene.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        // Materials were cloned per instance (AssetManager.cloneModel), geometry is the cache's
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) m.dispose();
      });
      assets.releaseModel(url);
    },
  };
}

function findClip(clips: readonly AnimationClip[], name: string): AnimationClip | null {
  const wanted = name.toLowerCase();
  return clips.find((c) => c.name.toLowerCase() === wanted)
    ?? clips.find((c) => c.name.toLowerCase().includes(wanted))
    ?? null;
}
