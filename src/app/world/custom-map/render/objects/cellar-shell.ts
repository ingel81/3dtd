import { BufferAttribute, BufferGeometry, Vector3, type Material } from 'three';
import type { ModelPart } from '../map-asset-library';
import { CELLAR_STOREY, MAX_CELLAR_STOREYS } from '../../object-cellar';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import { compact } from './merge-parts';
import { isWindowGlass } from './night-windows';

/**
 * The cellar of a catalogue building (docs/CUSTOM_MAPS.md "Keller";
 * MapObject.cellar, object-cellar.ts) as part of its model: the model's foot
 * carried on down, its openings in the model's window raster, built once
 * per model when it loads and drawn with it in its own draws.
 *
 * The foot: the lowest ring of upright faces (a plinth reaching into the
 * ground, or the stone of an old town's ground storey). Its vertices at the
 * bottom go down to the cellar's foot, each instance as deep as its cellar
 * (`aCellarOf`, written per object by the object layer), the faces' texture
 * running on (`aCellar`: the change of uv per metre down). So the plinth
 * runs down to the cellar's foot in its own surface where the house has
 * one, the wall where its foot is the wall, flush with it: the wall's colour
 * ends at the plinth's top, as it does on the house. The ground hides what
 * lies in it; on level ground all of it.
 *
 * The openings: under each window of the ground floor a cellar window in
 * every cellar storey, in the model's own frame and glass, and on each wall
 * the one nearest its middle a door as well, in the model's door. Each is
 * built as four corners on one point (`aCellar`: their offsets along the
 * wall and down, the storey) and opened by the vertex shader where the
 * storey stands free of the ground under it (the height texture the
 * terrain's mesh is drawn from, at the window): a window where the ground
 * lies under its sill with room to spare, the door where the ground meets
 * the storey's floor, and never in a buried cellar (MapObject.cellar
 * `buried`) or a storey below its last. Closed they draw nothing and cast
 * nothing; the sun's shadow sees the model as it was built, so the cellar
 * casts no new shadow on the slope.
 */

/** `aCellar` per vertex: (kind, a, b, storey); kinds */
const FOOT = 1;
const WINDOW = 2;
/** A window where the door may stand: closed when the door opens */
const DOOR_SLOT = 2.5;
const DOOR = 3;
/**
 * A house whose cellar wears its wall (aCellarOf.w, cellarPlinthDown): the plinth's top goes down to the lowest
 * ground with it, and the wall's foot standing on it, its texture running on, so the wall's surface covers the
 * cellar and the plinth stands at the foot of the slope
 */
const PLINTH_TOP = 4;
/** A plinth's foot (FOOT on a model with a plinth): under a wall-clad cellar its texture moves with its top */
const PLINTH_FOOT = 1.25;
const WALL_BASE = 5;
/** A foot face: its lowest point at the model's lowest, within this (m) */
const FOOT_NEAR = 0.03;
/** An upright face: its normal's height under this */
const UPRIGHT = 0.15;
/** Above the foot no foot: a model standing on posts or floating has none to go on from */
const FOOT_HIGHEST = 0.05;
/** The ground floor's windows the raster is read from: their glass's middle between these heights, m */
const RASTER_LOW = 0.3;
const RASTER_HIGH = 3;
/** A ground floor window's glass lies at most this far behind its wall's foot (a deep reveal), m */
const PANE_IN_WALL = 1;
/** Cellar windows: most width, height, their top under the storey's ceiling, the frame round the glass; the nearest two may stand */
const WIN = { width: 0.9, height: 0.6, top: 0.35, frame: 0.06, apart: 1.2 } as const;
/** A cellar window opens where the storey stands this free of the ground: its top, its height and room under its sill */
const WINDOW_FREE = WIN.top + WIN.height + 0.2;
/**
 * The door: width, height, frame; it opens where the ground lies this far under the storey's ceiling, from and to:
 * room for it, and at most a few steps under its floor
 */
const DOOR_SIZE = { width: 1.0, height: 2.05, frame: 0.06 } as const;
export const DOOR_FROM = 2.3;
export const DOOR_TO = CELLAR_STOREY + 1;
/** How far in front of the wall the frame, the glass and the door lie, m: apart enough not to fight for depth far off */
const FRAME_OUT = 0.03;
const GLASS_OUT = 0.06;

