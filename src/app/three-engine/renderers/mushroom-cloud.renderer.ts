import { MathUtils, type PerspectiveCamera, type Scene, type Vector3 } from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';
import { PARTICLE_POINT_SCALE, type ParticleShaderMaterials } from './particle-shaders';
import { CloudBlast } from './mushroom-cloud-blast';
import { CloudGlow } from './mushroom-cloud-glow';
import { TAU, type Cloud } from './mushroom-cloud-shape';
import { CloudSmoke } from './mushroom-cloud-smoke';

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
 * The glow (CloudGlow), the smoke (CloudSmoke) and the ring, dome and
 * flashes (CloudBlast) live in files of their own; this class keeps the
 * clouds, ages them and hands each to the three in turn.
 *
 * Fixed buffers, nothing allocated per frame.
 */
export class MushroomCloudRenderer {
  private readonly clouds: Cloud[] = [];
  private activeCount = 0;
  private sequence = 0;
  /** See bloomKick */
  private kick = 0;
  /** Smoke, embers, ground fire, stem fire and rim glow (VFX settings: impact effects) */
  private full = true;

  private readonly glow: CloudGlow;
  private readonly smoke: CloudSmoke;
  private readonly blast: CloudBlast;

  constructor(
    private readonly scene: Scene,
    materials: ParticleShaderMaterials,
  ) {
    for (let i = 0; i < LOOK.clouds; i++) {
      this.clouds.push({ active: false, t: 0, x: 0, y: 0, z: 0, scale: 1, full: true, windX: 1, windZ: 0, born: 0 });
    }
    this.glow = new CloudGlow(scene, materials.additive);
    this.smoke = new CloudSmoke(scene, materials.normal);
    this.blast = new CloudBlast(scene);
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

    this.glow.seed(slot);
    this.smoke.seed(slot);
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

    const sizePerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * PARTICLE_POINT_SCALE);
    this.glow.sizePerMetre = sizePerMetre;
    this.smoke.beginFrame(sizePerMetre, camera.position);

    let glowCount = 0;
    let screen = 0;
    let kick = 0;
    for (let slot = 0; slot < this.clouds.length; slot++) {
      const cloud = this.clouds[slot];
      if (!cloud.active) {
        this.smoke.hide(slot);
        this.blast.hide(slot);
        continue;
      }
      glowCount = this.glow.write(cloud, slot, glowCount);
      if (cloud.full) {
        this.smoke.stageCloud(cloud, slot);
      } else {
        this.smoke.hide(slot);
      }
      this.blast.update(cloud, slot);
      const { screenPeak, screenDuration } = LOOK.flash;
      if (cloud.t < screenDuration) {
        const fade = 1 - cloud.t / screenDuration;
        screen = Math.max(screen, screenPeak * fade * fade);
      }
      if (cloud.t < LOOK.bloomKick.duration) {
        const fade = 1 - cloud.t / LOOK.bloomKick.duration;
        kick = Math.max(kick, fade * fade);
      }
    }
    this.kick = kick;
    this.glow.commit(glowCount);
    this.smoke.commit(this.smoke.writeSorted());
    this.blast.setScreen(screen);
  }

  /** Drop every cloud (restart). */
  clear(): void {
    for (const cloud of this.clouds) cloud.active = false;
    this.activeCount = 0;
    this.kick = 0;
    this.smoke.clear();
    this.glow.commit(0);
    this.smoke.commit(0);
    this.blast.clear();
  }

  /** Remove and free everything but the particle materials, which belong to the trail pools. */
  dispose(): void {
    this.clear();
    this.glow.dispose(this.scene);
    this.smoke.dispose(this.scene);
    this.blast.dispose(this.scene);
  }
}
