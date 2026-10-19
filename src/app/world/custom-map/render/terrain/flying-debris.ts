import {
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
} from 'three';
import { addHeightFog } from '../environment/height-fog';

/** Pieces in the air at most; the oldest gives way */
export const MAX_FLYING = 768;
/** Metres per second² the pieces fall with */
const GRAVITY = 9.81;

/** A repeatable number 0..1 from a seed and a counter */
function rand(seed: number, n: number): number {
  let h = Math.imul((seed * 1000) | 0, 0x27d4eb2d) ^ Math.imul(n + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Pieces thrown out of a structure as it falls (docs/DESTRUCTION_PLAN.md,
 * Z3): each flies a parabola from its start, turning, until it comes down on
 * the ground it started over, where the heap's own pieces lie
 * (rubble-pieces.ts). The flight is the vertex shader's, from the start,
 * velocity and time each piece got when it was thrown: no work on the CPU
 * per frame but the clock, one draw call for all, a fixed pool whose oldest
 * slot a new piece takes.
 */
export class FlyingDebris {
  readonly mesh: InstancedMesh<BufferGeometry, MeshStandardMaterial>;
  /** x, y, z (scene) and the second it was thrown */
  private readonly start: InstancedBufferAttribute;
  /** Velocity (scene, m/s) and how long it flies */
  private readonly velocity: InstancedBufferAttribute;
  private readonly uniforms = { uDebrisTime: { value: 0 } };
  private next = 0;
  private readonly color = new Color();
  private readonly scale = new Matrix4();

  constructor() {
    const geometry = new IcosahedronGeometry(0.3, 0);
    // Flattened and pushed about: chips and slabs rather than balls
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 1.3, p.getY(i) * 0.55, p.getZ(i) * (0.8 + rand(i, 3) * 0.4));
    geometry.computeVertexNormals();
    this.start = new InstancedBufferAttribute(new Float32Array(MAX_FLYING * 4).fill(0), 4);
    this.velocity = new InstancedBufferAttribute(new Float32Array(MAX_FLYING * 4).fill(0), 4);
    geometry.setAttribute('aDebrisStart', this.start);
    geometry.setAttribute('aDebrisVelocity', this.velocity);
    const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
    material.name = 'custom-map-flying-debris';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uDebrisTime;\nattribute vec4 aDebrisStart;\nattribute vec4 aDebrisVelocity;`)
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          // Where the piece is now: its parabola from the start, turned about its flight; nowhere outside its flight
          float t = uDebrisTime - aDebrisStart.w;
          float flies = step(0.0, t) * step(t, aDebrisVelocity.w);
          vec3 v = aDebrisVelocity.xyz;
          float spin = t * (4.0 + 3.0 * fract(aDebrisStart.w * 13.7));
          vec3 axis = normalize(vec3(v.z + 0.3, 0.7, -v.x + 0.1));
          float c = cos(spin);
          float s = sin(spin);
          vec3 p = transformed * c + cross(axis, transformed) * s + axis * dot(axis, transformed) * (1.0 - c);
          #ifdef USE_INSTANCING
            p = mat3(instanceMatrix) * p;
          #endif
          vec3 at = aDebrisStart.xyz + v * t + vec3(0.0, -0.5 * ${GRAVITY.toFixed(2)} * t * t, 0.0);
          vec4 mvPosition = modelViewMatrix * vec4(at + p * flies, 1.0);
          gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    material.customProgramCacheKey = () => 'custom-map-flying-debris-1';
    addHeightFog(material);
    this.mesh = new InstancedMesh(geometry, material, MAX_FLYING);
    this.mesh.name = 'custom-map-flying-debris';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData['losTransparent'] = true;
    for (let i = 0; i < MAX_FLYING; i++) this.mesh.setColorAt(i, this.color.setRGB(0.3, 0.3, 0.3));
  }

  /** The view's clock, seconds: moves every piece in the air */
  set time(seconds: number) {
    this.uniforms.uDebrisTime.value = seconds;
  }

  get time(): number {
    return this.uniforms.uDebrisTime.value;
  }

  /**
   * A structure falls at scene (`x`, `z`) over ground `groundY`: `count`
   * pieces thrown up and out from its body (radius and height, m), tinted
   * from `colour` (linear RGB), rolled from `seed`
   */
  burst(x: number, groundY: number, z: number, radius: number, height: number, colour: readonly [number, number, number], count: number, seed: number): void {
    const now = this.time;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_FLYING;
      const a = rand(seed, k * 5) * Math.PI * 2;
      const out = 2 + rand(seed, k * 5 + 1) * (3 + radius * 0.8);
      const up = 3 + rand(seed, k * 5 + 2) * (4 + height * 0.5);
      const y0 = groundY + height * (0.2 + rand(seed, k * 5 + 3) * 0.6);
      const r0 = radius * 0.6 * rand(seed, k * 5 + 4);
      // Up and down to the ground it started over: the larger root of y0 + up t - g t²/2 = ground
      const drop = y0 - groundY;
      const flight = (up + Math.sqrt(up * up + 2 * GRAVITY * drop)) / GRAVITY;
      this.start.setXYZW(i, x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0, now + rand(seed, k * 5 + 7) * 0.25);
      this.velocity.setXYZW(i, Math.cos(a) * out, up, Math.sin(a) * out, flight);
      const s = 0.6 + rand(seed, k * 5 + 8) * (0.9 + radius * 0.05);
      this.mesh.setMatrixAt(i, this.scale.makeScale(s, s, s));
      const tone = 0.65 + rand(seed, k * 5 + 9) * 0.55;
      this.mesh.setColorAt(i, this.color.setRGB(colour[0] * tone, colour[1] * tone, colour[2] * tone));
    }
    this.start.needsUpdate = true;
    this.velocity.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