interface Face {
  part: number;
  ids: [number, number, number];
  p: [Vector3, Vector3, Vector3];
  n: Vector3;
  minY: number;
  maxY: number;
}

/** A wall plane at the foot: its outward normal, its offset along it, its extent along its tangent */
interface FootWall {
  n: Vector3;
  d: number;
  a0: number;
  a1: number;
}

/** A cellar opening on a foot wall: where along the wall, how wide, a door's slot */
interface Slot {
  wall: FootWall;
  along: number;
  width: number;
  door: boolean;
}

/** The tangent along a wall facing `n` (the vertex shader builds the same) */
function tangentOf(n: Vector3): Vector3 {
  return new Vector3(n.z, 0, -n.x);
}

function facesOf(parts: readonly ModelPart[]): Face[] {
  const out: Face[] = [];
  parts.forEach((part, k) => {
    const g = part.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const index = g.getIndex();
    const total = index ? index.count : pos.count;
    const start = Math.max(0, g.drawRange.start);
    const end = Math.min(total, start + (Number.isFinite(g.drawRange.count) ? g.drawRange.count : total));
    for (let i = start; i + 2 < end; i += 3) {
      const ids = [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j)) as [number, number, number];
      const p = ids.map((id) => new Vector3().fromBufferAttribute(pos, id)) as [Vector3, Vector3, Vector3];
      const n = new Vector3().subVectors(p[1], p[0]).cross(new Vector3().subVectors(p[2], p[0]));
      const area = n.length();
      if (area < 1e-8) continue;
      n.divideScalar(area);
      out.push({ part: k, ids, p, n, minY: Math.min(p[0].y, p[1].y, p[2].y), maxY: Math.max(p[0].y, p[1].y, p[2].y) });
    }
  });
  return out;
}

/** The change of a face's uv per metre down its plane (its texture's affine map), null without uv */
function uvPerMetreDown(face: Face, uv: BufferAttribute | null): [number, number] | null {
  if (!uv) return null;
  const [a, b, c] = face.p;
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const d11 = e1.dot(e1);
  const d12 = e1.dot(e2);
  const d22 = e2.dot(e2);
  const det = d11 * d22 - d12 * d12;
  if (Math.abs(det) < 1e-12) return null;
  // One metre straight down on the (upright) plane in the face's own coordinates
  const w = new Vector3(0, -1, 0);
  const w1 = w.dot(e1);
  const w2 = w.dot(e2);
  const s = (d22 * w1 - d12 * w2) / det;
  const t = (d11 * w2 - d12 * w1) / det;
  const [i0, i1, i2] = face.ids;
  return [
    s * (uv.getX(i1) - uv.getX(i0)) + t * (uv.getX(i2) - uv.getX(i0)),
    s * (uv.getY(i1) - uv.getY(i0)) + t * (uv.getY(i2) - uv.getY(i0)),
  ];
}

/**
 * The foot walls of a model: its upright faces at the foot grouped by plane
 * (outward normal and offset), each with its extent along the wall
 */
function footWalls(foot: readonly Face[]): FootWall[] {
  const walls: FootWall[] = [];
  for (const f of foot) {
    if (Math.abs(f.n.y) > UPRIGHT) continue;
    const n = new Vector3(f.n.x, 0, f.n.z).normalize();
    const d = n.dot(f.p[0]);
    const t = tangentOf(n);
    const along = f.p.map((p) => t.dot(p));
    let wall = walls.find((w) => w.n.dot(n) > 0.995 && Math.abs(w.d - d) < 0.05);
    if (!wall) walls.push((wall = { n, d, a0: Infinity, a1: -Infinity }));
    wall.a0 = Math.min(wall.a0, ...along);
    wall.a1 = Math.max(wall.a1, ...along);
  }
  return walls;
}

/**
 * The cellar's openings: under each window of the ground floor (the glass
 * whose middle is between RASTER_LOW and RASTER_HIGH, per wall plane and
 * pane), on the foot wall facing the same way that reaches under it; on each
 * wall the one nearest its middle a door's slot too
 */
