import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Uniform,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';

const GLOW = LOOK.glowParticles;
const SMOKE = LOOK.smokeParticles;
/** Points of all ember streaks of one cloud */
const EMBER_POINTS = GLOW.embers * LOOK.embers.trail;
const GLOW_PER_CLOUD =
  GLOW.core + GLOW.fireball + GLOW.shell + EMBER_POINTS + GLOW.groundFire + GLOW.stemFire + GLOW.rim;
const SMOKE_PER_CLOUD = SMOKE.cap + SMOKE.dome + SMOKE.stem + SMOKE.dust + SMOKE.skirt + SMOKE.wall;
/** Random numbers per particle, drawn once per strike */
const SEEDS = 4;
/** Staged smoke values per particle: x, y, z, size, r, g, b, frame */
const STAGE = 8;
const TAU = Math.PI * 2;

// Where each glow group's random numbers start within a cloud's block
const CORE_SEEDS = 0;
const BALL_SEEDS = CORE_SEEDS + GLOW.core * SEEDS;
const SHELL_SEEDS = BALL_SEEDS + GLOW.fireball * SEEDS;
const EMBER_SEEDS = SHELL_SEEDS + GLOW.shell * SEEDS;
const GROUND_FIRE_SEEDS = EMBER_SEEDS + EMBER_POINTS * SEEDS;
const STEM_FIRE_SEEDS = GROUND_FIRE_SEEDS + GLOW.groundFire * SEEDS;
const RIM_SEEDS = STEM_FIRE_SEEDS + GLOW.stemFire * SEEDS;
/** Embers launch within this many seconds of the impact */
const EMBER_LAUNCH = 0.12;
/** The last ember streak point is gone after this many game seconds */
const EMBERS_END = EMBER_LAUNCH + LOOK.embers.life[1] + (LOOK.embers.trail - 1) * LOOK.embers.trailStep;

/** Frames of the 4x4 sprite atlases */
const ATLAS_FRAMES = 16;
/**
 * Centre alpha of smoke-atlas frame 0 as drawn: 0.6 in the atlas
 * (generateSmokeAtlas) times the 0.85 of the normal particle shader. Each
 * later frame is wider and fainter, the last one empty.
 */
const SMOKE_ALPHA = 0.51;
/** A puff fainter than this is left out */
const MIN_ALPHA = 0.015;
/** A glow particle darker than this is left out */
const MIN_LIGHT = 0.01;
/** Share of the sprite the glow of an explosion-atlas frame covers */
const GLOW_COVERAGE = 0.6;

/** The glow draws before the smoke, so smoke in front of it dims it */
const GLOW_ORDER = 996;
const SMOKE_ORDER = 997;
/** Above the strike marker (950), under the particle pools (999) */
const RING_ORDER = 951;
const DOME_ORDER = 952;
const FLASH_ORDER = 1002;
const SCREEN_ORDER = 1003;
/** Shockwave ring above the ground point, m */
const RING_LIFT = 0.6;
/** Height of the shock dome over its radius */
const DOME_FLATTEN = 0.8;

/** A quad over the whole screen, additive: the screen part of the flash. */
const SCREEN_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const SCREEN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  #include <logdepthbuf_pars_fragment>

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <logdepthbuf_fragment>
  }
`;

/** Shock dome: additive, faint where it faces the camera, bright along its outline. */
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

  #include <logdepthbuf_pars_fragment>

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float outline = pow(1.0 - facing, 2.5);
    gl_FragColor = vec4(uColor, uOpacity * (0.15 + 0.85 * outline));
    #include <logdepthbuf_fragment>
  }
`;

interface Cloud {
  active: boolean;
  /** Game seconds since the impact */
  t: number;
  /** Ground point, local coordinates */
  x: number;
  y: number;
  z: number;
  /** Strike radius over LOOK.referenceRadius */
  scale: number;
  /** Everything, or the detonation only (impact effects off) */
  full: boolean;
  /** Wind direction, unit vector on the ground */
  windX: number;
  windZ: number;
  /** Order of the strikes, the oldest cloud makes room */
  born: number;
}

interface ParticleBuffer {
  points: Points;
  gate: DrawGate;
  position: BufferAttribute;
  size: BufferAttribute;
  color: BufferAttribute;
  frame: BufferAttribute;
  /** Particles drawn last frame */
  drawn: number;
}

/** Smoke-atlas frame whose centre alpha comes closest to `alpha`; the empty last frame is never picked. */
function smokeFrameFor(alpha: number): number {
  const frame = Math.round((ATLAS_FRAMES - 1) * (1 - alpha / SMOKE_ALPHA));
  return Math.min(ATLAS_FRAMES - 2, Math.max(0, frame));
}

