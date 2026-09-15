import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  RGBAFormat,
  Sprite,
  SpriteMaterial,
  type PerspectiveCamera,
  type Scene,
  type Vector3,
} from 'three';
import { FROST_BURST_LOOK as LOOK, type EffectRgb } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';
import { commitParticles, particleBuffer, radialTexture, reach, unpickable, type ParticleBuffer } from './effect-buffers';

const SHARDS = LOOK.shards.count;
const MIST = LOOK.mist.count;
/** Random numbers per particle, drawn once per burst */
const SEEDS = 5;
const TAU = Math.PI * 2;
/** Frames of the 4x4 smoke atlas; the last one is empty */
const SMOKE_LAST_FRAME = 14;
/** A shard darker than this is left out */
const MIN_LIGHT = 0.02;

/** Above the strike marker (950) and the mushroom cloud's ring (951), under the particle pools (999) */
const RIME_ORDER = 953;
const RING_ORDER = 954;
const SHARD_ORDER = 996;
const MIST_ORDER = 997;
const FLASH_ORDER = 1002;
/** Rime and ring above the ground point, m */
const RIME_LIFT = 0.3;
const RING_LIFT = 0.6;

interface Burst {
  active: boolean;
  /** Game seconds since the impact */
  t: number;
  /** Ground point, local coordinates */
  x: number;
  y: number;
  z: number;
  /** Radius over LOOK.referenceRadius */
  scale: number;
  radiusM: number;
  /** Seconds the rime holds before it fades: the freeze */
  holdS: number;
  /** Game seconds until the last of it is gone */
  end: number;
  /** Shards and mist too, or the flash, ring and rime only (impact effects off) */
  full: boolean;
  /** Order of the bursts, the oldest makes room */
  born: number;
}

/**
 * Square texture of frost on the ground: speckled crystals under a faint
 * fill, brightest towards the edge, gone at it. Value noise from a hash, so
 * every run draws the same frost.
 */
function rimeTexture(size: number): DataTexture {
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx);
    const bottom = MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx);
    return MathUtils.lerp(top, bottom, sy);
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = Math.hypot(u * 2 - 1, v * 2 - 1);
      let alpha = 0;
      if (r < 1) {
        const crystals = 0.55 * noise(u * 14, v * 14) + 0.45 * noise(u * 52, v * 52);
        const speckle = MathUtils.smoothstep(crystals, 0.45, 0.8);
        const rim = MathUtils.smoothstep(r, 0.5, 0.92) * (1 - MathUtils.smoothstep(r, 0.93, 1));
        alpha = (0.18 + 0.55 * speckle) * (1 - MathUtils.smoothstep(r, 0.9, 1)) + 0.35 * rim;
      }
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, alpha) * 255);
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
 * Material of a quad on the ground: `additive` light over everything (depth
 * test off), otherwise a colour in the normal blend under whatever stands on
 * it (depth test on).
 */
function groundMaterial(map: DataTexture, color: EffectRgb, additive: boolean): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0,
    blending: additive ? AdditiveBlending : NormalBlending,
    depthTest: !additive,
    depthWrite: false,
    side: DoubleSide,
  });
  material.color.setRGB(color.r, color.g, color.b);
  return material;
}

/**
 * Frost burst of the frost bomb (FROST_BURST_LOOK): a white-cyan flash, a
 * ring of cold running out over the radius, rime on the ground that holds
 * while the enemies stay frozen, ice shards thrown out and falling, and a
 * low mist rolling out.
 *
 * Every particle is a function of the burst's age and five random numbers
 * drawn at the impact, recomputed each frame. The age runs on game time: a
 * pause holds the burst, the timescale plays it faster, and one long frame
 * or many short ones end in the same picture.
 *
 * Shards are round additive particles, the mist puffs the smoke atlas in
 * the normal blend, both with the trail pools' materials (log depth) in
 * buffers of their own. Ring and flash are built-in materials with the
 * depth test off, like the strike marker: readable between buildings. The
 * rime is one too, but depth tested in the normal blend: the enemies frozen
 * in it and the roofs over it cover it, and it never lights the street above
 * its own colour. Until playtest 625 it was additive over everything and
 * washed out the frozen enemies and the roofs inside the radius.
 * Fixed buffers, nothing allocated per frame.
 */