function slotsOf(faces: readonly Face[], parts: readonly ModelPart[], walls: readonly FootWall[]): Slot[] {
  const panes: { n: Vector3; d: number; along0: number; along1: number }[] = [];
  for (const f of faces) {
    if (!isWindowGlass(parts[f.part].material.name) || parts[f.part].material.name === 'window') continue;
    if (Math.abs(f.n.y) > UPRIGHT) continue;
    const mid = (f.minY + f.maxY) / 2;
    if (mid < RASTER_LOW || mid > RASTER_HIGH) continue;
    const n = new Vector3(f.n.x, 0, f.n.z).normalize();
    const t = tangentOf(n);
    const along = f.p.map((p) => t.dot(p));
    const a0 = Math.min(...along);
    const a1 = Math.max(...along);
    const d = n.dot(f.p[0]);
    const same = panes.find((p) => p.n.dot(n) > 0.995 && Math.abs(p.d - d) < 0.1 && a0 <= p.along1 + 0.05 && a1 >= p.along0 - 0.05);
    if (same) {
      same.along0 = Math.min(same.along0, a0);
      same.along1 = Math.max(same.along1, a1);
    } else panes.push({ n, d, along0: a0, along1: a1 });
  }
  const slots: Slot[] = [];
  for (const pane of panes) {
    const along = (pane.along0 + pane.along1) / 2;
    // The outermost foot wall facing the same way that reaches under it, the pane in its wall (a pane's inner
    // face, facing into the house, lies the house's depth behind the wall facing that way)
    const wall = walls
      .filter((w) => w.n.dot(pane.n) > 0.995 && along >= w.a0 + 0.5 && along <= w.a1 - 0.5 && Math.abs(w.d - pane.d) < PANE_IN_WALL)
      .sort((a, b) => b.d - a.d)[0];
    if (!wall || slots.some((s) => s.wall === wall && Math.abs(s.along - along) < WIN.apart)) continue;
    slots.push({ wall, along, width: Math.min(WIN.width, pane.along1 - pane.along0), door: false });
  }
  for (const wall of walls) {
    const mid = (wall.a0 + wall.a1) / 2;
    const on = slots.filter((s) => s.wall === wall).sort((a, b) => Math.abs(a.along - mid) - Math.abs(b.along - mid));
    if (on.length) on[0].door = true;
  }
  return slots;
}

/** A foot whose top is no higher than this is a plinth whose cap closes the ground (capRing), m */
const CAP_HIGHEST = 1.5;
/** A wall stands on a plinth's top this far behind its face at most (its ledge; a porch's front before the door), m */
const LEDGE_MOST = 1.5;

/** Where a point of a face's plane lies in a texture coordinate of its (an affine map of the face's own), null without */
function attrAt(face: Face, attr: BufferAttribute | undefined, p: Vector3): [number, number] | null {
  if (!attr || attr.itemSize < 2) return null;
  const [a, b, c] = face.p;
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const w = new Vector3().subVectors(p, a);
  const d11 = e1.dot(e1);
  const d12 = e1.dot(e2);
  const d22 = e2.dot(e2);
  const det = d11 * d22 - d12 * d12;
  if (Math.abs(det) < 1e-12) return null;
  const w1 = w.dot(e1);
  const w2 = w.dot(e2);
  const u = (d22 * w1 - d12 * w2) / det;
  const v = (d11 * w2 - d12 * w1) / det;
  const [i0, i1, i2] = face.ids;
  const at = (c2: number) => attr.getComponent(i0, c2) + u * (attr.getComponent(i1, c2) - attr.getComponent(i0, c2)) + v * (attr.getComponent(i2, c2) - attr.getComponent(i0, c2));
  return [at(0), at(1)];
}

/**
 * A foot part's cap at its top (`top`, model y) taken out and a ring put
 * in along its upright faces' top edges: each edge's ledge from the foot's
 * face in to the wall standing on it (one of `others`, the other parts'
 * faces: an upright face facing the same way at most LEDGE_MOST behind),
 * mitred at the corners, in the cap's own texture. Null where the part has
 * no cap there
 */