/** Share of the sprite the puff of a smoke-atlas frame covers: 0.3 to 1 of 0.45 cell radius (generateSmokeAtlas). */
function smokeCoverage(frame: number): number {
  return 0.9 * (0.3 + (0.7 * frame) / (ATLAS_FRAMES - 1));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * Share of its final radius a front running out with time constant `k`
 * has reached at `t`: fast at first, all of it at `duration`.
 */
function reach(t: number, duration: number, k: number): number {
  return (1 - Math.exp(-Math.min(t, duration) / k)) / (1 - Math.exp(-duration / k));
}

/** White square texture whose alpha runs over the distance r (0 centre, 1 edge) from its centre. */
function radialTexture(size: number, alphaAt: (r: number) => number): DataTexture {
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

function particleBuffer(scene: Scene, capacity: number, material: ShaderMaterial, renderOrder: number): ParticleBuffer {
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

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  scene.add(points);
  return { points, gate: new DrawGate([points]), position, size, color, frame, drawn: 0 };
}

/**
 * Mushroom cloud of the nuclear strike (MUSHROOM_CLOUD_LOOK).
 *
 * Every particle is a function of the cloud's age and four random numbers
 * drawn at the impact, recomputed each frame: the age runs on game time,
 * so a pause holds the cloud and the timescale plays it faster, one long
 * frame or many short ones end in the same picture.
 *
 * Glow and smoke are Points of their own with the trail pools' materials
 * (sprite atlases, log depth): the pools age their particles in wall time,
 * and a big wave, the kind a strike is used on, keeps them full. The smoke
 * goes into its buffer back to front; it blends normally. The flash sprite
 * and the shockwave ring have depth test off, like the strike marker: the
 * flash lights up what stands in front, and the ring has to stay readable
 * between buildings. Built-in materials, so they get logarithmic depth;
 * the screen quad and the shock dome include the chunks. The dome keeps
 * its depth test, the buildings in front of it hide it.
 *
 * Fixed buffers, nothing allocated per frame.
 */
export class MushroomCloudRenderer {
  private readonly clouds: Cloud[] = [];
  private activeCount = 0;
  private sequence = 0;
  /** Smoke, embers, ground fire, stem fire and rim glow (VFX settings: impact effects) */
  private full = true;

  private readonly glowSeeds = new Float32Array(LOOK.clouds * GLOW_PER_CLOUD * SEEDS);
  private readonly smokeSeeds = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * SEEDS);

  private readonly glow: ParticleBuffer;
  private readonly smoke: ParticleBuffer;

  // The smoke of all clouds is staged, sorted by camera distance and then written
  private readonly stage = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD * STAGE);
  /** Squared distance to the camera, -1 = not drawn */
  private readonly depth = new Float32Array(LOOK.clouds * SMOKE_PER_CLOUD).fill(-1);
  private readonly order = new Uint16Array(LOOK.clouds * SMOKE_PER_CLOUD);

  private readonly ringTexture: DataTexture;
  private readonly flashTexture: DataTexture;
  private readonly ringGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  /** Upper half of a unit sphere */
  private readonly domeGeometry = new SphereGeometry(1, 32, 10, 0, TAU, 0, Math.PI / 2);
  private readonly rings: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly domes: Mesh<SphereGeometry, ShaderMaterial>[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly ringGates: DrawGate[] = [];
  private readonly domeGates: DrawGate[] = [];
  private readonly flashGates: DrawGate[] = [];
  private readonly screen: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly screenGate: DrawGate;

  // Shape of the cloud being written (shape()), metres from its ground point
  private capY = 0;
  private ringR = 0;
  private tubeR = 0;
  private roll = 0;
  private stemTop = 0;
  private spread = 0;
  private windX = 0;
  private windZ = 0;
  // Point being written, from its ground point
  private px = 0;
  private py = 0;
  private pz = 0;
  // Frame values
  private sizePerMetre = 0;
  private readonly cameraPosition = new Vector3();

  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
  ) {
    for (let i = 0; i < LOOK.clouds; i++) {
      this.clouds.push({ active: false, t: 0, x: 0, y: 0, z: 0, scale: 1, full: true, windX: 1, windZ: 0, born: 0 });
    }
    for (let i = 0; i < this.order.length; i++) this.order[i] = i;

    this.glow = particleBuffer(scene, LOOK.clouds * GLOW_PER_CLOUD, materials.additive, GLOW_ORDER);
    this.smoke = particleBuffer(scene, LOOK.clouds * SMOKE_PER_CLOUD, materials.normal, SMOKE_ORDER);

    // Shockwave: a bright front with a faint fill behind it
    this.ringTexture = radialTexture(256, (r) =>
      Math.exp(-(((r - 0.9) / 0.045) ** 2)) + (r < 0.9 ? 0.18 * MathUtils.smoothstep(r, 0.2, 0.9) : 0));
    this.flashTexture = radialTexture(64, (r) => (1 - r) ** 2);

    const { flash, shockwave, shockDome } = LOOK.colors;
    const intensity = LOOK.flash.intensity;
    for (let i = 0; i < LOOK.clouds; i++) {
      const ringMaterial = new MeshBasicMaterial({
        map: this.ringTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      ringMaterial.color.setRGB(shockwave.r, shockwave.g, shockwave.b);
      const ring = new Mesh(this.ringGeometry, ringMaterial);
      ring.frustumCulled = false;
      ring.renderOrder = RING_ORDER;
      scene.add(ring);
      this.rings.push(ring);
      this.ringGates.push(new DrawGate([ring]));

      const domeMaterial = new ShaderMaterial({
        vertexShader: DOME_VERTEX_SHADER,
        fragmentShader: DOME_FRAGMENT_SHADER,
        uniforms: {
          uColor: new Uniform(new Vector3(shockDome.r, shockDome.g, shockDome.b)),
          uOpacity: new Uniform(0),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const dome = new Mesh(this.domeGeometry, domeMaterial);
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
      flashMaterial.color.setRGB(flash.r * intensity, flash.g * intensity, flash.b * intensity);
      const sprite = new Sprite(flashMaterial);
      sprite.frustumCulled = false;
      sprite.renderOrder = FLASH_ORDER;
      scene.add(sprite);
      this.flashes.push(sprite);
      this.flashGates.push(new DrawGate([sprite]));
    }

    const screenMaterial = new ShaderMaterial({
      vertexShader: SCREEN_VERTEX_SHADER,
      fragmentShader: SCREEN_FRAGMENT_SHADER,
      uniforms: {
        uColor: new Uniform(new Vector3(flash.r, flash.g, flash.b)),
        uOpacity: new Uniform(0),
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.screen = new Mesh(new PlaneGeometry(2, 2), screenMaterial);
    this.screen.frustumCulled = false;
    this.screen.renderOrder = SCREEN_ORDER;
    scene.add(this.screen);
    this.screenGate = new DrawGate([this.screen]);
  }

  /** Clouds on the way up or fading out. */
  get activeClouds(): number {
    return this.activeCount;
  }

  /**
   * The whole cloud, or the detonation only: flash, fireball, fire shell,
   * shock dome and shockwave (VFX settings: impact effects). Takes hold
   * with the next strike.
   */
  setFullCloud(full: boolean): void {
    this.full = full;
  }

  /** A strike hit `ground` (local coordinates, on the ground) with `radiusM`. */
  detonate(ground: Vector3, radiusM: number): void {
    let slot = 0;
    for (let i = 0; i < this.clouds.length; i++) {
      if (!this.clouds[i].active) {
        slot = i;
        break;
      }
      if (this.clouds[i].born < this.clouds[slot].born) slot = i;
    }
    const cloud = this.clouds[slot];
    if (!cloud.active) this.activeCount++;

    const wind = Math.random() * TAU;
    cloud.active = true;
    cloud.t = 0;
    cloud.x = ground.x;
    cloud.y = ground.y;
    cloud.z = ground.z;
    cloud.scale = radiusM / LOOK.referenceRadius;
    cloud.full = this.full;
    cloud.windX = Math.cos(wind);
    cloud.windZ = Math.sin(wind);
    cloud.born = ++this.sequence;

    const glowStart = slot * GLOW_PER_CLOUD * SEEDS;
    for (let i = glowStart; i < glowStart + GLOW_PER_CLOUD * SEEDS; i++) this.glowSeeds[i] = Math.random();
    const smokeStart = slot * SMOKE_PER_CLOUD * SEEDS;
    for (let i = smokeStart; i < smokeStart + SMOKE_PER_CLOUD * SEEDS; i++) this.smokeSeeds[i] = Math.random();
  }

  /**
   * Once per rendered frame.
   * @param gameDeltaMs - the frame in game time: 0 while paused, the frame times the timescale otherwise
   * @param camera - sorts the smoke and turns metres into point sizes
   * @param viewportHeight - drawing buffer height in pixels; the particle shader sizes in pixels
   */
  update(gameDeltaMs: number, camera: PerspectiveCamera, viewportHeight: number): void {
    if (this.activeCount === 0) return;

    const dt = gameDeltaMs / 1000;
    for (const cloud of this.clouds) {
      if (!cloud.active) continue;
      cloud.t += dt;
      if (cloud.t >= LOOK.duration) {
        cloud.active = false;
        this.activeCount--;
      }
    }

    this.sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);
    this.cameraPosition.copy(camera.position);

    let glowCount = 0;
    let screen = 0;
    for (let slot = 0; slot < this.clouds.length; slot++) {
      const cloud = this.clouds[slot];
      if (!cloud.active) {
        this.hideSmoke(slot);
        this.ringGates[slot].setCount(0);
        this.domeGates[slot].setCount(0);
        this.flashGates[slot].setCount(0);
        continue;
      }
      this.shape(cloud);
      glowCount = this.writeGlow(cloud, slot, glowCount);
      if (cloud.full) {
        this.stageSmoke(cloud, slot);
      } else {
        this.hideSmoke(slot);
      }
      this.updateRing(cloud, slot);
      this.updateDome(cloud, slot);
      this.updateFlash(cloud, slot);
      const { screenPeak, screenDuration } = LOOK.flash;
      if (cloud.t < screenDuration) {
        const fade = 1 - cloud.t / screenDuration;
        screen = Math.max(screen, screenPeak * fade * fade);
      }
    }
    this.commit(this.glow, glowCount);
    this.commit(this.smoke, this.writeSortedSmoke());
    this.screen.material.uniforms['uOpacity'].value = screen;
    this.screenGate.setCount(screen > 0 ? 1 : 0);
  }

  /** Drop every cloud (restart). */
  clear(): void {
    for (const cloud of this.clouds) cloud.active = false;
    this.activeCount = 0;
    this.depth.fill(-1);
    this.commit(this.glow, 0);
    this.commit(this.smoke, 0);
    for (const gate of this.ringGates) gate.setCount(0);
    for (const gate of this.domeGates) gate.setCount(0);
    for (const gate of this.flashGates) gate.setCount(0);
    this.screenGate.setCount(0);
  }

  /** Remove and free everything but the particle materials, which belong to the trail pools. */
  dispose(): void {
    this.clear();
    for (const buffer of [this.glow, this.smoke]) {
      this.scene.remove(buffer.points);
      buffer.points.geometry.dispose();
    }
    for (const ring of this.rings) {
      this.scene.remove(ring);
      ring.material.dispose();
    }
    for (const dome of this.domes) {
      this.scene.remove(dome);
      dome.material.dispose();
    }
    for (const sprite of this.flashes) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.scene.remove(this.screen);
    this.screen.geometry.dispose();
    this.screen.material.dispose();
    this.ringGeometry.dispose();
    this.domeGeometry.dispose();
    this.ringTexture.dispose();
    this.flashTexture.dispose();
  }

  /** The cloud's cap, stem and wind at its age. */
  private shape(cloud: Cloud): void {
    const { cap, disperse } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const tau = Math.max(0, t - cap.start);
    const rise = 1 - Math.exp(-tau / cap.riseTime);
    const late = Math.max(0, t - disperse.start);
    this.spread = MathUtils.smoothstep(t, disperse.start, LOOK.duration);
    this.capY = (MathUtils.lerp(cap.startHeight, cap.height, rise) + disperse.rise * late) * s;
    this.ringR = (MathUtils.lerp(cap.ringRadius[0], cap.ringRadius[1], rise) + disperse.spread * late) * s;
    this.tubeR = (MathUtils.lerp(cap.tubeRadius[0], cap.tubeRadius[1], rise) + disperse.spread * 0.6 * late) * s;
    // Turned so far: rollSpeed at first, slowing down
    this.roll = cap.rollSpeed * cap.rollTime * (1 - Math.exp(-tau / cap.rollTime));
    // The stem runs into the underside of the cap
    this.stemTop = this.capY - this.tubeR * cap.flatten * 0.6;
    const drift = disperse.wind * Math.max(0, t - 1.5);
    this.windX = cloud.windX * drift;
    this.windZ = cloud.windZ * drift;
  }

  /**
   * A point of the cap's torus into px/py/pz: `phi` around the stem,
   * `theta` around the tube (pi/2 on top), `k` the share of the tube radius.
   * The roll turns theta down: out over the top, in underneath.
   */
  private torusPoint(phi: number, theta: number, k: number): void {
    const rho = this.ringR + this.tubeR * k * Math.cos(theta);
    this.px = rho * Math.cos(phi);
    this.py = this.capY + this.tubeR * k * Math.sin(theta) * LOOK.cap.flatten;
    this.pz = rho * Math.sin(phi);
  }

  /** Push the point out and up as the cloud spreads. */
  private spreadOut(phi: number, u: number, v: number, s: number): void {
    if (this.spread <= 0) return;
    const out = this.spread * 5 * s * (0.5 + u);
    this.px += Math.cos(phi) * out;
    this.pz += Math.sin(phi) * out;
    this.py += this.spread * 3 * s * v;
  }

  /** Wind drift, full at the cap's height and none on the ground. */
  private drift(): void {
    const share = this.capY > 0 ? Math.min(1, Math.max(0, this.py / this.capY)) : 0;
    this.px += this.windX * share;
    this.pz += this.windZ * share;
  }

  /**
   * The glow of one cloud into the glow buffer from index `n`; returns the
   * next index. The detonation always, the rest with the full cloud.
   */
  private writeGlow(cloud: Cloud, slot: number, n: number): number {
    const seeds = slot * GLOW_PER_CLOUD * SEEDS;
    n = this.writeFireball(cloud, seeds, n);
    n = this.writeShell(cloud, seeds + SHELL_SEEDS, n);
    if (!cloud.full) return n;
    n = this.writeEmbers(cloud, seeds + EMBER_SEEDS, n);
    n = this.writeGroundFire(cloud, seeds + GROUND_FIRE_SEEDS, n);
    n = this.writeStemFire(cloud, seeds + STEM_FIRE_SEEDS, n);
    return this.writeRim(cloud, seeds + RIM_SEEDS, n);
  }

  /**
   * The white-hot core and the fireball: a hemisphere on the ground whose
   * centre punches up, white-hot turning orange, then the glowing core of
   * the cap. `seeds` is the cloud's block.
   */
  private writeFireball(cloud: Cloud, seeds: number, n: number): number {
    const { core, fireball, colors } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const r = this.glowSeeds;
    const punch = fireball.punch * (1 - Math.exp(-t / fireball.punchTime)) * s;
    const radius = (2 + (fireball.radius - 2) * (1 - Math.exp(-t / fireball.growTime))) * s;

    // Core: a white-hot knot in the middle of the fireball, burnt out after core.duration
    const coreLight = core.intensity * (1 - MathUtils.smoothstep(t, 0.1, core.duration));
    if (coreLight > MIN_LIGHT) {
      const centre = radius * 0.5 + punch;
      const grow = 0.6 + 0.4 * MathUtils.smoothstep(t, 0, 0.15);
      for (let i = 0, seed = seeds + CORE_SEEDS; i < GLOW.core; i++, seed += SEEDS) {
        const a = r[seed] * TAU;
        const up = r[seed + 1] * 2 - 1;
        const k = core.radius * s * Math.cbrt(r[seed + 2]);
        const out = Math.sqrt(1 - up * up) * k;
        this.px = Math.cos(a) * out;
        this.py = centre + up * k;
        this.pz = Math.sin(a) * out;
        const diameter = MathUtils.lerp(core.size[0], core.size[1], r[seed + 3]) * s * grow;
        this.putGlow(n++, cloud, diameter, 0, colors.core, coreLight);
      }
    }

    const ballLight =
      1.6 * (1 - MathUtils.smoothstep(t, fireball.fadeStart, fireball.fadeEnd)) * (0.45 + 0.55 * Math.exp(-t / 0.6));
    if (ballLight <= MIN_LIGHT) return n;
    const lift = MathUtils.smoothstep(t, fireball.liftStart, fireball.liftEnd);
    const grow = 0.5 + 0.5 * MathUtils.smoothstep(t, 0, 0.25);
    // Flash white to fireball orange to dark red (explosion atlas)
    const frame = Math.round(1 + 9 * Math.min(1, t / fireball.fadeEnd));
    const hot = 1 - MathUtils.smoothstep(t, 0.1, fireball.hotEnd);
    const { fireballHot, fireball: orange } = colors;
    const red = MathUtils.lerp(orange.r, fireballHot.r, hot) * ballLight;
    const green = MathUtils.lerp(orange.g, fireballHot.g, hot) * ballLight;
    const blue = MathUtils.lerp(orange.b, fireballHot.b, hot) * ballLight;
    for (let i = 0, seed = seeds + BALL_SEEDS; i < GLOW.fireball; i++, seed += SEEDS) {
      const azimuth = r[seed] * TAU;
      const up = r[seed + 1];
      const depth = r[seed + 2];
      const out = Math.sqrt(1 - up * up);
      const k = 0.25 + 0.75 * Math.cbrt(depth);
      const bx = Math.cos(azimuth) * out * radius * k;
      const by = radius * (0.35 + up * k) + punch;
      const bz = Math.sin(azimuth) * out * radius * k;
      this.torusPoint(azimuth, (up * 2 - 1) * Math.PI - this.roll, 0.2 + 0.4 * depth);
      this.px = MathUtils.lerp(bx, this.px, lift);
      this.py = MathUtils.lerp(by, this.py, lift);
      this.pz = MathUtils.lerp(bz, this.pz, lift);
      this.drift();
      const diameter = MathUtils.lerp(fireball.size[0], fireball.size[1], r[seed + 3]) * s * grow;
      this.putGlowRgb(n++, cloud, diameter, frame, red, green, blue);
    }
    return n;
  }

  /** Second fire front: a flattened shell running out over the ground and fading. */
  private writeShell(cloud: Cloud, seeds: number, n: number): number {
    const { shell, colors } = LOOK;
    const age = cloud.t - shell.start;
    if (age <= 0 || age >= shell.duration) return n;
    const share = age / shell.duration;
    const light = 1.5 * (1 - share) ** 1.5 * MathUtils.smoothstep(age, 0, 0.06);
    if (light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const out = reach(age, shell.duration, shell.timeConstant);
    const radius = shell.radius * s * out;
    const frame = Math.round(3 + 6 * share);
    const r = this.glowSeeds;
    for (let i = 0, seed = seeds; i < GLOW.shell; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      // Mostly low over the ground, a few up the side
      const elevation = r[seed + 1] ** 1.5 * 1.3;
      const k = radius * (0.85 + 0.15 * r[seed + 2]);
      this.px = Math.cos(a) * Math.cos(elevation) * k;
      this.py = Math.sin(elevation) * k * 0.7 + s;
      this.pz = Math.sin(a) * Math.cos(elevation) * k;
      const diameter = MathUtils.lerp(shell.size[0], shell.size[1], r[seed + 3]) * s * (0.6 + 0.6 * out);
      this.putGlow(n++, cloud, diameter, frame, colors.shell, light);
    }
    return n;
  }

  /**
   * Glowing debris thrown out and up, slowed by the air and falling back,
   * each a streak of its last few positions. A point that has reached the
   * ground is left out.
   */
  private writeEmbers(cloud: Cloud, seeds: number, n: number): number {
    const { embers, colors } = LOOK;
    const t = cloud.t;
    if (t >= EMBERS_END) return n;
    const s = cloud.scale;
    const r = this.glowSeeds;
    const drag = embers.drag;
    const gravity = embers.gravity * s;
    for (let e = 0, seed = seeds; e < GLOW.embers; e++, seed += embers.trail * SEEDS) {
      const azimuth = r[seed] * TAU;
      const elevation = 0.25 + 1.1 * r[seed + 1];
      const speed = MathUtils.lerp(embers.speed[0], embers.speed[1], r[seed + 2]) * s;
      const life = MathUtils.lerp(embers.life[0], embers.life[1], r[seed + 3]);
      const start = EMBER_LAUNCH * r[seed + 4];
      const size = MathUtils.lerp(embers.size[0], embers.size[1], r[seed + 5]) * s;
      const out = Math.cos(elevation) * speed;
      const up = Math.sin(elevation) * speed;
      const cos = Math.cos(azimuth);
      const sin = Math.sin(azimuth);
      for (let j = 0; j < embers.trail; j++) {
        const age = t - start - j * embers.trailStep;
        if (age <= 0 || age >= life) continue;
        // Linear drag: the speed falls off with the time constant, gravity pulls against it
        const covered = drag * (1 - Math.exp(-age / drag));
        const y = 2 * s + up * covered - gravity * drag * (age - covered);
        if (y < 0) continue;
        const h = 3 * s + out * covered;
        this.px = cos * h;
        this.py = y;
        this.pz = sin * h;
        const fade = (1 - age / life) ** 1.5 * (1 - 0.22 * j);
        this.putGlow(n++, cloud, size * (1 - 0.18 * j), 1 + Math.round((6 * age) / life), colors.ember, 1.4 * fade);
      }
    }
    return n;
  }

  /** Burning ground around the foot of the stem, flickering in game time. */
  private writeGroundFire(cloud: Cloud, seeds: number, n: number): number {
    const { groundFire, colors } = LOOK;
    const t = cloud.t;
    const light =
      1.1 *
      MathUtils.smoothstep(t, groundFire.start, groundFire.start + 0.4) *
      (1 - MathUtils.smoothstep(t, groundFire.fadeStart, groundFire.fadeEnd));
    if (light <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const r = this.glowSeeds;
    for (let i = 0, seed = seeds; i < GLOW.groundFire; i++, seed += SEEDS) {
      const a = r[seed] * TAU;
      const d = MathUtils.lerp(groundFire.radius[0], groundFire.radius[1], Math.sqrt(r[seed + 1])) * s;
      const phase = r[seed + 2] * TAU;
      const flicker = (0.7 + 0.3 * Math.sin(9 * t + phase)) * (0.85 + 0.15 * Math.sin(23 * t + 3 * phase));
      const diameter =
        MathUtils.lerp(groundFire.size[0], groundFire.size[1], r[seed + 3]) * s * (0.9 + 0.2 * Math.sin(6 * t + 2 * phase));
      this.px = Math.cos(a) * d;
      this.py = diameter * 0.35;
      this.pz = Math.sin(a) * d;
      // Cycles through the fireball frames of the atlas
      const frame = 4 + (Math.floor(8 * t + 16 * r[seed + 2]) % 4);
      this.putGlow(n++, cloud, diameter, frame, colors.groundFire, light * flicker);
    }
    return n;
  }

  /** Stem fire: rising through the core of the stem, darker the higher it gets. */
  private writeStemFire(cloud: Cloud, seeds: number, n: number): number {
    const { stem, colors } = LOOK;
    const t = cloud.t;
    const fireLight = 1.1 * MathUtils.smoothstep(t, 0.25, 0.5) * (1 - MathUtils.smoothstep(t, 1.4, 3));
    if (fireLight <= MIN_LIGHT) return n;
    const s = cloud.scale;
    const r = this.glowSeeds;
    const width = stem.width * s * 0.55;
    for (let i = 0, seed = seeds; i < GLOW.stemFire; i++, seed += SEEDS) {
      const climb = fract(r[seed] + 0.9 * (t - 0.25));
      const light = fireLight * (1 - 0.65 * climb) * MathUtils.smoothstep(climb, 0, 0.1);
      if (light <= MIN_LIGHT) continue;
      const radius = width * Math.sqrt(r[seed + 1]);
      const a = r[seed + 2] * TAU + 0.7 * t;
      this.px = Math.cos(a) * radius;
      this.py = this.stemTop * climb * 0.9;
      this.pz = Math.sin(a) * radius;
      this.drift();
      this.putGlow(n++, cloud, (4 + 3 * r[seed + 3]) * s, Math.round(4 + 5 * climb), colors.stemFire, light);
    }
    return n;
  }

  /** Rim glow: the underside of the cap, lit by the fire in the stem. */
  private writeRim(cloud: Cloud, seeds: number, n: number): number {
    const t = cloud.t;
    const rimLight = 0.9 * MathUtils.smoothstep(t, 0.7, 1.4) * (1 - MathUtils.smoothstep(t, 2.4, 5.2));
    if (rimLight <= MIN_LIGHT) return n;
    const r = this.glowSeeds;
    for (let i = 0, seed = seeds; i < GLOW.rim; i++, seed += SEEDS) {
      const u = r[seed + 3];
      this.torusPoint(r[seed] * TAU + 0.1 * t, -Math.PI / 2 + (r[seed + 1] - 0.5) * 1.9, 0.8 + 0.2 * r[seed + 2]);
      this.drift();
      this.putGlow(n++, cloud, this.tubeR * 0.8 * (0.8 + 0.4 * u), 5 + Math.round(2 * u), LOOK.colors.rim, rimLight);
    }
    return n;
  }

  /** Cap, dome, stem, dust surge, skirt and dust wall of one cloud into the stage. */
  private stageSmoke(cloud: Cloud, slot: number): void {
    const { cap, stem, dust, shockwave, colors } = LOOK;
    const t = cloud.t;
    const s = cloud.scale;
    const seeds = this.smokeSeeds;
    let i = slot * SMOKE_PER_CLOUD;
    let seed = i * SEEDS;

    // Cap: a torus rolling out over the top and in underneath. Lit orange by
    // the fireball at first, its underside for longer; the top catches the
    // light, the outer side is darker.
    const capAlpha = 0.46 * MathUtils.smoothstep(t, cap.start, cap.start + 0.7) * (1 - this.spread);
    const capWarm = 1 - MathUtils.smoothstep(t, 0.8, 3.2);
    const rimWarm = 1 - MathUtils.smoothstep(t, 1.8, 4.6);
    const puffGrowth = 1 + 0.5 * this.spread;
    for (let p = 0; p < SMOKE.cap; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU;
      const theta = seeds[seed + 1] * TAU - this.roll;
      const u = seeds[seed + 2];
      const v = seeds[seed + 3];
      const k = 0.45 + 0.55 * u;
      this.torusPoint(phi, theta, k);
      this.spreadOut(phi, u, v, s);
      this.drift();
      const sin = Math.sin(theta);
      const lum = 0.78 + 0.3 * sin - 0.12 * Math.max(0, Math.cos(theta)) * k;
      const warm = Math.max(capWarm, rimWarm * Math.max(0, -sin));
      this.putSmoke(i, cloud, this.tubeR * (0.95 + 0.4 * v) * puffGrowth, capAlpha, colors.smoke, lum, warm);
    }

    // Dome: covers the middle of the cap, welling up at the centre and
    // flowing out to the torus
    const domeAlpha = 0.44 * MathUtils.smoothstep(t, cap.start + 0.2, cap.start + 1) * (1 - this.spread);
    const domeR = this.ringR + 0.25 * this.tubeR;
    for (let p = 0; p < SMOKE.dome; p++, i++, seed += SEEDS) {
      const out = fract(seeds[seed] + 0.1 * t);
      const phi = seeds[seed + 1] * TAU + 0.15 * t;
      const rho = domeR * Math.sqrt(out);
      this.px = Math.cos(phi) * rho;
      this.py = this.capY + this.tubeR * cap.flatten * (0.5 + 0.6 * (1 - out));
      this.pz = Math.sin(phi) * rho;
      this.spreadOut(phi, seeds[seed + 2], seeds[seed + 3], s);
      this.drift();
      const edges = MathUtils.smoothstep(out, 0, 0.12) * (1 - MathUtils.smoothstep(out, 0.85, 1));
      const diameter = this.tubeR * (1 + 0.3 * seeds[seed + 3]) * puffGrowth;
      this.putSmoke(i, cloud, diameter, domeAlpha * edges, colors.smoke, 1.05, capWarm);
    }

    // Stem: smoke climbing into the cap, wide at the foot, flaring into the
    // cap at the top, fire-lit at the bottom at first. Thins out before the cap.
    const stemAlpha =
      0.42 * MathUtils.smoothstep(t, stem.start, stem.start + 0.5) * (1 - MathUtils.smoothstep(t, 4.5, 8.5));
    const stemWarm = 1 - MathUtils.smoothstep(t, 0.6, 2.8);
    const climbed = stem.flow * Math.max(0, t - stem.start);
    for (let p = 0; p < SMOKE.stem; p++, i++, seed += SEEDS) {
      const climb = fract(seeds[seed] + climbed);
      const width =
        stem.width * s * (1 + 1.5 * (1 - climb) ** 4) * (1 + 0.6 * this.spread) + 0.45 * this.ringR * climb ** 5;
      const r = width * 0.8 * Math.sqrt(seeds[seed + 1]);
      const a = seeds[seed + 2] * TAU + 0.5 * t;
      this.px = Math.cos(a) * r;
      this.py = this.stemTop * climb;
      this.pz = Math.sin(a) * r;
      this.drift();
      const edges = MathUtils.smoothstep(climb, 0, 0.08) * (1 - MathUtils.smoothstep(climb, 0.9, 1));
      const diameter = (width * 1.2 + 2 * s) * (0.85 + 0.3 * seeds[seed + 3]);
      this.putSmoke(i, cloud, diameter, stemAlpha * edges, colors.smoke, 0.7, stemWarm * (1 - 0.7 * climb));
    }

    // Base surge: dust thrown out along the ground behind the shockwave
    const dustAlpha = 0.4 * MathUtils.smoothstep(t, 0.05, 0.3) * (1 - MathUtils.smoothstep(t, 3, 8.5));
    const dustOut = 1 - Math.exp(-t / dust.time);
    const dustWarm = 0.5 * (1 - MathUtils.smoothstep(t, 0.1, 0.9));
    const dustRise = MathUtils.smoothstep(t, 0, 2.5);
    const dustGrowth = 1 + 0.2 * Math.min(t, 5);
    for (let p = 0; p < SMOKE.dust; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU + 0.03 * t;
      const r = (dust.radius * (0.75 + 0.25 * seeds[seed + 1]) * dustOut + 0.4 * t) * s;
      this.px = Math.cos(phi) * r;
      this.py = (0.8 + (1.5 + 3.5 * seeds[seed + 2]) * dustRise + 0.25 * t) * s;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, (5 + 3 * seeds[seed + 3]) * s * dustGrowth, dustAlpha, colors.dust, 0.95, dustWarm);
    }

    // Skirt: darker dust drawn in around the foot of the stem
    const skirtAlpha = 0.38 * MathUtils.smoothstep(t, 0.5, 1.4) * (1 - MathUtils.smoothstep(t, 5, 9.5));
    const skirtOut = 1 - Math.exp(-t / 1.2);
    const skirtRise = MathUtils.smoothstep(t, 0.5, 3);
    const skirtGrowth = 1 + 0.1 * Math.min(t, 5);
    for (let p = 0; p < SMOKE.skirt; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU + 0.2 * t;
      const r = (4 + 9 * seeds[seed + 1] * skirtOut) * s;
      this.px = Math.cos(phi) * r;
      this.py = (1 + 5 * seeds[seed + 2] * skirtRise) * s;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, (6 + 3 * seeds[seed + 3]) * s * skirtGrowth, skirtAlpha, colors.dust, 0.7, 0);
    }

    // Dust wall: thrown up on the shockwave's front and left standing where
    // the front stops, creeping on a little
    const wallAlpha = 0.45 * MathUtils.smoothstep(t, 0.03, 0.2) * (1 - MathUtils.smoothstep(t, 1.2, 3.2));
    const front =
      shockwave.radius * s * reach(t, shockwave.duration, shockwave.timeConstant) +
      1.5 * s * Math.max(0, t - shockwave.duration);
    const wallWarm = 0.45 * (1 - MathUtils.smoothstep(t, 0.1, 0.6));
    const wallRise = MathUtils.smoothstep(t, 0, 0.5);
    for (let p = 0; p < SMOKE.wall; p++, i++, seed += SEEDS) {
      const phi = seeds[seed] * TAU;
      const r = front * (0.9 + 0.12 * seeds[seed + 1]);
      const diameter = (6 + 5 * seeds[seed + 3]) * s * (0.6 + 0.4 * wallRise);
      this.px = Math.cos(phi) * r;
      this.py = diameter * 0.3 + 4 * s * seeds[seed + 2] * wallRise;
      this.pz = Math.sin(phi) * r;
      this.putSmoke(i, cloud, diameter, wallAlpha, colors.dust, 1, wallWarm);
    }
  }

  /** The point px/py/pz as glow particle `n`: `diameter` in metres, colour times `light`. */
  private putGlow(n: number, cloud: Cloud, diameter: number, frame: number, color: EffectRgb, light: number): void {
    this.putGlowRgb(n, cloud, diameter, frame, color.r * light, color.g * light, color.b * light);
  }

  private putGlowRgb(n: number, cloud: Cloud, diameter: number, frame: number, r: number, g: number, b: number): void {
    const position = this.glow.position.array as Float32Array;
    const rgb = this.glow.color.array as Float32Array;
    position[n * 3] = cloud.x + this.px;
    position[n * 3 + 1] = cloud.y + this.py;
    position[n * 3 + 2] = cloud.z + this.pz;
    rgb[n * 3] = r;
    rgb[n * 3 + 1] = g;
    rgb[n * 3 + 2] = b;
    (this.glow.size.array as Float32Array)[n] = (diameter / GLOW_COVERAGE) * this.sizePerMetre;
    (this.glow.frame.array as Float32Array)[n] = frame;
  }

  /**
   * The point px/py/pz as smoke puff `i` of the stage: `diameter` in metres,
   * `alpha` at its centre (picks the atlas frame), `base` colour times `lum`
   * blended towards the fire-lit colour by `warm`.
   */
  private putSmoke(
    i: number,
    cloud: Cloud,
    diameter: number,
    alpha: number,
    base: EffectRgb,
    lum: number,
    warm: number,
  ): void {
    if (alpha < MIN_ALPHA) {
      this.depth[i] = -1;
      return;
    }
    const x = cloud.x + this.px;
    const y = cloud.y + this.py;
    const z = cloud.z + this.pz;
    const frame = smokeFrameFor(alpha);
    const lit = LOOK.colors.fireLit;
    const o = i * STAGE;
    const stage = this.stage;
    stage[o] = x;
    stage[o + 1] = y;
    stage[o + 2] = z;
    stage[o + 3] = (diameter / smokeCoverage(frame)) * this.sizePerMetre;
    stage[o + 4] = MathUtils.lerp(base.r * lum, lit.r, warm);
    stage[o + 5] = MathUtils.lerp(base.g * lum, lit.g, warm);
    stage[o + 6] = MathUtils.lerp(base.b * lum, lit.b, warm);
    stage[o + 7] = frame;
    const dx = x - this.cameraPosition.x;
    const dy = y - this.cameraPosition.y;
    const dz = z - this.cameraPosition.z;
    this.depth[i] = dx * dx + dy * dy + dz * dz;
  }

  private hideSmoke(slot: number): void {
    this.depth.fill(-1, slot * SMOKE_PER_CLOUD, (slot + 1) * SMOKE_PER_CLOUD);
  }

  /**
   * Sort the staged smoke far to near and write the drawn puffs into the
   * smoke buffer; returns how many. Insertion sort over last frame's order,
   * which the camera and the cloud change only a little per frame.
   */
  private writeSortedSmoke(): number {
    const { order, depth, stage } = this;
    for (let i = 1; i < order.length; i++) {
      const index = order[i];
      const d = depth[index];
      let j = i - 1;
      while (j >= 0 && depth[order[j]] < d) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = index;
    }

    const position = this.smoke.position.array as Float32Array;
    const size = this.smoke.size.array as Float32Array;
    const rgb = this.smoke.color.array as Float32Array;
    const frame = this.smoke.frame.array as Float32Array;
    let n = 0;
    for (; n < order.length; n++) {
      const index = order[n];
      if (depth[index] < 0) break;
      const o = index * STAGE;
      position[n * 3] = stage[o];
      position[n * 3 + 1] = stage[o + 1];
      position[n * 3 + 2] = stage[o + 2];
      size[n] = stage[o + 3];
      rgb[n * 3] = stage[o + 4];
      rgb[n * 3 + 1] = stage[o + 5];
      rgb[n * 3 + 2] = stage[o + 6];
      frame[n] = stage[o + 7];
    }
    return n;
  }

  private commit(buffer: ParticleBuffer, count: number): void {
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

  /** Shockwave: out over the ground, fast at first, fading as it goes. */
  private updateRing(cloud: Cloud, slot: number): void {
    const { shockwave } = LOOK;
    const gate = this.ringGates[slot];
    if (cloud.t >= shockwave.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, shockwave.radius * cloud.scale * reach(cloud.t, shockwave.duration, shockwave.timeConstant));
    const ring = this.rings[slot];
    ring.position.set(cloud.x, cloud.y + RING_LIFT, cloud.z);
    ring.scale.set(radius, 1, radius);
    ring.material.opacity = shockwave.opacity * (1 - cloud.t / shockwave.duration) ** 1.3;
    gate.setCount(1);
  }

  /** Shock dome: a hemisphere out over the ground point, faster than the ring and gone sooner. */
  private updateDome(cloud: Cloud, slot: number): void {
    const { shockDome } = LOOK;
    const gate = this.domeGates[slot];
    if (cloud.t >= shockDome.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, shockDome.radius * cloud.scale * reach(cloud.t, shockDome.duration, shockDome.timeConstant));
    const dome = this.domes[slot];
    dome.position.set(cloud.x, cloud.y, cloud.z);
    dome.scale.set(radius, radius * DOME_FLATTEN, radius);
    dome.material.uniforms['uOpacity'].value = shockDome.opacity * (1 - cloud.t / shockDome.duration) ** 1.5;
    gate.setCount(1);
  }

  /** Flash over the ground point: full size within 80 ms, then gone by LOOK.flash.duration. */
  private updateFlash(cloud: Cloud, slot: number): void {
    const { flash } = LOOK;
    const gate = this.flashGates[slot];
    if (cloud.t >= flash.duration) {
      gate.setCount(0);
      return;
    }
    const fade = 1 - cloud.t / flash.duration;
    const size = flash.size * cloud.scale * (0.4 + 0.6 * MathUtils.smoothstep(cloud.t, 0, 0.08));
    const sprite = this.flashes[slot];
    sprite.position.set(cloud.x, cloud.y + flash.height * cloud.scale, cloud.z);
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = fade * fade;
    gate.setCount(1);
  }
}
