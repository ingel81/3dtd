import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Uniform,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { ORBITAL_BEAM_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';
import { commitParticles, particleBuffer, radialTexture, unpickable, type ParticleBuffer } from './effect-buffers';

/** Points of a beam's path at most; a longer one is cut off (the sweep is some 70 m) */
const MAX_POINTS = 256;
const TAU = Math.PI * 2;
/** Sparks alive at once per beam, at most */
const SPARKS_PER_BEAM = Math.ceil(LOOK.sparks.rate * LOOK.sparks.life) + 1;
const SPARK_INTERVAL = 1 / LOOK.sparks.rate;

/** The column is drawn with the depth test, after the ground overlays */
const RING_ORDER = 957;
const COLUMN_ORDER = 990;
const SPARK_ORDER = 996;
const FOOT_ORDER = 1001;
const FLASH_ORDER = 1002;
/** Ring and foot glow above the ground, m */
const RING_LIFT = 0.5;
const FOOT_LIFT = 1.2;

/** Ground under the beam; the route grid, see setGround(). */
export interface BeamGround {
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

/** Where a beam leaves a scorch mark, local coordinates on the ground */
export type BeamScorch = (x: number, y: number, z: number) => void;

/**
 * The beam's column: a quad from the foot straight up, turned about the
 * vertical to face the camera (a cylinder seen from anywhere but straight
 * above). x runs across it (-1 to 1), y up (0 to 1). A white-hot core and
 * an orange glow across it, fading towards the top, brightest at the
 * ground, rippling downwards in game time. Additive, linear light out,
 * encoded for the canvas (colorspace_fragment); depth tested, so buildings
 * in front hide it.
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

const COLUMN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform float uCoreShare;
  uniform float uGlowShare;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float x = abs(vUv.x);
    float core = exp(-(x * x) / (uCoreShare * uCoreShare));
    float glow = 0.55 * exp(-(x * x) / (uGlowShare * uGlowShare));
    float along = 1.0 - smoothstep(0.45, 1.0, vUv.y);
    float ground = 1.0 + 1.5 * exp(-vUv.y * 80.0);
    float ripple = 0.8 + 0.2 * sin(vUv.y * 220.0 + uTime * 45.0);
    float alpha = clamp((core + glow) * along * ground * ripple, 0.0, 1.0) * uIntensity;
    gl_FragColor = vec4(uCore * core + uGlow * glow, alpha);
    #include <colorspace_fragment>
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
  /** Metres along the path of the next scorch mark */
  nextScorch: number;
  scorch: BeamScorch | null;
  /** Sparks too (impact effects on) */
  full: boolean;
  born: number;
}

function additive(color: EffectRgb, scale = 1): Vector3 {
  return new Vector3(color.r * scale, color.g * scale, color.b * scale);
}

/** Pseudo-random 0-1 from a spark's number and its beam, the same every frame. */
function sparkHash(k: number, beam: number, channel: number): number {
  const h = Math.sin(k * 12.9898 + beam * 78.233 + channel * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Beam of the orbital laser (ORBITAL_BEAM_LOOK): a column of light from
 * high above onto the route, its foot running along the path the
 * AbilityManager swept (from the aim point toward the spawn), a ring on the
 * ground at the beam's radius, a glow and sparks at the foot, a flash where
 * it starts, and a scorch mark every few metres of the way.
 *
 * It runs in game time like the simulation's beam: the foot is at speed
 * times age along the path, so a pause holds it and the timescale plays it
 * faster; the sparks are functions of their birth time and number. The
 * foot stands on the route grid's ground where the grid has a cell
 * (setGround), else on the path's own height. Nothing allocated per frame.
 */
export class OrbitalBeamRenderer {
  private readonly beams: Beam[] = [];
  private activeCount = 0;
  private sequence = 0;
  private full = true;
  private ground: BeamGround | null = null;

  private readonly sparks: ParticleBuffer;
  private readonly columnGeometry = new PlaneGeometry(2, 1, 1, 32).translate(0, 0.5, 0);
  private readonly plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly ringTexture: DataTexture;
  private readonly glowTexture: DataTexture;
  private readonly columns: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly rings: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly feet: Sprite[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly gates: DrawGate[][] = [];

  private sizePerMetre = 0;
  private readonly foot = new Vector3();
  private readonly sparkFoot = new Vector3();

  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
  ) {
    for (let i = 0; i < LOOK.beams; i++) {
      this.beams.push({
        active: false, t: 0, path: new Float32Array(MAX_POINTS * 3), cumulative: new Float32Array(MAX_POINTS),
        points: 0, length: 0, radiusM: 0, speedMps: 0, burnS: 0, nextScorch: 0, scorch: null, full: true, born: 0,
      });
    }
    this.sparks = particleBuffer(scene, LOOK.beams * SPARKS_PER_BEAM, materials.additive, SPARK_ORDER);
    this.ringTexture = radialTexture(128, (r) =>
      Math.exp(-(((r - 0.88) / 0.07) ** 2)) + (r < 0.88 ? 0.25 * MathUtils.smoothstep(r, 0, 0.88) : 0));
    this.glowTexture = radialTexture(64, (r) => (1 - r) ** 2);

    const { colors, column } = LOOK;
    for (let i = 0; i < LOOK.beams; i++) {
      const columnMaterial = new ShaderMaterial({
        vertexShader: COLUMN_VERTEX_SHADER,
        fragmentShader: COLUMN_FRAGMENT_SHADER,
        uniforms: {
          uBase: new Uniform(new Vector3()),
          uHeight: new Uniform(column.height),
          uHalfWidth: new Uniform(column.quadWidth / 2),
          uCore: new Uniform(additive(colors.core, column.intensity)),
          uGlow: new Uniform(additive(colors.glow, column.intensity)),
          uCoreShare: new Uniform(column.coreWidth / (column.quadWidth / 2)),
          uGlowShare: new Uniform(column.glowWidth / (column.quadWidth / 2)),
          uIntensity: new Uniform(0),
          uTime: new Uniform(0),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const columnMesh = unpickable(new Mesh(this.columnGeometry, columnMaterial));
      columnMesh.frustumCulled = false;
      columnMesh.renderOrder = COLUMN_ORDER;

      const ringMaterial = new MeshBasicMaterial({
        map: this.ringTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      ringMaterial.color.setRGB(colors.ring.r, colors.ring.g, colors.ring.b);
      const ring = unpickable(new Mesh(this.plane, ringMaterial));
      ring.frustumCulled = false;
      ring.renderOrder = RING_ORDER;

      const foot = this.glowSprite(colors.foot, LOOK.foot.intensity, FOOT_ORDER);
      const flash = this.glowSprite(colors.flash, LOOK.flash.intensity, FLASH_ORDER);

      for (const object of [columnMesh, ring, foot, flash]) scene.add(object);
      this.columns.push(columnMesh);
      this.rings.push(ring);
      this.feet.push(foot);
      this.flashes.push(flash);
      this.gates.push([columnMesh, ring, foot, flash].map((object) => new DrawGate([object])));
    }
  }

  /** Beams still showing something. */
  get activeBeams(): number {
    return this.activeCount;
  }

  /** Sparks too (VFX settings: impact effects). Takes hold with the next beam. */
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
    beam.scorch = scorch;
    beam.full = this.full;
    beam.born = ++this.sequence;
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
    this.sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);

    let sparkCount = 0;
    for (let slot = 0; slot < this.beams.length; slot++) {
      const beam = this.beams[slot];
      if (beam.active) {
        beam.t += dt;
        if (beam.t >= beam.burnS + Math.max(LOOK.fadeOut, LOOK.sparks.life)) {
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
      if (beam.full) sparkCount = this.writeSparks(beam, slot, sparkCount);
    }
    commitParticles(this.sparks, sparkCount);
  }

  /** Drop every beam (restart). */
  clear(): void {
    for (const beam of this.beams) {
      beam.active = false;
      beam.scorch = null;
    }
    this.activeCount = 0;
    commitParticles(this.sparks, 0);
    for (const gates of this.gates) for (const gate of gates) gate.setCount(0);
  }

  /** Remove and free everything but the particle material, which belongs to the trail pools. */
  dispose(): void {
    this.clear();
    this.scene.remove(this.sparks.points);
    this.sparks.points.geometry.dispose();
    for (const mesh of [...this.columns, ...this.rings]) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    for (const sprite of [...this.feet, ...this.flashes]) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.columnGeometry.dispose();
    this.plane.dispose();
    this.ringTexture.dispose();
    this.glowTexture.dispose();
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

  /** A scorch mark every scorchStep metres the foot has passed, the first where it comes down. */
  private leaveScorch(beam: Beam, s: number): void {
    if (!beam.scorch) return;
    while (beam.nextScorch <= s && beam.nextScorch <= beam.length) {
      const mark = this.footAt(beam, beam.nextScorch, this.sparkFoot);
      beam.scorch(mark.x, mark.y, mark.z);
      beam.nextScorch += LOOK.scorchStep;
    }
  }

  private updateColumn(beam: Beam, slot: number): void {
    const [columnGate, ringGate, footGate, flashGate] = this.gates[slot];
    const t = beam.t;
    const fadeIn = Math.min(1, t / LOOK.fadeIn);
    const fadeOut = t <= beam.burnS ? 1 : Math.max(0, 1 - (t - beam.burnS) / LOOK.fadeOut);
    const intensity = fadeIn * fadeOut;
    if (intensity <= 0) {
      columnGate.setCount(0);
      ringGate.setCount(0);
      footGate.setCount(0);
    } else {
      const uniforms = this.columns[slot].material.uniforms;
      (uniforms['uBase'].value as Vector3).copy(this.foot);
      uniforms['uIntensity'].value = intensity;
      uniforms['uTime'].value = t;
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
  private writeSparks(beam: Beam, slot: number, n: number): number {
    const { life, speed, lift, gravity, size } = LOOK.sparks;
    const { spark, sparkHot } = LOOK.colors;
    const position = this.sparks.position.array as Float32Array;
    const color = this.sparks.color.array as Float32Array;
    const sizes = this.sparks.size.array as Float32Array;
    const frames = this.sparks.frame.array as Float32Array;
    const first = Math.max(0, Math.ceil((beam.t - life) / SPARK_INTERVAL));
    const last = Math.floor(Math.min(beam.t, beam.burnS) / SPARK_INTERVAL);
    const limit = (slot + 1) * SPARKS_PER_BEAM;

    for (let k = first; k <= last && n < limit; k++) {
      const born = k * SPARK_INTERVAL;
      const age = beam.t - born;
      if (age < 0 || age >= life) continue;
      const fade = 1 - age / life;
      const origin = this.footAt(beam, beam.speedMps * born, this.sparkFoot);
      const angle = sparkHash(k, beam.born, 0) * TAU;
      const out = MathUtils.lerp(speed[0], speed[1], sparkHash(k, beam.born, 1));
      const up = MathUtils.lerp(lift[0], lift[1], sparkHash(k, beam.born, 2));
      position[n * 3] = origin.x + Math.cos(angle) * out * age;
      position[n * 3 + 1] = origin.y + 0.3 + Math.max(0, up * age - 0.5 * gravity * age * age);
      position[n * 3 + 2] = origin.z + Math.sin(angle) * out * age;
      const hot = sparkHash(k, beam.born, 3);
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
}
