import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Uniform,
  Vector3,
  type IUniform,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { ORBITAL_BEAM_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DISPLAY_OUTPUT_GLSL } from './display-output';
import { DrawGate } from './draw-gate';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';
import { commitParticles, particleBuffer, radialTexture, unpickable, type ParticleBuffer } from './effect-buffers';

/** Points of a beam's path at most; a longer one is cut off (the sweep is some 70 m) */
const MAX_POINTS = 256;
/** Points along a beam's reach, taken at the impact: where its particles are born */
const REACH_SAMPLES = 128;
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);

/** Particles alive at once per beam, at most */
const SPARKS_PER_BEAM = Math.ceil(LOOK.sparks.rate * LOOK.sparks.life) + 1;
const SPARK_INTERVAL = 1 / LOOK.sparks.rate;
const DEBRIS_PER_BEAM = Math.ceil(LOOK.debris.rate * LOOK.debris.life[1]) + 1;
const DEBRIS_INTERVAL = 1 / LOOK.debris.rate;
/** Additive particles per beam: its sparks and the streaks of its debris */
const GLOW_PER_BEAM = SPARKS_PER_BEAM + DEBRIS_PER_BEAM * LOOK.debris.trail;
const SMOKE_PER_BEAM = Math.ceil(LOOK.smoke.rate * LOOK.smoke.life[1]) + 1;
const SMOKE_INTERVAL = 1 / LOOK.smoke.rate;
/** Frames of the 4x4 smoke atlas; the last one is empty */
const SMOKE_LAST_FRAME = 14;
/** Game seconds a beam with particles shows after it has burnt out: until the last of them is gone */
const PARTICLE_TAIL = Math.max(LOOK.fadeOut, LOOK.sparks.life, LOOK.debris.life[1], LOOK.smoke.life[1]);
/**
 * Ember patches at once. A 72 m trail (18 m/s for 4 s) at one every
 * scorchStep is 30 of them; room for three trails, the oldest patch makes
 * room for a new one.
 */
const EMBERS = 96;
/** Debris leaves the foot this high above the ground and comes to rest this high, m */
const DEBRIS_START = 0.5;
const DEBRIS_REST = 0.15;

/** Ground glow and ring above the strike marker (950); smoke before the column, whose light adds over it */
const GROUND_GLOW_ORDER = 956;
const RING_ORDER = 957;
const SMOKE_ORDER = 985;
const COLUMN_ORDER = 990;
const SPARK_ORDER = 996;
/** Over the scorch marks (998) */
const EMBER_ORDER = 999;
const FOOT_ORDER = 1001;
const FLASH_ORDER = 1002;
/** Above the ground, m: embers over the scorch marks (0.1) and blood (0.12) */
const EMBER_LIFT = 0.16;
const GROUND_GLOW_LIFT = 0.35;
const RING_LIFT = 0.5;
const FOOT_LIFT = 1.2;

