import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  Vector3,
  type BufferAttribute,
  type Material,
} from 'three';
import { MushroomCloudRenderer } from './mushroom-cloud.renderer';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';

/** Math.random with a fixed sequence, so every run draws the same particles and winds. */
function seededRandom(seed = 7): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  });
}

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex').slice(0, 16);

/**
 * Everything the renderer hands to three in one frame, hashed: per scene
 * child its type, visibility, render order and pose; for the particle
 * buffers the draw range and every attribute's bytes and upload version;
 * the opacity of rings, domes, flashes and the screen quad; the bloom kick.
 */
function frameState(scene: Scene, clouds: MushroomCloudRenderer): string {
  const parts: unknown[] = [clouds.activeClouds, clouds.bloomKick, scene.children.length];
  for (const child of scene.children) {
    parts.push(child.type, child.visible, child.renderOrder, child.position.toArray(), child.scale.toArray());
    if (child instanceof Points) {
      const geometry = child.geometry;
      parts.push(geometry.drawRange.start, geometry.drawRange.count);
      for (const name of ['position', 'size', 'color', 'frameIndex']) {
        const attribute = geometry.getAttribute(name) as BufferAttribute;
        const array = attribute.array as Float32Array;
        parts.push(name, attribute.version, hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)));
      }
    } else if (child instanceof Mesh || child instanceof Sprite) {
      const material = child.material as Material;
      const uniform = material instanceof ShaderMaterial ? material.uniforms['uOpacity']?.value : null;
      parts.push(material.opacity, uniform ?? null);
    }
  }
  return hash(JSON.stringify(parts));
}

function setup() {
  const scene = new Scene();
  const clouds = new MushroomCloudRenderer(scene, { additive: new ShaderMaterial(), normal: new ShaderMaterial() });
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(100, 250, 350);
  camera.lookAt(new Vector3(100, 20, -50));
  const log: string[] = [];
  let frame = 0;
  /** `frames` frames of `stepMs` game time each, the state logged every `every` frames */
  const run = (frames: number, stepMs: number, every = 5) => {
    for (let i = 0; i < frames; i++) {
      clouds.update(stepMs, camera, 1080);
      if (++frame % every === 0) log.push(frameState(scene, clouds));
    }
  };
  return { scene, clouds, camera, log, run };
}

describe('MushroomCloudRenderer, characterized for the split', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the whole cloud frame for frame as before, through pause and timescale jumps', () => {
    seededRandom();
    const { scene, clouds, camera, log, run } = setup();
    clouds.detonate(new Vector3(100, 20, -50), 25);
    run(40, 16, 1);
    // Pause: game time stands
    run(30, 0);
    // 75x timescale: long frames
    run(12, 16 * 75, 1);
    camera.position.set(-200, 120, 80);
    camera.lookAt(new Vector3(100, 40, -50));
    clouds.detonate(new Vector3(160, 22, -10), 40);
    run(Math.ceil((LOOK.duration * 1000) / 16) + 10, 16);
    log.push(frameState(scene, clouds));
    expect(clouds.activeClouds).toBe(0);
    expect(hash(log.join())).toBe('85ec7febafd4855a');
  });

  it('draws the detonation only, overlapping strikes, a reused slot and clear as before', () => {
    seededRandom(11);
    const { scene, clouds, log, run } = setup();
    clouds.setFullCloud(false);
    clouds.detonate(new Vector3(0, 0, 0), 25);
    run(20, 16, 1);
    clouds.setFullCloud(true);
    for (let i = 0; i < LOOK.clouds + 1; i++) {
      clouds.detonate(new Vector3(30 * i, 5, -20 * i), 20 + 5 * i);
      run(25, 33, 1);
    }
    clouds.clear();
    log.push(frameState(scene, clouds));
    clouds.detonate(new Vector3(-40, 3, 60), 30);
    run(60, 50, 1);
    clouds.dispose();
    expect(scene.children).toEqual([]);
    expect(hash(log.join())).toBe('c6f68dd30c4bd9e0');
  });
});
