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
export type OozeDebrisKind = 'bone' | 'rib' | 'skull' | 'teeth' | 'helmet' | 'scrap' | 'boot' | 'sign' | 'can';

const KINDS: readonly OozeDebrisKind[] = ['bone', 'rib', 'skull', 'teeth', 'helmet', 'scrap', 'boot', 'sign', 'can'];

/**
 * The order the pieces of a collapse come in, round after round: the first
 * five give even a short body bones, a rib, a skull and a jaw; a full body
 * (60 pieces) gets three rounds, 18 bones, 12 ribs, 6 skulls, 6 jaws, 6
 * scraps of metal and 3 each of helmets, boots, signs and cans.
 */
export const OOZE_DEBRIS_DECK: readonly OozeDebrisKind[] = [
  'bone', 'rib', 'skull', 'bone', 'teeth', 'helmet', 'rib', 'bone', 'scrap', 'boot',
  'bone', 'teeth', 'rib', 'sign', 'bone', 'can', 'skull', 'rib', 'scrap', 'bone',
];

/** Rounds of the deck each kind's pool holds: two full bodies at once and some */
const POOL_ROUNDS = 8;

/** Longest step of the flight (s), so a frame at a high timescale does not fly through the ground */
const STEP_S = 0.05;
/** A piece landing faster than this (m/s) bounces once, keeping BOUNCE of its speed */
const BOUNCE_MIN = 3;
const BOUNCE = 0.3;
/** Height of a lying piece's centre over the ground, per metre of its scale */
const REST_LIFT = 0.06;
/** How deep a piece sinks, per metre of its scale */
const SINK_DEPTH = 0.5;
/** The heavy pieces fly lower */
const HEAVY = new Set<OozeDebrisKind>(['skull', 'helmet', 'boot', 'sign']);

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
};

interface Piece {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Height of its centre lying on the ground, local */
  restY: number;
  readonly turn: Quaternion;
  readonly axis: Vector3;
  /** rad/s about `axis` while it flies */
  spin: number;
  /** Scale over the natural size */
  size: number;
  /** Seconds left lying on the ground before it sinks */
  rest: number;
  /** 0 until it sinks, 1 sunk in */
  sunk: number;
  landed: boolean;
  bounced: boolean;
  /** Slime on it: white, or a green tint over the vertex colours */
  readonly tint: Color;
}

function newPiece(): Piece {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, restY: 0,
    turn: new Quaternion(), axis: new Vector3(0, 1, 0), spin: 0, size: 1,
    rest: 0, sunk: 0, landed: false, bounced: false, tint: new Color(1, 1, 1),
  };
}

const spinStep = new Quaternion();

/** `dt` game seconds of a piece: flight, one bounce, rest, sinking. @returns false once it has sunk in */
function step(p: Piece, dt: number): boolean {
  const look = OOZE_DEATH_LOOK.debris;
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, STEP_S);
    left -= h;
    if (!p.landed) {
      p.vy -= look.gravity * h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.z += p.vz * h;
      p.turn.multiply(spinStep.setFromAxisAngle(p.axis, p.spin * h)).normalize();
      if (p.y <= p.restY && p.vy < 0) {
        p.y = p.restY;
        if (!p.bounced && p.vy < -BOUNCE_MIN) {
          p.bounced = true;
          p.vy *= -BOUNCE;
          p.vx *= 0.5;
          p.vz *= 0.5;
          p.spin *= 0.5;
        } else {
          p.landed = true;
        }
      }
    } else if (p.rest > 0) {
      p.rest -= h;
    } else {
      p.sunk += h / look.sink;
      if (p.sunk >= 1) return false;
    }
  }
  return true;
}

/**
 * The debris a killed ooze throws up as its band collapses
 * (OOZE_DEATH_LOOK.debris, planned by planOozeDeath): bones, ribs, skulls,
 * jaws with teeth and what else it swallowed, a helmet, scrap metal, a
 * boot, a stop sign, a can. Procedural low-poly pieces in vertex colours,
 * some with a green tint of slime; one InstancedMesh per kind with a fixed
 * pool (OOZE_DEBRIS_DECK times POOL_ROUNDS) and a DrawGate, so a kind with
 * nothing out costs no draw call and the load-time warm-up compiles the one
 * shared material. A piece flies, spins, bounces once, lies a few seconds
 * and sinks into the ground, all in game time (update). Visual only.
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
  private liveCount = 0;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
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
   * `groundY`. Drawn from the next update on. @returns false when that
   * kind's pool is full
   */
  launch(kind: OozeDebrisKind, x: number, y: number, z: number, groundY: number, random: () => number = Math.random): boolean {
    const k = KINDS.indexOf(kind);
    const p = this.spare[k].pop();
    if (!p) return false;
    const look = OOZE_DEATH_LOOK.debris;
    const angle = random() * Math.PI * 2;
    const out = look.outMin + (look.outMax - look.outMin) * random();
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = Math.cos(angle) * out;
    p.vz = Math.sin(angle) * out;
    p.vy = (look.upMin + (look.upMax - look.upMin) * random()) * (HEAVY.has(kind) ? 0.8 : 1);
    p.axis.set(random() - 0.5, random() - 0.5, random() - 0.5);
    if (p.axis.lengthSq() < 1e-6) p.axis.set(0, 1, 0);
    p.axis.normalize();
    p.spin = look.spin * (0.3 + 0.7 * random());
    p.turn.setFromAxisAngle(p.axis, random() * Math.PI * 2);
    p.size = look.scale * (0.85 + 0.35 * random());
    p.restY = groundY + REST_LIFT * p.size;
    p.rest = look.restMin + (look.restMax - look.restMin) * random();
    p.sunk = 0;
    p.landed = false;
    p.bounced = false;
    const slime = 0.45 * random();
    p.tint.setRGB(1 - 0.45 * slime, 1, 1 - 0.55 * slime);
    this.live[k].push(p);
    this.liveCount++;
    return true;
  }

  /** Once per render frame, `dt` game seconds: every piece moves on, the sunk ones go back to their pool. */
  update(dt: number): void {
    if (this.liveCount === 0 || dt <= 0) return;
    for (let k = 0; k < KINDS.length; k++) {
      const live = this.live[k];
      if (live.length === 0) continue;
      for (let i = live.length - 1; i >= 0; i--) {
        if (step(live[i], dt)) continue;
        this.spare[k].push(live[i]);
        live[i] = live[live.length - 1];
        live.pop();
        this.liveCount--;
      }
      const mesh = this.meshes[k];
      for (let i = 0; i < live.length; i++) {
        const p = live[i];
        this.position.set(p.x, p.y - p.sunk * p.size * SINK_DEPTH, p.z);
        this.scale.setScalar(p.size * (1 - 0.5 * p.sunk));
        this.matrix.compose(this.position, p.turn, this.scale);
        mesh.setMatrixAt(i, this.matrix);
        mesh.setColorAt(i, p.tint);
      }
      mesh.count = live.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.gates[k].setCount(live.length);
    }
  }

  /** Every piece gone at once (reset). */
  clear(): void {
    for (let k = 0; k < KINDS.length; k++) {
      const live = this.live[k];
      for (const p of live) this.spare[k].push(p);
      live.length = 0;
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
