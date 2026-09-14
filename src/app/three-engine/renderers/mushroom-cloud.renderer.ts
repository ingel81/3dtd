import { MathUtils, type PerspectiveCamera, type Scene, type Vector3 } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';
import { CloudBlast } from './mushroom-cloud-blast';
import { CloudFireballs } from './mushroom-cloud-fireball';
import { CloudGlow } from './mushroom-cloud-glow';
import { TAU, type Cloud } from './mushroom-cloud-shape';
import { CloudSmoke } from './mushroom-cloud-smoke';
import { createCloudSpriteMaterials, type CloudSpriteMaterials } from './mushroom-cloud-sprites';

/**
 * The screen part of the flash `t` game seconds after the impact:
 * screenPeak for screenHold, then fading out quadratically until
 * screenDuration (LOOK.flash).
 */
export function screenFlashAt(t: number): number {
  const { screenPeak, screenHold, screenDuration } = LOOK.flash;
  if (t >= screenDuration) return 0;
  if (t <= screenHold) return screenPeak;
  const fade = 1 - (t - screenHold) / (screenDuration - screenHold);
  return screenPeak * fade * fade;
}

/**
 * Mushroom cloud of the nuclear strike (MUSHROOM_CLOUD_LOOK).
 *
 * Every sprite is a function of the cloud's age and four random numbers
 * drawn at the impact, recomputed each frame: the age runs on game time,
 * so a pause holds the cloud and the timescale plays it faster, one long
 * frame or many short ones end in the same picture.
 *
 * Smoke and glow are camera-facing quads, one instance per sprite
 * (mushroom-cloud-sprites.ts), sized in metres: unlike point sprites they
 * are not clamped to the GPU's largest point size close up and do not
 * vanish once their centre leaves the screen. They fade out as the camera
 * comes into them and towards the ground under the cloud. The smoke is lit
 * per pixel, a normal-mapped billow atlas under the sun from above and the
 * fire from below, and sorted back to front, split at the fireball: the
 * puffs behind it draw before it, the others after it and after the glow.
 * The fireball is a mesh with a boiling surface (mushroom-cloud-fireball.ts).
 * Flash sprite, ground glow and shockwave ring have depth test off, like
 * the strike marker; they are built-in materials with logarithmic depth,
 * and every ShaderMaterial here includes the logdepthbuf chunks.
 *
 * The fireball (CloudFireballs), glow (CloudGlow), smoke (CloudSmoke) and
 * ground glow, ring, dome and flashes (CloudBlast) live in files of their
 * own; this class keeps the clouds, ages them and hands each to them in
 * turn.
 *
 * Fixed buffers, nothing allocated per frame.
 */
export class MushroomCloudRenderer {
  private readonly clouds: Cloud[] = [];
  private activeCount = 0;
  private sequence = 0;
  /** See bloomKick */
  private kick = 0;
  /** All sprites, lit smoke and the fireball's fine surface (VFX settings: impact effects) */
  private full = true;

  private readonly materials: CloudSpriteMaterials;
  private readonly blast: CloudBlast;
  private readonly smoke: CloudSmoke;
  private readonly fireballs: CloudFireballs;
  private readonly glow: CloudGlow;

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < LOOK.clouds; i++) {
      this.clouds.push({ active: false, t: 0, x: 0, y: 0, z: 0, scale: 1, full: true, windX: 1, windZ: 0, born: 0 });
    }
    this.materials = createCloudSpriteMaterials();
    this.blast = new CloudBlast(scene);
    this.smoke = new CloudSmoke(scene, this.materials.smoke);
    this.fireballs = new CloudFireballs(scene);
    this.glow = new CloudGlow(scene, this.materials.glow);
  }

  /** Clouds on the way up or fading out. */
  get activeClouds(): number {
    return this.activeCount;
  }

  /**
   * How far the bloom kick of the newest flash is up, 0 to 1: 1 at the
   * impact, falling off quadratically over LOOK.bloomKick.duration of game
   * time (for PostProcessingPipeline.setBloomKick).
   */
  get bloomKick(): number {
    return this.kick;
  }

  /**
   * The whole cloud, or with impact effects off (Low preset) the same
   * silhouette from fewer, larger sprites, no embers, unlit smoke and a
   * coarser fireball surface. The counts take hold with the next strike,
   * the smoke's shading at once.
   */
  setFullCloud(full: boolean): void {
    this.full = full;
    this.materials.smoke.uniforms['uLit'].value = full ? 1 : 0;
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

    this.glow.seed(slot);
    this.smoke.seed(slot);
    this.fireballs.seed(slot);
  }

  /**
   * Once per rendered frame.
   * @param gameDeltaMs - the frame in game time: 0 while paused, the frame times the timescale otherwise
   * @param camera - sorts the smoke and splits it at the fireball
   */
  update(gameDeltaMs: number, camera: PerspectiveCamera): void {
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

    this.smoke.beginFrame(camera.position);
    let glowCount = 0;
    let screen = 0;
    let warmth = 0;
    let kick = 0;
    // Squared distance from the camera to the nearest fireball, -1 without one
    let split = -1;
    for (let slot = 0; slot < this.clouds.length; slot++) {
      const cloud = this.clouds[slot];
      if (!cloud.active) {
        this.smoke.hide(slot);
        this.fireballs.hide(slot);
        this.blast.hide(slot);
        continue;
      }
      glowCount = this.glow.write(cloud, slot, glowCount);
      this.smoke.stageCloud(cloud, slot);
      if (this.fireballs.update(cloud, slot)) {
        const d = this.fireballs.centre(slot).distanceToSquared(camera.position);
        split = split < 0 ? d : Math.min(split, d);
      }
      this.blast.update(cloud, slot);
      const flash = screenFlashAt(cloud.t);
      if (flash > screen) {
        screen = flash;
        warmth = MathUtils.smoothstep(cloud.t, 0, LOOK.flash.screenDuration);
      }
      if (cloud.t < LOOK.bloomKick.duration) {
        const fade = 1 - cloud.t / LOOK.bloomKick.duration;
        kick = Math.max(kick, fade * fade);
      }
    }
    this.kick = kick;
    this.glow.commit(glowCount);
    this.smoke.writeSorted(split);
    this.blast.setScreen(screen, warmth);
  }

  /** Drop every cloud (restart). */
  clear(): void {
    for (const cloud of this.clouds) cloud.active = false;
    this.activeCount = 0;
    this.kick = 0;
    this.glow.commit(0);
    this.smoke.clear();
    this.fireballs.clear();
    this.blast.clear();
  }

  /** Remove and free all of it. */
  dispose(): void {
    this.clear();
    this.glow.dispose(this.scene);
    this.smoke.dispose(this.scene);
    this.fireballs.dispose(this.scene);
    this.blast.dispose(this.scene);
    this.materials.smoke.dispose();
    this.materials.glow.dispose();
    this.materials.atlas.dispose();
  }
}