function capRing(geometry: BufferGeometry, top: number, others: readonly Face[]): { geometry: BufferGeometry; add: Added } | null {
  const own = facesOf([{ geometry } as ModelPart]);
  const at = (y: number) => Math.abs(y - top) < 0.02;
  const caps = own.filter((f) => f.n.y > 0.9 && at(f.minY) && at(f.maxY));
  if (!caps.length) return null;
  // The edges: the top of each upright face of the part, with its ledge's depth
  const edges: { a: Vector3; b: Vector3; n: Vector3; d: number }[] = [];
  for (const f of own) {
    if (Math.abs(f.n.y) > UPRIGHT) continue;
    const ps = f.p.filter((p) => at(p.y));
    if (ps.length !== 2 || ps[0].distanceToSquared(ps[1]) < 1e-4) continue;
    const n = new Vector3(f.n.x, 0, f.n.z).normalize();
    const face = n.dot(ps[0]);
    // A wall that goes on up from the edge (an old town's ground storey of stone, split at its floor): no plinth,
    // and its floor's cap stays (it hides the joint between the wall's courses; a pit has that floor over it)
    const t = tangentOf(n);
    const mid = t.dot(ps[0].clone().add(ps[1]).multiplyScalar(0.5));
    const goesOn = own.some((g) => g !== f && Math.abs(g.n.y) <= UPRIGHT && g.minY < top + 0.05 && g.maxY > top + 0.05
      && new Vector3(g.n.x, 0, g.n.z).normalize().dot(n) > 0.995 && Math.abs(n.dot(g.p[0]) - face) < 0.01
      && Math.min(...g.p.map((p) => t.dot(p))) <= mid + 1e-3 && Math.max(...g.p.map((p) => t.dot(p))) >= mid - 1e-3);
    if (goesOn) return null;
    let d = Infinity;
    for (const w of others) {
      if (Math.abs(w.n.y) > UPRIGHT || w.minY < top - 0.05 || w.minY > top + 0.3) continue;
      if (new Vector3(w.n.x, 0, w.n.z).normalize().dot(n) < 0.995) continue;
      const behind = face - n.dot(w.p[0]);
      if (behind > 0.005 && behind <= LEDGE_MOST && behind < d) d = behind;
    }
    if (d === Infinity) continue;
    edges.push({ a: ps[0].clone(), b: ps[1].clone(), n, d });
  }
  // No wall stands on it: a low block that is the whole building (a kiosk, a shed), its top its roof
  if (!edges.length) return null;
  // Without it in the index (or as an index without it)
  const index = geometry.getIndex();
  const total = index ? index.count : geometry.getAttribute('position').count;
  const capped = new Set(caps.map((c) => c.ids.join(',')));
  const corners: number[] = [];
  for (let i = 0; i + 2 < total; i += 3) {
    const ids = [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j));
    if (!capped.has(ids.join(','))) corners.push(...ids);
  }
  const out = geometry.clone();
  out.setIndex(corners);
  out.setDrawRange(0, Infinity);
  const add: Added = { pos: [], nor: [], cellar: [], attrs: {} };
  const uvs = ['uv', 'uv1'].filter((name) => out.getAttribute(name));
  for (const name of uvs) add.attrs![name] = [];
  const cap = caps[0];
  // A corner of the ledge: in from the edge by its depth, and by the depth of the edge meeting it there
  const inward = (p: Vector3, self: (typeof edges)[number]): Vector3 => {
    const q = p.clone().addScaledVector(self.n, -self.d);
    const other = edges.find((e) => e !== self && Math.abs(e.n.dot(self.n)) < 0.99 && (e.a.distanceToSquared(p) < 1e-4 || e.b.distanceToSquared(p) < 1e-4));
    return other ? q.addScaledVector(other.n, -other.d) : q;
  };
  for (const e of edges) {
    const quad = [e.a, e.b, inward(e.b, e), inward(e.a, e)];
    // Facing up, whichever way the edge runs
    const up = new Vector3().subVectors(quad[1], quad[0]).cross(new Vector3().subVectors(quad[2], quad[0])).y > 0;
    for (const j of up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      const p = quad[j];
      add.pos.push(p.x, p.y, p.z);
      add.nor.push(0, 1, 0);
      add.cellar.push(0, 0, 0, 0);
      for (const name of uvs) add.attrs![name].push(...(attrAt(cap, out.getAttribute(name) as BufferAttribute, p) ?? [0, 0]));
    }
  }
  return { geometry: out, add };
}