/** Ground under the beam; the route grid, see setGround(). */
export interface BeamGround {
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

/** Where a beam leaves a scorch mark, local coordinates on the ground */
export type BeamScorch = (x: number, y: number, z: number) => void;

/** Value noise from a hash, for the column's streaks and the embers' cracks */
const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

/**
 * The beam's column: a quad from the foot straight up, turned about the
 * vertical to face the camera (a cylinder seen from anywhere but straight
 * above). x runs across it (-1 to 1), y up (0 to 1).
 */
const COLUMN_VERTEX_SHADER = /* glsl */ `
  uniform vec3 uBase;
  uniform float uHeight;
  uniform float uHalfWidth;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec3 toCamera = cameraPosition - uBase;
    // Horizontal, square to the view (named so: the interpolation qualifiers are reserved words in GLSL ES 3.00)
    vec2 across = vec2(-toCamera.z, toCamera.x);
    float len = length(across);
    vec3 side = len > 1e-4 ? vec3(across.x / len, 0.0, across.y / len) : vec3(1.0, 0.0, 0.0);
    vec3 world = uBase + side * (position.x * uHalfWidth) + vec3(0.0, position.y * uHeight, 0.0);
    vUv = position.xy;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/**
 * A white-hot core, a yellow-orange inner and a red outer corona across
 * the column, fading towards the top, brightest at the ground. With
 * uDetail 1 energy streaks run down the corona and its edges waver like
 * air over heat; pulses run down the whole column in game time. Nothing
 * below uReach of it from the top: the beam coming down. Additive light in
 * display values, written for the target (displayLight); depth tested, so
 * buildings in front hide it.
 */
const COLUMN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform float uCoreShare;
  uniform float uInnerShare;
  uniform float uOuterShare;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uReach;
  uniform float uDetail;
  uniform float uShimmer;
  uniform float uStreaks;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  ${DISPLAY_OUTPUT_GLSL}
  ${NOISE_GLSL}

  void main() {
    float front = 1.0 - uReach;
    if (vUv.y < front) discard;
    float y = vUv.y;
    // Heat shimmer: the corona's edges waver, the core stays straight
    float waver = uDetail * uShimmer * (sin(y * 90.0 - uTime * 23.0) + 0.6 * sin(y * 217.0 + uTime * 41.0));
    float xc = abs(vUv.x);
    float xw = abs(vUv.x + waver);
    float core = exp(-(xc * xc) / (uCoreShare * uCoreShare));
    float inner = exp(-(xw * xw) / (uInnerShare * uInnerShare));
    float outer = exp(-(xw * xw) / (uOuterShare * uOuterShare)) * (1.0 - smoothstep(0.6, 1.0, xw));
    // Energy streaks running down the corona, 1 on average
    float streak = 1.0;
    if (uDetail > 0.5) {
      float n = 0.6 * noise(vec2(vUv.x * 7.0, y * 30.0 + uTime * 11.0))
        + 0.4 * noise(vec2(vUv.x * 16.0, y * 70.0 + uTime * 23.0));
      streak = 1.0 + uStreaks * (2.0 * n - 1.0);
    }
    // Pulses running down; sin goes negative, and pow of a negative base is undefined
    float pulse = pow(max(sin(y * 60.0 + uTime * 34.0), 0.0), 6.0);
    float along = 1.0 - smoothstep(0.5, 1.0, y);
    float ground = 1.0 + 2.0 * exp(-y * 90.0);
    float arrive = uReach >= 1.0 ? 1.0 : smoothstep(front, front + 0.03, y);
    vec3 light = uCore * core * (1.0 + 0.3 * pulse)
      + (uInner * inner * (0.8 + 0.4 * pulse) + uOuter * outer) * streak;
    gl_FragColor = vec4(displayLight(light * (along * ground * arrive * uIntensity)), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

/** Ember patches: flat quads on the ground, one instance each, their age from the renderer's clock. */
const EMBER_VERTEX_SHADER = /* glsl */ `
  attribute float aBorn;
  attribute float aSeed;
  uniform float uClock;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vUv = position.xz;
    vAge = uClock - aBorn;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/**
 * A ragged patch of molten ground, hottest in its middle: at first the
 * whole crust glows, darkening from the rim in within a third of uCool;
 * cracks through it glow on and cool from white-hot over orange to dark
 * red until uCool. Additive light in display values (displayLight), times
 * the blood moon's tint like the ground marks it lies on.
 */
const EMBER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uCool;
  uniform float uIntensity;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform vec3 uDull;
  uniform vec3 uBloodMoonTint;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;

  #include <logdepthbuf_pars_fragment>

  ${DISPLAY_OUTPUT_GLSL}
  ${NOISE_GLSL}

