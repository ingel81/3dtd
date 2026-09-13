import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  MathUtils,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Uniform,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { EMP_PULSE_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';
import { commitParticles, particleBuffer, radialTexture, reach, unpickable, type ParticleBuffer } from './effect-buffers';

const SPARKS = LOOK.sparks.count;
/** Random numbers per spark, drawn once per pulse */
const SEEDS = 4;
const TAU = Math.PI * 2;
const RINGS = LOOK.rings.length;

/** Above the strike marker (950) and the other abilities' ground rings, under the particle pools (999) */
const RING_ORDER = 955;
const DOME_ORDER = 956;
const SPARK_ORDER = 996;
const FLASH_ORDER = 1002;
/** Rings above the ground point, m */
const RING_LIFT = 0.6;

/**
 * An electric front on the ground: a thin band at the edge of the quad,
 * jagged by noise around the circle and crackling in time. The mesh is
 * scaled to the front's radius; `uWidth` is the band's half width as a
 * share of it. Additive, linear light out, encoded for the canvas
 * (colorspace_fragment; left linear for the post-processing target).
 */
const RING_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uWidth;
  uniform float uSeed;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  float hash1(float p) {
    return fract(sin(p * 12.9898 + uSeed * 78.233) * 43758.5453);
  }
  float noise1(float p) {
    float i = floor(p);
    float f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash1(i), hash1(i + 1.0), f);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // Around the circle in turns, wrapped so the seam does not show
    float a = atan(p.y, p.x) / 6.28318530718 + 0.5;
    float jag = (noise1(a * 18.0 + uTime * 9.0) - 0.5) * 0.08 + (noise1(a * 57.0 - uTime * 17.0) - 0.5) * 0.04;
    float d = abs(r - (0.92 + jag));
    float band = exp(-(d * d) / (uWidth * uWidth));
    float core = exp(-(d * d) / (0.09 * uWidth * uWidth));
    float crackle = 0.6 + 0.4 * noise1(a * 7.0 + uTime * 31.0);
    float alpha = clamp((band * 0.7 + core) * crackle, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(mix(uColor, uCore, core), alpha);
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }
`;

/** Shell over the pulse: additive, faint where it faces the camera, bright along its outline. */
const DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float outline = pow(1.0 - facing, 2.5);
    gl_FragColor = vec4(uColor, uOpacity * (0.12 + 0.88 * outline));
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }
`;

interface Pulse {
  active: boolean;
  /** Game seconds since the impact */
  t: number;
  /** Ground point, local coordinates */
  x: number;
  y: number;
  z: number;
  radiusM: number;
  /** Radius over LOOK.referenceRadius */
  scale: number;
  /** Sparks too, or flash, fronts and shell only (impact effects off) */
  full: boolean;
  /** Order of the pulses, the oldest makes room */
  born: number;
}

function rgb(color: EffectRgb): Vector3 {
  return new Vector3(color.r, color.g, color.b);
}

/** Radius of front `ring` at `t` game seconds after the impact, m; 0 before it starts. */
function frontRadius(ring: (typeof LOOK.rings)[number], radiusM: number, t: number): number {
  const age = t - ring.delay;
  if (age <= 0) return 0;
  return radiusM * ring.radius * reach(age, ring.duration, ring.timeConstant);
}

/**
 * Pulse of the EMP (EMP_PULSE_LOOK): a blue-white flash, two electric
 * fronts running out over the radius, jagged and crackling, a faint shell
 * over it, and sparks crackling along the first front as it passes.
 *
 * Like the mushroom cloud and the frost burst it runs in game time: the
 * fronts' noise, the sparks and the fades are functions of the pulse's
 * age, so a pause holds it and the timescale plays it faster. Fronts and
 * shell are ShaderMaterials with the log depth chunks and the output
 * encoding, fronts and flash with the depth test off like the strike
 * marker. Sparks are round additive particles with the trail pools'
 * material in a buffer of their own. Nothing allocated per frame.
 */
export class EmpPulseRenderer {
  private readonly pulses: Pulse[] = [];
  private activeCount = 0;
  private sequence = 0;
  /** Sparks (VFX settings: impact effects) */
  private full = true;

  private readonly seeds = new Float32Array(LOOK.pulses * SPARKS * SEEDS);
  private readonly sparks: ParticleBuffer;

  private readonly plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  /** Upper half of a unit sphere */
  private readonly domeGeometry = new SphereGeometry(1, 32, 10, 0, TAU, 0, Math.PI / 2);
  private readonly flashTexture: DataTexture;
  /** RINGS per pulse slot, slot-major */
  private readonly rings: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly domes: Mesh<SphereGeometry, ShaderMaterial>[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly ringGates: DrawGate[] = [];
  private readonly domeGates: DrawGate[] = [];
  private readonly flashGates: DrawGate[] = [];

  private sizePerMetre = 0;

  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
  ) {
    for (let i = 0; i < LOOK.pulses; i++) {
      this.pulses.push({ active: false, t: 0, x: 0, y: 0, z: 0, radiusM: 0, scale: 1, full: true, born: 0 });
    }
    this.sparks = particleBuffer(scene, LOOK.pulses * SPARKS, materials.additive, SPARK_ORDER);
    this.flashTexture = radialTexture(64, (r) => (1 - r) ** 2);

    const { colors, flash } = LOOK;
    for (let slot = 0; slot < LOOK.pulses; slot++) {
      for (let r = 0; r < RINGS; r++) {
        const material = new ShaderMaterial({
          vertexShader: RING_VERTEX_SHADER,
          fragmentShader: RING_FRAGMENT_SHADER,
          uniforms: {
            uColor: new Uniform(rgb(colors.ring)),
            uCore: new Uniform(rgb(colors.ringCore)),
            uOpacity: new Uniform(0),
            uTime: new Uniform(0),
            uWidth: new Uniform(0.05),
            uSeed: new Uniform(slot * RINGS + r),
          },
          transparent: true,
          blending: AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
        });
        const ring = unpickable(new Mesh(this.plane, material));
        ring.frustumCulled = false;
        ring.renderOrder = RING_ORDER;
        scene.add(ring);
        this.rings.push(ring);
        this.ringGates.push(new DrawGate([ring]));
      }

      const domeMaterial = new ShaderMaterial({
        vertexShader: DOME_VERTEX_SHADER,
        fragmentShader: DOME_FRAGMENT_SHADER,
        uniforms: {
          uColor: new Uniform(rgb(colors.dome)),
          uOpacity: new Uniform(0),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const dome = unpickable(new Mesh(this.domeGeometry, domeMaterial));
      dome.frustumCulled = false;
      dome.renderOrder = DOME_ORDER;
      scene.add(dome);
      this.domes.push(dome);
      this.domeGates.push(new DrawGate([dome]));

      const flashMaterial = new SpriteMaterial({
        map: this.flashTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      flashMaterial.color.setRGB(colors.flash.r * flash.intensity, colors.flash.g * flash.intensity, colors.flash.b * flash.intensity);
      const sprite = unpickable(new Sprite(flashMaterial));
      sprite.frustumCulled = false;
      sprite.renderOrder = FLASH_ORDER;
      scene.add(sprite);
      this.flashes.push(sprite);
      this.flashGates.push(new DrawGate([sprite]));
    }
  }

  /** Pulses still showing something. */
  get activePulses(): number {
    return this.activeCount;
  }

  /** Sparks too, or flash, fronts and shell only (VFX settings: impact effects). Takes hold with the next pulse. */
  setFull(full: boolean): void {
    this.full = full;
  }

  /** An EMP went off on `ground` (local coordinates, on the ground) with `radiusM`. */
  pulse(ground: Vector3, radiusM: number): void {
    let slot = 0;
    for (let i = 0; i < this.pulses.length; i++) {
      if (!this.pulses[i].active) {
        slot = i;
        break;
      }
      if (this.pulses[i].born < this.pulses[slot].born) slot = i;
    }
    const pulse = this.pulses[slot];
    if (!pulse.active) this.activeCount++;

    pulse.active = true;
    pulse.t = 0;
    pulse.x = ground.x;
    pulse.y = ground.y;
    pulse.z = ground.z;
    pulse.radiusM = radiusM;
    pulse.scale = radiusM / LOOK.referenceRadius;
    pulse.full = this.full;
    pulse.born = ++this.sequence;

    const start = slot * SPARKS * SEEDS;
    for (let i = start; i < start + SPARKS * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /**
   * Once per rendered frame.
   * @param gameDeltaMs - the frame in game time: 0 while paused, the frame times the timescale otherwise
   * @param camera - turns metres into point sizes
   * @param viewportHeight - drawing buffer height in pixels; the particle shader sizes in pixels
   */
  update(gameDeltaMs: number, camera: PerspectiveCamera, viewportHeight: number): void {
    if (this.activeCount === 0) return;

    const dt = gameDeltaMs / 1000;
    for (const pulse of this.pulses) {
      if (!pulse.active) continue;
      pulse.t += dt;
      if (pulse.t >= EmpPulseRenderer.DURATION) {
        pulse.active = false;
        this.activeCount--;
      }
    }
    this.sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);

    let sparkCount = 0;
    for (let slot = 0; slot < this.pulses.length; slot++) {
      const pulse = this.pulses[slot];
      if (!pulse.active) {
        for (let r = 0; r < RINGS; r++) this.ringGates[slot * RINGS + r].setCount(0);
        this.domeGates[slot].setCount(0);
        this.flashGates[slot].setCount(0);
        continue;
      }
      if (pulse.full) sparkCount = this.writeSparks(pulse, slot, sparkCount);
      this.updateRings(pulse, slot);
      this.updateDome(pulse, slot);
      this.updateFlash(pulse, slot);
    }
    commitParticles(this.sparks, sparkCount);
  }

  /** Game seconds until the last of a pulse is gone. */
  static readonly DURATION = Math.max(
    ...LOOK.rings.map((ring) => ring.delay + ring.duration),
    LOOK.dome.duration,
    LOOK.flash.duration,
    LOOK.sparks.until + LOOK.sparks.life[1],
  );

  /** Drop every pulse (restart). */
  clear(): void {
    for (const pulse of this.pulses) pulse.active = false;
    this.activeCount = 0;
    commitParticles(this.sparks, 0);
    for (const gate of [...this.ringGates, ...this.domeGates, ...this.flashGates]) gate.setCount(0);
  }

  /** Remove and free everything but the particle material, which belongs to the trail pools. */
  dispose(): void {
    this.clear();
    this.scene.remove(this.sparks.points);
    this.sparks.points.geometry.dispose();
    for (const mesh of [...this.rings, ...this.domes]) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    for (const sprite of this.flashes) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.plane.dispose();
    this.domeGeometry.dispose();
    this.flashTexture.dispose();
  }

  /**
   * Sparks: each is born on the first front where it stands at its birth
   * time, a little off it, and crackles in place for its short life, bright
   * at first. Born until `until`, so the front drags a trail of them.
   */
  private writeSparks(pulse: Pulse, slot: number, n: number): number {
    const { life, size, lift, until } = LOOK.sparks;
    const { spark, sparkCore } = LOOK.colors;
    const first = LOOK.rings[0];
    const position = this.sparks.position.array as Float32Array;
    const color = this.sparks.color.array as Float32Array;
    const sizes = this.sparks.size.array as Float32Array;
    const frames = this.sparks.frame.array as Float32Array;
    const base = slot * SPARKS * SEEDS;

    for (let i = 0; i < SPARKS; i++) {
      const s = base + i * SEEDS;
      const born = first.delay + until * this.seeds[s];
      const lifeS = MathUtils.lerp(life[0], life[1], this.seeds[s + 1]);
      const age = pulse.t - born;
      if (age < 0 || age >= lifeS) continue;
      const fade = 1 - age / lifeS;
      // Crackle: the brightness jumps with the age, the same at every frame rate
      const crackle = 0.55 + 0.45 * Math.abs(Math.sin((age * 90 + this.seeds[s + 2] * 13) * 1.7));
      const light = fade * crackle * 1.6;

      const angle = (i / SPARKS + 0.5 * this.seeds[s + 3] / SPARKS) * TAU;
      const distance = frontRadius(first, pulse.radiusM, born) + (this.seeds[s + 2] - 0.5) * 2;
      position[n * 3] = pulse.x + Math.cos(angle) * distance;
      position[n * 3 + 1] = pulse.y + RING_LIFT + MathUtils.lerp(lift[0], lift[1], this.seeds[s + 3]);
      position[n * 3 + 2] = pulse.z + Math.sin(angle) * distance;
      const core = this.seeds[s + 1];
      color[n * 3] = MathUtils.lerp(spark.r, sparkCore.r, core) * light;
      color[n * 3 + 1] = MathUtils.lerp(spark.g, sparkCore.g, core) * light;
      color[n * 3 + 2] = MathUtils.lerp(spark.b, sparkCore.b, core) * light;
      sizes[n] = MathUtils.lerp(size[0], size[1], this.seeds[s + 2]) * (0.5 + 0.5 * fade) * this.sizePerMetre;
      frames[n] = -1; // round particle
      n++;
    }
    return n;
  }

  private updateRings(pulse: Pulse, slot: number): void {
    for (let r = 0; r < RINGS; r++) {
      const ring = LOOK.rings[r];
      const gate = this.ringGates[slot * RINGS + r];
      const age = pulse.t - ring.delay;
      if (age <= 0 || age >= ring.duration) {
        gate.setCount(0);
        continue;
      }
      const radius = Math.max(0.01, frontRadius(ring, pulse.radiusM, pulse.t));
      const mesh = this.rings[slot * RINGS + r];
      mesh.position.set(pulse.x, pulse.y + RING_LIFT, pulse.z);
      mesh.scale.set(radius, 1, radius);
      const uniforms = mesh.material.uniforms;
      uniforms['uOpacity'].value = ring.opacity * (1 - age / ring.duration) ** 1.2;
      uniforms['uTime'].value = pulse.t;
      // A band of constant metres: its share shrinks as the front grows
      uniforms['uWidth'].value = Math.min(0.3, (ring.width * pulse.radiusM) / radius);
      gate.setCount(1);
    }
  }

  private updateDome(pulse: Pulse, slot: number): void {
    const { dome } = LOOK;
    const gate = this.domeGates[slot];
    if (pulse.t >= dome.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, pulse.radiusM * dome.radius * reach(pulse.t, dome.duration, dome.timeConstant));
    const mesh = this.domes[slot];
    mesh.position.set(pulse.x, pulse.y, pulse.z);
    mesh.scale.set(radius, radius * dome.flatten, radius);
    mesh.material.uniforms['uOpacity'].value = dome.opacity * (1 - pulse.t / dome.duration) ** 1.5;
    gate.setCount(1);
  }

  private updateFlash(pulse: Pulse, slot: number): void {
    const { flash } = LOOK;
    const gate = this.flashGates[slot];
    if (pulse.t >= flash.duration) {
      gate.setCount(0);
      return;
    }
    const fade = 1 - pulse.t / flash.duration;
    const size = flash.size * pulse.scale * (0.5 + 0.5 * MathUtils.smoothstep(pulse.t, 0, 0.05));
    const sprite = this.flashes[slot];
    sprite.position.set(pulse.x, pulse.y + flash.height * pulse.scale, pulse.z);
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = fade * fade;
    gate.setCount(1);
  }
}
