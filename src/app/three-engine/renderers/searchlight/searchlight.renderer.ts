import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Uniform,
  Vector3,
  type Scene,
} from 'three';
import type { CoordinateSync } from '../index';
import { InstanceSlotAllocator } from '../instance-slot-allocator';
import { DrawGate } from '../draw-gate';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';
import type { TowerTypeConfig } from '../../../configs/tower-types.config';

/** More towers than any run places; one past it gets no light */
const MAX_SEARCHLIGHTS = 256;
/** Segments around the cone */
const CONE_SEGMENTS = 24;
/**
 * Transparent, so after the blood moon's mood quad: the beams are light in
 * the red night, not tinted by it. Before the smoke (997) and the particle
 * pools (999), so smoke in front of a beam still dims it.
 */
const SEARCHLIGHT_ORDER = 960;

const DEG = Math.PI / 180;

/** What a tower needs for a searchlight, from its type config. */
export type SearchlightTowerConfig = Pick<TowerTypeConfig, 'attackType' | 'heightOffset' | 'shootHeight'>;

/**
 * Where the towers aim (ThreeTowerRenderer.aimHeading): the geo heading of
 * tower `id`'s turret, null while its model is still loading.
 */
export interface SearchlightAim {
  aimHeading(id: string): number | null;
}

/**
 * Height of the lamp above the tower's foot (m): just over its shoot
 * height, at least minLampHeight. null for a passive building (the Research
 * Center), which gets no searchlight.
 */
export function searchlightLampHeight(config: SearchlightTowerConfig): number | null {
  if (config.attackType === 'passive') return null;
  const { lampLift, minLampHeight } = BLOOD_MOON_LOOK.searchlights;
  return Math.max(config.heightOffset + config.shootHeight, minLampHeight) + lampLift;
}

/**
 * Yaw of the beam's axis for a geo heading (0 = north, clockwise). The cone
 * points along +Z; the scene has -X east and +Z north
 * (EllipsoidSync.geoToLocalSimple), so heading h lies at (-sin h, 0, cos h),
 * which a turn of -h about Y gives. The turret takes the same -h
 * (headingToLocalRotation).
 */
export function headingToSearchlightYaw(heading: number): number {
  return -heading;
}

/**
 * Open cone of length 1 along +Z, apex at the origin, radius tan(half
 * angle) at the far end. One triangle per segment; the apex vertices carry
 * the normal of their segment's middle, so the surface shades smoothly.
 */
