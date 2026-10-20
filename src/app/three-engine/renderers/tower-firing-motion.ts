import { Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { FiringReload, TowerTypeConfig } from '../../configs/tower-types.config';
import type { TowerAim } from '../../entities/tower-aim';
import type { TurretPitch } from './tower-turret-aim';

/**
 * How a tower's model moves when it fires (TowerTypeConfig.firingMotion), drawn only: the simulation never reads
 * it. The shot's muzzle flash event starts it (ThreeTowerRenderer.fire), it runs in game time and is drawn after
 * the aim (drawTurretAim) every frame while it moves. Nothing is allocated per frame or per shot.
 */

/** Share of a shot's interval a kick or a reload may take, so the next shot finds the model at rest */
const FIT_KICK = 0.85;
const FIT_RELOAD = 0.9;
/** Shortest return of a kick, s, however fast the tower fires */
const MIN_RETURN_S = 0.05;

/**
 * Where a kick stands `t` s after the shot, a share of its peak: up in `kickS` (cubic ease out: the blast throws
 * the barrel back at once, the brake catches it), then home over `returnS` on a damped spring that starts from
 * rest at the peak and runs a few per cent past home before it settles, faded to exactly 0 at `returnS`.
 */
export function kickCurve(t: number, kickS: number, returnS: number): number {
  if (t <= 0) return 0;
  if (t < kickS) {
    const u = 1 - t / kickS;
    return 1 - u * u * u;
  }
  const u = (t - kickS) / returnS;
  if (u >= 1) return 0;
  const spring = Math.exp(-SPRING_DAMP * u) * (Math.cos(SPRING_FREQ * u) + (SPRING_DAMP / SPRING_FREQ) * Math.sin(SPRING_FREQ * u));
  const u2 = u * u;
  return spring * (1 - u2 * u2);
}
/** The return spring: decay and angular frequency per return time; past home at u 0.58, about 3 % at u 0.77 */
const SPRING_DAMP = 4;
const SPRING_FREQ = 4.1;

/**
 * The phases of a reload, shares of its time T, and the release's own clock in seconds: the string snaps slack in
 * SNAP_S and shivers out over SHIVER_S; it hangs slack until DRAW_FROM, is drawn by DRAW_TO, the next shot comes in
 * from LOAD_FROM to LOAD_TO.
 */
const SNAP_S = 0.035;
const SHIVER_S = 0.08;
const SHIVER_PERIOD_S = 0.055;
const SHIVER_AMPLITUDE = 0.14;
export const RELOAD_PHASES = { drawFrom: 0.16, drawTo: 0.7, loadFrom: 0.74, loadTo: 0.9 } as const;

/** How slack the drawn part hangs `t` s into a reload of `T` s: 1 released (and a little past as it shivers), 0 drawn */
export function releaseCurve(t: number, T: number): number {
  if (t < 0) return 0;
  if (t < SNAP_S) {
    const u = 1 - t / SNAP_S;
    return 1 - u * u;
  }
  const drawFrom = RELOAD_PHASES.drawFrom * T;
  const drawTo = RELOAD_PHASES.drawTo * T;
  if (t < drawFrom) {
    const s = t - SNAP_S;
    return 1 + SHIVER_AMPLITUDE * Math.exp(-s / SHIVER_S) * Math.sin((2 * Math.PI * s) / SHIVER_PERIOD_S);
  }
  if (t >= drawTo) return 0;
  return 1 - smoothstep((t - drawFrom) / (drawTo - drawFrom));
}

/** How far the next shot has come in, `t` s into a reload of `T` s: 0 at its start, 1 home; a little past and back */
export function loadCurve(t: number, T: number): number {
  const from = RELOAD_PHASES.loadFrom * T;
  const to = RELOAD_PHASES.loadTo * T;
  if (t <= from) return 0;
  if (t >= to) return 1;
  // Ease out with a small overshoot: the bolt seats with a knock
  const u = (t - from) / (to - from) - 1;
  return 1 + u * u * ((LOAD_OVERSHOOT + 1) * u + LOAD_OVERSHOOT);
}
const LOAD_OVERSHOOT = 1.2;

function smoothstep(u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}

/** How a kick part's resting rotation is found each frame: from the aim pitch, the turret's yaw, or its rest */
const enum KickBase { Pitch, Turret, Rest }

interface KickPart {
  node: Object3D;
  back: number;
  tilt: number;
  base: KickBase;
  rest: Vector3;
  restQuaternion: Quaternion;
  /** Seconds since its last shot; Infinity at rest */
  t: number;
  /** Where the kick stood when the shot came, so a shot during the return rises from there */
  from: number;
  returnS: number;
}

const tmpBase = new Quaternion();
const tmpTilt = new Quaternion();
const tmpDir = new Vector3();
const tmpAxis = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The firing motion of one tower: built with its model (ThreeTowerRenderer.create) when its config has one and its
 * model has the nodes; null when nothing of it is in the model.
 */
export class TowerFiring {
  private readonly parts: KickPart[] = [];
  private readonly kickS: number;
  private readonly returnS: number;
  private readonly alternate: boolean;
  private nextPart = 0;
  /** Along the barrel and across it, in a kick part's frame (turretBarrelOffset) */
  private readonly barrel: Vector3;
  private readonly across: Vector3;

  private readonly reload: FiringReload | undefined;
  private ammo: Object3D | null = null;
  private readonly ammoRest = new Vector3();
  private releaseMesh: Mesh | null = null;
  private releaseIndex = -1;
  private winch: Object3D | null = null;
  private readonly winchRest = new Quaternion();
  private readonly winchAxis = new Vector3();
  private winchAngle = 0;
  /** Seconds into the reload, Infinity loaded; and how long this one takes */
  private reloadT = Infinity;
  private reloadS = 0;

  /** In ThreeTowerRenderer's list of moving towers */
  active = false;

  static create(config: TowerTypeConfig, model: Object3D, turretPart: Object3D | null, pitch: TurretPitch | undefined,
    aim: TowerAim): TowerFiring | null {
    const motion = config.firingMotion;
    if (!motion) return null;
    const firing = new TowerFiring(config, model, turretPart, pitch, aim);
    return firing.parts.length > 0 || firing.ammo ? firing : null;
  }

  private constructor(
    config: TowerTypeConfig,
    model: Object3D,
    private readonly turretPart: Object3D | null,
    private readonly pitch: TurretPitch | undefined,
    private readonly aim: TowerAim,
  ) {
    const motion = config.firingMotion!;
    this.kickS = motion.kickS ?? 0.05;
    this.returnS = motion.returnS ?? 0.4;
    this.alternate = motion.alternate ?? false;
    const o = config.turretBarrelOffset ?? 0;
    this.barrel = new Vector3(Math.sin(o), 0, Math.cos(o));
    this.across = new Vector3(-Math.cos(o), 0, Math.sin(o));
    for (const kick of motion.kick ?? []) {
      const node = model.getObjectByName(kick.node);
      if (!node) continue;
      const base = pitch?.nodes.includes(node) ? KickBase.Pitch : node === turretPart ? KickBase.Turret : KickBase.Rest;
      this.parts.push({
        node, back: kick.back, tilt: kick.tilt ?? 0, base,
        rest: node.position.clone(), restQuaternion: node.quaternion.clone(),
        t: Infinity, from: 0, returnS: this.returnS,
      });
    }
    const reload = motion.reload;
    this.reload = reload;
    if (!reload) return;
    this.ammo = model.getObjectByName(reload.ammoNode) ?? null;
    if (this.ammo) this.ammoRest.copy(this.ammo.position);
    if (reload.release) {
      const holder = model.getObjectByName(reload.release.node);
      holder?.traverse((node) => {
        const mesh = node as Mesh;
        const index = mesh.isMesh ? mesh.morphTargetDictionary?.[reload.release!.target] : undefined;
        if (index !== undefined && !this.releaseMesh) {
          this.releaseMesh = mesh;
          this.releaseIndex = index;
        }
      });
    }
    if (reload.winch) {
      this.winch = model.getObjectByName(reload.winch.node) ?? null;
      if (this.winch) this.winchRest.copy(this.winch.quaternion);
      this.winchAxis.fromArray(reload.winch.axis).normalize();
    }
  }

  /** The tower fired at `fireRate` shots per game second (0: unknown, the configured times hold) */
  fire(fireRate: number): void {
    const interval = fireRate > 0 ? 1 / fireRate : Infinity;
    const count = this.alternate ? 1 : this.parts.length;
    for (let i = 0; i < count; i++) {
      const part = this.parts[this.alternate ? this.nextPart : i];
      // A part fires every `parts` shots when they take turns
      const own = this.alternate ? interval * this.parts.length : interval;
      part.from = kickCurve(part.t, this.kickS, part.returnS);
      part.returnS = Math.max(MIN_RETURN_S, Math.min(this.returnS, FIT_KICK * own - this.kickS));
      part.t = 0;
    }
    if (this.alternate && this.parts.length > 0) this.nextPart = (this.nextPart + 1) % this.parts.length;
    if (this.reload && this.ammo) {
      // A shot while the string is still being drawn: the winch keeps the turn it made
      if (this.reloadT !== Infinity && this.reload.winch) {
        this.winchAngle = (this.winchAngle + this.reload.winch.turns * 2 * Math.PI * this.drawnAt(this.reloadT, this.reloadS)) % (2 * Math.PI);
      }
      this.reloadS = Math.min(this.reload.seconds, FIT_RELOAD * interval);
      this.reloadT = 0;
      this.ammo.visible = false;
    }
  }

  /**
   * Advance `dt` game seconds and draw the pose; after drawTurretAim, which sets the aim the kick adds to. False
   * once all is at rest again (and drawn so).
   */
  update(dt: number): boolean {
    let moving = false;
    for (const part of this.parts) {
      if (part.t === Infinity) continue;
      part.t += dt;
      const done = part.t >= this.kickS + part.returnS;
      if (done) part.t = Infinity;
      else moving = true;
      this.drawKick(part, done ? 0 : this.kickAt(part));
    }
    if (this.reloadT !== Infinity) {
      this.reloadT += dt;
      const done = this.reloadT >= this.reloadS;
      if (done) this.reloadT = Infinity;
      else moving = true;
      this.drawReload(done);
    }
    return moving;
  }

  /** The kick of `part` now: from where the shot found it up to the peak, then home */
  private kickAt(part: KickPart): number {
    if (part.t < this.kickS) return part.from + (1 - part.from) * kickCurve(part.t, this.kickS, part.returnS);
    return kickCurve(part.t, this.kickS, part.returnS);
  }

  private drawKick(part: KickPart, x: number): void {
    const node = part.node;
    // The rest the kick adds to: the aim's pitch or yaw as drawTurretAim leaves it this frame, else the model's
    if (part.base === KickBase.Pitch && this.pitch) {
      tmpBase.setFromAxisAngle(this.pitch.axis, this.aim.pitch);
      // drawTurretAim writes the pitch again next frame, over the tilt
      this.pitch.drawn = NaN;
    } else if (part.base === KickBase.Turret) {
      // drawTurretAim sets rotation.y only, so the yaw comes from there and not from the Euler's x and z: a
      // quaternion turned more than a quarter turn reads back as (π, π - yaw, π)
      tmpBase.setFromAxisAngle(UP, node.rotation.y);
    } else {
      tmpBase.copy(part.restQuaternion);
    }
    tmpDir.copy(this.barrel).applyQuaternion(tmpBase);
    node.position.copy(part.rest).addScaledVector(tmpDir, -part.back * x);
    if (part.base === KickBase.Turret && x === 0) {
      // At rest the Euler is written plainly: drawTurretAim's next rotation.y over a (π, π - yaw, π) left by the
      // quaternion drew the turret at its mirrored heading until the next shot (playtest 2026-10-20)
      node.rotation.set(0, node.rotation.y, 0);
      return;
    }
    node.quaternion.copy(tmpBase);
    if (part.tilt !== 0 && x !== 0) node.quaternion.multiply(tmpTilt.setFromAxisAngle(this.across, part.tilt * x));
  }

  /** How far the string is drawn `t` s into a reload of `T` s, 0 to 1 */
  private drawnAt(t: number, T: number): number {
    return smoothstep((t - RELOAD_PHASES.drawFrom * T) / ((RELOAD_PHASES.drawTo - RELOAD_PHASES.drawFrom) * T));
  }

  private drawReload(done: boolean): void {
    const reload = this.reload!;
    const t = done ? Infinity : this.reloadT;
    const T = this.reloadS;
    if (this.releaseMesh?.morphTargetInfluences) {
      this.releaseMesh.morphTargetInfluences[this.releaseIndex] = done ? 0 : releaseCurve(t, T);
    }
    if (this.winch && reload.winch) {
      // The winch turns while the string is drawn, always the same way: a ratchet
      const drawn = done ? 1 : this.drawnAt(t, T);
      const turn = reload.winch.turns * 2 * Math.PI;
      this.winch.quaternion.copy(this.winchRest).multiply(tmpTilt.setFromAxisAngle(this.winchAxis, this.winchAngle + turn * drawn));
      if (done) this.winchAngle = (this.winchAngle + turn) % (2 * Math.PI);
    }
    const ammo = this.ammo!;
    const load = done ? 1 : loadCurve(t, T);
    ammo.visible = done || t > RELOAD_PHASES.loadFrom * T;
    tmpAxis.fromArray(reload.ammoFrom);
    ammo.position.copy(this.ammoRest).addScaledVector(tmpAxis, 1 - load);
  }
}
