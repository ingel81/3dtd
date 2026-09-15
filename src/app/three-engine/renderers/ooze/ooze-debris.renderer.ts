import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OOZE_DEATH_LOOK } from '../../../configs/visual-effects.config';
import { DrawGate } from '../draw-gate';

/** What a killed ooze had swallowed and throws up again, see OOZE_DEBRIS_DECK */
export type OozeDebrisKind =
  | 'bone' | 'rib' | 'skull' | 'teeth' | 'helmet' | 'scrap' | 'boot' | 'sign' | 'can'
  | 'ribcage' | 'spine' | 'tire' | 'cone' | 'barrel' | 'bottle';

const KINDS: readonly OozeDebrisKind[] = [
  'bone', 'rib', 'skull', 'teeth', 'helmet', 'scrap', 'boot', 'sign', 'can',
  'ribcage', 'spine', 'tire', 'cone', 'barrel', 'bottle',
];

/**
 * The order the pieces of a collapse come in, round after round: the first
 * five give even a short body bones, a rib, a skull and a jaw, the first ten
 * a helmet, a ribcage, a stop sign and a can too; a full body (128 pieces)
 * gets four rounds, 24 bones, 12 ribs, 12 skulls, 8 each of jaws, helmets,
 * ribcages, stop signs, cans, traffic cones, scraps of metal and boots, and
 * 4 each of spines, tyres, oil drums and bottles.
 */
export const OOZE_DEBRIS_DECK: readonly OozeDebrisKind[] = [
  'bone', 'rib', 'skull', 'bone', 'teeth', 'helmet', 'ribcage', 'bone', 'sign', 'can',
  'cone', 'skull', 'rib', 'scrap', 'bone', 'boot', 'spine', 'teeth', 'tire', 'bone',
  'barrel', 'rib', 'skull', 'bottle', 'helmet', 'sign', 'scrap', 'ribcage', 'can', 'boot',
  'cone', 'bone',
];

/** Rounds of the deck each kind's pool holds: two full bodies at once and some */
const POOL_ROUNDS = 10;

/**
 * A piece landing faster than this (m/s) bounces once, back up at BOUNCE
 * of that speed, with BOUNCE_KEEP of its speed out and of its spin
 */
const BOUNCE_MIN = 3;
const BOUNCE = 0.3;
const BOUNCE_KEEP = 0.5;
/** Height of a lying piece's centre over the ground, per metre of its scale */
const REST_LIFT = 0.06;
/** How deep a piece sinks, per metre of its scale */
const SINK_DEPTH = 0.5;
/** The heavy pieces fly lower */
const HEAVY = new Set<OozeDebrisKind>(['skull', 'helmet', 'boot', 'sign', 'tire', 'barrel']);

const BONE = 0xd9ccae;
const TOOTH = 0xf1ead6;
const SOCKET = 0x1c1510;
const HELMET = 0x4a5a2e;
const HELMET_RIM = 0x39461f;
const RUST = 0x7b4a2b;
const METAL = 0x8c9298;
const LEATHER = 0x3d2b1f;
const SOLE = 0x16120f;
const SIGN_RED = 0xb1221d;
const SIGN_WHITE = 0xe8e8e8;
const POST = 0x9aa0a6;
const TIN = 0xa9b1b8;
const LABEL = 0x2e5fa8;
const RUBBER = 0x1b1b1b;
const HUB = 0x6d7278;
const CONE_ORANGE = 0xe8611a;
const CONE_WHITE = 0xf2f2f2;
const CONE_BASE = 0x2a2a2a;
const DRUM = 0x2f4f8f;
const DRUM_RING = 0x24407a;
const GLASS = 0x2f6b3a;
const CAP = 0xc9a227;

/** `geometry` in one vertex colour and without UVs, so the parts of a piece merge. */
function part(geometry: BufferGeometry, color: number): BufferGeometry {
  geometry.deleteAttribute('uv');
  const c = new Color(color);
  const n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('ooze debris: parts do not merge');
  return merged;
}