/** Corners to add to a part: positions, normals, `aCellar`, as flat lists of triangles; other attributes by name */
interface Added {
  pos: number[];
  nor: number[];
  cellar: number[];
  attrs?: Record<string, number[]>;
}

/** Two triangles on one point, their corners `(along, down)` from it riding in `aCellar` */
function addQuad(add: Added, anchor: Vector3, n: Vector3, kind: number, storey: number, left: number, right: number, top: number, bottom: number): void {
  const corners: [number, number][] = [[left, bottom], [right, bottom], [right, top], [left, top]];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    add.pos.push(anchor.x, anchor.y, anchor.z);
    add.nor.push(n.x, n.y, n.z);
    add.cellar.push(kind, corners[k][0], corners[k][1], storey);
  }
}

/** `geometry` with every vertex's `aCellar` and the corners of `add` after its own (indexed: their own index) */
function withCellar(geometry: BufferGeometry, cellar: Float32Array, add: Added | undefined): BufferGeometry {
  const out = geometry.clone();
  out.setAttribute('aCellar', new BufferAttribute(cellar, 4));
  if (!add || !add.pos.length) return out;
  const n = out.getAttribute('position').count;
  const extra = add.pos.length / 3;
  for (const [name, attr] of Object.entries(out.attributes)) {
    const size = attr.itemSize;
    const data = new Float32Array((n + extra) * size);
    for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) data[i * size + c] = attr.getComponent(i, c);
    const from = name === 'position' ? add.pos : name === 'normal' ? add.nor : name === 'aCellar' ? add.cellar : (add.attrs?.[name] ?? null);
    if (from && from.length === extra * size) data.set(from, n * size);
    // Any other attribute (uv, a colour, roughness): the part's first vertex's value
    else for (let i = n; i < n + extra; i++) for (let c = 0; c < size; c++) data[i * size + c] = attr.getComponent(0, c);
    out.setAttribute(name, new BufferAttribute(data, size));
  }
  const index = out.getIndex();
  if (index) {
    const corners = Array.from({ length: index.count }, (_, k) => index.getX(k));
    for (let i = 0; i < extra; i++) corners.push(n + i);
    out.setIndex(corners);
    out.setDrawRange(0, Infinity);
  }
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * A building model's parts with its cellar: every part with `aCellar` (the
 * foot's vertices marked with their faces' uv per metre down, a vertex
 * shared by faces of another texture direction split off), the openings
 * added to the parts of the model's frame, glass and door. The parts as
 * they were, with `aCellar` all zero, where the model has no foot to go on
 * from or with `openings` off (a far model) without openings
 */
