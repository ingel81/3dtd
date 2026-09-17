import { MathUtils, Vector3, type BufferGeometry, type Mesh, type MeshStandardMaterial, type PerspectiveCamera, type Scene } from 'three';
import { MISSILE_LAUNCH_LOOK as LOOK } from '../../configs/visual-effects.config';
import { MissileFlight, planMissileLaunch } from '../../utils/missile-flight';
import { DrawGate } from './draw-gate';
import { unpickable } from './effect-buffers';
import { MissileExhaust } from './missile-exhaust';
import type { Launch } from './missile-launch-state';
import { createMissileModel } from './missile-model';
import { MissileSmoke } from './missile-smoke';
import { TAU } from './mushroom-cloud-shape';
import type { CloudSpriteMaterials } from './mushroom-cloud-sprites';

const UP = new Vector3(0, 1, 0);

/** Game seconds after the command when the last smoke of a launch of `durationS` is gone */
function smokeEnd(durationS: number): number {
  return Math.max(durationS + LOOK.trail.life[1], LOOK.cloud.emit[1] + LOOK.cloud.life[1]);
}

/**
 * The nuclear strike's missile from its silo to the target
 * (MISSILE_LAUNCH_LOOK): the missile on its flight (MissileFlight), its
 * flame, glow and fire (MissileExhaust), and the launch cloud and the trail
 * of smoke it leaves (MissileSmoke), which stand on after the impact.
 *
 * It runs in game time: the launch's age is the sum of the frames' game
 * time, the missile stands where the flight is at that age, every sprite is
 * a function of it and of random numbers drawn at the launch. A pause holds
 * all of it, the timescale plays it faster, one long frame or many short
 * ones end in the same picture. The impact lands the missile (land()): it
 * goes, and so the flight never runs past the impact, and a frame that got
 * ahead of the simulation shows it gone on the target.
 *
 * The smoke shares the mushroom clouds' sprite materials and atlas: the
 * Low preset's unlit smoke takes it too. The missile is a mesh of its own,
 * cloned per launch from one model (createMissileModel); another model with
 * the same convention can take its place.
 *
 * Fixed buffers, nothing allocated per frame.
 */
export class MissileLaunchRenderer {
  private readonly launches: Launch[] = [];
  private activeCount = 0;
  private sequence = 0;
  private full = true;

  private readonly model: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly bodies: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  private readonly bodyGates: DrawGate[] = [];
  private readonly exhaust: MissileExhaust;
  private readonly smoke: MissileSmoke;

  constructor(
    private readonly scene: Scene,
    materials: CloudSpriteMaterials,
  ) {
    this.model = createMissileModel();
    for (let i = 0; i < LOOK.launches; i++) {
      this.launches.push({
        active: false, strikeId: -1, t: 0, landed: false, end: 0, flight: new MissileFlight(), site: new Vector3(),
        targetY: 0, full: true, windX: 1, windZ: 0, born: 0, position: new Vector3(), direction: new Vector3(0, 1, 0),
        scale: 1, thrust: 0, speed: 0,
      });
      const body = unpickable(this.model.clone());
      body.name = `missile-body-${i}`;
      body.frustumCulled = false;
      scene.add(body);
      this.bodies.push(body);
      this.bodyGates.push(new DrawGate([body]));
    }
    this.exhaust = new MissileExhaust(scene, materials.glow);
    this.smoke = new MissileSmoke(scene, materials.smoke);
  }

  /** Launches with a missile in the air or smoke still standing. */
  get activeLaunches(): number {
    return this.activeCount;
  }

  /** Fire, plume and ground light too, and all the smoke (VFX settings: impact effects). Takes hold with the next launch. */
  setFull(full: boolean): void {
    this.full = full;
  }