/** The low-poly pieces at their natural size (m), centred on their origin. */
const PIECES: Record<OozeDebrisKind, () => BufferGeometry> = {
  // A long bone: the shaft and a double knob at each end
  bone: () => merge([
    part(new CylinderGeometry(0.045, 0.04, 0.5, 6), BONE),
    part(new SphereGeometry(0.06, 6, 4).translate(0.035, 0.25, 0), BONE),
    part(new SphereGeometry(0.06, 6, 4).translate(-0.035, 0.25, 0), BONE),
    part(new SphereGeometry(0.055, 6, 4).translate(0.03, -0.25, 0), BONE),
    part(new SphereGeometry(0.055, 6, 4).translate(-0.03, -0.25, 0), BONE),
  ]),
  // A rib: a thin arc
  rib: () => merge([part(new TorusGeometry(0.24, 0.025, 4, 10, Math.PI * 0.85), BONE)]),
  // A skull: the cranium, the jaw block, two dark sockets and the nose
  skull: () => merge([
    part(new SphereGeometry(0.15, 10, 8).scale(0.9, 0.95, 1.1).translate(0, 0.04, 0), BONE),
    part(new BoxGeometry(0.15, 0.08, 0.1).translate(0, -0.08, 0.07), BONE),
    part(new SphereGeometry(0.035, 6, 4).translate(0.05, 0.03, 0.14), SOCKET),
    part(new SphereGeometry(0.035, 6, 4).translate(-0.05, 0.03, 0.14), SOCKET),
    part(new SphereGeometry(0.018, 4, 3).translate(0, -0.02, 0.155), SOCKET),
  ]),
  // A lower jaw with its teeth standing up along it
  teeth: () => {
    const parts = [part(new TorusGeometry(0.09, 0.022, 4, 8, Math.PI).rotateX(Math.PI / 2), BONE)];
    for (let i = 0; i < 7; i++) {
      const a = ((i + 0.5) / 7) * Math.PI;
      parts.push(part(new ConeGeometry(0.014, 0.05, 4).translate(Math.cos(a) * 0.09, 0.035, Math.sin(a) * 0.09), TOOTH));
    }
    return merge(parts);
  },
  // A soldier's helmet: the open dome and its rim
  helmet: () => merge([
    part(new SphereGeometry(0.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), HELMET),
    part(new TorusGeometry(0.2, 0.02, 4, 14).rotateX(Math.PI / 2), HELMET_RIM),
  ]),
  // A sheet of metal bent along one edge
  scrap: () => merge([
    part(new BoxGeometry(0.36, 0.015, 0.24), RUST),
    part(new BoxGeometry(0.22, 0.015, 0.24).translate(0.11, 0, 0).rotateZ(0.6).translate(0.18, 0, 0), METAL),
  ]),
  // A boot: the sole, the foot and the shaft over the heel
  boot: () => merge([
    part(new BoxGeometry(0.12, 0.035, 0.3), SOLE),
    part(new BoxGeometry(0.11, 0.08, 0.2).translate(0, 0.055, 0.04), LEATHER),
    part(new CylinderGeometry(0.06, 0.065, 0.22, 8).translate(0, 0.2, -0.08), LEATHER),
  ]),
  // A stop sign on a broken-off post: the red octagon on a white one
  sign: () => merge([
    part(new CylinderGeometry(0.22, 0.22, 0.02, 8).rotateX(Math.PI / 2).translate(0, 0.45, 0), SIGN_RED),
    part(new CylinderGeometry(0.235, 0.235, 0.012, 8).rotateX(Math.PI / 2).translate(0, 0.45, -0.008), SIGN_WHITE),
    part(new CylinderGeometry(0.025, 0.025, 0.9, 5).translate(0, -0.05, -0.03), POST),
  ]),
  // A tin can with a label
  can: () => merge([
    part(new CylinderGeometry(0.06, 0.06, 0.16, 8), TIN),
    part(new CylinderGeometry(0.062, 0.062, 0.08, 8), LABEL),
  ]),
  // A ribcage: the spine and four pairs of ribs arching over it, shorter towards the bottom
  ribcage: () => {
    const parts = [part(new CylinderGeometry(0.03, 0.03, 0.56, 5).rotateX(Math.PI / 2).translate(0, 0.17, 0), BONE)];
    for (let i = 0; i < 4; i++) {
      const r = 0.19 - i * 0.02;
      parts.push(part(new TorusGeometry(r, 0.02, 4, 10, Math.PI).translate(0, 0.17 - r, -0.2 + i * 0.13), BONE));
    }
    return merge(parts);
  },
  // A piece of spine: six vertebrae with their spurs, bent a little
  spine: () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 0.075;
      const x = 0.03 * Math.sin(i * 0.8);
      parts.push(part(new CylinderGeometry(0.045, 0.045, 0.05, 6).translate(x, y, 0), BONE));
      parts.push(part(new BoxGeometry(0.02, 0.03, 0.07).translate(x, y, -0.06), BONE));
    }
    return merge(parts);
  },
  // A car tyre on the rim of its wheel
  tire: () => merge([
    part(new TorusGeometry(0.27, 0.1, 6, 14), RUBBER),
    part(new CylinderGeometry(0.18, 0.18, 0.12, 10).rotateX(Math.PI / 2), HUB),
  ]),
  // A traffic cone on its square base, with a white band
  cone: () => merge([
    part(new ConeGeometry(0.15, 0.56, 10).translate(0, 0.02, 0), CONE_ORANGE),
    part(new CylinderGeometry(0.075, 0.095, 0.09, 10).translate(0, 0.02, 0), CONE_WHITE),
    part(new BoxGeometry(0.36, 0.04, 0.36).translate(0, -0.26, 0), CONE_BASE),
  ]),
  // An oil drum with two rolling rings
  barrel: () => merge([
    part(new CylinderGeometry(0.22, 0.22, 0.62, 12), DRUM),
    part(new TorusGeometry(0.225, 0.016, 4, 12).rotateX(Math.PI / 2).translate(0, 0.16, 0), DRUM_RING),
    part(new TorusGeometry(0.225, 0.016, 4, 12).rotateX(Math.PI / 2).translate(0, -0.16, 0), DRUM_RING),
  ]),
  // A glass bottle with its cap
  bottle: () => merge([
    part(new CylinderGeometry(0.05, 0.05, 0.2, 8), GLASS),
    part(new CylinderGeometry(0.018, 0.048, 0.09, 8).translate(0, 0.145, 0), GLASS),
    part(new CylinderGeometry(0.021, 0.021, 0.02, 6).translate(0, 0.2, 0), CAP),
  ]),
};

