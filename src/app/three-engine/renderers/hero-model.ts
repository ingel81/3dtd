import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Material,
} from 'three';
import type { AssetManagerService } from '../../services/infrastructure/asset-manager.service';

/**
 * The hero's model: the one place that decides what he looks like.
 *
 * Until the soldier GLB is in the repo a primitive figure stands in. Setting
 * `url` swaps it: the renderer loads the GLB, scales it to `heightM`, puts
 * its feet on the ground and plays the clips named in `clips`. Nothing else
 * has to change.
 */
export interface HeroModelConfig {
  /** GLB of the soldier, null for the placeholder figure */
  url: string | null;
  /** Height he is scaled to, metres. Taller than a person, like the enemies, to read from the overview camera */
  heightM: number;
  /** Radians added to his heading when the model's front is not +Z */
  yawOffset: number;
  /** Clip names in the GLB; matched case-insensitively, a name contained in the clip's name is enough */
  clips: Record<HeroPose, string>;
}

export const HERO_MODEL: HeroModelConfig = {
  url: null,
  heightM: 4.5,
  yawOffset: 0,
  clips: { idle: 'idle', run: 'run', shoot: 'shoot' },
};

/** What he is doing, as the model shows it. */
export type HeroPose = 'idle' | 'run' | 'shoot';

export interface HeroModel {
  /** Feet at the origin, front along +Z */
  readonly root: Object3D;
  /** Height of the top of the model above its feet, metres */
  readonly heightM: number;
  setPose(pose: HeroPose): void;
  /** Advance the animation by game-time ms */
  update(gameDeltaMs: number): void;
  dispose(): void;
}

/** Proportions of the placeholder in metres of a 1.9 m figure, scaled to heightM. */
const FIGURE_M = 1.9;
/** Leg swing of the placeholder while running: amplitude in radians, strides per second */
const STRIDE_SWING = 0.6;
const STRIDE_HZ = 2.4;
/** Clip crossfade of a GLB, seconds */
const CROSSFADE_S = 0.15;

/**
 * Primitive soldier: olive legs and helmet, khaki vest, a dark rifle held
 * forward. Built-in lit materials, so the scene lights shade it and the
 * logarithmic depth buffer comes with them. The legs swing while he runs.
 */
export function createPlaceholderHero(config: HeroModelConfig = HERO_MODEL): HeroModel {
  const olive = new MeshStandardMaterial({ color: 0x4b5a32, roughness: 0.85 });
  const khaki = new MeshStandardMaterial({ color: 0x8a7d55, roughness: 0.9 });
  const skin = new MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8 });
  const steel = new MeshStandardMaterial({ color: 0x2b2e2f, roughness: 0.5, metalness: 0.6 });
  const materials: Material[] = [olive, khaki, skin, steel];
  const geometries = {
    leg: new BoxGeometry(0.17, 0.92, 0.22),
    torso: new BoxGeometry(0.52, 0.62, 0.32),
    arm: new BoxGeometry(0.13, 0.5, 0.15),
    rifle: new BoxGeometry(0.07, 0.1, 0.85),
    head: new SphereGeometry(0.14, 16, 12),
    helmet: new SphereGeometry(0.165, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  };

  const root = new Group();
  root.name = 'hero-placeholder';
  const figure = new Group();
  figure.scale.setScalar(config.heightM / FIGURE_M);
  root.add(figure);

  const part = (geometry: BoxGeometry | SphereGeometry, material: Material, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    return mesh;
  };

  // Legs hang from the hips so they can swing
  const legs = [-0.12, 0.12].map((x) => {
    const hip = new Group();
    hip.position.set(x, 0.92, 0);
    hip.add(part(geometries.leg, olive, 0, -0.46, 0));
    figure.add(hip);
    return hip;
  });
  figure.add(part(geometries.torso, khaki, 0, 1.23, 0));
  // Both arms forward to the rifle at chest height
  const leftArm = part(geometries.arm, khaki, -0.2, 1.3, 0.14);
  leftArm.rotation.x = -1.1;
  const rightArm = part(geometries.arm, khaki, 0.2, 1.3, 0.1);
  rightArm.rotation.x = -1.3;
  figure.add(leftArm, rightArm);
  figure.add(part(geometries.rifle, steel, 0.05, 1.36, 0.42));
  figure.add(part(geometries.head, skin, 0, 1.7, 0));
  figure.add(part(geometries.helmet, olive, 0, 1.73, 0));

  let pose: HeroPose = 'idle';
  let phase = 0;
  return {
    root,
    heightM: config.heightM,
    setPose(next) {
      pose = next;
    },
    update(gameDeltaMs) {
      if (pose === 'run') {
        phase += (gameDeltaMs / 1000) * STRIDE_HZ * Math.PI * 2;
        const swing = Math.sin(phase) * STRIDE_SWING;
        legs[0].rotation.x = swing;
        legs[1].rotation.x = -swing;
      } else {
        phase = 0;
        for (const leg of legs) leg.rotation.x *= 0.8;
      }
    },
    dispose() {
      for (const g of Object.values(geometries)) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * The GLB of `config.url`, scaled to `config.heightM` with its feet at the
 * origin, its clips crossfading by pose. Throws when the file does not load;
 * the renderer keeps the placeholder then.
 */
export async function loadHeroModel(assets: AssetManagerService, config: HeroModelConfig = HERO_MODEL): Promise<HeroModel> {
  const url = config.url;
  if (!url) throw new Error('[HeroModel] no url');
  const cached = await assets.loadModel(url);
  const scene = assets.cloneModel(url, { preserveSkeleton: true });
  if (!scene) throw new Error(`[HeroModel] ${url} did not clone`);

  const root = new Group();
  root.name = 'hero-model';
  root.add(scene);
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  const scale = height > 0 ? config.heightM / height : 1;
  scene.scale.multiplyScalar(scale);
  scene.position.y -= box.min.y * scale;

  const mixer = cached.animations.length > 0 ? new AnimationMixer(scene) : null;
  const actions: Partial<Record<HeroPose, AnimationAction>> = {};
  if (mixer) {
    for (const pose of ['idle', 'run', 'shoot'] as HeroPose[]) {
      const clip = findClip(cached.animations, config.clips[pose]);
      if (clip) actions[pose] = mixer.clipAction(clip);
    }
  }

  let current: AnimationAction | null = null;
  return {
    root,
    heightM: config.heightM,
    setPose(pose) {
      const next = actions[pose] ?? actions.idle ?? null;
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