  void main() {
    float dist = length(vUv);
    float life = vAge / uCool;
    if (dist > 1.0 || life < 0.0 || life >= 1.0) discard;
    vec2 seed = vec2(vSeed * 37.0, vSeed * 71.0);
    float blotch = noise(vUv * 3.0 + seed);
    float body = 1.0 - smoothstep(0.25, 1.0, dist + 0.35 * (blotch - 0.5));
    // Cracks: where the noise crosses its middle
    float ridge = 1.0 - abs(2.0 * noise(vUv * 4.5 + seed.yx) - 1.0);
    float cracks = pow(max(ridge, 0.0), 5.0);
    float crust = body * (1.0 - smoothstep(0.0, 0.35, life + 0.3 * (1.0 - body)));
    float seams = cracks * body * (1.0 - smoothstep(0.15, 1.0, life)) * (1.0 - 0.6 * life);
    float heat = clamp(max(crust, seams), 0.0, 1.0);
    vec3 color = mix(uDull, uWarm, smoothstep(0.1, 0.55, heat));
    color = mix(color, uHot, smoothstep(0.6, 0.95, heat));
    gl_FragColor = vec4(displayLight(color * (heat * uIntensity)) * uBloodMoonTint, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

interface Beam {
  active: boolean;
  /** Game seconds since the impact */
  t: number;
  /** Path in local coordinates, x y z per point, and the metres along it */
  path: Float32Array;
  cumulative: Float32Array;
  points: number;
  length: number;
  radiusM: number;
  speedMps: number;
  /** Game seconds the beam burns: its duration, or less where the path ends sooner */
  burnS: number;
  /** Game seconds after the impact when the last of it is gone */
  end: number;
  /** Metres of its path it burns, and REACH_SAMPLES points along them on the ground, x y z each */
  reachM: number;
  reach: Float32Array;
  /** Metres along the path of the next scorch mark, and the marks laid so far */
  nextScorch: number;
  marks: number;
  scorch: BeamScorch | null;
  /** Ground glow, sparks, debris, smoke and embers too (impact effects on) */
  full: boolean;
  born: number;
}

function rgb(color: EffectRgb, scale = 1): Vector3 {
  return new Vector3(color.r * scale, color.g * scale, color.b * scale);
}

/** Pseudo-random 0-1 from a particle's number, its beam and a channel, the same every frame. */
function particleHash(k: number, beam: number, channel: number): number {
  const h = Math.sin(k * 12.9898 + beam * 78.233 + channel * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Beam of the orbital laser (ORBITAL_BEAM_LOOK): a column of light from
 * high above onto the route, its foot running along the path the
 * AbilityManager swept (from the aim point toward the spawn). At the foot a
 * glow, a disc of light on the ground and a ring at the beam's radius, a
 * flash where it comes down; sparks and molten debris thrown out, smoke and
 * dust kicked up behind it; every few metres a scorch mark and a patch of
 * embers that cools and is gone.
 *
 * It runs in game time like the simulation's beam: the foot is at speed
 * times age along the path, so a pause holds it and the timescale plays it
 * faster. Particles are functions of their number and birth time, born on
 * the points of the beam's reach taken at the impact; ember patches carry
 * their birth on the renderer's own game clock. The foot stands on the
 * route grid's ground where the grid has a cell (setGround), else on the
 * path's own height. Fixed buffers, nothing allocated per frame.
 */
export class OrbitalBeamRenderer {
  private readonly beams: Beam[] = [];
  private activeCount = 0;
  private sequence = 0;
  private full = true;
  private ground: BeamGround | null = null;
  /** Game seconds since the renderer was built: the embers' clock */
  private clock = 0;

  private readonly glow: ParticleBuffer;
  private readonly smoke: ParticleBuffer;
  private readonly columnGeometry = new PlaneGeometry(2, 1, 1, 32).translate(0, 0.5, 0);
  private readonly plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly ringTexture: DataTexture;
  private readonly glowTexture: DataTexture;
  private readonly groundTexture: DataTexture;
  private readonly columns: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly rings: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly groundGlows: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly feet: Sprite[] = [];
  private readonly flashes: Sprite[] = [];
  /** Per beam: column, ring, foot, flash, ground glow */
  private readonly gates: DrawGate[][] = [];

  private readonly emberGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly emberBorn = new InstancedBufferAttribute(new Float32Array(EMBERS), 1);
  private readonly emberSeed = new InstancedBufferAttribute(new Float32Array(EMBERS), 1);
  private readonly embers: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  private readonly emberGate: DrawGate;
  /** Next patch to write, patches written (up to EMBERS), birth of the youngest on the clock */
  private emberNext = 0;
  private emberCount = 0;
  private lastEmber = Number.NEGATIVE_INFINITY;

  private sizePerMetre = 0;
  private readonly foot = new Vector3();
  private readonly mark = new Vector3();
  private readonly origin = new Vector3();
  private readonly emberPosition = new Vector3();
  private readonly emberScale = new Vector3();
  private readonly emberTurn = new Quaternion();
  private readonly emberMatrix = new Matrix4();

  /** `groundTint`: the blood moon tint the ground marks share (GroundDecals), which the embers take too */
  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
    groundTint: IUniform<Vector3> = { value: new Vector3(1, 1, 1) },
  ) {
    for (let i = 0; i < LOOK.beams; i++) {
      this.beams.push({
        active: false, t: 0, path: new Float32Array(MAX_POINTS * 3), cumulative: new Float32Array(MAX_POINTS),
        points: 0, length: 0, radiusM: 0, speedMps: 0, burnS: 0, end: 0, reachM: 0,
        reach: new Float32Array(REACH_SAMPLES * 3), nextScorch: 0, marks: 0, scorch: null, full: true, born: 0,
      });
    }
    this.glow = particleBuffer(scene, LOOK.beams * GLOW_PER_BEAM, materials.additive, SPARK_ORDER);
    this.glow.points.name = 'orbital-beam-sparks';
    this.smoke = particleBuffer(scene, LOOK.beams * SMOKE_PER_BEAM, materials.normal, SMOKE_ORDER);
    this.smoke.points.name = 'orbital-beam-smoke';
    this.ringTexture = radialTexture(128, (r) =>
      Math.exp(-(((r - 0.88) / 0.07) ** 2)) + (r < 0.88 ? 0.25 * MathUtils.smoothstep(r, 0, 0.88) : 0));
    this.glowTexture = radialTexture(64, (r) => (1 - r) ** 2);
    this.groundTexture = radialTexture(128, (r) => (1 - r) ** 2.2);

    const { colors, column } = LOOK;
    const halfWidth = column.quadWidth / 2;
    for (let i = 0; i < LOOK.beams; i++) {
      const columnMaterial = new ShaderMaterial({
        vertexShader: COLUMN_VERTEX_SHADER,
        fragmentShader: COLUMN_FRAGMENT_SHADER,
        uniforms: {
          uBase: new Uniform(new Vector3()),
          uHeight: new Uniform(column.height),
          uHalfWidth: new Uniform(halfWidth),
          uCore: new Uniform(rgb(colors.core)),
          uInner: new Uniform(rgb(colors.inner)),
          uOuter: new Uniform(rgb(colors.outer)),
          uCoreShare: new Uniform(column.coreWidth / halfWidth),
          uInnerShare: new Uniform(column.innerWidth / halfWidth),
          uOuterShare: new Uniform(column.outerWidth / halfWidth),
          uIntensity: new Uniform(0),
          uTime: new Uniform(0),
          uReach: new Uniform(0),
          uDetail: new Uniform(1),
          uShimmer: new Uniform(column.shimmer),
          uStreaks: new Uniform(column.streaks),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const columnMesh = unpickable(new Mesh(this.columnGeometry, columnMaterial));
      columnMesh.name = `orbital-beam-column-${i}`;
      columnMesh.frustumCulled = false;
      columnMesh.renderOrder = COLUMN_ORDER;

      const ring = this.groundOverlay(this.ringTexture, colors.ring, 1, RING_ORDER);
      ring.name = `orbital-beam-ring-${i}`;
      const groundGlow = this.groundOverlay(this.groundTexture, colors.groundGlow, LOOK.groundGlow.intensity, GROUND_GLOW_ORDER);
      groundGlow.name = `orbital-beam-ground-glow-${i}`;
      const foot = this.glowSprite(colors.foot, LOOK.foot.intensity, FOOT_ORDER);
      foot.name = `orbital-beam-foot-${i}`;
      const flash = this.glowSprite(colors.flash, LOOK.flash.intensity, FLASH_ORDER);
      flash.name = `orbital-beam-flash-${i}`;

      for (const object of [columnMesh, ring, groundGlow, foot, flash]) scene.add(object);
      this.columns.push(columnMesh);
      this.rings.push(ring);
      this.groundGlows.push(groundGlow);
      this.feet.push(foot);
      this.flashes.push(flash);
      this.gates.push([columnMesh, ring, foot, flash, groundGlow].map((object) => new DrawGate([object])));
    }

    this.emberGeometry.setAttribute('aBorn', this.emberBorn);
    this.emberGeometry.setAttribute('aSeed', this.emberSeed);
    const emberMaterial = new ShaderMaterial({
      vertexShader: EMBER_VERTEX_SHADER,
      fragmentShader: EMBER_FRAGMENT_SHADER,
      uniforms: {
        uClock: new Uniform(0),
        uCool: new Uniform(LOOK.embers.cool),
        uIntensity: new Uniform(LOOK.embers.intensity),
        uHot: new Uniform(rgb(colors.emberHot)),
        uWarm: new Uniform(rgb(colors.emberWarm)),
        uDull: new Uniform(rgb(colors.emberDull)),
        uBloodMoonTint: groundTint,
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.embers = unpickable(new InstancedMesh(this.emberGeometry, emberMaterial, EMBERS));
    this.embers.name = 'orbital-beam-embers';
    this.embers.count = 0;
    this.embers.frustumCulled = false;
    this.embers.renderOrder = EMBER_ORDER;
    scene.add(this.embers);
    this.emberGate = new DrawGate([this.embers]);
  }

  /** Beams still showing something (the embers of a trail aside). */
  get activeBeams(): number {
    return this.activeCount;
  }

  /** Ground glow, sparks, debris, smoke and embers too (VFX settings: impact effects). Takes hold with the next beam. */
  setFull(full: boolean): void {
    this.full = full;
  }

  /** Ground the feet stand on (the route grid); null: the path's own heights. */
  setGround(ground: BeamGround | null): void {
    this.ground = ground;
  }

  /**
   * A beam comes down on `path[0]` (local coordinates) and runs along the
   * path at `speedMps` for `burnS` game seconds at most, `radiusM` wide;
   * `scorch` is called every LOOK.scorchStep metres of its way.
   */
  fire(path: readonly Vector3[], radiusM: number, speedMps: number, burnS: number, scorch: BeamScorch | null): void {
    if (path.length === 0) return;
    let slot = 0;
    for (let i = 0; i < this.beams.length; i++) {
      if (!this.beams[i].active) {
        slot = i;
        break;
      }
      if (this.beams[i].born < this.beams[slot].born) slot = i;
    }
    const beam = this.beams[slot];
    if (!beam.active) this.activeCount++;

    const points = Math.min(path.length, MAX_POINTS);
    let length = 0;
    for (let i = 0; i < points; i++) {
      const p = path[i];
      beam.path[i * 3] = p.x;
      beam.path[i * 3 + 1] = p.y;
      beam.path[i * 3 + 2] = p.z;
      if (i > 0) {
        const q = path[i - 1];
        length += Math.hypot(p.x - q.x, p.z - q.z);
      }
      beam.cumulative[i] = length;
    }
    beam.active = true;
    beam.t = 0;
    beam.points = points;
    beam.length = length;
    beam.radiusM = radiusM;
    beam.speedMps = speedMps;
    beam.burnS = speedMps > 0 ? Math.min(burnS, length / speedMps) : burnS;
    beam.nextScorch = 0;
    beam.marks = 0;
    beam.scorch = scorch;
    beam.full = this.full;
    beam.born = ++this.sequence;
    beam.end = beam.burnS + (beam.full ? PARTICLE_TAIL : LOOK.fadeOut);
    beam.reachM = speedMps * beam.burnS;
    for (let j = 0; j < REACH_SAMPLES; j++) {
      const p = this.footAt(beam, (beam.reachM * j) / (REACH_SAMPLES - 1), this.origin);
      beam.reach[j * 3] = p.x;
      beam.reach[j * 3 + 1] = p.y;
      beam.reach[j * 3 + 2] = p.z;
    }
  }

  /**
   * Once per rendered frame.
   * @param gameDeltaMs - the frame in game time: 0 while paused, the frame times the timescale otherwise
   * @param camera - turns metres into point sizes
   * @param viewportHeight - drawing buffer height in pixels; the particle shader sizes in pixels
   */
  update(gameDeltaMs: number, camera: PerspectiveCamera, viewportHeight: number): void {
    const dt = gameDeltaMs / 1000;
    this.clock += dt;
    if (this.activeCount > 0) this.updateBeams(dt, camera, viewportHeight);
    this.updateEmbers();
  }

  /** Drop every beam and ember patch (restart). */
  clear(): void {
    for (const beam of this.beams) {
      beam.active = false;
      beam.scorch = null;
    }
    this.activeCount = 0;
    commitParticles(this.glow, 0);
    commitParticles(this.smoke, 0);
    for (const gates of this.gates) for (const gate of gates) gate.setCount(0);
    this.emberNext = 0;
    this.emberCount = 0;
    this.lastEmber = Number.NEGATIVE_INFINITY;
    this.embers.count = 0;
    this.emberGate.setCount(0);
  }

  /** Remove and free everything but the particle materials, which belong to the trail pools. */
  dispose(): void {
    this.clear();
    for (const buffer of [this.glow, this.smoke]) {
      this.scene.remove(buffer.points);
      buffer.points.geometry.dispose();
    }
    for (const mesh of [...this.columns, ...this.rings, ...this.groundGlows]) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    for (const sprite of [...this.feet, ...this.flashes]) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.scene.remove(this.embers);
    this.embers.material.dispose();
    this.emberGeometry.dispose();
    this.columnGeometry.dispose();
    this.plane.dispose();
    this.ringTexture.dispose();
    this.glowTexture.dispose();
    this.groundTexture.dispose();
  }

  private updateBeams(dt: number, camera: PerspectiveCamera, viewportHeight: number): void {
    this.sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);

    let glowCount = 0;
    let smokeCount = 0;
    for (let slot = 0; slot < this.beams.length; slot++) {
      const beam = this.beams[slot];
      if (beam.active) {
        beam.t += dt;
        if (beam.t >= beam.end) {
          beam.active = false;
          this.activeCount--;
        }
      }
      if (!beam.active) {
        for (const gate of this.gates[slot]) gate.setCount(0);
        continue;
      }
      const s = beam.speedMps * Math.min(beam.t, beam.burnS);
      this.footAt(beam, s, this.foot);
      this.leaveScorch(beam, s);
      this.updateColumn(beam, slot);
      if (beam.full) {
        const glowLimit = (slot + 1) * GLOW_PER_BEAM;
        glowCount = this.writeSparks(beam, glowCount, glowLimit);
        glowCount = this.writeDebris(beam, glowCount, glowLimit);
        smokeCount = this.writeSmoke(beam, smokeCount, (slot + 1) * SMOKE_PER_BEAM);
      }
    }
    commitParticles(this.glow, glowCount);
    commitParticles(this.smoke, smokeCount);
  }

  /** The embers' clock, and drawn while a patch still glows. */
  private updateEmbers(): void {
    const glowing = this.emberCount > 0 && this.clock - this.lastEmber < LOOK.embers.cool;
    if (glowing) this.embers.material.uniforms['uClock'].value = this.clock;
    this.emberGate.setCount(glowing ? this.emberCount : 0);
  }

  /** A flat additive disc on the ground, depth test off like the strike marker: readable between buildings. */
  private groundOverlay(map: DataTexture, color: EffectRgb, intensity: number, order: number): Mesh<PlaneGeometry, MeshBasicMaterial> {
    const material = new MeshBasicMaterial({
      map,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    material.color.setRGB(color.r * intensity, color.g * intensity, color.b * intensity);
    const mesh = unpickable(new Mesh(this.plane, material));
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  }

  private glowSprite(color: EffectRgb, intensity: number, order: number): Sprite {
    const material = new SpriteMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    material.color.setRGB(color.r * intensity, color.g * intensity, color.b * intensity);
    const sprite = unpickable(new Sprite(material));
    sprite.frustumCulled = false;
    sprite.renderOrder = order;
    return sprite;
  }

  /** The point `s` metres along the beam's path, on the ground, into `out`. */
  private footAt(beam: Beam, s: number, out: Vector3): Vector3 {
    const { path, cumulative, points } = beam;
    let i = 1;
    while (i < points - 1 && cumulative[i] < s) i++;
    if (points < 2) {
      out.set(path[0], path[1], path[2]);
    } else {
      const span = cumulative[i] - cumulative[i - 1];
      const t = span > 0 ? Math.min(1, Math.max(0, (s - cumulative[i - 1]) / span)) : 0;
      const a = (i - 1) * 3;
      const b = i * 3;
      out.set(
        path[a] + (path[b] - path[a]) * t,
        path[a + 1] + (path[b + 1] - path[a + 1]) * t,
        path[a + 2] + (path[b + 2] - path[a + 2]) * t,
      );
    }
    const groundY = this.ground?.getGroundLocalYAt(out.x, out.z);
    if (groundY !== null && groundY !== undefined) out.y = groundY;
    return out;
  }

  /** Where the foot stood `born` game seconds after the impact, from the points taken then, into `out`. */
  private originAt(beam: Beam, born: number, out: Vector3): Vector3 {
    const reach = beam.reach;
    const u = beam.reachM > 0 ? ((beam.speedMps * Math.min(born, beam.burnS)) / beam.reachM) * (REACH_SAMPLES - 1) : 0;
    const j = Math.min(REACH_SAMPLES - 2, Math.floor(u));
    const f = Math.min(1, u - j);
    const a = j * 3;
    const b = a + 3;
    return out.set(
      reach[a] + (reach[b] - reach[a]) * f,
      reach[a + 1] + (reach[b + 1] - reach[a + 1]) * f,
      reach[a + 2] + (reach[b + 2] - reach[a + 2]) * f,
    );
  }

  /**
   * A scorch mark every scorchStep metres the foot has passed, the first
   * where it comes down, and with impact effects on a patch of embers,
   * born on the clock when the foot passed that point.
   */
  private leaveScorch(beam: Beam, s: number): void {
    while (beam.nextScorch <= s && beam.nextScorch <= beam.length) {
      const mark = this.footAt(beam, beam.nextScorch, this.mark);
      beam.scorch?.(mark.x, mark.y, mark.z);
      if (beam.full) {
        const passed = beam.speedMps > 0 ? beam.nextScorch / beam.speedMps : 0;
        this.addEmber(beam, mark, this.clock - (beam.t - passed));
      }
      beam.nextScorch += LOOK.scorchStep;
      beam.marks++;
    }
  }

  /** Ember patch number `beam.marks` of the beam on `at`, born `born` on the clock; it takes the oldest patch's place. */
  private addEmber(beam: Beam, at: Vector3, born: number): void {
    const k = beam.marks;
    const i = this.emberNext;
    this.emberNext = (i + 1) % EMBERS;
    this.emberCount = Math.min(EMBERS, this.emberCount + 1);
    const radius = LOOK.embers.size * beam.radiusM * (0.85 + 0.3 * particleHash(k, beam.born, 30));
    this.emberPosition.set(at.x, at.y + EMBER_LIFT, at.z);
    this.emberScale.set(radius, 1, radius);
    this.emberTurn.setFromAxisAngle(UP, particleHash(k, beam.born, 31) * TAU);
    this.embers.setMatrixAt(i, this.emberMatrix.compose(this.emberPosition, this.emberTurn, this.emberScale));
    this.embers.instanceMatrix.needsUpdate = true;
    this.emberBorn.setX(i, born);
    this.emberBorn.needsUpdate = true;
    this.emberSeed.setX(i, particleHash(k, beam.born, 32));
    this.emberSeed.needsUpdate = true;
    this.embers.count = this.emberCount;
    this.lastEmber = Math.max(this.lastEmber, born);
  }

  private updateColumn(beam: Beam, slot: number): void {
    const [columnGate, ringGate, footGate, flashGate, groundGate] = this.gates[slot];
    const t = beam.t;
    const fadeIn = Math.min(1, t / LOOK.fadeIn);
    const fadeOut = t <= beam.burnS ? 1 : Math.max(0, 1 - (t - beam.burnS) / LOOK.fadeOut);
    const intensity = fadeIn * fadeOut;
    if (intensity <= 0) {
      columnGate.setCount(0);
      ringGate.setCount(0);
      footGate.setCount(0);
      groundGate.setCount(0);
    } else {
      const uniforms = this.columns[slot].material.uniforms;
      (uniforms['uBase'].value as Vector3).copy(this.foot);
      uniforms['uIntensity'].value = intensity;
      uniforms['uTime'].value = t;
      uniforms['uReach'].value = Math.min(1, t / LOOK.descend);
      uniforms['uDetail'].value = beam.full ? 1 : 0;
      columnGate.setCount(1);

      const ring = this.rings[slot];
      ring.position.set(this.foot.x, this.foot.y + RING_LIFT, this.foot.z);
      ring.scale.set(beam.radiusM, 1, beam.radiusM);
      ring.material.opacity = LOOK.ring.opacity * intensity;
      ringGate.setCount(1);

      const foot = this.feet[slot];
      const pulse = 0.85 + 0.15 * Math.sin(t * 38);
      const size = LOOK.foot.size * beam.radiusM * pulse;
      foot.position.set(this.foot.x, this.foot.y + FOOT_LIFT, this.foot.z);
      foot.scale.set(size, size, 1);
      foot.material.opacity = intensity;
      footGate.setCount(1);

      if (beam.full) {
        const flicker = 0.8 + 0.12 * Math.sin(t * 29) + 0.08 * Math.sin(t * 53 + 1.3);
        const radius = LOOK.groundGlow.size * beam.radiusM;
        const glow = this.groundGlows[slot];
        glow.position.set(this.foot.x, this.foot.y + GROUND_GLOW_LIFT, this.foot.z);
        glow.scale.set(radius, 1, radius);
        glow.material.opacity = intensity * flicker;
        groundGate.setCount(1);
      } else {
        groundGate.setCount(0);
      }
    }

    if (t < LOOK.flash.duration) {
      const fade = 1 - t / LOOK.flash.duration;
      const flash = this.flashes[slot];
      const size = LOOK.flash.size * (0.5 + 0.5 * MathUtils.smoothstep(t, 0, 0.05));
      flash.position.set(this.foot.x, this.foot.y + FOOT_LIFT, this.foot.z);
      flash.scale.set(size, size, 1);
      flash.material.opacity = fade * fade;
      flashGate.setCount(1);
    } else {
      flashGate.setCount(0);
    }
  }

  /**
   * Sparks thrown from the foot: spark k is born at k / rate seconds where
   * the foot stood then, flies out and up and falls; drawn for its life.
   * Born only while the beam burns.
   */
  private writeSparks(beam: Beam, n: number, limit: number): number {
    const { life, speed, lift, gravity, size } = LOOK.sparks;
    const { spark, sparkHot } = LOOK.colors;
    const position = this.glow.position.array as Float32Array;
    const color = this.glow.color.array as Float32Array;
    const sizes = this.glow.size.array as Float32Array;
    const frames = this.glow.frame.array as Float32Array;
    const first = Math.max(0, Math.ceil((beam.t - life) / SPARK_INTERVAL));
    const last = Math.floor(Math.min(beam.t, beam.burnS) / SPARK_INTERVAL);

    for (let k = first; k <= last && n < limit; k++) {
      const born = k * SPARK_INTERVAL;
      const age = beam.t - born;
      if (age < 0 || age >= life) continue;
      const fade = 1 - age / life;
      const origin = this.originAt(beam, born, this.origin);
      const angle = particleHash(k, beam.born, 0) * TAU;
      const out = MathUtils.lerp(speed[0], speed[1], particleHash(k, beam.born, 1));
      const up = MathUtils.lerp(lift[0], lift[1], particleHash(k, beam.born, 2));
      position[n * 3] = origin.x + Math.cos(angle) * out * age;
      position[n * 3 + 1] = origin.y + 0.3 + Math.max(0, up * age - 0.5 * gravity * age * age);
      position[n * 3 + 2] = origin.z + Math.sin(angle) * out * age;
      const hot = particleHash(k, beam.born, 3);
      const light = fade * 1.5;
      color[n * 3] = MathUtils.lerp(spark.r, sparkHot.r, hot) * light;
      color[n * 3 + 1] = MathUtils.lerp(spark.g, sparkHot.g, hot) * light;
      color[n * 3 + 2] = MathUtils.lerp(spark.b, sparkHot.b, hot) * light;
      sizes[n] = MathUtils.lerp(size[0], size[1], hot) * (0.5 + 0.5 * fade) * this.sizePerMetre;
      frames[n] = -1; // round particle
      n++;
    }
    return n;
  }

  /**
   * Molten debris: blob k is born at k / rate seconds where the foot stood
   * then, flies out and up in an arc and lands, glowing and cooling from
   * yellow to dark red over its life; streaks behind it while it flies.
   * Born only while the beam burns.
   */
  private writeDebris(beam: Beam, n: number, limit: number): number {
    const { life, speed, lift, gravity, size, trail, trailStep } = LOOK.debris;
    const { debrisHot, debrisCold } = LOOK.colors;
    const position = this.glow.position.array as Float32Array;
    const color = this.glow.color.array as Float32Array;
    const sizes = this.glow.size.array as Float32Array;
    const frames = this.glow.frame.array as Float32Array;
    const first = Math.max(0, Math.ceil((beam.t - life[1]) / DEBRIS_INTERVAL));
    const last = Math.floor(Math.min(beam.t, beam.burnS) / DEBRIS_INTERVAL);

    for (let k = first; k <= last && n < limit; k++) {
      const born = k * DEBRIS_INTERVAL;
      const age = beam.t - born;
      const lifeS = MathUtils.lerp(life[0], life[1], particleHash(k, beam.born, 10));
      if (age < 0 || age >= lifeS) continue;
      const origin = this.originAt(beam, born, this.origin);
      const angle = particleHash(k, beam.born, 11) * TAU;
      const out = MathUtils.lerp(speed[0], speed[1], particleHash(k, beam.born, 12));
      const up = MathUtils.lerp(lift[0], lift[1], particleHash(k, beam.born, 13));
      // In the air until it is down from DEBRIS_START to DEBRIS_REST
      const landS = (up + Math.sqrt(up * up + 2 * gravity * (DEBRIS_START - DEBRIS_REST))) / gravity;
      const heat = 1 - age / lifeS;
      const hot = heat * heat;
      const diameter = MathUtils.lerp(size[0], size[1], particleHash(k, beam.born, 14));
      const dx = Math.cos(angle) * out;
      const dz = Math.sin(angle) * out;
      for (let j = 0; j < trail && n < limit; j++) {
        const a = age - j * trailStep;
        if (a < 0 || (j > 0 && a >= landS)) break;
        const flight = Math.min(a, landS);
        position[n * 3] = origin.x + dx * flight;
        position[n * 3 + 1] = origin.y + (a >= landS ? DEBRIS_REST : DEBRIS_START + up * flight - 0.5 * gravity * flight * flight);
        position[n * 3 + 2] = origin.z + dz * flight;
        const light = (0.35 + 1.3 * hot) * (1 - j / trail);
        color[n * 3] = MathUtils.lerp(debrisCold.r, debrisHot.r, hot) * light;
        color[n * 3 + 1] = MathUtils.lerp(debrisCold.g, debrisHot.g, hot) * light;
        color[n * 3 + 2] = MathUtils.lerp(debrisCold.b, debrisHot.b, hot) * light;
        sizes[n] = diameter * (1 - 0.25 * j) * (0.6 + 0.4 * heat) * this.sizePerMetre;
        frames[n] = -1; // round particle
        n++;
      }
    }
    return n;
  }

  /**
   * Smoke and dust: puff k is born at k / rate seconds around where the
   * foot stood then, rises and drifts out, grows and thins over the smoke
   * atlas' frames. Born only while the beam burns, so it lies along the
   * way behind the foot.
   */
  private writeSmoke(beam: Beam, n: number, limit: number): number {
    const { life, spread, rise, drift, size } = LOOK.smoke;
    const { dust, soot } = LOOK.colors;
    const position = this.smoke.position.array as Float32Array;
    const color = this.smoke.color.array as Float32Array;
    const sizes = this.smoke.size.array as Float32Array;
    const frames = this.smoke.frame.array as Float32Array;
    const first = Math.max(0, Math.ceil((beam.t - life[1]) / SMOKE_INTERVAL));
    const last = Math.floor(Math.min(beam.t, beam.burnS) / SMOKE_INTERVAL);

    for (let k = first; k <= last && n < limit; k++) {
      const born = k * SMOKE_INTERVAL;
      const age = beam.t - born;
      const lifeS = MathUtils.lerp(life[0], life[1], particleHash(k, beam.born, 20));
      if (age < 0 || age >= lifeS) continue;
      const progress = age / lifeS;
      const origin = this.originAt(beam, born, this.origin);
      const angle = particleHash(k, beam.born, 21) * TAU;
      const out = particleHash(k, beam.born, 22) * spread * beam.radiusM + drift * age;
      const up = MathUtils.lerp(rise[0], rise[1], particleHash(k, beam.born, 23));
      position[n * 3] = origin.x + Math.cos(angle) * out;
      position[n * 3 + 1] = origin.y + 0.6 + up * age * (1 - 0.35 * progress);
      position[n * 3 + 2] = origin.z + Math.sin(angle) * out;
      const sooty = particleHash(k, beam.born, 24);
      color[n * 3] = MathUtils.lerp(dust.r, soot.r, sooty);
      color[n * 3 + 1] = MathUtils.lerp(dust.g, soot.g, sooty);
      color[n * 3 + 2] = MathUtils.lerp(dust.b, soot.b, sooty);
      const diameter = MathUtils.lerp(size[0], size[1], Math.sqrt(progress)) * (0.85 + 0.3 * particleHash(k, beam.born, 25));
      sizes[n] = diameter * this.sizePerMetre;
      // Frame 2 at the start (thick), the last drawn frame at the end (faint)
      frames[n] = Math.min(SMOKE_LAST_FRAME, Math.round(2 + (SMOKE_LAST_FRAME - 2) * progress));
      n++;
    }
    return n;
  }
}
