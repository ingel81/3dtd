import { MathUtils, Mesh, ShaderMaterial, SphereGeometry, Uniform, Vector3, type Scene } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { unpickable } from './effect-buffers';
import { CloudShape, type Cloud } from './mushroom-cloud-shape';

/** Between the smoke behind it (995) and the glow (997) */
const FIREBALL_ORDER = 996;
/** How deep the ball sits in the ground before it rises, share of its radius */
const GROUND_SINK = 0.45;

/**
 * Heat of the fireball's surface `t` game seconds after the impact: 1
 * white-hot, about 0.75 yellow, 0.5 orange, under 0.3 dark red (the colour
 * ramp of the fragment shader); the boiling cells spread it by about 0.2.
 */
export function fireballHeat(t: number): number {
  return 0.12 + 0.88 * Math.exp(-t / LOOK.fireball.heatTime);
}

/** Value noise and its octaves, for both stages; uDetail adds the two finer octaves. */
const NOISE_GLSL = /* glsl */ `
  uniform float uDetail;

  float hash13(vec3 p) {
    p = fract(p * vec3(0.1127, 0.1319, 0.0983));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
  }

  // 0 to 1; without detail the two finer octaves are their mean
  float fbm3(vec3 p) {
    float sum = 0.5 * noise3(p) + 0.25 * noise3(p * 2.03 + 11.7);
    if (uDetail > 0.5) {
      sum += 0.125 * noise3(p * 4.01 + 23.1) + 0.0625 * noise3(p * 8.07 + 37.3);
    } else {
      sum += 0.09375;
    }
    return sum / 0.9375;
  }
`;

