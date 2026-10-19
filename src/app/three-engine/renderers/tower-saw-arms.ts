import {
  BufferAttribute,
  Color,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { SAW_ARM_TIMING, type TowerTypeConfig } from '../../configs/tower-types.config';
import { ChainLoop, chainLinkGeometry, chainMaterial, chainlessGeometry } from './tower-saw-chain';

/** Radius of an arm, model units: even all along, a robot arm, not a taper (the concept of 2026-10-02) */
const RADIUS = 0.15;
/** One vertebra of an arm, model units: a short barrel with a yellow ring in the joint */
const SEGMENT = 0.15;
/** Vertebrae per arm at most: 6 units of arm, beyond every range upgrade */
const MAX_SEGMENTS = 40;
/** Seconds an arm takes out or home, game time: first it unfolds into its own quarter, then it reaches */
const EXTEND_SECONDS = SAW_ARM_TIMING.extendMs / 1000;
/** Share of the way out spent unfolding: the saw lifts off its dock out to its deployed point, clear of the body */
const UNFOLD_SHARE = 0.4;
/** Deployed point of an arm: this far along its `out` from the socket, and up by its `lift` times as much, model units */
const DEPLOY_REACH = 0.9;
/**
 * How fast a saw out at work follows its enemy, rad/s of a critically damped
 * spring: a swing, never a jump; over to a new enemy nine tenths of the way
 * in SAW_ARM_TIMING.swingMs, when the simulation lets it cut
 */
const FOLLOW_RATE = 5.5;
/** An enemy this close to where an arm's enemy was is the same one, model units: the arm keeps it */
const SAME_ENEMY = 0.6;
/**
 * A saw as the arms keep clear of it, model units at its built size: a
 * capsule from its mount along its bar to the nose, as thick as its housing
 * and its bar with the chain
 */
const SAW_LENGTH = 0.85;
const SAW_RADIUS = 0.17;
/** Room left between two arms or saws, model units: they never touch */
const GAP = 0.05;
/** Straight pieces an arm's curve is taken as when the arms keep clear of each other */
const BODY_PIECES = 8;
/** Rounds of pushing apart a frame at most; one without a push ends them */
const SOLVE_PASSES = 16;
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
/** At work a saw strokes across its enemy, sideways on the ground: this far each way, model units (about 0.7 m) */
const STROKE = 0.18;
/** Strokes there and back a second, each arm at its own share of it and from its own phase: they do not move in step */
const STROKE_RATE = 0.9;
const STROKE_RATES = [1, 0.81, 1.23];
const STROKE_PHASES = [0, 2.3, 4.1];
/** How much the stroke swells and ebbs, slowly and per arm: never the same move twice */
const STROKE_SWELL = 0.3;
const SWELL_RATE = 0.55;
/** With each stroke it pushes in and draws back along the bar this much, twice a stroke, model units */
const STROKE_PUSH = 0.05;
/** The bar trails each stroke by this much at its fastest, rad: dragged through, not slid */
const STROKE_YAW = (11 * Math.PI) / 180;
/** Seconds the stroke takes to set in once a saw is at its enemy, and to stop */
const STROKE_EASE = 0.35;
/** The chain at full run, model units a second along its loop */
const CHAIN_RUN = 2.6;
/** Share of the full run docked and idling; out on the way to an enemy it runs at CHAIN_REACH */
const CHAIN_IDLE = 0.12;
const CHAIN_REACH = 0.6;
/** Seconds the chain takes to run up to speed, and to run down (the motors run on, as in SAW_SOUND) */
const CHAIN_SPIN_UP = 0.3;
const CHAIN_SPIN_DOWN = 1.2;
/**
 * The most a link moves in one frame, a share of a link: faster it would
 * strobe (seem to stand or run back); near that speed the links stretch
 * along the run, by CHAIN_BLUR per share past CHAIN_BLUR_FROM, a blur
 */
const CHAIN_MAX_STEP = 0.45;
const CHAIN_BLUR = 2.2;
const CHAIN_BLUR_FROM = 0.15;

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
  /** 0 to 1, how far the stroke has set in (STROKE_EASE) */
  stroke: number;
  /** Where in its stroke the saw is, rad, and how fast it strokes (STROKE_RATES) */
  strokePhase: number;
  strokeRate: number;
  /** This frame: how the arm bows to keep clear (added to both inner control points), its saw's turn, size and nose, its curve in BODY_PIECES */
  bow: Vector3;
  sawTurn: Quaternion;
  sawScale: number;
  nose: Vector3;
  body: Vector3[];
  /** The chain round its bar (null without a `bar` or a saw), its run 0 to 1 and how far it has gone, model units */
  chain: ChainLoop | null;
  /** Its bar along its length and its face, in the saw's own frame (null without a `bar`): out it lies flat */
  barLength: Vector3 | null;
  barFace: Vector3 | null;
  chainSpeed: number;
  chainAt: number;
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
 * There it saws (E241): it strokes across the enemy, sideways on the
 * ground to the way the arm comes in, each saw at its own pace and phase,
 * swelling and ebbing, pushing in twice a stroke, its bar trailing and
 * lying flat (rolled so as it unfolds,
 * layFlat); its chain runs round the bar (tower-saw-chain.ts, all links in
 * one InstancedMesh), idling docked, faster out and spinning up at work.
 * The simulation names the enemies; which arm takes which is drawn here:
 * the order with the least travel and the fewest enemies outside an arm's
 * quarter, so arms keep to their sides and do not cross; arms and saws
 * never touch (keepClear). An arm at an enemy keeps it. Purely visual, in
 * game time: the simulation deals the damage once an arm is out and over
 * at its enemy, on the same timing (SAW_ARM_TIMING,
 * TowerCombatService.updateSawTowers), and sends the enemies once a frame
 * (`towers.setSawTargets`).
 */
export class SawArms {
  readonly mesh: InstancedMesh;
  /** The links of all the chains, one InstancedMesh */
  readonly chain: InstancedMesh;
  private readonly arms: Arm[];
  private readonly matrix = new Matrix4();
  private readonly sawMatrix = new Matrix4();
  private readonly linkMatrix = new Matrix4();
  private readonly points: Vector3[] = Array.from({ length: SAMPLES + 1 }, () => new Vector3());
  private readonly lengths = new Float32Array(SAMPLES + 1);
  private readonly p0 = new Vector3();
  private readonly p1 = new Vector3();
  private readonly p2 = new Vector3();
  private readonly p3 = new Vector3();
  private readonly dir = new Vector3();
  private readonly endDir = new Vector3();
  private readonly tmp = new Vector3();
  private readonly flat = new Vector3();
  private readonly cross = new Vector3();
  private readonly q = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly local: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
  private readonly onA = new Vector3();
  private readonly onB = new Vector3();
  private readonly hitA = new Vector3();
  private readonly hitB = new Vector3();
  private readonly push = new Vector3();
  private readonly u = new Vector3();
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  /** Where on the two segments the last `closest` found the nearest points, 0 to 1 */
  private atA = 0;
  private atB = 0;
  private time = 0;
  /** Per arm, the target it keeps this frame (-1: free), and which targets are kept */
  private readonly kept: number[] = [];
  private readonly used: boolean[] = [];

  constructor(config: TowerTypeConfig, private readonly turret: Object3D) {
    const specs = config.sawArms ?? [];
    this.arms = specs.map((spec, index) => {
      const saw = turret.getObjectByName(spec.node) ?? null;
      // Its modelled teeth pressed into the bar: the running chain stands in for them
      const sawMesh = saw as Mesh | null;
      if (spec.bar && sawMesh?.isMesh) sawMesh.geometry = chainlessGeometry(sawMesh.geometry, spec.bar);
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
        stroke: 0,
        strokePhase: STROKE_PHASES[index % STROKE_PHASES.length],
        strokeRate: STROKE_RATE * STROKE_RATES[index % STROKE_RATES.length],
        bow: new Vector3(),
        sawTurn: new Quaternion(),
        sawScale: 1,
        nose: new Vector3(),
        body: Array.from({ length: BODY_PIECES + 1 }, () => new Vector3()),
        chain: spec.bar && saw ? new ChainLoop(spec.bar) : null,
        barLength: spec.bar ? new Vector3(...spec.bar.to).sub(new Vector3(...spec.bar.from)).normalize() : null,
        barFace: spec.bar ? new Vector3(...spec.bar.normal).normalize() : null,
        chainSpeed: CHAIN_IDLE,
        chainAt: index * 0.37,
      };
    });
    this.mesh = new InstancedMesh(vertebraGeometry(), sawArmsMaterial(), Math.max(1, this.arms.length) * MAX_SEGMENTS);
    this.mesh.name = 'saw_arms';
    // The arms reach far past the model's bounds
    this.mesh.frustumCulled = false;
    turret.add(this.mesh);
    const links = this.arms.reduce((sum, arm) => sum + (arm.chain?.links ?? 0), 0);
    this.chain = new InstancedMesh(chainLinkGeometry(), chainMaterial(), Math.max(1, links));
    this.chain.name = 'saw_chain';
    this.chain.frustumCulled = false;
    this.chain.count = 0;
    turret.add(this.chain);
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
      arm.strokePhase = (arm.strokePhase + deltaSeconds * arm.strokeRate * 2 * Math.PI) % (2 * Math.PI);
      const step = deltaSeconds / EXTEND_SECONDS;
      arm.reach = arm.hasTarget ? Math.min(1, arm.reach + step) : Math.max(0, arm.reach - step);
      const cutting = arm.hasTarget && arm.reach >= 1;
      arm.stroke = cutting
        ? Math.min(1, arm.stroke + deltaSeconds / STROKE_EASE)
        : Math.max(0, arm.stroke - deltaSeconds / STROKE_EASE);
      const run = cutting ? 1 : arm.hasTarget ? CHAIN_REACH : CHAIN_IDLE;
      const ease = run > arm.chainSpeed ? CHAIN_SPIN_UP : CHAIN_SPIN_DOWN;
      arm.chainSpeed += (run - arm.chainSpeed) * (1 - Math.exp(-deltaSeconds / ease));
      if (arm.hasTarget) this.follow(arm, deltaSeconds);
      this.placeTip(arm);
    }
    this.keepClear();
    let count = 0;
    let links = 0;
    for (const arm of this.arms) {
      count = this.drawArm(arm, count);
      links = this.drawChain(arm, links, deltaSeconds);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.chain.count = links;
    this.chain.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.chain.removeFromParent();
    this.mesh.geometry.dispose();
    this.chain.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    (this.chain.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
    this.chain.dispose();
  }

  /**
   * Which target each arm takes, the order with the least cost; null with no
   * target. An arm at an enemy keeps it (the target nearest where its enemy
   * was, within SAME_ENEMY): arms never trade enemies that only walk on, as
   * the simulation keeps an arm on its enemy (Tower.sawHold). The rest go by
   * cost per arm: the way its saw would travel (from where it is bound, or
   * from its deployed point when docked) and the angle of the enemy off its
   * quarter.
   */
  private bestOrder(count: number): readonly number[] | null {
    if (count === 0) return null;
    this.keepEnemies(count);
    let best: readonly number[] | null = null;
    let bestCost = Infinity;
    for (const order of ORDERS) {
      if (order.length < this.arms.length && this.arms.length > 0) continue;
      if (this.kept.some((t, i) => t >= 0 && order[i] !== t)) continue;
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

  /** Into `kept`: for each arm at an enemy the target that is still it, nearest pairs first */
  private keepEnemies(count: number): void {
    const arms = this.arms;
    this.kept.length = arms.length;
    this.kept.fill(-1);
    this.used.length = count;
    this.used.fill(false);
    for (;;) {
      let bestArm = -1;
      let bestT = -1;
      let bestD = SAME_ENEMY;
      for (let i = 0; i < arms.length; i++) {
        if (!arms[i].hasTarget || this.kept[i] >= 0) continue;
        for (let t = 0; t < count; t++) {
          if (this.used[t]) continue;
          const d = arms[i].target.distanceTo(this.local[t]);
          if (d < bestD) {
            bestD = d;
            bestArm = i;
            bestT = t;
          }
        }
      }
      if (bestArm < 0) return;
      this.kept[bestArm] = bestT;
      this.used[bestT] = true;
    }
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

  /**
   * The saw on its staged way: dock to deployed point (unfolding), deployed
   * point to the bound point (reaching); at work it strokes across its enemy,
   * sideways to the way the arm comes in, pushing in twice a stroke
   */
  private placeTip(arm: Arm): void {
    const r = arm.reach;
    if (r <= UNFOLD_SHARE) arm.tip.lerpVectors(arm.restPosition, arm.deployed, smooth(r / UNFOLD_SHARE));
    else arm.tip.lerpVectors(arm.deployed, arm.aim, smooth((r - UNFOLD_SHARE) / (1 - UNFOLD_SHARE)));
    if (arm.stroke <= 0) return;
    const dir = this.inward(arm);
    const set = smooth(arm.stroke) * (1 - STROKE_SWELL * (0.5 + 0.5 * Math.sin(this.time * SWELL_RATE * arm.strokeRate + arm.lift * 9)));
    const across = Math.sin(arm.strokePhase) * STROKE * set;
    const push = Math.sin(2 * arm.strokePhase) * STROKE_PUSH * set;
    arm.tip.x += -dir.z * across + dir.x * push;
    arm.tip.z += dir.x * across + dir.z * push;
    // The motor's buzz while it cuts
    const buzz = 0.006 * set;
    arm.tip.x += Math.sin(this.time * 61 + arm.lift * 13) * buzz;
    arm.tip.y += Math.sin(this.time * 47 + arm.lift * 7) * buzz;
  }

  /** The way the arm comes in to its enemy on the ground, normalised, in `this.dir` */
  private inward(arm: Arm): Vector3 {
    const dir = this.dir.subVectors(arm.target, arm.socket).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(arm.side);
    return dir.normalize();
  }

  /**
   * The arms never touch (E241): each a chain of BODY_PIECES straight pieces
   * RADIUS thick, each saw a capsule (SAW_LENGTH, SAW_RADIUS, at its size).
   * Wherever two come closer than their thickness and GAP, they are pushed
   * apart along the line between their nearest points, each as far as it is
   * out (a docked arm stays as the model has it): a saw by its mount, a body
   * near its saw by its saw, else by bowing (both inner control points, as
   * much more as the curve there moves less). Again with the arms reshaped,
   * until a round pushes nothing or SOLVE_PASSES are done.
   */
  private keepClear(): void {
    for (const arm of this.arms) {
      arm.bow.set(0, 0, 0);
      this.shapeArm(arm);
    }
    const arms = this.arms;
    for (let pass = 0; pass < SOLVE_PASSES; pass++) {
      let pushed = false;
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) pushed = this.pushApart(arms[i], arms[j]) || pushed;
      }
      if (!pushed) return;
      for (const arm of arms) this.shapeArm(arm);
    }
  }

  /** One round between two arms: saw against saw, each saw against the other's body, body against body; true on a push */
  private pushApart(a: Arm, b: Arm): boolean {
    const wa = smooth(a.reach);
    const wb = smooth(b.reach);
    if (wa + wb <= 0) return false;
    let pushed = false;
    const sawA = SAW_RADIUS * a.sawScale;
    const sawB = SAW_RADIUS * b.sawScale;
    // Saw against saw
    let d = this.closest(a.tip, a.nose, b.tip, b.nose);
    if (d < sawA + sawB + GAP) {
      this.separate(a, b, wa, wb, sawA + sawB + GAP - d, -1, -1);
      pushed = true;
    }
    // Each saw against the other's body
    pushed = this.sawAgainstBody(a, b, wa, wb, sawA) || pushed;
    pushed = this.sawAgainstBody(b, a, wb, wa, sawB) || pushed;
    // Body against body, past where they leave the torso side by side
    let best = Infinity;
    let atA = 0;
    let atB = 0;
    for (let i = 0; i < BODY_PIECES; i++) {
      for (let k = 0; k < BODY_PIECES; k++) {
        if (i === 0 && k === 0) continue;
        d = this.closest(a.body[i], a.body[i + 1], b.body[k], b.body[k + 1]);
        if (d < best) {
          best = d;
          atA = (i + this.atA) / BODY_PIECES;
          atB = (k + this.atB) / BODY_PIECES;
          this.hitA.copy(this.onA);
          this.hitB.copy(this.onB);
        }
      }
    }
    if (best < 2 * RADIUS + GAP) {
      this.onA.copy(this.hitA);
      this.onB.copy(this.hitB);
      this.separate(a, b, wa, wb, 2 * RADIUS + GAP - best, atA, atB);
      pushed = true;
    }
    return pushed;
  }

  /** The saw of `saw` against the body of `other`; true on a push */
  private sawAgainstBody(saw: Arm, other: Arm, ws: number, wo: number, radius: number): boolean {
    let best = Infinity;
    let at = 0;
    for (let k = 0; k < BODY_PIECES; k++) {
      const d = this.closest(saw.tip, saw.nose, other.body[k], other.body[k + 1]);
      if (d < best) {
        best = d;
        at = (k + this.atB) / BODY_PIECES;
        this.hitA.copy(this.onA);
        this.hitB.copy(this.onB);
      }
    }
    if (best >= radius + RADIUS + GAP) return false;
    this.onA.copy(this.hitA);
    this.onB.copy(this.hitB);
    this.separate(saw, other, ws, wo, radius + RADIUS + GAP - best, -1, at);
    return true;
  }

  /**
   * Moves `a` and `b` apart by `short` along the line from onB to onA,
   * shared as far as each is out; `atA`/`atB` where on its body (-1: its saw)
   */
  private separate(a: Arm, b: Arm, wa: number, wb: number, short: number, atA: number, atB: number): void {
    const n = this.push.subVectors(this.onA, this.onB);
    if (n.lengthSq() < 1e-12) n.subVectors(a.side, b.side).setY(0.1);
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    n.normalize();
    const share = short / (wa + wb);
    this.moveArm(a, atA, wa * share);
    this.moveArm(b, atB, -wb * share);
  }

  /** Moves `arm` by `amount` along `this.push`, at `at` on its body (-1: its saw) */
  private moveArm(arm: Arm, at: number, amount: number): void {
    if (amount === 0) return;
    if (at < 0 || at > 0.75) arm.tip.addScaledVector(this.push, amount);
    else arm.bow.addScaledVector(this.push, amount / Math.max(0.4, 3 * at * (1 - at)));
  }

  /**
   * Distance between the segments p1 q1 and p2 q2, their nearest points in
   * onA and onB and where along each in atA and atB (Ericson, Real-Time
   * Collision Detection 5.1.9)
   */
  private closest(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
    const d1 = this.u.subVectors(q1, p1);
    const d2 = this.v.subVectors(q2, p2);
    const r = this.w.subVectors(p1, p2);
    const a = d1.lengthSq();
    const e = d2.lengthSq();
    const f = d2.dot(r);
    let s = 0;
    let t = 0;
    if (a <= 1e-12 && e > 1e-12) {
      t = clamp01(f / e);
    } else if (a > 1e-12) {
      const c = d1.dot(r);
      if (e <= 1e-12) {
        s = clamp01(-c / a);
      } else {
        const b = d1.dot(d2);
        const denom = a * e - b * b;
        s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = clamp01((b - c) / a);
        }
      }
    }
    this.atA = s;
    this.atB = t;
    this.onA.copy(p1).addScaledVector(d1, s);
    this.onB.copy(p2).addScaledVector(d2, t);
    return this.onA.distanceTo(this.onB);
  }

  /**
   * The arm's shape this frame: its saw's bar and the curve's control points
   * (socket and saw are its ends) with its bow, the saw's turn, size and
   * nose, the curve in BODY_PIECES
   */
  private shapeArm(arm: Arm): void {
    const reach = smooth(arm.reach);
    // The bar along the curve's end: as docked, turning into the enemy (tilted down) as it reaches, trailing its stroke
    const dir = this.inward(arm);
    const yaw = Math.cos(arm.strokePhase) * STROKE_YAW * smooth(arm.stroke);
    if (yaw !== 0) dir.applyAxisAngle(UP, yaw);
    arm.bar.set(dir.x, -Math.tan(SAW_TILT), dir.z).normalize();
    arm.bar.lerpVectors(arm.axis, arm.bar, reach).normalize();
    const span = arm.socket.distanceTo(arm.tip);
    // Out of the socket along its own `out`, arching up by its lift: each arm on its own height
    arm.c1.copy(arm.socket).addScaledVector(arm.out, span * 0.35).addScaledVector(UP, arm.lift * span * reach).add(arm.bow);
    arm.c2.copy(arm.tip).addScaledVector(arm.bar, -span * 0.35).add(arm.bow);
    arm.sawTurn.setFromUnitVectors(arm.axis, arm.bar).multiply(arm.restQuaternion);
    this.layFlat(arm, arm.sawTurn);
    arm.sawScale = 1 + SAW_GROWTH * reach;
    if (arm.barLength) arm.nose.copy(arm.barLength).applyQuaternion(arm.sawTurn);
    else arm.nose.copy(arm.bar);
    arm.nose.multiplyScalar(SAW_LENGTH * arm.sawScale).add(arm.tip);
    for (let i = 0; i <= BODY_PIECES; i++) bezier(arm.socket, arm.c1, arm.c2, arm.tip, i / BODY_PIECES, arm.body[i]);
  }

  /**
   * Where arm `index` runs this frame: its curve at `curve.length` points
   * from socket to saw, its saw from mount to nose into `saw` (the clearance
   * spec measures them)
   */
  shape(index: number, curve: Vector3[], saw: [Vector3, Vector3]): void {
    const arm = this.arms[index];
    const n = curve.length - 1;
    for (let i = 0; i <= n; i++) bezier(arm.socket, arm.c1, arm.c2, arm.tip, i / n, curve[i]);
    saw[0].copy(arm.tip);
    saw[1].copy(arm.nose);
  }

  /**
   * The saw rolled about its bar until the bar's face lies flat, as it
   * unfolds (docked it is as the model has it): the blade lies across, as
   * the saw strokes, and cuts through its enemy sideways. The nearer of the
   * two flat lies, so it never rolls more than a quarter turn.
   */
  private layFlat(arm: Arm, q: Quaternion): void {
    if (!arm.barLength || !arm.barFace) return;
    const share = smooth(Math.min(1, arm.reach / UNFOLD_SHARE));
    if (share <= 0) return;
    const length = this.endDir.copy(arm.barLength).applyQuaternion(q);
    const face = this.tmp.copy(arm.barFace).applyQuaternion(q);
    face.addScaledVector(length, -face.dot(length));
    const flat = this.flat.copy(UP).addScaledVector(length, -length.y);
    if (face.lengthSq() < 1e-9 || flat.lengthSq() < 1e-9) return;
    face.normalize();
    flat.normalize();
    let angle = Math.atan2(this.cross.crossVectors(face, flat).dot(length), face.dot(flat));
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle < -Math.PI / 2) angle += Math.PI;
    q.premultiply(this.q.setFromAxisAngle(length, angle * share));
  }

  /** Saw and vertebrae of one arm along its curve; returns the instances used so far. */
  private drawArm(arm: Arm, first: number): number {
    const { p0, p1, p2, p3, dir } = this;
    p0.copy(arm.socket);
    p1.copy(arm.c1);
    p2.copy(arm.c2);
    p3.copy(arm.tip);

    if (arm.saw) {
      arm.saw.position.copy(p3);
      arm.saw.quaternion.copy(arm.sawTurn);
      arm.saw.scale.setScalar(arm.sawScale);
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

  /**
   * The links of one arm's chain where they run this frame, in the turret's
   * frame through the saw's (drawArm placed it); returns the links used so
   * far. A link goes at most CHAIN_MAX_STEP of itself a frame and stretches
   * past CHAIN_BLUR_FROM, so a fast chain blurs instead of strobing.
   */
  private drawChain(arm: Arm, first: number, deltaSeconds: number): number {
    const loop = arm.chain;
    if (!loop || !arm.saw) return first;
    const step = Math.min(arm.chainSpeed * CHAIN_RUN * deltaSeconds, CHAIN_MAX_STEP * loop.pitch);
    arm.chainAt = (arm.chainAt + step) % loop.perimeter;
    const stretch = 1 + CHAIN_BLUR * Math.max(0, step / loop.pitch - CHAIN_BLUR_FROM);
    const saw = arm.saw;
    this.sawMatrix.compose(saw.position, saw.quaternion, saw.scale);
    let n = first;
    for (let k = 0; k < loop.links; k++) {
      if (!loop.place(arm.chainAt + k * loop.pitch, (k & 1) === 1, stretch, this.linkMatrix)) continue;
      this.chain.setMatrixAt(n++, this.linkMatrix.premultiply(this.sawMatrix));
    }
    return n;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
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
function sawArmsMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.3 });
}

/** The arms' mesh as a saw tower builds it, one vertebra, for the load-time warm-up (ThreeTowerRenderer.warmUpObjects) */
export function sawArmsWarmUp(): Object3D {
  const mesh = new InstancedMesh(vertebraGeometry(), sawArmsMaterial(), 1);
  mesh.frustumCulled = false;
  return mesh;
}

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