interface Piece {
  /** Where it was thrown from and how fast, local */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Height of its centre lying on the ground, local */
  restY: number;
  /** Game seconds since it was thrown */
  age: number;
  /** Its age when it first lands, and when it lands again after its bounce (the same without one) */
  land: number;
  settle: number;
  /** Speed up out of the bounce (m/s), 0 without one */
  bounceVy: number;
  /** Seconds it lies on the ground before it sinks */
  rest: number;
  readonly axis: Vector3;
  /** Its turn about `axis` when thrown (rad), and how fast it spins there while it flies (rad/s) */
  turn: number;
  spin: number;
  /** Scale over the natural size */
  size: number;
  /** Slime on it: white, or a green tint over the vertex colours */
  readonly tint: Color;
}

function newPiece(): Piece {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, restY: 0,
    age: 0, land: 0, settle: 0, bounceVy: 0, rest: 0,
    axis: new Vector3(0, 1, 0), turn: 0, spin: 0, size: 1, tint: new Color(1, 1, 1),
  };
}

/**
 * `p` at its age, in closed form: the arc of its throw, the one bounce,
 * the rest and the sinking. The frames only sample it, so a piece flies
 * the same arc and lands in the same place at any timescale. Its place
 * (sunk in) into `out`, its turn into `turn`. @returns its scale
 */
