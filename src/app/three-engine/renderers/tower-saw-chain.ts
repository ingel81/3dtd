import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Radius of the chain's run about its bar, at the links' middle, model units: the modelled teeth reach 0.125 */
const RUN_RADIUS = 0.09;
/** The modelled teeth are pressed in to this distance from the bar's middle line; the running chain covers it */
const FLAT_RADIUS = 0.085;
/** The loop goes on this far behind the bar's start, into the motor housing, where its back turn stays hidden */
const BACK = 0.12;
/** Links behind the bar's start by more than this sit in the housing and are not drawn, model units */
const HIDDEN_BEHIND = 0.03;
/** One link of the chain, model units: about 36 to a loop */
export const CHAIN_PITCH = 0.042;

/** A saw's bar, in the saw's own frame (glTF units): the middle line from where it leaves the housing to its nose, and its face */
export interface SawBar {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  normal: readonly [number, number, number];
}

/**
 * The loop a chain runs on around one bar, a stadium in the bar's plane:
 * out along one edge to the nose, round it, back along the other edge and
 * round the drive sprocket in the housing. `place` gives a link's frame at
 * a distance along the loop.
 */
export class ChainLoop {
  readonly perimeter: number;
  /** Links on the loop, a whole number so it closes; and the pitch that makes it so */
  readonly links: number;
  readonly pitch: number;
  private readonly back = new Vector3();
  private readonly nose = new Vector3();
  private readonly dir = new Vector3();
  private readonly side = new Vector3();
  private readonly straight: number;
  private readonly turn: number;
  private readonly tangent = new Vector3();
  private readonly radial = new Vector3();
  private readonly face = new Vector3();
  private readonly at = new Vector3();

  constructor(bar: SawBar) {
    const from = new Vector3(...bar.from);
    this.nose.set(...bar.to);
    this.dir.subVectors(this.nose, from).normalize();
    this.side.crossVectors(this.dir, new Vector3(...bar.normal)).normalize();
    this.back.copy(from).addScaledVector(this.dir, -BACK);
    this.straight = this.back.distanceTo(this.nose);
    this.turn = Math.PI * RUN_RADIUS;
    this.perimeter = 2 * this.straight + 2 * this.turn;
    this.links = Math.max(4, Math.round(this.perimeter / CHAIN_PITCH));
    this.pitch = this.perimeter / this.links;
  }

  /**
   * The frame of a link `s` along the loop into `out` (x along the run, y
   * out from the bar, z its face), stretched by `stretch` along the run;
   * false where the link sits in the housing and is not drawn.
   */
  place(s: number, flip: boolean, stretch: number, out: Matrix4): boolean {
    const { straight, turn, dir, side, tangent, radial, at } = this;
    s = ((s % this.perimeter) + this.perimeter) % this.perimeter;
    if (s < straight) {
      tangent.copy(dir);
      radial.copy(side);
      at.copy(this.back).addScaledVector(dir, s);
    } else if (s < straight + turn) {
      const a = (s - straight) / RUN_RADIUS;
      const c = Math.cos(a);
      const n = Math.sin(a);
      radial.copy(side).multiplyScalar(c).addScaledVector(dir, n);
      tangent.copy(dir).multiplyScalar(c).addScaledVector(side, -n);
      at.copy(this.nose);
    } else if (s < 2 * straight + turn) {
      tangent.copy(dir).negate();
      radial.copy(side).negate();
      at.copy(this.nose).addScaledVector(dir, straight + turn - s);
    } else {
      const a = (s - 2 * straight - turn) / RUN_RADIUS;
      const c = Math.cos(a);
      const n = Math.sin(a);
      radial.copy(side).multiplyScalar(-c).addScaledVector(dir, -n);
      tangent.copy(dir).multiplyScalar(-c).addScaledVector(side, n);
      at.copy(this.back);
    }
    at.addScaledVector(radial, RUN_RADIUS);
    // In the housing: not drawn
    if (this.face.subVectors(at, this.back).dot(dir) < BACK - HIDDEN_BEHIND) return false;
    // Every other link turned about its radial, so its cutter sits on the other face
    if (flip) tangent.negate();
    this.face.crossVectors(tangent, radial);
    tangent.multiplyScalar(stretch);
    out.makeBasis(tangent, radial, this.face).setPosition(at);
    return true;
  }
}

const chainless = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * The saw's mesh with its modelled teeth pressed into the bar (every vertex
 * of the bar farther than FLAT_RADIUS from its middle line, out past the
 * housing, moved in to it), so the running chain is the only chain; made
 * once per source geometry and shared by every tower. Only the positions are
 * its own, the other attributes and the index are the source's.
 */
export function chainlessGeometry(source: BufferGeometry, bar: SawBar): BufferGeometry {
  const known = chainless.get(source);
  if (known) return known;
  const from = new Vector3(...bar.from);
  const to = new Vector3(...bar.to);
  const normal = new Vector3(...bar.normal).normalize();
  const dir = new Vector3().subVectors(to, from);
  const length = dir.length();
  dir.normalize();
  const position = source.getAttribute('position');
  const positions = new Float32Array(position.count * 3);
  const p = new Vector3();
  const rel = new Vector3();
  const core = new Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    rel.subVectors(p, from);
    const u = rel.dot(dir);
    if (u > 0.01) {
      const n = rel.dot(normal);
      // Off the middle line in the bar's plane
      core.copy(from).addScaledVector(dir, Math.min(u, length)).addScaledVector(normal, n);
      rel.subVectors(p, core);
      const d = rel.length();
      if (d > FLAT_RADIUS) p.copy(core).addScaledVector(rel, FLAT_RADIUS / d);
    }
    p.toArray(positions, i * 3);
  }
  const geometry = new BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, name === 'position' ? new BufferAttribute(positions, 3) : source.getAttribute(name));
  }
  geometry.setIndex(source.getIndex());
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  chainless.set(source, geometry);
  return geometry;
}

/**
 * One link of the chain (x along the run, y out from the bar, z its face):
 * two steel side plates astride the bar's edge and an orange cutter, an L
 * of a plate up the +z face and a top plate over the chain that drops to
 * its back, a hook sharp at the front. Every other link is turned
 * (ChainLoop.place), so the cutters sit left and right in turn.
 */
export function chainLinkGeometry(): BufferGeometry {
  const steel = new Color(0.36, 0.36, 0.38);
  const orange = new Color(0.9, 0.36, 0.06);
  const parts = [
    part(new BoxGeometry(0.034, 0.022, 0.007), 0, -0.003, -0.022, steel),
    part(new BoxGeometry(0.034, 0.022, 0.007), 0, -0.003, 0.022, steel),
    part(new BoxGeometry(0.026, 0.03, 0.008), 0.002, 0.012, 0.027, orange),
    hook(part(new BoxGeometry(0.024, 0.008, 0.032), 0.002, 0.028, 0.012, orange)),
  ];
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  merged.computeVertexNormals();
  for (const p of parts) p.dispose();
  return merged;
}

/** The chain's steel and cutters: worn metal, lighter than the arms' so the orange reads (a program the arms share) */
export function chainMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 });
}

/** The top plate's back edge dropped below its front: the cutter's hook */
function hook(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) < 0) position.setY(i, position.getY(i) - 0.009);
  }
  return geometry;
}

function part(geometry: BoxGeometry, x: number, y: number, z: number, color: Color): BufferGeometry {
  geometry.translate(x, y, z);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}