/** The unit sphere bulged by rising noise cells, in game time (uTime). */
const FIREBALL_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBoil;
  uniform vec3 uSeed;
  varying vec3 vObject;
  varying vec3 vNormalView;
  varying vec3 vView;
  varying float vBump;

  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${NOISE_GLSL}

  void main() {
    vec3 n = normalize(position);
    float bump = fbm3(n * 2.2 + uSeed + vec3(0.0, -0.9 * uTime, 0.0));
    vec4 mvPosition = modelViewMatrix * vec4(n * (1.0 + uBoil * (bump - 0.5)), 1.0);
    vObject = n;
    vBump = bump;
    vNormalView = normalize(normalMatrix * n);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

/**
 * Colour from the heat (uHeat) and finer cells sliding up the surface,
 * cooler along the outline, sooty where it has cooled; the outline soft.
 */
const FIREBALL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform vec3 uSeed;
  varying vec3 vObject;
  varying vec3 vNormalView;
  varying vec3 vView;
  varying float vBump;

  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}

  // Dark red, red, orange, yellow, white over 0 to 1
  vec3 heatColor(float h) {
    vec3 c = mix(vec3(0.16, 0.02, 0.0), vec3(0.72, 0.1, 0.02), smoothstep(0.0, 0.3, h));
    c = mix(c, vec3(1.0, 0.42, 0.06), smoothstep(0.25, 0.55, h));
    c = mix(c, vec3(1.0, 0.8, 0.3), smoothstep(0.5, 0.78, h));
    return mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.75, 1.0, h));
  }

  void main() {
    float facing = clamp(dot(normalize(vNormalView), normalize(vView)), 0.0, 1.0);
    float cells = fbm3(vObject * 5.0 + uSeed * 1.7 + vec3(0.0, -1.6 * uTime, 0.0));
    float heat = uHeat + 0.35 * (cells - 0.5) + 0.2 * (vBump - 0.5) - 0.25 * (1.0 - facing);
    vec3 color = heatColor(clamp(heat, 0.0, 1.0)) * uIntensity;
    float soot = (1.0 - smoothstep(0.1, 0.4, heat)) * (1.0 - smoothstep(0.3, 0.55, cells));
    color = mix(color, vec3(0.05, 0.03, 0.02), 0.75 * soot);
    gl_FragColor = vec4(color, uOpacity * smoothstep(0.0, 0.3, facing));
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }
`;

/**
 * The fireballs of the mushroom clouds, one per cloud: a sphere with a
 * boiling surface (value noise in both stages, in game time), white-hot
 * turning yellow, orange and dark red (fireballHeat). It swells on the
 * ground, rises with the cap and flattens into its core, then fades while
 * the glow under the cap takes over (MushroomCloudRenderer). Normal
 * blending, depth test on, no depth write: the smoke behind it draws first,
 * the smoke in front of it after it (CloudSmoke).
 */
export class CloudFireballs extends CloudShape {
  private readonly geometry = new SphereGeometry(1, 48, 24);
  private readonly balls: Mesh<SphereGeometry, ShaderMaterial>[] = [];
  private readonly gates: DrawGate[] = [];

  constructor(scene: Scene) {
    super();
    for (let i = 0; i < LOOK.clouds; i++) {
      const material = new ShaderMaterial({
        name: 'mushroom-fireball',
        vertexShader: FIREBALL_VERTEX_SHADER,
        fragmentShader: FIREBALL_FRAGMENT_SHADER,
        uniforms: {
          uTime: new Uniform(0),
          uHeat: new Uniform(1),
          uIntensity: new Uniform(1),
          uOpacity: new Uniform(0),
          uBoil: new Uniform(LOOK.fireball.boil),
          uDetail: new Uniform(1),
          uSeed: new Uniform(new Vector3()),
        },
        transparent: true,
        depthWrite: false,
      });
      const ball = unpickable(new Mesh(this.geometry, material));
      ball.name = `mushroom-fireball-${i}`;
      ball.frustumCulled = false;
      ball.renderOrder = FIREBALL_ORDER;
      scene.add(ball);
      this.balls.push(ball);
      this.gates.push(new DrawGate([ball]));
    }
  }

  /** New boiling for a strike in cloud `slot`. */
  seed(slot: number): void {
    const seed = this.balls[slot].material.uniforms['uSeed'].value as Vector3;
    seed.set(Math.random() * 100, Math.random() * 100, Math.random() * 100);
  }

  /** Where the fireball of `slot` stands (valid while update() says it is drawn). */
  centre(slot: number): Vector3 {
    return this.balls[slot].position;
  }

  /** The fireball of `cloud` in its `slot` at its age; returns whether it is drawn. */
  update(cloud: Cloud, slot: number): boolean {
    const { fireball } = LOOK;
    const t = cloud.t;
    const opacity = 1 - MathUtils.smoothstep(t, fireball.fadeStart, fireball.fadeEnd);
    if (opacity <= 0.01) {
      this.gates[slot].setCount(0);
      return false;
    }
    this.shape(cloud);
    const s = cloud.scale;
    const radius =
      fireball.radius * s * (1 - Math.exp(-t / fireball.growTime)) * (1 + fireball.swell * MathUtils.smoothstep(t, 0, 3));
    const rise = MathUtils.smoothstep(t, fireball.riseStart, fireball.riseEnd);
    const flat = MathUtils.smoothstep(t, fireball.flattenStart, fireball.flattenEnd);
    const punch = fireball.punch * s * (1 - Math.exp(-t / fireball.punchTime));
    this.px = 0;
    this.py = MathUtils.lerp(radius * (1 - GROUND_SINK) + punch, this.capY, rise);
    this.pz = 0;
    this.drift();
    const across = Math.max(0.01, MathUtils.lerp(radius, this.ringR + 0.6 * this.tubeR, flat));
    const up = Math.max(0.01, MathUtils.lerp(radius, this.tubeR * LOOK.cap.flatten, flat));

    const ball = this.balls[slot];
    ball.position.set(cloud.x + this.px, cloud.y + this.py, cloud.z + this.pz);
    ball.scale.set(across, up, across);
    const uniforms = ball.material.uniforms;
    uniforms['uTime'].value = t;
    uniforms['uHeat'].value = fireballHeat(t);
    uniforms['uIntensity'].value = MathUtils.lerp(
      fireball.intensity[1],
      fireball.intensity[0],
      Math.exp(-t / fireball.intensityTime),
    );
    uniforms['uOpacity'].value = opacity;
    uniforms['uDetail'].value = cloud.full ? 1 : 0;
    this.gates[slot].setCount(1);
    return true;
  }

  /** Hide the fireball of `slot` (no cloud there). */
  hide(slot: number): void {
    this.gates[slot].setCount(0);
  }

  /** Hide all of them (restart). */
  clear(): void {
    for (const gate of this.gates) gate.setCount(0);
  }

  /** Remove and free all of them. */
  dispose(scene: Scene): void {
    for (const ball of this.balls) {
      scene.remove(ball);
      ball.material.dispose();
    }
    this.geometry.dispose();
  }
}
