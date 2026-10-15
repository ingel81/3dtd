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
/** Share of the way out or home an arm goes per second */
const REACH_SPEED = 2.5;
/** Extended, a saw grows this much to read on arms this thick; docked it is as built */
const SAW_GROWTH = 0.25;
/** Extended, the saw's bar points this far down into the target, rad */
const SAW_TILT = (15 * Math.PI) / 180;
/** The saw's mount stops this far short of the target, model units: the bar reaches into it */
const SAW_STANDOFF = 0.42;
/** Points along an arm's curve to measure its length */
const SAMPLES = 24;

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

interface Arm {
  saw: Object3D | null;
  socket: Vector3;
  out: Vector3;
  axis: Vector3;
  lift: number;
  /** The saw's docked place and turn, as the model has it */
  restPosition: Vector3;
  restQuaternion: Quaternion;
  /** 0 docked to 1 out at its target */
  reach: number;
  /** Where it cuts, in the turret's frame; kept while it goes home */
  target: Vector3;
  hasTarget: boolean;
}

/**
 * The Chainsaw's robot arms (TowerTypeConfig.sawArms), drawn under the
 * tower's turret part in its frame (model units): each a cubic Bezier from
 * its socket on the torso to its saw, a chain of vertebrae along it (one
 * InstancedMesh for all three, more vertebrae the longer it is), the saw
 * turned along the curve's end. Docked the saws hang where the model has
 * them; with a target an arm goes out across the road in a fraction of a
 * second, the saw over the asphalt and its bar tilted into the enemy, and
 * comes home without one. Purely visual: the simulation deals the damage
 * (TowerCombatService.updateSawTowers) and sends where each arm cuts once a
 * frame (`towers.setSawTargets`).
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
  private time = 0;

  constructor(config: TowerTypeConfig, private readonly turret: Object3D) {
    const specs = config.sawArms ?? [];
    this.arms = specs.map((spec) => {
      const saw = turret.getObjectByName(spec.node) ?? null;
      return {
        saw,
        socket: new Vector3(...spec.socket),
        out: new Vector3(...spec.out).normalize(),
        axis: new Vector3(...spec.axis).normalize(),
        lift: spec.lift,
        restPosition: saw ? saw.position.clone() : new Vector3(...spec.socket),
        restQuaternion: saw ? saw.quaternion.clone() : new Quaternion(),
        reach: 0,
        target: new Vector3(),
        hasTarget: false,
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
   * Where each arm cuts this frame (world positions, one per arm, null: that
   * arm goes home); an empty list sends every arm home.
   */
  setTargets(targets: readonly (Vector3 | null)[]): void {
    this.turret.updateWorldMatrix(true, false);
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      const target = targets[i] ?? null;
      arm.hasTarget = target !== null;
      if (target) arm.target.copy(target).applyMatrix4(this.matrix.copy(this.turret.matrixWorld).invert());
    }
  }

  /** Once per render frame: the arms go out or home and are drawn where they are. */
  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    let count = 0;
    for (const arm of this.arms) {
      const step = REACH_SPEED * deltaSeconds;
      arm.reach = arm.hasTarget ? Math.min(1, arm.reach + step) : Math.max(0, arm.reach - step);
      count = this.drawArm(arm, count);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }

  /** Curve, saw and vertebrae of one arm; returns the instances used so far. */
  private drawArm(arm: Arm, first: number): number {
    const reach = smooth(arm.reach);
    const { p0, p1, p2, p3, dir, endDir } = this;
    p0.copy(arm.socket);
    // Out at its target: the mount short of it, the bar tilted down into it
    dir.subVectors(arm.target, p0).setY(0);
    if (dir.lengthSq() < 1e-6) dir.copy(arm.out).setY(0);
    dir.normalize();
    endDir.set(dir.x, -Math.tan(SAW_TILT), dir.z).normalize();
    const out = this.tmp.copy(arm.target).addScaledVector(endDir, -SAW_STANDOFF);
    p3.lerpVectors(arm.restPosition, out, reach);
    // Small shake while it cuts
    if (arm.hasTarget && arm.reach >= 1) {
      p3.x += Math.sin(this.time * 61 + arm.lift * 13) * 0.012;
      p3.y += Math.sin(this.time * 47 + arm.lift * 7) * 0.012;
    }
    endDir.lerpVectors(arm.axis, endDir, reach).normalize();
    const span = p0.distanceTo(p3);
    p1.copy(p0).addScaledVector(arm.out, span * 0.35).addScaledVector(UP, arm.lift * span * reach);
    p2.copy(p3).addScaledVector(endDir, -span * 0.35);

    if (arm.saw) {
      arm.saw.position.copy(p3);
      arm.saw.quaternion.setFromUnitVectors(arm.axis, endDir).multiply(arm.restQuaternion);
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