  /**
   * Strike `strikeId`'s missile lifts off the silo whose base is `site` and
   * lands on `target` (local) `durationS` game seconds later. Another launch
   * takes the place of the oldest when all are in use.
   */
  launch(strikeId: number, site: Vector3, target: Vector3, durationS: number): void {
    let slot = 0;
    for (let i = 0; i < this.launches.length; i++) {
      if (!this.launches[i].active) {
        slot = i;
        break;
      }
      if (this.launches[i].born < this.launches[slot].born) slot = i;
    }
    const launch = this.launches[slot];
    if (!launch.active) this.activeCount++;

    const wind = Math.random() * TAU;
    launch.active = true;
    launch.strikeId = strikeId;
    launch.t = 0;
    launch.landed = false;
    launch.site.copy(site);
    launch.targetY = target.y;
    launch.full = this.full;
    launch.windX = Math.cos(wind);
    launch.windZ = Math.sin(wind);
    launch.born = ++this.sequence;
    planMissileLaunch(launch.flight, site, target, durationS);
    launch.end = smokeEnd(launch.flight.duration);

    this.exhaust.seed(slot);
    this.smoke.seed(launch, slot);
  }

  /** Strike `strikeId` landed: its missile is gone, its smoke stands on. */
  land(strikeId: number): void {
    for (const launch of this.launches) {
      if (!launch.active || launch.landed || launch.strikeId !== strikeId) continue;
      launch.landed = true;
      launch.t = Math.max(launch.t, launch.flight.duration);
    }
  }

  /**
   * Once per rendered frame.
   * @param gameDeltaMs - the frame in game time: 0 while paused, the frame times the timescale otherwise
   * @param camera - sorts the smoke
   */
  update(gameDeltaMs: number, camera: PerspectiveCamera): void {
    if (this.activeCount === 0) return;

    const dt = gameDeltaMs / 1000;
    this.smoke.beginFrame(camera.position);
    let glowCount = 0;
    for (let slot = 0; slot < this.launches.length; slot++) {
      const launch = this.launches[slot];
      if (launch.active) {
        launch.t += dt;
        if (launch.t >= launch.flight.duration) launch.landed = true;
        if (launch.t >= launch.end) {
          launch.active = false;
          this.activeCount--;
        }
      }
      if (!launch.active) {
        this.bodyGates[slot].setCount(0);
        this.exhaust.hide(slot);
        this.smoke.hide(slot);
        continue;
      }
      this.pose(launch, slot);
      glowCount = this.exhaust.update(launch, slot, glowCount);
      this.smoke.stageLaunch(launch, slot);
    }
    this.exhaust.commit(glowCount);
    this.smoke.writeSorted();
  }

  /** Drop every launch (restart). */
  clear(): void {
    for (const launch of this.launches) launch.active = false;
    this.activeCount = 0;
    for (const gate of this.bodyGates) gate.setCount(0);
    this.exhaust.clear();
    this.smoke.clear();
  }

  /** Remove and free all of it but the sprite materials, which belong to the mushroom clouds. */
  dispose(): void {
    this.clear();
    for (const body of this.bodies) this.scene.remove(body);
    this.model.geometry.dispose();
    this.model.material.dispose();
    this.exhaust.dispose(this.scene);
    this.smoke.dispose(this.scene);
  }

  /** Where the missile is at its launch's age, its size and thrust; the body there, or gone once landed. */
  private pose(launch: Launch, slot: number): void {
    const { flight, t } = launch;
    const { missile, flame } = LOOK;
    const gate = this.bodyGates[slot];
    launch.scale = MathUtils.lerp(1, missile.flightScale, MathUtils.smoothstep(t, missile.grow[0], missile.grow[1]));
    if (launch.landed) {
      launch.thrust = 0;
      launch.speed = 0;
      flight.at(1, launch.position, launch.direction);
      gate.setCount(0);
      return;
    }
    flight.at(t / flight.duration, launch.position, launch.direction);
    launch.thrust = MathUtils.smoothstep(t, 0, flame.ignite);
    launch.speed = flight.speedAt(t);
    const body = this.bodies[slot];
    body.position.copy(launch.position);
    body.quaternion.setFromUnitVectors(UP, launch.direction);
    body.scale.setScalar(launch.scale);
    gate.setCount(1);
  }
}