function pose(p: Piece, out: Vector3, turn: Quaternion): number {
  const look = OOZE_DEATH_LOOK.debris;
  const g = look.gravity;
  const a = p.age;
  // Seconds of the throw's speed out and of its spin gone by
  let travel: number;
  let y: number;
  if (a < p.land) {
    travel = a;
    y = p.y + (p.vy - 0.5 * g * a) * a;
  } else if (a < p.settle) {
    const b = a - p.land;
    travel = p.land + BOUNCE_KEEP * b;
    y = p.restY + (p.bounceVy - 0.5 * g * b) * b;
  } else {
    travel = p.land + BOUNCE_KEEP * (p.settle - p.land);
    y = p.restY;
  }
  const sunk = Math.min(1, Math.max(0, (a - p.settle - p.rest) / look.sink));
  out.set(p.x + p.vx * travel, y - sunk * p.size * SINK_DEPTH, p.z + p.vz * travel);
  turn.setFromAxisAngle(p.axis, p.turn + p.spin * travel);
  return p.size * (1 - 0.5 * sunk);
}

/**
 * The debris a killed ooze throws up as its band collapses
 * (OOZE_DEATH_LOOK.debris, planned by planOozeDeath): bones, ribs, skulls,
 * jaws with teeth, ribcages, spines and what else it swallowed, helmets,
 * scrap metal, boots, stop signs, cans, traffic cones, tyres, oil drums,
 * bottles. Procedural low-poly pieces in vertex colours,
 * some with a green tint of slime; one InstancedMesh per kind with a fixed
 * pool (OOZE_DEBRIS_DECK times POOL_ROUNDS) and a DrawGate, so a kind with
 * nothing out costs no draw call and the load-time warm-up compiles the one
 * shared material. A piece flies, spins, bounces once, lies a few seconds
 * and sinks into the ground, all in game time and in closed form of its age
 * (pose), so a kill at 4x leaves the debris where it would at 1x. A kind
 * whose pieces all lie still costs no upload. Visual only.
 */