export class FrostBurstRenderer {
  private readonly bursts: Burst[] = [];
  private activeCount = 0;
  private sequence = 0;
  /** Shards and mist (VFX settings: impact effects) */
  private full = true;

  private readonly seeds = new Float32Array(LOOK.bursts * (SHARDS + MIST) * SEEDS);
  private readonly shards: ParticleBuffer;
  private readonly mist: ParticleBuffer;

  private readonly ringTexture: DataTexture;
  private readonly rimeTexture: DataTexture;
  private readonly flashTexture: DataTexture;
  private readonly plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly rings: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly rimes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly ringGates: DrawGate[] = [];
  private readonly rimeGates: DrawGate[] = [];
  private readonly flashGates: DrawGate[] = [];

  private sizePerMetre = 0;

  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
  ) {
    for (let i = 0; i < LOOK.bursts; i++) {
      this.bursts.push({
        active: false, t: 0, x: 0, y: 0, z: 0, scale: 1, radiusM: 0, holdS: 0, end: 0, full: true, born: 0,
      });
    }
    this.shards = particleBuffer(scene, LOOK.bursts * SHARDS, materials.additive, SHARD_ORDER);
    this.mist = particleBuffer(scene, LOOK.bursts * MIST, materials.normal, MIST_ORDER);

    // A thin bright front with a faint fill behind it
    this.ringTexture = radialTexture(256, (r) =>
      Math.exp(-(((r - 0.9) / 0.05) ** 2)) + (r < 0.9 ? 0.12 * MathUtils.smoothstep(r, 0.3, 0.9) : 0));
    this.rimeTexture = rimeTexture(256);
    this.flashTexture = radialTexture(64, (r) => (1 - r) ** 2);

    const { colors, flash } = LOOK;
    for (let i = 0; i < LOOK.bursts; i++) {
      const ring = unpickable(new Mesh(this.plane, groundMaterial(this.ringTexture, colors.ring, true)));
      ring.frustumCulled = false;
      ring.renderOrder = RING_ORDER;
      scene.add(ring);
      this.rings.push(ring);
      this.ringGates.push(new DrawGate([ring]));

      const rime = unpickable(new Mesh(this.plane, groundMaterial(this.rimeTexture, colors.rime, false)));
      rime.frustumCulled = false;
      rime.renderOrder = RIME_ORDER;
      scene.add(rime);
      this.rimes.push(rime);
      this.rimeGates.push(new DrawGate([rime]));

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

  /** Bursts still showing something. */
  get activeBursts(): number {
    return this.activeCount;
  }

  /** Shards and mist too, or flash, ring and rime only (VFX settings: impact effects). Takes hold with the next burst. */
  setFull(full: boolean): void {
    this.full = full;
  }

  /**
   * A frost bomb burst on `ground` (local coordinates, on the ground) with
   * `radiusM`; the rime holds `holdS` game seconds, as long as the freeze.
   */
  burst(ground: Vector3, radiusM: number, holdS: number): void {
    let slot = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      if (!this.bursts[i].active) {
        slot = i;
        break;
      }
      if (this.bursts[i].born < this.bursts[slot].born) slot = i;
    }
    const burst = this.bursts[slot];
    if (!burst.active) this.activeCount++;

    burst.active = true;
    burst.t = 0;
    burst.x = ground.x;
    burst.y = ground.y;
    burst.z = ground.z;
    burst.radiusM = radiusM;
    burst.scale = radiusM / LOOK.referenceRadius;
    burst.holdS = holdS;
    burst.full = this.full;
    burst.born = ++this.sequence;
    burst.end = Math.max(
      LOOK.ring.duration,
      LOOK.flash.duration,
      holdS + LOOK.rime.fade,
      burst.full ? LOOK.shards.life[1] : 0,
      burst.full ? LOOK.mist.start + 0.15 + LOOK.mist.life[1] : 0,
    );

    const start = slot * (SHARDS + MIST) * SEEDS;
    for (let i = start; i < start + (SHARDS + MIST) * SEEDS; i++) this.seeds[i] = Math.random();
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
    for (const burst of this.bursts) {
      if (!burst.active) continue;
      burst.t += dt;
      if (burst.t >= burst.end) {
        burst.active = false;
        this.activeCount--;
      }
    }
    this.sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);

    let shardCount = 0;
    let mistCount = 0;
    for (let slot = 0; slot < this.bursts.length; slot++) {
      const burst = this.bursts[slot];
      if (!burst.active) {
        this.ringGates[slot].setCount(0);
        this.rimeGates[slot].setCount(0);
        this.flashGates[slot].setCount(0);
        continue;
      }
      if (burst.full) {
        shardCount = this.writeShards(burst, slot, shardCount);
        mistCount = this.writeMist(burst, slot, mistCount);
      }
      this.updateRing(burst, slot);
      this.updateRime(burst, slot);
      this.updateFlash(burst, slot);
    }
    commitParticles(this.shards, shardCount);
    commitParticles(this.mist, mistCount);
  }

  /** Drop every burst (restart). */
  clear(): void {
    for (const burst of this.bursts) burst.active = false;
    this.activeCount = 0;
    commitParticles(this.shards, 0);
    commitParticles(this.mist, 0);
    for (const gate of [...this.ringGates, ...this.rimeGates, ...this.flashGates]) gate.setCount(0);
  }

  /** Remove and free everything but the particle materials, which belong to the trail pools. */
  dispose(): void {
    this.clear();
    for (const buffer of [this.shards, this.mist]) {
      this.scene.remove(buffer.points);
      buffer.points.geometry.dispose();
    }
    for (const mesh of [...this.rings, ...this.rimes]) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    for (const sprite of this.flashes) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.plane.dispose();
    this.ringTexture.dispose();
    this.rimeTexture.dispose();
    this.flashTexture.dispose();
  }

  /**
   * Shards: thrown out and up from just above the ground point, slowed by
   * air drag (time constant `drag`) and pulled down by gravity; they come to
   * rest on the ground and fade out over their life.
   */
  private writeShards(burst: Burst, slot: number, n: number): number {
    const { speed, lift, drag, gravity, life, size } = LOOK.shards;
    const { shard, shardDeep } = LOOK.colors;
    const position = this.shards.position.array as Float32Array;
    const rgb = this.shards.color.array as Float32Array;
    const sizes = this.shards.size.array as Float32Array;
    const frames = this.shards.frame.array as Float32Array;
    const base = slot * (SHARDS + MIST) * SEEDS;
    const k = drag;
    const decay = 1 - Math.exp(-burst.t / k);

    for (let i = 0; i < SHARDS; i++) {
      const s = base + i * SEEDS;
      const lifeS = MathUtils.lerp(life[0], life[1], this.seeds[s + 3]);
      if (burst.t >= lifeS) continue;
      const fade = 1 - burst.t / lifeS;
      const light = fade ** 1.5 * 1.4;
      if (light < MIN_LIGHT) continue;

      const angle = this.seeds[s] * TAU;
      const v = MathUtils.lerp(speed[0], speed[1], this.seeds[s + 1]) * burst.scale;
      const vy = MathUtils.lerp(lift[0], lift[1], this.seeds[s + 2]);
      const distance = 1.5 * this.seeds[s + 4] + v * k * decay;
      const height = Math.max(0.2, 1.2 + (vy + gravity * k) * k * decay - gravity * k * burst.t);

      position[n * 3] = burst.x + Math.cos(angle) * distance;
      position[n * 3 + 1] = burst.y + height;
      position[n * 3 + 2] = burst.z + Math.sin(angle) * distance;
      const white = this.seeds[s + 4];
      rgb[n * 3] = MathUtils.lerp(shardDeep.r, shard.r, white) * light;
      rgb[n * 3 + 1] = MathUtils.lerp(shardDeep.g, shard.g, white) * light;
      rgb[n * 3 + 2] = MathUtils.lerp(shardDeep.b, shard.b, white) * light;
      const diameter = MathUtils.lerp(size[0], size[1], this.seeds[s + 2]) * (0.6 + 0.4 * fade);
      sizes[n] = diameter * this.sizePerMetre;
      frames[n] = -1; // round particle
      n++;
    }
    return n;
  }

  /**
   * Mist: puffs of the smoke atlas in a ring over the radius, rolling out
   * and rising a little; the atlas frames widen and fade them out.
   */
  private writeMist(burst: Burst, slot: number, n: number): number {
    const { start, radius, rise, spread, life, size } = LOOK.mist;
    const color = LOOK.colors.mist;
    const position = this.mist.position.array as Float32Array;
    const rgb = this.mist.color.array as Float32Array;
    const sizes = this.mist.size.array as Float32Array;
    const frames = this.mist.frame.array as Float32Array;
    const base = slot * (SHARDS + MIST) * SEEDS + SHARDS * SEEDS;

    for (let i = 0; i < MIST; i++) {
      const s = base + i * SEEDS;
      const age = burst.t - start - 0.15 * this.seeds[s + 3];
      const lifeS = MathUtils.lerp(life[0], life[1], this.seeds[s + 2]);
      if (age <= 0 || age >= lifeS) continue;
      const progress = age / lifeS;

      const angle = (i / MIST + 0.3 * this.seeds[s]) * TAU;
      const out = MathUtils.lerp(radius[0], radius[1], this.seeds[s + 1]) * burst.radiusM;
      const distance = out * (0.7 + 0.3 * reach(age, lifeS, 0.5)) + spread * age;
      position[n * 3] = burst.x + Math.cos(angle) * distance;
      position[n * 3 + 1] = burst.y + 0.8 + rise * age * (0.5 + this.seeds[s + 4]);
      position[n * 3 + 2] = burst.z + Math.sin(angle) * distance;
      rgb[n * 3] = color.r;
      rgb[n * 3 + 1] = color.g;
      rgb[n * 3 + 2] = color.b;
      const diameter = MathUtils.lerp(size[0], size[1], this.seeds[s + 4]) * burst.scale * (0.8 + 0.5 * progress);
      sizes[n] = diameter * this.sizePerMetre;
      // Frame 2 at the start (thick), the last drawn frame at the end (faint)
      frames[n] = Math.min(SMOKE_LAST_FRAME, Math.round(2 + (SMOKE_LAST_FRAME - 2) * progress));
      n++;
    }
    return n;
  }

  private updateRing(burst: Burst, slot: number): void {
    const { ring } = LOOK;
    const gate = this.ringGates[slot];
    if (burst.t >= ring.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, burst.radiusM * ring.radius * reach(burst.t, ring.duration, ring.timeConstant));
    const mesh = this.rings[slot];
    mesh.position.set(burst.x, burst.y + RING_LIFT, burst.z);
    mesh.scale.set(radius, 1, radius);
    mesh.material.opacity = ring.opacity * (1 - burst.t / ring.duration) ** 1.3;
    gate.setCount(1);
  }

  /** Rime over the frozen area: up in `rise`, held for the freeze, faded out over `fade`. */
  private updateRime(burst: Burst, slot: number): void {
    const { rime } = LOOK;
    const gate = this.rimeGates[slot];
    const t = burst.t;
    const fadeEnd = burst.holdS + rime.fade;
    if (t >= fadeEnd) {
      gate.setCount(0);
      return;
    }
    const up = Math.min(1, t / rime.rise);
    const down = t <= burst.holdS ? 1 : 1 - (t - burst.holdS) / rime.fade;
    const mesh = this.rimes[slot];
    mesh.position.set(burst.x, burst.y + RIME_LIFT, burst.z);
    mesh.scale.set(burst.radiusM, 1, burst.radiusM);
    mesh.material.opacity = rime.opacity * up * down;
    gate.setCount(1);
  }

  private updateFlash(burst: Burst, slot: number): void {
    const { flash } = LOOK;
    const gate = this.flashGates[slot];
    if (burst.t >= flash.duration) {
      gate.setCount(0);
      return;
    }
    const fade = 1 - burst.t / flash.duration;
    const size = flash.size * burst.scale * (0.5 + 0.5 * MathUtils.smoothstep(burst.t, 0, 0.06));
    const sprite = this.flashes[slot];
    sprite.position.set(burst.x, burst.y + flash.height * burst.scale, burst.z);
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = fade * fade;
    gate.setCount(1);
  }
}
