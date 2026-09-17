import { MathUtils, Quaternion, Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { MISSILE_LAUNCH_LOOK as LOOK } from '../../configs/visual-effects.config';
import { MissileFlight } from '../../utils/missile-flight';
import { DrawGate } from './draw-gate';
import { unpickable } from './effect-buffers';
import { MissileExhaust } from './missile-exhaust';
import type { Launch } from './missile-launch-state';
import type { MissileStart } from './missile-silo';
import { MissileSmoke } from './missile-smoke';
import { TAU } from './mushroom-cloud-shape';
import type { CloudSpriteMaterials } from './mushroom-cloud-sprites';

const UP = new Vector3(0, 1, 0);

/**
 * The missile model a launch clones: the silo model's missile node (origin
 * on its nozzle, nose up +y), or null while it is not loaded.
 */
export type MissileModelSource = () => Object3D | null;

/** Game seconds after the command when the last smoke of a launch of `durationS` is gone */
function smokeEnd(durationS: number): number {
  return Math.max(durationS + LOOK.trail.life[1], LOOK.cloud.emit[1] + LOOK.cloud.life[1]);
}

/** The missile of a launch slot: a clone of the model it was made from */
interface Body {
  readonly model: Object3D;
  readonly object: Object3D;
  readonly gate: DrawGate;
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
 * The missile is the silo model's own (MissileModelSource), cloned per
 * launch slot and kept for the next launch from the same model. It starts
 * as it stood in the silo (MissileStart: pose, turn, size) and turns along
 * its way from there. Without a model at the launch no missile is drawn;
 * flame, fire and smoke run all the same. The clones share geometry and
 * materials with the model, which the asset cache owns.
 *
 * The smoke shares the mushroom clouds' sprite materials and atlas: the
 * Low preset's unlit smoke takes it too.
 *
 * Fixed buffers, nothing allocated per frame.
 */
export class MissileLaunchRenderer {
  private readonly launches: Launch[] = [];
  private activeCount = 0;
  private sequence = 0;
  private full = true;

  private readonly bodies: (Body | null)[] = [];
  private readonly exhaust: MissileExhaust;
  private readonly smoke: MissileSmoke;
  private readonly bend = new Quaternion();

  constructor(
    private readonly scene: Scene,
    materials: CloudSpriteMaterials,
    private readonly missileModel: MissileModelSource,
  ) {
    for (let i = 0; i < LOOK.launches; i++) {
      this.launches.push({
        active: false, strikeId: -1, t: 0, landed: false, end: 0, flight: new MissileFlight(), site: new Vector3(),
        shaftTop: LOOK.shaftTop, turn: new Quaternion(), baseScale: 1, targetY: 0, full: true, windX: 1, windZ: 0,
        born: 0, position: new Vector3(), direction: new Vector3(0, 1, 0), scale: 1, thrust: 0, speed: 0,
      });
      this.bodies.push(null);
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
   * Strike `strikeId`'s missile lifts off where `start` has it standing in
   * its silo and lands on `target` (local) `durationS` game seconds later.
   * Another launch takes the place of the oldest when all are in use.
   */
  launch(strikeId: number, start: MissileStart, target: Vector3, durationS: number): void {
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
    launch.site.copy(start.site);
    launch.shaftTop = start.shaftTop;
    launch.turn.copy(start.turn);
    launch.baseScale = start.scale;
    launch.targetY = target.y;
    launch.full = this.full;
    launch.windX = Math.cos(wind);
    launch.windZ = Math.sin(wind);
    launch.born = ++this.sequence;
    launch.flight.plan(start.nozzle, target, durationS);
    launch.end = smokeEnd(launch.flight.duration);

    this.takeBody(slot);
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
        this.bodies[slot]?.gate.setCount(0);
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
    for (const body of this.bodies) body?.gate.setCount(0);
    this.exhaust.clear();
    this.smoke.clear();
  }

  /** Remove all of it and free what is its own: not the sprite materials (the mushroom clouds') nor the model (the asset cache's). */
  dispose(): void {
    this.clear();
    for (const body of this.bodies) if (body) this.scene.remove(body.object);
    this.bodies.fill(null);
    this.exhaust.dispose(this.scene);
    this.smoke.dispose(this.scene);
  }

  /**
   * The missile of launch `slot`: a clone of the model, the one from the
   * last launch if it was made from the same model; none without a model.
   */
  private takeBody(slot: number): void {
    const model = this.missileModel();
    const body = this.bodies[slot];
    if (body && body.model === model) return;
    if (body) {
      body.gate.setCount(0);
      this.scene.remove(body.object);
    }
    if (!model) {
      this.bodies[slot] = null;
      return;
    }
    const object = model.clone();
    object.name = `missile-body-${slot}`;
    object.traverse((node) => {
      unpickable(node);
      node.frustumCulled = false;
    });
    this.scene.add(object);
    this.bodies[slot] = { model, object, gate: new DrawGate([object]) };
  }

  /**
   * Where the missile is at its launch's age, its growth and thrust; the
   * body there, turned from its stand in the silo along its way, or gone
   * once landed.
   */
  private pose(launch: Launch, slot: number): void {
    const { flight, t } = launch;
    const { missile, flame } = LOOK;
    const body = this.bodies[slot];
    launch.scale = MathUtils.lerp(1, missile.flightScale, MathUtils.smoothstep(t, missile.grow[0], missile.grow[1]));
    if (launch.landed) {
      launch.thrust = 0;
      launch.speed = 0;
      flight.at(1, launch.position, launch.direction);
      body?.gate.setCount(0);
      return;
    }
    flight.at(t / flight.duration, launch.position, launch.direction);
    launch.thrust = MathUtils.smoothstep(t, 0, flame.ignite);
    launch.speed = flight.speedAt(t);
    if (!body) return;
    const object = body.object;
    object.position.copy(launch.position);
    // Upright in the silo it stands as the model stood there; the flight bends that along its way
    object.quaternion.multiplyQuaternions(this.bend.setFromUnitVectors(UP, launch.direction), launch.turn);
    object.scale.setScalar(launch.baseScale * launch.scale);
    body.gate.setCount(1);
  }
}