export function cellarShell(source: readonly ModelPart[], openings = true): ModelPart[] {
  // Each part its own vertices, its draw range only: a part of a shared buffer drew only its range, and one with
  // corners added must not draw the others' (merge-parts.ts compact)
  const parts = source.map((p) => ({ geometry: compact(p.geometry), material: p.material }));
  const faces = facesOf(parts);
  const upright = faces.filter((f) => Math.abs(f.n.y) <= UPRIGHT);
  const footY = upright.length ? Math.min(...upright.map((f) => f.minY)) : Infinity;
  const zeros = () => parts.map((p) => ({ geometry: withCellar(p.geometry, new Float32Array(p.geometry.getAttribute('position').count * 4), undefined), material: p.material }));
  if (footY > FOOT_HIGHEST) return zeros();
  const foot = upright.filter((f) => f.minY < footY + FOOT_NEAR);
  // Per part its vertices at the foot and the uv per metre down of the upright faces they belong to
  const geometries = parts.map((p) => p.geometry.clone());
  const cellars = geometries.map((g) => new Float32Array(g.getAttribute('position').count * 4));
  const footFaces = new Map<number, Face[]>();
  for (const f of faces) {
    if (f.minY >= footY + FOOT_NEAR) continue;
    let list = footFaces.get(f.part);
    if (!list) footFaces.set(f.part, (list = []));
    list.push(f);
  }
  const mark = (k: number, list: readonly Face[], atY: number, kind: number): void => {
    let g = geometries[k];
    const pos = g.getAttribute('position');
    const uv = (g.getAttribute('uv') as BufferAttribute | undefined) ?? null;
    let cellar = cellars[k];
    // The gradient each foot vertex took, and its splits: a vertex shared by faces of other gradients is copied
    const taken = new Map<number, [number, number]>();
    const splits: { from: number; gradient: [number, number]; faces: Face[] }[] = [];
    for (const f of list) {
      const gradient = Math.abs(f.n.y) <= UPRIGHT ? (uvPerMetreDown(f, uv) ?? [0, 0]) : [0, 0] as [number, number];
      for (let c = 0; c < 3; c++) {
        const id = f.ids[c];
        if (Math.abs(pos.getY(id) - atY) >= FOOT_NEAR) continue;
        const had = taken.get(id);
        if (!had) {
          taken.set(id, gradient);
          continue;
        }
        if (Math.abs(had[0] - gradient[0]) < 1e-5 && Math.abs(had[1] - gradient[1]) < 1e-5) continue;
        let split = splits.find((s) => s.from === id && Math.abs(s.gradient[0] - gradient[0]) < 1e-5 && Math.abs(s.gradient[1] - gradient[1]) < 1e-5);
        if (!split) splits.push((split = { from: id, gradient, faces: [] }));
        split.faces.push(f);
      }
    }
    if (splits.length && g.getIndex()) {
      // Each split a copy of its vertex at the end, its faces' corners pointed at it
      const n = pos.count;
      const grown = new BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) {
        const size = attr.itemSize;
        const data = new Float32Array((n + splits.length) * size);
        for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) data[i * size + c] = attr.getComponent(i, c);
        splits.forEach((s, j) => {
          for (let c = 0; c < size; c++) data[(n + j) * size + c] = attr.getComponent(s.from, c);
        });
        grown.setAttribute(name, new BufferAttribute(data, size));
      }
      const index = g.getIndex()!;
      const corners = Array.from({ length: index.count }, (_, i) => index.getX(i));
      // The faces by their first corner's place in the index (facesOf walked the index in threes)
      const at = new Map<Face, number>();
      {
        const total = index.count;
        const start = Math.max(0, g.drawRange.start);
        const end = Math.min(total, start + (Number.isFinite(g.drawRange.count) ? g.drawRange.count : total));
        let q = 0;
        const own = faces.filter((f) => f.part === k);
        for (let i = start; i + 2 < end && q < own.length; i += 3) {
          const f = own[q];
          if (f.ids[0] === index.getX(i) && f.ids[1] === index.getX(i + 1) && f.ids[2] === index.getX(i + 2)) {
            at.set(f, i);
            q++;
          }
        }
      }
      splits.forEach((s, j) => {
        for (const f of s.faces) {
          const i = at.get(f);
          if (i === undefined) continue;
          for (let c = 0; c < 3; c++) if (corners[i + c] === s.from) corners[i + c] = n + j;
        }
        taken.set(n + j, s.gradient);
      });
      grown.setIndex(corners);
      grown.groups = g.groups;
      grown.drawRange = { ...g.drawRange };
      g = grown;
      geometries[k] = g;
      cellar = new Float32Array((n + splits.length) * 4);
      cellars[k] = cellar;
    }
    for (const [id, [du, dv]] of taken) cellar.set([kind, du, dv, 0], id * 4);
  };
  for (const [k, list] of footFaces) mark(k, list, footY, FOOT);
  const adds = new Map<number, Added>();
  // The foot's top: a plinth built as one block has a cap over the whole ground, which would close the cellar seen
  // through a hole or its pit after a fall; only its ledge before the wall stays (capRing)
  for (const [k, list] of footFaces) {
    const sides = list.filter((f) => Math.abs(f.n.y) <= UPRIGHT);
    if (!sides.length) continue;
    const top = Math.max(...sides.map((f) => f.maxY));
    if (top > CAP_HIGHEST) continue;
    const ring = capRing(geometries[k], top, faces.filter((f) => f.part !== k));
    if (!ring) continue;
    geometries[k] = ring.geometry;
    if (ring.add.pos.length) adds.set(k, ring.add);
  }
  // A plinth (a foot lower than CAP_HIGHEST, its own parts): its top and the wall's foot on it marked, to go down
  // to the lowest ground on a house whose cellar wears its wall (WALL_BASE)
  const plinthParts = [...footFaces.keys()].filter((k) => {
    const sides = footFaces.get(k)!.filter((f) => Math.abs(f.n.y) <= UPRIGHT);
    return sides.length > 0 && Math.max(...sides.map((f) => f.maxY)) <= CAP_HIGHEST;
  });
  if (plinthParts.length) {
    const top = Math.max(...plinthParts.flatMap((k) => footFaces.get(k)!.filter((f) => Math.abs(f.n.y) <= UPRIGHT).map((f) => f.maxY)));
    const opening = (name: string) => name.startsWith('frame') || name === 'window' || name.startsWith('door') || isWindowGlass(name);
    // The wall standing on it: upright faces of the other parts (not a window's, a door's) from its top
    const base = new Map<number, Face[]>();
    for (const f of faces) {
      if (footFaces.has(f.part) || opening(parts[f.part].material.name) || Math.abs(f.n.y) > UPRIGHT || Math.abs(f.minY - top) >= FOOT_NEAR) continue;
      let list = base.get(f.part);
      if (!list) base.set(f.part, (list = []));
      list.push(f);
    }
    // No wall on it: a low block that is the whole building, its foot a foot
    if (base.size) {
      for (const k of plinthParts) {
        // The plinth's top corners (no texture run: the plinth moves whole), its ledge's too (the ring added above)
        const cellar = cellars[k];
        const pos = geometries[k].getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(pos.getY(i) - top) < FOOT_NEAR && cellar[i * 4] === 0) cellar.set([PLINTH_TOP, 0, 0, 0], i * 4);
          else if (cellar[i * 4] === FOOT) cellar[i * 4] = PLINTH_FOOT;
        }
        const ring = adds.get(k);
        if (ring) for (let i = 0; i < ring.cellar.length; i += 4) ring.cellar[i] = PLINTH_TOP;
      }
      for (const [k, list] of base) mark(k, list, top, WALL_BASE);
    }
  }
  // The openings, into the parts of the model's frame, glass and door
  if (openings) {
    const frame = parts.findIndex((p) => p.material.name.startsWith('frame') || p.material.name === 'window');
    const glass = parts.findIndex((p) => isWindowGlass(p.material.name) && p.material.name !== 'window');
    const door = parts.findIndex((p) => p.material.name.startsWith('door'));
    if (frame >= 0 && glass >= 0) {
      const walls = footWalls(foot);
      const into = (k: number): Added => {
        let a = adds.get(k);
        if (!a) adds.set(k, (a = { pos: [], nor: [], cellar: [] }));
        return a;
      };
      for (const s of slotsOf(faces, parts, walls)) {
        const n = s.wall.n;
        const t = tangentOf(n);
        const at = (out: number, y: number) => t.clone().multiplyScalar(s.along).addScaledVector(n, s.wall.d + out).setY(y);
        const half = s.width / 2;
        const kind = s.door && door >= 0 ? DOOR_SLOT : WINDOW;
        for (let k = 0; k < MAX_CELLAR_STOREYS; k++) {
          // A window: its frame, the glass in front; corners down from its top
          const b = WIN.frame;
          addQuad(into(frame), at(FRAME_OUT, -WIN.top), n, kind, k, -half - b, half + b, -b, WIN.height + b);
          addQuad(into(glass), at(GLASS_OUT, -WIN.top), n, kind, k, -half, half, 0, WIN.height);
          if (s.door && door >= 0) {
            // The door: up from the ground it stands on (the shader puts the point there)
            const h = DOOR_SIZE.width / 2;
            const f = DOOR_SIZE.frame;
            addQuad(into(frame), at(FRAME_OUT, 0), n, DOOR, k, -h - f, h + f, -DOOR_SIZE.height - f, 0);
            addQuad(into(door), at(GLASS_OUT, 0), n, DOOR, k, -h, h, -DOOR_SIZE.height, 0);
          }
        }
      }
    }
  }
  return parts.map((p, k) => ({ geometry: withCellar(geometries[k], cellars[k], adds.get(k)), material: p.material }));
}

