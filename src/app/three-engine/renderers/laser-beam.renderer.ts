/**
 * Laser beams of the Sentinel Laser (attackType 'laser'): a straight ribbon
 * from the lens to the target, turned to face the camera about its own axis,
 * and a glow where it lands. The simulation sends each beam once per frame
 * with its heat (laserBeams ops, TowerCombatService.flushBeams): cold a thin
 * red line, hot a wide white-hot core with an orange corona and a bigger
 * glow, pulses running down it faster the hotter it is.
 *
 * Every beam is one instance of a static quad strip (one Mesh over an
 * InstancedBufferGeometry, one ShaderMaterial, one draw call), the glows one
 * Sprite each from a pool. Additive light in display values (displayLight),
 * log depth for the tiles.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type Scene,
  type Vector3,
} from 'three';
import { DISPLAY_OUTPUT_GLSL } from './display-output';
import { radialTexture, unpickable } from './effect-buffers';

/** Lasers shown at once at most */
const MAX_BEAMS = 64;
/** Half-width of the ribbon cold and hot, m */
const HALF_WIDTH_COLD = 0.12;
const HALF_WIDTH_HOT = 0.45;
/** Glow at the target cold and hot, m across */
const GLOW_COLD = 2.5;
const GLOW_HOT = 7;

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute float aT;
  attribute float aSide;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aHeat;

  varying float vSide;
  varying float vAlong;
  varying float vHeat;
  varying float vLength;

  void main() {
    vec3 line = aEnd - aStart;
    float len = max(length(line), 0.0001);
    vec3 dir = line / len;
    vec3 spine = aStart + line * aT;
    vec3 toCamera = normalize(cameraPosition - spine);
    vec3 side = cross(dir, toCamera);
    side = length(side) < 0.001 ? normalize(cross(dir, vec3(0.0, 1.0, 0.0))) : normalize(side);
    float halfWidth = mix(${HALF_WIDTH_COLD.toFixed(3)}, ${HALF_WIDTH_HOT.toFixed(3)}, aHeat);
    vSide = aSide;
    vAlong = aT * len;
    vHeat = aHeat;
    vLength = len;
    gl_Position = projectionMatrix * viewMatrix * vec4(spine + side * aSide * halfWidth, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>
  ${DISPLAY_OUTPUT_GLSL}

  uniform float uTime;
  varying float vSide;
  varying float vAlong;
  varying float vHeat;
  varying float vLength;

  void main() {
    float d = abs(vSide);
    float core = exp(-d * d / 0.04);
    float corona = exp(-d * d / 0.35);
    // Pulses running from the lens to the target, faster and denser when hot
    float pulse = pow(max(sin(vAlong * mix(0.6, 1.4, vHeat) - uTime * mix(18.0, 46.0, vHeat)), 0.0), 4.0);
    vec3 cold = vec3(1.0, 0.18, 0.08);
    vec3 hot = vec3(1.0, 0.62, 0.22);
    vec3 coronaColour = mix(cold, hot, vHeat);
    vec3 coreColour = mix(vec3(1.0, 0.55, 0.45), vec3(1.0, 0.97, 0.9), vHeat);
    // A short fade at the lens, so the ribbon's end does not show as a cut
    float start = smoothstep(0.0, 0.6, vAlong);
    float light = mix(0.9, 1.6, vHeat) * (1.0 + 0.35 * pulse);
    vec3 colour = (coreColour * core + coronaColour * corona * 0.8) * light * start;
    float alpha = clamp(core + corona * 0.7, 0.0, 1.0);
    if (alpha < 0.01) discard;
    gl_FragColor = displayLight(vec4(colour, alpha));
    #include <logdepthbuf_fragment>
  }
`;

interface Beam {
  slot: number;
  glow: Sprite;
}

export class LaserBeamRenderer {
  private readonly geometry = new InstancedBufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly start = new InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
  private readonly end = new InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
  private readonly heat = new InstancedBufferAttribute(new Float32Array(MAX_BEAMS), 1);
  private readonly glowMaterial: SpriteMaterial;
  private readonly glows: Sprite[] = [];
  private readonly beams = new Map<string, Beam>();
  /** Tower id by slot, the slots 0 to beams.size - 1 taken */
  private readonly slots: string[] = [];
  private dirty = false;

  constructor(private readonly scene: Scene) {
    // Two vertices at each end, across the ribbon
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    this.geometry.setAttribute('aT', new BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
    this.geometry.setAttribute('aSide', new BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
    this.geometry.setIndex([0, 2, 1, 1, 2, 3]);
    this.geometry.setAttribute('aStart', this.start);
    this.geometry.setAttribute('aEnd', this.end);
    this.geometry.setAttribute('aHeat', this.heat);
    this.geometry.instanceCount = 0;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = unpickable(new Mesh(this.geometry, this.material));
    // Its vertices come from the shader, the geometry's bounds are the origin
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1001;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.glowMaterial = new SpriteMaterial({
      map: radialTexture(64, (r) => (1 - r) * (1 - r)),
      color: 0xff7a3a,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  /** The beam of `towerId` this frame, from `source` to `target`, `heat` 0 cold to 1 hot. */
  startBeam(towerId: string, source: Vector3, target: Vector3, heat: number): void {
    let beam = this.beams.get(towerId);
    if (!beam) {
      if (this.slots.length >= MAX_BEAMS) return;
      beam = { slot: this.slots.length, glow: this.takeGlow() };
      this.slots.push(towerId);
      this.beams.set(towerId, beam);
    }
    const i = beam.slot;
    this.start.setXYZ(i, source.x, source.y, source.z);
    this.end.setXYZ(i, target.x, target.y, target.z);
    this.heat.setX(i, heat);
    beam.glow.position.copy(target);
    const size = GLOW_COLD + (GLOW_HOT - GLOW_COLD) * heat;
    beam.glow.scale.set(size, size, 1);
    beam.glow.material.opacity = 0.6 + 0.6 * heat;
    beam.glow.visible = true;
    this.dirty = true;
  }

  /** The beam of `towerId` went out: the last slot moves into its place. */
  stopBeam(towerId: string): void {
    const beam = this.beams.get(towerId);
    if (!beam) return;
    this.beams.delete(towerId);
    beam.glow.visible = false;
    this.glows.push(beam.glow);
    const last = this.slots.length - 1;
    const movedId = this.slots[last];
    this.slots.pop();
    if (beam.slot !== last) {
      const moved = this.beams.get(movedId)!;
      this.start.setXYZ(beam.slot, this.start.getX(last), this.start.getY(last), this.start.getZ(last));
      this.end.setXYZ(beam.slot, this.end.getX(last), this.end.getY(last), this.end.getZ(last));
      this.heat.setX(beam.slot, this.heat.getX(last));
      moved.slot = beam.slot;
      this.slots[beam.slot] = movedId;
    }
    this.dirty = true;
  }

  clear(): void {
    for (const towerId of [...this.beams.keys()]) this.stopBeam(towerId);
  }

  /** Once per render frame: the shader clock, and the beams of the frame to the GPU. */
  update(timeSeconds: number): void {
    this.material.uniforms['uTime'].value = timeSeconds;
    if (!this.dirty) return;
    this.dirty = false;
    this.geometry.instanceCount = this.slots.length;
    this.mesh.visible = this.slots.length > 0;
    this.start.needsUpdate = true;
    this.end.needsUpdate = true;
    this.heat.needsUpdate = true;
  }

  /** Lasers on now */
  get count(): number {
    return this.slots.length;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const glow of this.glows) {
      this.scene.remove(glow);
      glow.material.dispose();
    }
    this.glowMaterial.map?.dispose();
    this.glowMaterial.dispose();
  }

  private takeGlow(): Sprite {
    const pooled = this.glows.pop();
    if (pooled) return pooled;
    // A material each: their opacity follows their beam's heat
    const glow = unpickable(new Sprite(this.glowMaterial.clone()));
    glow.renderOrder = 1002;
    glow.visible = false;
    this.scene.add(glow);
    return glow;
  }
}
