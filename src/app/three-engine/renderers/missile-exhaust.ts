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
  type Scene,
} from 'three';
import { MISSILE_LAUNCH_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DISPLAY_OUTPUT_GLSL } from './display-output';
import { DrawGate } from './draw-gate';
import { radialTexture, unpickable } from './effect-buffers';
import type { Launch } from './missile-launch-state';
import { SEEDS, TAU, fract } from './mushroom-cloud-shape';
import { ATLAS_FRAMES, SpriteBuffer } from './mushroom-cloud-sprites';

const FULL = LOOK.glowSprites.full;
const GLOW_PER_LAUNCH = FULL.fire + FULL.plume;
/** Ground light under the strike marker (950) and the mushroom cloud's (949) */
const GROUND_GLOW_ORDER = 947;
/** Over the smoke (994) and the particle pools (999) */
const GLOW_ORDER = 1000;
const FLAME_ORDER = 1001;
const NOZZLE_ORDER = 1001;
const FLASH_ORDER = 1002;
/** Above the ground, m */
const GROUND_GLOW_LIFT = 0.4;
/** A glow sprite darker than this is left out */
const MIN_LIGHT = 0.01;
/** Share of a sprite the dense middle of a billow covers */
const GLOW_COVERAGE = 0.75;

/** Value noise from a hash, for the flame's flicker */
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
 * The flame: a quad from the nozzle along uAxis (away from the missile),
 * turned about that axis to face the camera. x runs across it (-1 to 1), y
 * along it (0 at the nozzle, 1 at the tip).
 */
