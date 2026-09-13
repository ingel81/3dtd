import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  Points,
  RGBAFormat,
  type Object3D,
  type Scene,
  type ShaderMaterial,
} from 'three';
import { DrawGate } from './draw-gate';

/**
 * Building blocks of the effects that run in game time on buffers of their
 * own (the mushroom cloud, the abilities' bursts and beams): the particles
 * are recomputed from their age every frame, so a pause holds them and the
 * timescale plays them faster.
 */

function noRaycast(): void {
  // an effect, nothing to pick
}

/**
 * Keeps an object of an effect out of every raycast. The gates only hide
 * them, and three's raycast skips no hidden object: after a strike the
 * shock dome (46 m, 37 m high), the flash sprite and the ring stayed over
 * the impact in their last pose, and the camera controls zoomed onto them,
 * pivoted on them and kept their ground clearance above them.
 */
export function unpickable<T extends Object3D>(object: T): T {
  object.raycast = noRaycast;
  return object;
}

/**
 * Share of its final radius a front running out with time constant `k`
 * has reached at `t`: fast at first, all of it at `duration`.
 */
export function reach(t: number, duration: number, k: number): number {
  return (1 - Math.exp(-Math.min(t, duration) / k)) / (1 - Math.exp(-duration / k));
}

/** White square texture whose alpha runs over the distance r (0 centre, 1 edge) from its centre. */
export function radialTexture(size: number, alphaAt: (r: number) => number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const alpha = r >= 1 ? 0 : Math.min(1, Math.max(0, alphaAt(r)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Points drawn with one of the trail pools' ShaderMaterials (sprite atlas
 * or round particle by `frameIndex`, logarithmic depth), filled per frame.
 */
export interface ParticleBuffer {
  points: Points;
  gate: DrawGate;
  position: BufferAttribute;
  size: BufferAttribute;
  color: BufferAttribute;
  frame: BufferAttribute;
  /** Particles drawn last frame */
  drawn: number;
}

export function particleBuffer(scene: Scene, capacity: number, material: ShaderMaterial, renderOrder: number): ParticleBuffer {
  const attribute = (itemSize: number) =>
    new BufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  const position = attribute(3);
  const size = attribute(1);
  const color = attribute(3);
  const frame = attribute(1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('size', size);
  geometry.setAttribute('color', color);
  geometry.setAttribute('frameIndex', frame);
  geometry.setDrawRange(0, 0);

  const points = unpickable(new Points(geometry, material));
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  scene.add(points);
  return { points, gate: new DrawGate([points]), position, size, color, frame, drawn: 0 };
}

/** Draw the first `count` particles written into `buffer` this frame. */
export function commitParticles(buffer: ParticleBuffer, count: number): void {
  if (count > 0 || buffer.drawn > 0) {
    buffer.position.needsUpdate = true;
    buffer.size.needsUpdate = true;
    buffer.color.needsUpdate = true;
    buffer.frame.needsUpdate = true;
  }
  buffer.points.geometry.setDrawRange(0, count);
  buffer.gate.setCount(count);
  buffer.drawn = count;
}
