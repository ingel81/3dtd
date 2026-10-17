import {
  BufferAttribute,
  Color,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';

/** Radius of an arm, model units: even all along, a robot arm, not a taper (the concept of 2026-10-02) */
const RADIUS = 0.15;
/** One vertebra of an arm, model units: a short barrel with a yellow ring in the joint */
const SEGMENT = 0.15;
/** Vertebrae per arm at most: 6 units of arm, beyond every range upgrade */
const MAX_SEGMENTS = 40;
/** Seconds an arm takes out or home: first it unfolds into its own quarter, then it reaches */
const EXTEND_SECONDS = 0.7;
/** Share of the way out spent unfolding: the saw lifts off its dock out to its deployed point, clear of the body */
const UNFOLD_SHARE = 0.4;
/** Deployed point of an arm: this far along its `out` from the socket, and up by its `lift` times as much, model units */
const DEPLOY_REACH = 0.9;
/** How fast a saw out at work follows its enemy, rad/s of a critically damped spring: a swing, never a jump */
const FOLLOW_RATE = 9;
/** Least distance between two saws out, model units: two arms on enemies side by side do not run into each other */
const SAW_CLEARANCE = 0.55;
/** Least distance between the middles of two arms, model units (three arm radii): their bodies do not run through each other */
const BODY_CLEARANCE = 0.45;
/**
 * Weight of an enemy outside an arm's quarter (away from its `out`) against
 * the distance its saw would travel, model units at a right angle: each arm
 * keeps to its side, the arms do not cross
 */
const QUARTER_WEIGHT = 1.4;
/** Extended, a saw grows this much to read on arms this thick; docked it is as built */
const SAW_GROWTH = 0.25;
/** Extended, the saw's bar points this far down into the target, rad */
const SAW_TILT = (15 * Math.PI) / 180;
/** The saw's mount stops this far short of the target, model units: the bar reaches into it */
const SAW_STANDOFF = 0.42;
/** Points along an arm's curve to measure its length */
const SAMPLES = 24;
/** Longest step the spring takes at once, s: a long frame is taken in several */
const MAX_STEP = 1 / 60;

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

interface Arm {
  saw: Object3D | null;
  socket: Vector3;
  out: Vector3;
  /** `out` on the ground plane, normalised: the arm's quarter */
  side: Vector3;
  axis: Vector3;
  lift: number;
  /** The saw's docked place and turn, as the model has it */
  restPosition: Vector3;
  restQuaternion: Quaternion;
  /** Where it unfolds to before it reaches (DEPLOY_REACH), clear of the body and the other arms */
  deployed: Vector3;
  /** 0 docked to 1 out at its target */
  reach: number;
  /** Where its enemy is, in the turret's frame; kept while it goes home */
  target: Vector3;
  hasTarget: boolean;
  /** Where its saw is bound, following the enemy on the spring, and how fast that point moves */
  aim: Vector3;
  aimVelocity: Vector3;
  /** The saw's place this frame */
  tip: Vector3;
  /** The curve's inner control points this frame, and the saw's bar along its end */
  c1: Vector3;
  c2: Vector3;
  bar: Vector3;
}

/** Ways to give up to three targets to three arms: each entry lists the target of arm 0, 1, 2 (-1: none) */
const ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

/**
 * The Chainsaw's robot arms (TowerTypeConfig.sawArms), drawn under the
 * tower's turret part in its frame (model units): each a cubic Bezier from
 * its socket on the torso to its saw, a chain of vertebrae along it (one
 * InstancedMesh for all three, more vertebrae the longer it is), the saw
 * turned along the curve's end.
 *
 * The motion is staged and held in check (E221): an arm going out first
 * unfolds its saw off the dock to a deployed point in its own quarter (along
 * its `out`, up by its `lift`), then reaches across to the enemy, the saw
 * over the asphalt and its bar tilted into it; home it goes the same way
 * back. At work the saw follows its enemy on a critically damped spring, so
 * a moving enemy or a new one swings the arm over instead of jumping it.
 * The simulation names the enemies; which arm takes which is drawn here:
 * the order with the least travel and the fewest enemies outside an arm's
 * quarter, so arms keep to their sides and do not cross, and two saws out
 * keep SAW_CLEARANCE apart. Purely visual: the simulation deals the damage
 * (TowerCombatService.updateSawTowers) and sends the enemies once a frame
 * (`towers.setSawTargets`).
 */
export class SawArms {
  readonly mesh: InstancedMesh;
  private readonly arms: Arm[];
  private readonly matrix = new Matrix4();
  private readonly points: Vector3[] = Array.from({ length: SAMPLES + 1 }, () => new Vector3());
  private readonly lengths = new Float32Array(SAMPLES + 1);
  private readonly p0 = new Vector3();
  private readonly p1 = new Vector3();
  private readonly p2 = new Vector3();
  private readonly p3 = new Vector3();
  private readonly dir = new Vector3();
  private readonly endDir = new Vector3();
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly local: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
  private time = 0;

  constructor(config: TowerTypeConfig, private readonly turret: Object3D) {
    const specs = config.sawArms ?? [];
    this.arms = specs.map((spec) => {
      const saw = turret.getObjectByName(spec.node) ?? null;
      const socket = new Vector3(...spec.socket);
      const out = new Vector3(...spec.out).normalize();
      const side = out.clone().setY(0);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      const restPosition = saw ? saw.position.clone() : socket.clone();
      return {
        saw,
        socket,
        out,
        side,
        axis: new Vector3(...spec.axis).normalize(),
        lift: spec.lift,
        restPosition,
        restQuaternion: saw ? saw.quaternion.clone() : new Quaternion(),
        deployed: socket.clone().addScaledVector(out, DEPLOY_REACH).addScaledVector(UP, spec.lift * DEPLOY_REACH),
        reach: 0,
        target: new Vector3(),
        hasTarget: false,
        aim: restPosition.clone(),
        aimVelocity: new Vector3(),
        tip: restPosition.clone(),
        c1: new Vector3(),
        c2: new Vector3(),
        bar: new Vector3(),
      };
    });
    this.mesh = new InstancedMesh(vertebraGeometry(), new MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.85,
      roughness: 0.3,
    }), Math.max(1, this.arms.length) * MAX_SEGMENTS);
    this.mesh.name = 'saw_arms';
    // The arms reach far past the model's bounds
    this.mesh.frustumCulled = false;
    turret.add(this.mesh);
    this.update(0);
  }

  /**
   * The enemies the arms cut this frame (world positions; null entries and
   * an empty list mean fewer, every arm without one goes home). Which arm
   * takes which is decided here, see the class.
   */
  setTargets(targets: readonly (Vector3 | null)[]): void {
    this.turret.updateWorldMatrix(true, false);
    const toTurret = this.matrix.copy(this.turret.matrixWorld).invert();
    let count = 0;
    for (const target of targets) {
      if (target && count < this.local.length) this.local[count++].copy(target).applyMatrix4(toTurret);
    }
    const order = this.bestOrder(count);
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      const t = order ? order[i] : -1;
      const engaged = t >= 0 && t < count;
      if (engaged) {
        arm.target.copy(this.local[t]);
        // Out from the dock it binds to the enemy at once; at work it swings over on the spring
        if (!arm.hasTarget && arm.reach <= UNFOLD_SHARE) {
          this.cutPoint(arm, arm.aim);
          arm.aimVelocity.set(0, 0, 0);
        }
      }
      arm.hasTarget = engaged;
    }
  }

  /** Once per render frame: the arms go out or home and are drawn where they are. */
  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    for (const arm of this.arms) {
      const step = deltaSeconds / EXTEND_SECONDS;
      arm.reach = arm.hasTarget ? Math.min(1, arm.reach + step) : Math.max(0, arm.reach - step);
      if (arm.hasTarget) this.follow(arm, deltaSeconds);
      this.placeTip(arm);
    }
    this.keepApart();
    for (const arm of this.arms) this.shapeArm(arm);
    this.separateBodies();
    let count = 0;
    for (const arm of this.arms) count = this.drawArm(arm, count);
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }

  /**
   * Which target each arm takes, the order with the least cost; null with no
   * target. Cost per arm: the way its saw would travel (from where it is
   * bound, or from its deployed point when docked) and the angle of the
   * enemy off its quarter. Keeping an enemy costs no travel, so arms do not
   * trade enemies that only walk on.
   */
  private bestOrder(count: number): readonly number[] | null {
    if (count === 0) return null;
    let best: readonly number[] | null = null;
    let bestCost = Infinity;
    for (const order of ORDERS) {
      if (order.length < this.arms.length && this.arms.length > 0) continue;
      let cost = 0;
      for (let i = 0; i < this.arms.length && i < order.length; i++) {
        const t = order[i];
        if (t >= count) continue;
        const arm = this.arms[i];
        const target = this.local[t];
        const from = arm.hasTarget ? arm.target : arm.deployed;
        this.tmp.subVectors(target, arm.socket).setY(0);
        const off = this.tmp.lengthSq() > 1e-9 ? 1 - this.tmp.normalize().dot(arm.side) : 0;
        cost += from.distanceTo(target) + QUARTER_WEIGHT * off;
      }
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = order;
      }
    }
    return best;
  }

  /** Where the saw's mount goes to cut: short of the enemy, the bar tilted down into it */
  private cutPoint(arm: Arm, out: Vector3): Vector3 {
    const dir = this.dir.subVectors(arm.target, arm.socket).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(arm.side);
    dir.normalize();
    this.endDir.set(dir.x, -Math.tan(SAW_TILT), dir.z).normalize();
    return out.copy(arm.target).addScaledVector(this.endDir, -SAW_STANDOFF);
  }

  /** The bound point follows the enemy on a critically damped spring */
  private follow(arm: Arm, deltaSeconds: number): void {
    const goal = this.cutPoint(arm, this.p3);
    let left = deltaSeconds;
    while (left > 1e-6) {
      const dt = Math.min(MAX_STEP, left);
      left -= dt;
      // a = -2w v - w² (x - goal)
      this.tmp.subVectors(arm.aim, goal).multiplyScalar(-FOLLOW_RATE * FOLLOW_RATE)
        .addScaledVector(arm.aimVelocity, -2 * FOLLOW_RATE);
      arm.aimVelocity.addScaledVector(this.tmp, dt);
      arm.aim.addScaledVector(arm.aimVelocity, dt);
    }
  }

  /** The saw on its staged way: dock to deployed point (unfolding), deployed point to the bound point (reaching) */
  private placeTip(arm: Arm): void {
    const r = arm.reach;
    if (r <= UNFOLD_SHARE) arm.tip.lerpVectors(arm.restPosition, arm.deployed, smooth(r / UNFOLD_SHARE));
    else arm.tip.lerpVectors(arm.deployed, arm.aim, smooth((r - UNFOLD_SHARE) / (1 - UNFOLD_SHARE)));
  }

  /** Two saws out closer than SAW_CLEARANCE: each moves half the shortfall away from the other, as far as it is out */
  private keepApart(): void {
    const arms = this.arms;
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const a = arms[i];
        const b = arms[j];
        const d = this.tmp.subVectors(b.tip, a.tip);
        const distance = d.length();
        if (distance >= SAW_CLEARANCE) continue;
        if (distance < 1e-6) d.copy(b.side).sub(a.side);
        if (d.lengthSq() < 1e-9) d.set(1, 0, 0);
        d.normalize();
        const push = (SAW_CLEARANCE - distance) / 2;
        a.tip.addScaledVector(d, -push * smooth(a.reach));
        b.tip.addScaledVector(d, push * smooth(b.reach));
      }
    }
  }

  /** The arm's curve: its saw's bar and the control points (socket and saw are its ends) */
  private shapeArm(arm: Arm): void {
    const reach = smooth(arm.reach);
    const { dir } = this;
    // Small shake while it cuts
    if (arm.hasTarget && arm.reach >= 1) {
      arm.tip.x += Math.sin(this.time * 61 + arm.lift * 13) * 0.012;
      arm.tip.y += Math.sin(this.time * 47 + arm.lift * 7) * 0.012;
    }
    // The bar along the curve's end: as docked, turning into the enemy (tilted down) as it reaches
    dir.subVectors(arm.target, arm.socket).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(arm.side);
    dir.normalize();
    arm.bar.set(dir.x, -Math.tan(SAW_TILT), dir.z).normalize();
    arm.bar.lerpVectors(arm.axis, arm.bar, reach).normalize();
    const span = arm.socket.distanceTo(arm.tip);
    // Out of the socket along its own `out`, arching up by its lift: each arm on its own height
    arm.c1.copy(arm.socket).addScaledVector(arm.out, span * 0.35).addScaledVector(UP, arm.lift * span * reach);
    arm.c2.copy(arm.tip).addScaledVector(arm.bar, -span * 0.35);
  }

  /**
   * Two arms whose middles come closer than BODY_CLEARANCE bow apart: both
   * control points of each move away from the other (a move of both shifts
   * the middle by three quarters of it), as far as the arms are out
   */
  private separateBodies(): void {
    const arms = this.arms;
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const a = arms[i];
        const b = arms[j];
        const share = Math.min(smooth(a.reach), smooth(b.reach));
        if (share <= 0) continue;
        bezier(a.socket, a.c1, a.c2, a.tip, 0.5, this.p1);
        bezier(b.socket, b.c1, b.c2, b.tip, 0.5, this.p2);
        const d = this.tmp.subVectors(this.p2, this.p1);
        const distance = d.length();
        if (distance >= BODY_CLEARANCE) continue;
        if (distance < 1e-6) d.subVectors(b.socket, a.socket);
        if (d.lengthSq() < 1e-9) d.set(0, 1, 0);
        d.normalize();
        const push = ((BODY_CLEARANCE - distance) / 2 / 0.75) * share;
        a.c1.addScaledVector(d, -push);
        a.c2.addScaledVector(d, -push);
        b.c1.addScaledVector(d, push);
        b.c2.addScaledVector(d, push);
      }
    }
  }

  /** Saw and vertebrae of one arm along its curve; returns the instances used so far. */
  private drawArm(arm: Arm, first: number): number {
    const reach = smooth(arm.reach);
    const { p0, p1, p2, p3, dir } = this;
    p0.copy(arm.socket);
    p1.copy(arm.c1);
    p2.copy(arm.c2);
    p3.copy(arm.tip);

    if (arm.saw) {
      arm.saw.position.copy(p3);
      arm.saw.quaternion.setFromUnitVectors(arm.axis, arm.bar).multiply(arm.restQuaternion);
      arm.saw.scale.setScalar(1 + SAW_GROWTH * reach);
    }

    // Arc length along the curve, then a vertebra every SEGMENT
    const points = this.points;
    for (let i = 0; i <= SAMPLES; i++) bezier(p0, p1, p2, p3, i / SAMPLES, points[i]);
    this.lengths[0] = 0;
    for (let i = 1; i <= SAMPLES; i++) this.lengths[i] = this.lengths[i - 1] + points[i].distanceTo(points[i - 1]);
    const total = this.lengths[SAMPLES];
    const segments = Math.min(MAX_SEGMENTS, Math.max(1, Math.round(total / SEGMENT)));
    // Stretched or squeezed a little so a whole number of them fills the arm
    this.scale.set(total / (segments * SEGMENT), 1, 1);
    let at = 0;
    let n = first;
    for (let k = 0; k < segments; k++) {
      const s = (k * total) / segments;
      while (at < SAMPLES - 1 && this.lengths[at + 1] < s) at++;
      const t0 = this.lengths[at];
      const f = (s - t0) / Math.max(1e-6, this.lengths[at + 1] - t0);
      const a = points[at];
      const b = points[at + 1];
      this.tmp.lerpVectors(a, b, f);
      this.q.setFromUnitVectors(X, dir.subVectors(b, a).normalize());
      this.matrix.compose(this.tmp, this.q, this.scale);
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    return n;
  }
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  );
}

/**
 * One vertebra along +X (0 to SEGMENT): a dark metal barrel that bulges in the
 * middle and draws in at both ends, a yellow ring in the joint at its back.
 */
function vertebraGeometry(): LatheGeometry {
  const profile: Vector2[] = [new Vector2(0, 0), new Vector2(RADIUS * 0.78, 0), new Vector2(RADIUS * 0.78, 0.022)];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    profile.push(new Vector2(RADIUS * (0.8 + 0.2 * Math.pow(Math.sin(Math.PI * u), 0.6)), 0.022 + u * (SEGMENT - 0.03)));
  }
  profile.push(new Vector2(0, SEGMENT));
  const geometry = new LatheGeometry(profile, 16);
  // Lathed about y: turned so it runs along x
  geometry.rotateZ(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const dark = new Color(0.07, 0.07, 0.075);
  const yellow = new Color(0.85, 0.6, 0.05);
  for (let i = 0; i < position.count; i++) {
    const c = position.getX(i) < 0.023 ? yellow : dark;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