const FLAME_VERTEX_SHADER = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uAxis;
  uniform float uLength;
  uniform float uHalfWidth;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec3 toCamera = cameraPosition - uBase;
    vec3 across = cross(uAxis, toCamera);
    float len = length(across);
    // Looking straight along the flame: any side will do, the glow covers it
    vec3 fallback = abs(uAxis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 side = len > 1e-4 ? across / len : normalize(cross(uAxis, fallback));
    vec3 world = uBase + uAxis * (position.y * uLength) + side * (position.x * uHalfWidth);
    vUv = position.xy;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/**
 * A white-hot core out of the nozzle over a yellow-orange body that reddens
 * and thins to its tip; its width and brightness flicker with noise running
 * down it in game time. Additive light in display values (displayLight),
 * depth tested, so buildings in front hide it.
 */
const FLAME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uHot;
  uniform vec3 uOuter;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  ${DISPLAY_OUTPUT_GLSL}
  ${NOISE_GLSL}

  void main() {
    float y = vUv.y;
    float n = noise(vec2(y * 6.0 - uTime * 14.0, uSeed));
    float fine = noise(vec2(y * 19.0 - uTime * 33.0, uSeed + 7.3));
    // Widest a little behind the nozzle, down to nothing at the tip
    float width = (0.45 + 0.55 * smoothstep(0.0, 0.2, y)) * max(1.0 - y, 0.0) * (0.8 + 0.4 * n);
    if (width < 0.01) discard;
    float across = abs(vUv.x) / width;
    if (across >= 1.0) discard;
    float core = exp(-across * across * 10.0) * (1.0 - smoothstep(0.0, 0.5, y));
    float body = exp(-across * across * 2.5) * (1.0 - smoothstep(0.15, 1.0, y));
    vec3 color = mix(uHot, uOuter, smoothstep(0.15, 0.85, y + 0.2 * (fine - 0.5)));
    float edge = 1.0 - smoothstep(0.7, 1.0, across);
    vec3 light = (uCore * core * 1.5 + color * body * (0.75 + 0.5 * fine)) * edge;
    gl_FragColor = vec4(displayLight(light * uIntensity), 1.0);
    #include <logdepthbuf_fragment>
  }
`;

function rgb(color: EffectRgb): Vector3 {
  return new Vector3(color.r, color.g, color.b);
}

/**
 * The fire of the missiles (MissileLaunchRenderer): per launch a flame at
 * the nozzle, a glow sprite on it, a flash over the shaft and light on the
 * ground around the silo; in one shared buffer of additive billow sprites
 * the fire bursting out of the shaft at the ignition and a plume along the
 * flame. The tiles take no light, so the ground light is an additive disc;
 * like the glow and the flash without depth test.
 */
export class MissileExhaust {
  private readonly seeds = new Float32Array(LOOK.launches * FULL.fire * SEEDS);
  private readonly glow: SpriteBuffer;
  private readonly flameGeometry = new PlaneGeometry(2, 1, 1, 16).translate(0, 0.5, 0);
  private readonly plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly glowTexture: DataTexture;
  private readonly groundTexture: DataTexture;
  private readonly flames: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly nozzles: Sprite[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly grounds: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  /** Per launch: flame, nozzle glow, flash, ground light */
  private readonly gates: DrawGate[][] = [];
  private readonly nozzle = new Vector3();
  private readonly axis = new Vector3();

  constructor(scene: Scene, glowMaterial: ShaderMaterial) {
    this.glow = new SpriteBuffer(scene, LOOK.launches * GLOW_PER_LAUNCH, glowMaterial, GLOW_ORDER, 'missile-glow', false);
    this.glowTexture = radialTexture(64, (r) => (1 - r) ** 2);
    this.groundTexture = radialTexture(128, (r) => (1 - r) ** 2.2);
    const { colors } = LOOK;

    for (let i = 0; i < LOOK.launches; i++) {
      const material = new ShaderMaterial({
        name: 'missile-flame',
        vertexShader: FLAME_VERTEX_SHADER,
        fragmentShader: FLAME_FRAGMENT_SHADER,
        uniforms: {
          uBase: new Uniform(new Vector3()),
          uAxis: new Uniform(new Vector3(0, -1, 0)),
          uLength: new Uniform(0),
          uHalfWidth: new Uniform(0),
          uCore: new Uniform(rgb(colors.flameCore)),
          uHot: new Uniform(rgb(colors.flameHot)),
          uOuter: new Uniform(rgb(colors.flameOuter)),
          uIntensity: new Uniform(0),
          uTime: new Uniform(0),
          uSeed: new Uniform(i * 17.3),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const flame = unpickable(new Mesh(this.flameGeometry, material));
      flame.name = `missile-flame-${i}`;
      flame.frustumCulled = false;
      flame.renderOrder = FLAME_ORDER;

      const nozzle = this.glowSprite(colors.nozzleGlow, LOOK.nozzleGlow.intensity, NOZZLE_ORDER);
      nozzle.name = `missile-nozzle-glow-${i}`;
      const flash = this.glowSprite(colors.flash, LOOK.flash.intensity, FLASH_ORDER);
      flash.name = `missile-flash-${i}`;

      const groundMaterial = new MeshBasicMaterial({
        map: this.groundTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      const peak = LOOK.groundGlow.peak;
      groundMaterial.color.setRGB(colors.groundGlow.r * peak, colors.groundGlow.g * peak, colors.groundGlow.b * peak);
      const ground = unpickable(new Mesh(this.plane, groundMaterial));
      ground.name = `missile-ground-glow-${i}`;
      ground.frustumCulled = false;
      ground.renderOrder = GROUND_GLOW_ORDER;

      for (const object of [flame, nozzle, flash, ground]) scene.add(object);
      this.flames.push(flame);
      this.nozzles.push(nozzle);
      this.flashes.push(flash);
      this.grounds.push(ground);
      this.gates.push([flame, nozzle, flash, ground].map((object) => new DrawGate([object])));
    }
  }

  /** Draw the random numbers of a launch in `slot`. */
  seed(slot: number): void {
    const start = slot * FULL.fire * SEEDS;
    for (let i = start; i < start + FULL.fire * SEEDS; i++) this.seeds[i] = Math.random();
  }

  /** Flame, glow, flash and ground light of `launch` in `slot`; its sprites into the buffer from `n` on, returns the next free one. */
  update(launch: Launch, slot: number, n: number): number {
    const [flameGate, nozzleGate, flashGate, groundGate] = this.gates[slot];
    const { t, thrust, scale } = launch;
    const flicker = 0.85 + 0.1 * Math.sin(t * 41 + slot) + 0.05 * Math.sin(t * 67 + 2.1 * slot);
    const stretch = 1 + LOOK.flame.stretch * MathUtils.smoothstep(launch.speed, 0, LOOK.flame.stretchSpeed);
    const flameLength = LOOK.flame.length * scale * stretch * (0.4 + 0.6 * thrust);
    this.axis.copy(launch.direction).negate();

    if (thrust > 0) {
      const uniforms = this.flames[slot].material.uniforms;
      (uniforms['uBase'].value as Vector3).copy(launch.position);
      (uniforms['uAxis'].value as Vector3).copy(this.axis);
      uniforms['uLength'].value = flameLength;
      uniforms['uHalfWidth'].value = (LOOK.flame.width / 2) * scale;
      uniforms['uIntensity'].value = LOOK.flame.intensity * thrust;
      uniforms['uTime'].value = t;
      flameGate.setCount(1);

      const nozzle = this.nozzles[slot];
      const size = LOOK.nozzleGlow.size * scale * (0.9 + 0.1 * flicker);
      this.nozzle.copy(launch.position).addScaledVector(this.axis, 0.15 * flameLength);
      nozzle.position.copy(this.nozzle);
      nozzle.scale.set(size, size, 1);
      nozzle.material.opacity = thrust * flicker;
      nozzleGate.setCount(1);
    } else {
      flameGate.setCount(0);
      nozzleGate.setCount(0);
    }

    const { flash } = LOOK;
    if (t < flash.duration) {
      const fade = 1 - t / flash.duration;
      const size = flash.size * (0.5 + 0.5 * MathUtils.smoothstep(t, 0, 0.06));
      const sprite = this.flashes[slot];
      sprite.position.set(launch.site.x, launch.site.y + launch.shaftTop, launch.site.z);
      sprite.scale.set(size, size, 1);
      sprite.material.opacity = fade * fade;
      flashGate.setCount(1);
    } else {
      flashGate.setCount(0);
    }

    // Light on the ground while the flame is low over the silo, and with the flash
    const altitude = launch.position.y - launch.site.y;
    const near = 1 - MathUtils.smoothstep(altitude, 4, LOOK.groundGlow.height);
    const flashLight = t < flash.duration ? (1 - t / flash.duration) ** 2 : 0;
    const light = launch.full ? Math.min(1.2, thrust * near * flicker + 0.6 * flashLight) : 0;
    if (light > MIN_LIGHT) {
      const ground = this.grounds[slot];
      const radius = LOOK.groundGlow.radius * (0.85 + 0.15 * near);
      ground.position.set(launch.site.x, launch.site.y + GROUND_GLOW_LIFT, launch.site.z);
      ground.scale.set(radius, 1, radius);
      ground.material.opacity = light;
      groundGate.setCount(1);
    } else {
      groundGate.setCount(0);
    }

    if (!launch.full) return n;
    n = this.writeFire(launch, slot, n);
    return thrust > 0 ? this.writePlume(launch, slot, flameLength, flicker, n) : n;
  }

  /** Hide everything of `slot` (no launch there). */
  hide(slot: number): void {
    for (const gate of this.gates[slot]) gate.setCount(0);
  }

  /** Draw the first `count` glow sprites written this frame. */
  commit(count: number): void {
    this.glow.commit(count);
  }

  /** Hide all of it (restart). */
  clear(): void {
    for (let slot = 0; slot < LOOK.launches; slot++) this.hide(slot);
    this.glow.commit(0);
  }

  /** Remove and free all of it but the glow material, which belongs to the mushroom clouds. */
  dispose(scene: Scene): void {
    this.clear();
    this.glow.dispose(scene);
    for (const flame of this.flames) {
      scene.remove(flame);
      flame.material.dispose();
    }
    for (const sprite of [...this.nozzles, ...this.flashes]) {
      scene.remove(sprite);
      sprite.material.dispose();
    }
    for (const ground of this.grounds) {
      scene.remove(ground);
      ground.material.dispose();
    }
    this.flameGeometry.dispose();
    this.plane.dispose();
    this.glowTexture.dispose();
    this.groundTexture.dispose();
  }

  /**
   * Fire bursting out of the top of the shaft through the ignition: sprite
   * k is born at its share of `fire.until`, rises and spreads, cooling and
   * fading over its life.
   */
  private writeFire(launch: Launch, slot: number, n: number): number {
    const { fire, colors } = LOOK;
    const t = launch.t;
    if (t >= fire.until) return n;
    const count = FULL.fire;
    const r = this.seeds;
    const tail = 1 - MathUtils.smoothstep(t, fire.until * 0.5, fire.until);
    for (let k = 0, seed = slot * count * SEEDS; k < count; k++, seed += SEEDS) {
      const born = ((k + r[seed]) / count) * fire.until * 0.8;
      const life = MathUtils.lerp(fire.life[0], fire.life[1], r[seed + 1]);
      const age = t - born;
      if (age <= 0 || age >= life) continue;
      const share = age / life;
      const light = 1.4 * (1 - share) ** 1.5 * tail * MathUtils.smoothstep(age, 0, 0.05);
      if (light <= MIN_LIGHT) continue;
      const angle = r[seed + 2] * TAU;
      const out = fire.spread * (0.3 + r[seed + 3]) * Math.sqrt(age);
      const rise = MathUtils.lerp(fire.rise[0], fire.rise[1], r[seed + 3]) * age;
      const diameter = MathUtils.lerp(fire.size[0], fire.size[1], r[seed + 1]) * (0.6 + 0.6 * share);
      const cool = MathUtils.smoothstep(share, 0.2, 1);
      this.put(
        n++,
        launch.site.x + Math.cos(angle) * out,
        launch.site.y + launch.shaftTop + rise,
        launch.site.z + Math.sin(angle) * out,
        launch.site.y,
        diameter,
        r[seed + 2],
        colors.fire,
        light * (1 - 0.4 * cool),
      );
    }
    return n;
  }

  /** The plume: sprites along the flame, flickering, dimmer and smaller towards its end. */
  private writePlume(launch: Launch, slot: number, flameLength: number, flicker: number, n: number): number {
    const { plume, flame, colors } = LOOK;
    const count = FULL.plume;
    const reach = flameLength * plume.reach;
    const width = flame.width * launch.scale;
    const t = launch.t;
    for (let i = 0; i < count; i++) {
      const k = i / (count - 1);
      const wobble = 0.8 + 0.2 * Math.sin(t * (23 + 7 * i) + i * 1.7 + slot);
      const light = launch.thrust * (1 - 0.75 * k) * wobble * flicker;
      if (light <= MIN_LIGHT) continue;
      this.nozzle.copy(launch.position).addScaledVector(this.axis, k * reach);
      const diameter = MathUtils.lerp(plume.size[0], plume.size[1], k) * width * (0.85 + 0.3 * wobble);
      this.put(n++, this.nozzle.x, this.nozzle.y, this.nozzle.z, launch.site.y - 100, diameter, k * 0.37 + slot * 0.21, colors.plume, light);
    }
    return n;
  }

  /** Glow sprite `n`: `diameter` m, colour times `light`; `pick` chooses billow and turn. */
  private put(n: number, x: number, y: number, z: number, floor: number, diameter: number, pick: number, color: EffectRgb, light: number): void {
    this.glow.put(
      n,
      x,
      y,
      z,
      floor,
      diameter / GLOW_COVERAGE,
      TAU * fract(pick * 7.9),
      1,
      Math.floor(fract(pick * 13.7) * ATLAS_FRAMES),
      color.r * light,
      color.g * light,
      color.b * light,
    );
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
}