export class OozeDebrisRenderer {
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.1,
    // The helmet is an open dome
    side: DoubleSide,
  });
  private readonly meshes: InstancedMesh[] = [];
  private readonly gates: DrawGate[] = [];
  /** Pieces out per kind; slot i of the kind's mesh draws live[k][i] */
  private readonly live: Piece[][] = [];
  private readonly spare: Piece[][] = [];
  /** Per kind: a piece launched since the last update */
  private readonly added: boolean[] = [];
  private liveCount = 0;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();

  constructor(private readonly scene: Scene) {
    for (const kind of KINDS) {
      const capacity = OOZE_DEBRIS_DECK.filter((k) => k === kind).length * POOL_ROUNDS;
      const mesh = new InstancedMesh(PIECES[kind](), this.material, capacity);
      mesh.name = `ooze-debris-${kind}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // Creates the colour attribute now, so the warm-up builds the program with it
      mesh.setColorAt(0, new Color(1, 1, 1));
      mesh.instanceColor?.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      // The pieces spread over the whole body; the geometry's bounds are one piece's
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.gates.push(new DrawGate([mesh]));
      this.live.push([]);
      this.added.push(false);
      this.spare.push(Array.from({ length: capacity }, newPiece));
    }
  }

  /** Pieces flying or lying */
  get count(): number {
    return this.liveCount;
  }

  /** Pieces of `kind` flying or lying */
  countOf(kind: OozeDebrisKind): number {
    return this.live[KINDS.indexOf(kind)].length;
  }

  /** Draw calls this frame: one per kind with a piece out */
  get drawCalls(): number {
    let calls = 0;
    for (const mesh of this.meshes) if (mesh.visible) calls++;
    return calls;
  }

  /**
   * A piece of `kind` thrown up from local (x, y, z) over ground at local
   * `groundY`, where (rightX, rightZ) points across the route; its throw
   * drawn from `random`, `age` seconds ago (a frame at a high timescale
   * lets it go late). Drawn from the next update on.
   * @returns false when that kind's pool is full
   */
  launch(
    kind: OozeDebrisKind,
    x: number,
    y: number,
    z: number,
    groundY: number,
    rightX: number,
    rightZ: number,
    random: () => number = Math.random,
    age = 0,
  ): boolean {
    const k = KINDS.indexOf(kind);
    const p = this.spare[k].pop();
    if (!p) return false;
    const look = OOZE_DEATH_LOOK.debris;
    // Some pieces the collapse spits up high, the rest it throws wide, more along the street than across
    const high = random() < look.highShare;
    const angle = random() * Math.PI * 2;
    const out = high ? look.highOut * random() : look.outMin + (look.outMax - look.outMin) * random();
    const along = Math.cos(angle) * out;
    const across = Math.sin(angle) * out * look.across;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = -rightZ * along + rightX * across;
    p.vz = rightX * along + rightZ * across;
    const up = high ? look.highMin + (look.highMax - look.highMin) * random() : look.upMin + (look.upMax - look.upMin) * random();
    p.vy = up * (HEAVY.has(kind) ? 0.8 : 1);
    p.axis.set(random() - 0.5, random() - 0.5, random() - 0.5);
    if (p.axis.lengthSq() < 1e-6) p.axis.set(0, 1, 0);
    p.axis.normalize();
    p.spin = look.spin * (0.3 + 0.7 * random());
    p.turn = random() * Math.PI * 2;
    p.size = look.scale * (look.sizeMin + (look.sizeMax - look.sizeMin) * random());
    p.restY = groundY + REST_LIFT * p.size;
    p.rest = look.restMin + (look.restMax - look.restMin) * random();
    // The arc down to its resting height, then one bounce if it lands hard
    const g = look.gravity;
    p.land = (p.vy + Math.sqrt(p.vy * p.vy + 2 * g * Math.max(0, y - p.restY))) / g;
    const impact = g * p.land - p.vy;
    p.bounceVy = impact > BOUNCE_MIN ? impact * BOUNCE : 0;
    p.settle = p.land + (2 * p.bounceVy) / g;
    p.age = age;
    const slime = 0.45 * random();
    p.tint.setRGB(1 - 0.45 * slime, 1, 1 - 0.55 * slime);
    this.live[k].push(p);
    this.added[k] = true;
    this.liveCount++;
    return true;
  }

  /**
   * Once per render frame, `dt` game seconds: every piece ages, the sunk
   * ones go back to their pool. A kind's instances are written and uploaded
   * only while one of its pieces flies or sinks or one came or went.
   */
  update(dt: number): void {
    if (this.liveCount === 0 || dt <= 0) return;
    const sink = OOZE_DEATH_LOOK.debris.sink;
    for (let k = 0; k < KINDS.length; k++) {
      const live = this.live[k];
      if (live.length === 0) continue;
      const added = this.added[k];
      this.added[k] = false;
      let moved = added;
      let gone = false;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        const from = p.age;
        p.age += dt;
        if (p.age >= p.settle + p.rest + sink) {
          this.spare[k].push(p);
          live[i] = live[live.length - 1];
          live.pop();
          this.liveCount--;
          gone = true;
        } else if (from < p.settle || p.age > p.settle + p.rest) {
          moved = true;
        }
      }
      const mesh = this.meshes[k];
      if (moved || gone) {
        for (let i = 0; i < live.length; i++) {
          this.scale.setScalar(pose(live[i], this.position, this.quaternion));
          this.matrix.compose(this.position, this.quaternion, this.scale);
          mesh.setMatrixAt(i, this.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (added || gone) {
        for (let i = 0; i < live.length; i++) mesh.setColorAt(i, live[i].tint);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      mesh.count = live.length;
      this.gates[k].setCount(live.length);
    }
  }

  /** Every piece gone at once (reset). */
  clear(): void {
    for (let k = 0; k < KINDS.length; k++) {
      const live = this.live[k];
      for (const p of live) this.spare[k].push(p);
      live.length = 0;
      this.added[k] = false;
      this.meshes[k].count = 0;
      this.gates[k].setCount(0);
    }
    this.liveCount = 0;
  }

  dispose(): void {
    this.clear();
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }
}