export function createSearchlightConeGeometry(halfAngleRad: number, segments = CONE_SEGMENTS): BufferGeometry {
  const radius = Math.tan(halfAngleRad);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const normal = new Vector3();
  const step = (Math.PI * 2) / segments;
  // Apex ring: one vertex per segment, normal at the segment's middle
  for (let i = 0; i < segments; i++) {
    const a = (i + 0.5) * step;
    normal.set(Math.cos(a), Math.sin(a), -radius).normalize();
    positions.push(0, 0, 0);
    normals.push(normal.x, normal.y, normal.z);
  }
  // Far ring
  for (let i = 0; i < segments; i++) {
    const a = i * step;
    normal.set(Math.cos(a), Math.sin(a), -radius).normalize();
    positions.push(Math.cos(a) * radius, Math.sin(a) * radius, 1);
    normals.push(normal.x, normal.y, normal.z);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(i, segments + i, segments + ((i + 1) % segments));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

const SEARCHLIGHT_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aLamp;   // lamp, scene coordinates
  attribute vec2 aBeam;   // yaw, length (0 = free or hidden slot)

  uniform float uPitch;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vAlong;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  // Tip the cone's +Z axis down by the pitch (about X), then turn it by yaw (about Y)
  vec3 aim(vec3 v, float cp, float sp, float cy, float sy) {
    v = vec3(v.x, v.y * cp - v.z * sp, v.y * sp + v.z * cp);
    return vec3(v.x * cy + v.z * sy, v.y, -v.x * sy + v.z * cy);
  }

  void main() {
    // A free slot collapses to a clipped vertex and never rasterizes
    if (aBeam.y <= 0.0) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vWorldPosition = vec3(0.0);
      vNormal = vec3(0.0, 1.0, 0.0);
      vAlong = 1.0;
      return;
    }
    float cp = cos(uPitch);
    float sp = sin(uPitch);
    float cy = cos(aBeam.x);
    float sy = sin(aBeam.x);

    vec3 world = aLamp + aim(position * aBeam.y, cp, sp, cy, sy);
    vWorldPosition = world;
    vNormal = aim(normal, cp, sp, cy, sy);
    vAlong = position.z;

    // The mesh sits at the scene origin, the lamp is in scene coordinates
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const SEARCHLIGHT_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vAlong;

  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    // Walls that face the camera are the middle of the beam as seen, the
    // outline fades out: both walls add up to a soft shaft of light
    vec3 toCamera = normalize(cameraPosition - vWorldPosition);
    float facing = abs(dot(normalize(vNormal), toCamera));
    float fall = 1.0 - vAlong;
    vec3 light = uColor * (uIntensity * facing * facing * fall * fall);
    // Given in display values: decoded, then encoded for the target, it
    // shows as it is on the canvas and as linear light through the
    // post-processing target (same as the portal's summoning circle)
    gl_FragColor = linearToOutputTexel(sRGBTransferEOTF(vec4(light, 1.0)));
  }
`;

function noRaycast(): void {
  // light, nothing to pick
}

/** One tower's light. */
interface Searchlight {
  index: number;
  /** false while the wave replay hides the tower */
  visible: boolean;
  /** Yaw last written to the slot, NaN until the tower's aim is known */
  yaw: number;
}

/**
 * SearchlightRenderer: searchlights on the towers under the blood moon
 * (BLOOD_MOON_LOOK.searchlights). All beams are one mesh over an
 * InstancedBufferGeometry, one draw call.
 *
 * A beam points where its tower aims (SearchlightAim): along the turret, so
 * it swings onto each target with it and holds the heading the turret
 * holds; for a tower without a turret part along the aim that tower turns
 * all the same. BloodMoonLook calls aim() every frame the beams show; only
 * the slots whose tower turned get written, and a frame without a turn
 * uploads nothing.
 *
 * Kept apart from ThreeTowerRenderer, like the plinths: TowerManager adds a
 * light when it places a tower and removes it with the tower. The lamp
 * stands on the tower's foot (`position.height`, the top of a plinth if the
 * tower has one), so it follows the plinth. BloodMoonLook sets the
 * brightness; at 0 the mesh is out of the render list.
 */
export class SearchlightRenderer {
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly gate: DrawGate;
  private readonly slots = new InstanceSlotAllocator(MAX_SEARCHLIGHTS);
  private readonly lights = new Map<string, Searchlight>();
  private readonly lampAttribute: InstancedBufferAttribute;
  private readonly beamAttribute: InstancedBufferAttribute;
  private readonly lamp = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly sync: CoordinateSync,
    private readonly towerAim: SearchlightAim,
  ) {
    const look = BLOOD_MOON_LOOK.searchlights;
    const cone = createSearchlightConeGeometry(look.halfAngleDeg * DEG);
    const geometry = new InstancedBufferGeometry();
    geometry.setIndex(cone.getIndex());
    geometry.setAttribute('position', cone.getAttribute('position'));
    geometry.setAttribute('normal', cone.getAttribute('normal'));
    geometry.instanceCount = 0;
    this.lampAttribute = new InstancedBufferAttribute(new Float32Array(MAX_SEARCHLIGHTS * 3), 3);
    this.beamAttribute = new InstancedBufferAttribute(new Float32Array(MAX_SEARCHLIGHTS * 2), 2);
    geometry.setAttribute('aLamp', this.lampAttribute);
    geometry.setAttribute('aBeam', this.beamAttribute);
    this.geometry = geometry;

    this.material = new ShaderMaterial({
      vertexShader: SEARCHLIGHT_VERTEX_SHADER,
      fragmentShader: SEARCHLIGHT_FRAGMENT_SHADER,
      uniforms: {
        uPitch: new Uniform(look.pitchDeg * DEG),
        uColor: new Uniform(new Vector3(look.color.r, look.color.g, look.color.b)),
        uIntensity: new Uniform(0),
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      // Additive: back and front walls in one pass, the order does not matter
      forceSinglePass: true,
    });

    // The geometry's bounding sphere is the cone at the origin, not where the
    // lamps are, so no frustum culling
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'searchlights';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = SEARCHLIGHT_ORDER;
    this.mesh.raycast = noRaycast;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.gate = new DrawGate([this.mesh]);
    this.gate.setShown(false);
    scene.add(this.mesh);
  }

  /**
   * Searchlight on tower `id`, its foot at `footHeight` (the tower's
   * position.height), pointing where the tower aims. It stays dark until
   * that aim is known (the tower's model still loading). A passive building
   * gets none. Replaces an earlier light.
   */
  add(id: string, lat: number, lon: number, footHeight: number, config: SearchlightTowerConfig): void {
    this.remove(id);
    const lampHeight = searchlightLampHeight(config);
    if (lampHeight === null) return;
    const index = this.slots.alloc();
    if (index < 0) return;
    const light: Searchlight = { index, visible: true, yaw: NaN };
    this.lights.set(id, light);
    this.syncDrawCount();

    const lamp = this.sync.geoToLocalSimpleInto(lat, lon, footHeight + lampHeight, this.lamp);
    this.lampAttribute.setXYZ(index, lamp.x, lamp.y, lamp.z);
    this.slots.uploadSlot(this.lampAttribute, index);
    this.aimLight(id, light);
    this.writeBeam(light);
    this.slots.uploadSlot(this.beamAttribute, index);
  }

  /**
   * Point every beam where its tower aims now. Per frame while the beams
   * show; uploads the drawn slots once if any tower turned, else nothing.
   */
  aim(): void {
    let turned = false;
    for (const [id, light] of this.lights) {
      if (this.aimLight(id, light)) {
        this.writeBeam(light);
        turned = true;
      }
    }
    if (!turned) return;
    this.beamAttribute.clearUpdateRanges();
    this.beamAttribute.addUpdateRange(0, this.slots.activeCount * 2);
    this.beamAttribute.needsUpdate = true;
  }

  /**
   * Hide the beam of tower `id` or show it again, its slot kept: the wave
   * replay hides the towers not built yet at the moment it shows. A tower
   * without a light is left alone.
   */
  setVisible(id: string, visible: boolean): void {
    const light = this.lights.get(id);
    if (!light) return;
    light.visible = visible;
    this.writeBeam(light);
    this.slots.uploadSlot(this.beamAttribute, light.index);
  }

  /** Take the searchlight of tower `id` away, if it has one. */
  remove(id: string): void {
    const light = this.lights.get(id);
    if (!light) return;
    // Length 0: the shader collapses the slot until it is handed out again
    this.beamAttribute.setY(light.index, 0);
    this.slots.uploadSlot(this.beamAttribute, light.index);
    this.lights.delete(id);
    this.slots.release(light.index);
    this.syncDrawCount();
  }

  /** Remove every searchlight. */
  clear(): void {
    this.lights.clear();
    this.slots.reset();
    this.syncDrawCount();
    (this.beamAttribute.array as Float32Array).fill(0);
    this.beamAttribute.clearUpdateRanges();
    this.beamAttribute.needsUpdate = true;
  }

  /** Brightness of every beam, 0..1 (the blood moon fade); at 0 the mesh leaves the render list. */
  setAmount(amount: number): void {
    const k = Math.min(1, Math.max(0, amount));
    this.material.uniforms['uIntensity'].value = BLOOD_MOON_LOOK.searchlights.intensity * k;
    this.gate.setShown(k > 0);
  }

  get count(): number {
    return this.lights.size;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Take over where tower `id` aims. @returns true when the yaw changed */
  private aimLight(id: string, light: Searchlight): boolean {
    const heading = this.towerAim.aimHeading(id);
    if (heading === null) return false;
    const yaw = headingToSearchlightYaw(heading);
    if (yaw === light.yaw) return false;
    light.yaw = yaw;
    return true;
  }

  /** Yaw and length into the slot; length 0 while hidden or not aimed yet */
  private writeBeam(light: Searchlight): void {
    const shown = light.visible && !Number.isNaN(light.yaw);
    this.beamAttribute.setXY(light.index, shown ? light.yaw : 0, shown ? BLOOD_MOON_LOOK.searchlights.length : 0);
  }

  /** Draw count follows the slot allocator; the gate hides the mesh while no slot is drawn. */
  private syncDrawCount(): void {
    this.geometry.instanceCount = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }
}