/**
 * The vertex shader's part (cellarShell): before the texture coordinates
 * (three's uv chunk) the foot moves down to the instance's cellar foot and
 * its texture runs on; an opening's corners leave their point where it
 * opens. `aCellarOf` per instance: the cellar's depth under the floor (m),
 * its storeys, its mode (1 open to the slope, 2 buried; 0 none). Model
 * space (y up, the floor at 0), the group frame of the instance matrix;
 * the ground from the height texture the terrain's mesh is drawn from
 */
const CELLAR_VERTEX = /* glsl */ `
vec3 cellarMove = vec3(0.0);
vec2 cellarUvShift = vec2(0.0);
#ifdef USE_INSTANCING
{
  float sy = max(length(instanceMatrix[1].xyz), 1e-3);
  float kind = aCellar.x;
  // A cellar in the wall's surface: the plinth's top and the wall's foot this far down (the floor over the lowest
  // ground, aCellarOf.w; -1 a cellar in the plinth's)
  float wallDown = aCellarOf.x > 0.0 ? max(aCellarOf.w, 0.0) / sy : 0.0;
  if (kind > 0.5 && kind < 1.5 && aCellarOf.x > 0.0) {
    float drop = max(0.0, position.y + aCellarOf.x / sy);
    cellarMove.y = -drop;
    // Under a wall-clad cellar a plinth moves whole and stretches only below its old foot's new place
    cellarUvShift = aCellar.yz * max(0.0, drop - (kind > 1.1 ? wallDown : 0.0));
  } else if (kind > 3.5 && kind < 4.5) {
    cellarMove.y = -wallDown;
  } else if (kind > 4.5) {
    cellarMove.y = -wallDown;
    cellarUvShift = aCellar.yz * wallDown;
  } else if (kind > 1.5) {
    float storey = aCellar.w;
    vec3 anchor = position - vec3(0.0, storey * ${CELLAR_STOREY.toFixed(2)} / sy, 0.0);
    vec3 world = (instanceMatrix * vec4(anchor, 1.0)).xyz;
    float ground = terrainHeightAt(vec2(-world.x, world.z));
    // Metres of this storey free of the ground under its ceiling, there
    float free = instanceMatrix[3].y - ground - storey * ${CELLAR_STOREY.toFixed(2)};
    float open = step(0.5, aCellarOf.z) * step(aCellarOf.z, 1.5) * step(storey + 0.5, aCellarOf.y);
    float doorHere = step(${DOOR_FROM.toFixed(2)}, free) * step(free, ${DOOR_TO.toFixed(2)});
    if (kind > 2.75) {
      open *= doorHere;
      // A door stands on the ground before it, on its storey's floor where the ground lies lower (a few steps)
      anchor.y = max(ground - instanceMatrix[3].y, -(storey + 1.0) * ${CELLAR_STOREY.toFixed(2)}) / sy;
    } else {
      open *= step(${WINDOW_FREE.toFixed(2)}, free) * (1.0 - step(2.25, kind) * doorHere);
    }
    vec3 n = normalize(vec3(normal.x, 0.0, normal.z) + vec3(1e-6, 0.0, 0.0));
    vec3 t = vec3(n.z, 0.0, -n.x);
    cellarMove = anchor - position + (t * aCellar.y - vec3(0.0, aCellar.z, 0.0)) * open;
  }
}
#endif
`;

/** The maps whose coordinates run on down the foot (the occlusion's, in uv1, keeps the foot's own) */
const RUNNING_UVS = ['MAP_UV', 'NORMALMAP_UV', 'ROUGHNESSMAP_UV', 'METALNESSMAP_UV', 'BUMPMAP_UV', 'EMISSIVEMAP_UV'];

/**
 * A building material draws its model's cellar (cellarShell): its foot
 * down to each instance's cellar, its openings where they stand free.
 * Applied after every other patch of the material, so its move comes
 * before theirs (a ruin's fall moves the cellar's walls as the others)
 */
export function addCellar(material: Material, terrain: HeightTexture['uniforms']): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, terrain);
    const uvs = RUNNING_UVS.map((name) => `#ifdef ${name}\nvec2 cellar${name} = ${name} + cellarUvShift;\n#undef ${name}\n#define ${name} cellar${name}\n#endif`).join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aCellar;\n#ifdef USE_INSTANCING\nattribute vec4 aCellarOf;\n#endif\n${TERRAIN_HEIGHT_GLSL}`)
      .replace('#include <uv_vertex>', `${CELLAR_VERTEX}\n${uvs}\n#include <uv_vertex>`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += cellarMove;');
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-cellar`;
}
