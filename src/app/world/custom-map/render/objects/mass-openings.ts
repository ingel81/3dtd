import type { MapMassOpening } from '../../map-document';
import { ringsContain, type MassBody } from '../../object-mass';

/**
 * Ways through a raised building (MapMass.openings, docs/OSM_LANDMARKS_PLAN.md
 * "Durchgänge"): the walls of the building open where the way crosses them
 * and the room under it is free, drawn with the building's own walls in the
 * mass layer's wall batches, no model and no draw call more.
 *
 * - The walls the way crosses stand in pieces round the opening: beside it
 *   the whole height, over it the lintel up to the eaves; a round arch's head
 *   is a piece of its own (WALL_ARCH) the shader cuts the arch out of. Every
 *   piece keeps the whole wall's metres (u0, wallLength), so the windows
 *   stay where they were and the ones the opening would cut are left out.
 * - Inside, on the part that stands over it (MassBody.hosts): the reveals,
 *   the ceiling (or the arch's vault in five facets round the arch), and
 *   where the way ends inside a back wall; a car park's entrance all of it
 *   dark (the depth behind the opening).
 *
 * Pure geometry in the building's frame at scale 1 (model x, height over
 * the seat y, model z), worked out once per opening and ground.
 */

/** What a wall instance is (the shader's aWallB.y) */
export const WALL_FACADE = 0;
/** A plain face (a parapet's inside, an opening's ceiling) */
export const WALL_PLAIN = 1;
/** A gable: the quad's top drawn in to a point */
export const WALL_GABLE = 2;
/** A facade with a shop's display windows on its ground floor (MapMass.shop) */
export const WALL_SHOP = 3;
/** The head of a round arch over an opening: facade, the arch cut out of it in the shader */
export const WALL_ARCH = 4;
/** A triangle: the quad's top corners drawn in to its start (an opening's ceiling, its vault) */
export const WALL_WEDGE = 5;
/** An opening's reveal: a plain face with the plinth at its foot */
export const WALL_REVEAL = 6;

/** Metres the walls reach below the seat: the ground under a building on a slope (object-seat.ts) */
export const FOUNDATION = 1.5;

/** How an opening shows on the wall it cuts (the shader's aWallD.z) */
export const CUT_FLAT = 0;
export const CUT_ARCH = 1;
export const CUT_GARAGE = 2;

/** The opening a wall piece lies beside, for the shader: its frame and the windows it leaves out */
export interface WallCut {
  /** Metres along the whole wall to the opening's middle, half its width along the wall */
  mid: number;
  half: number;
  /** Its top over the seat (an arch's crown), the arch's rise (0 for a lintel), CUT_*, its floor over the seat */
  top: number;
  rise: number;
  style: number;
  floor: number;
}

/** One wall in the building's own frame at scale 1 */
export interface WallPiece {
  /** Start on the ground line (x, z), unit direction along it, length, outward normal */
  sx: number;
  sz: number;
  ax: number;
  az: number;
  length: number;
  nx: number;
  nz: number;
  /** Bottom and top over the seat, m (the bottom below 0 for the foundation) */
  bottom: number;
  top: number;
  kind: number;
  /** Metres at the top without windows: the cornice, the parapet */
  band: number;
  /** A piece of a split wall (splitWalls): the whole wall's top, and minus the metres its bottom stands over the seat */
  wallTop?: number;
  lift?: number;
  /** A piece of a wall in pieces round an opening: metres along the whole wall to its start, the whole wall's length */
  u0?: number;
  wallLength?: number;
  /** The opening beside it */
  cut?: WallCut;
  /**
   * A piece that does not stand upright (a wedge, a vault's facet): its
   * corner and its two edges (x, y, z), the normal (nx, ny, nz) square to
   * them; `sx`, `sz`, `ax`, `az` then unused
   */
  corner?: readonly [number, number, number];
  e1?: readonly [number, number, number];
  e2?: readonly [number, number, number];
  ny?: number;
  /** Its colour over the wall's (an opening's inside in shade, a car park's dark) */
  shade?: number;
}

/** Shade of a passage's reveals and of its ceiling; a car park's inside, its back wall */
const PASSAGE_REVEAL_SHADE = 0.86;
const PASSAGE_CEILING_SHADE = 0.72;
const GARAGE_SHADE = 0.1;
const GARAGE_BACK_SHADE = 0.05;
/** Metres a car park's walls reach below its floor */
const GARAGE_FOOT = 0.4;
/** Tangent half angle of a vault's facets (30° each, the polygon round the arch's circle) */
const FACET_HALF = Math.PI / 12;

/** An opening on the building's ground: its frame along the line, the stretches inside, its heights */
interface OpeningGeometry {
  ex: number;
  ez: number;
  /** Along the line (unit), to its left (unit) */
  dx: number;
  dz: number;
  lx: number;
  lz: number;
  half: number;
  /** Where its walls start, its top (an arch's crown), the arch's springing (top for a lintel) */
  base: number;
  top: number;
  spring: number;
  style: number;
  floor: number;
  /** Stretches inside the ground: along the line, and where its left and right sides meet the walls; blind ends */
  inside: { t0: number; t1: number; l0: number; l1: number; r0: number; r1: number; blind0: boolean; blind1: boolean }[];
  /** Along the line, the band the walls open in */
  tmin: number;
  tmax: number;
}

const geometries = new WeakMap<MapMassOpening, { ground: readonly number[][]; walls: readonly (readonly number[])[]; g: OpeningGeometry }>();

/** Metres a part's wall may stand past the building's ground where a way crosses it (OSM's parts follow the outline roughly) */
const PART_REACH = 1.5;

/**
 * An opening's frame on `ground` (the building's rings), its stretches
 * reaching out to the walls of its parts (`walls`, their rings) that stand
 * a little past the ground; worked out once per opening, ground and walls
 */
export function openingGeometry(o: MapMassOpening, ground: readonly number[][], walls: readonly (readonly number[])[] = ground): OpeningGeometry {
  const cached = geometries.get(o);
  if (cached && cached.ground === ground && cached.walls === walls) return cached.g;
  const [ex, ez, bx, bz] = o.line;
  const length = Math.hypot(bx - ex, bz - ez) || 1;
  const dx = (bx - ex) / length;
  const dz = (bz - ez) / length;
  const lx = -dz;
  const lz = dx;
  const half = o.width / 2;
  const floor = o.floor ?? 0;
  const base = o.floor !== undefined ? o.floor - GARAGE_FOOT : -FOUNDATION;
  const arch = o.head === 'arch' && o.kind === 'passage' && o.height - half >= floor + 1.8;
  const style = o.kind === 'garage' ? CUT_GARAGE : arch ? CUT_ARCH : CUT_FLAT;
  const spring = arch ? o.height - half : o.height;
  // The stretches of the line on the ground, between its crossings with the walls
  const cuts = [0, ...lineCrossings(ground, ex, ez, dx, dz).filter((t) => t > 1e-3 && t < length - 1e-3), length];
  const inside: OpeningGeometry['inside'] = [];
  for (let k = 1; k < cuts.length; k++) {
    const t0 = cuts[k - 1];
    const t1 = cuts[k];
    if (t1 - t0 < 0.3) continue;
    const m = (t0 + t1) / 2;
    if (!ringsContain(ground, ex + dx * m, ez + dz * m)) continue;
    const blind0 = k === 1;
    const blind1 = k === cuts.length - 1;
    // Where each side meets the wall at the stretch's ends: the crossing nearest the centre line's (an oblique wall),
    // out to a part's wall standing a little past it
    const side = (s: number, near: number, blind: boolean, out: -1 | 1) => {
      if (blind) return near;
      const px = ex + lx * s;
      const pz = ez + lz * s;
      const at = nearest(lineCrossings(ground, px, pz, dx, dz), near, 1.75 * half + 0.5) ?? near;
      if (walls === ground) return at;
      let far = at;
      for (const t of lineCrossings(walls, px, pz, dx, dz)) if ((t - at) * out > 0 && (t - at) * out <= PART_REACH && (t - far) * out > 0) far = t;
      return far;
    };
    const l0 = side(half, t0, blind0, -1);
    const r0 = side(-half, t0, blind0, -1);
    const l1 = side(half, t1, blind1, 1);
    const r1 = side(-half, t1, blind1, 1);
    inside.push({ t0, t1, l0, l1, r0, r1, blind0, blind1 });
  }
  let tmin = Infinity;
  let tmax = -Infinity;
  for (const s of inside) {
    tmin = Math.min(tmin, s.l0, s.r0, s.t0);
    tmax = Math.max(tmax, s.l1, s.r1, s.t1);
  }
  const g: OpeningGeometry = { ex, ez, dx, dz, lx, lz, half, base, top: o.height, spring, style, floor, inside, tmin: tmin - 0.05, tmax: tmax + 0.05 };
  geometries.set(o, { ground, walls, g });
  return g;
}

/** Where the line from (px, pz) along (dx, dz) crosses the rings' walls: metres along it, sorted */
function lineCrossings(rings: readonly (readonly number[])[], px: number, pz: number, dx: number, dz: number): number[] {
  const out: number[] = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j];
      const az = r[j + 1];
      const wx = r[i] - ax;
      const wz = r[i + 1] - az;
      const den = dx * wz - dz * wx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = ax - px;
      const qz = az - pz;
      const t = (qx * wz - qz * wx) / den;
      const u = (qx * dz - qz * dx) / den;
      if (u >= 0 && u < 1) out.push(t);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Of `ts` the one nearest `near` within `reach`; null for none */
function nearest(ts: readonly number[], near: number, reach: number): number | null {
  let best: number | null = null;
  for (const t of ts) if (Math.abs(t - near) <= reach && (best === null || Math.abs(t - near) < Math.abs(best - near))) best = t;
  return best;
}

/** One cut of a wall: along it from `a` to `b`, open up to `open` (the arch's springing), an arch over it to `top` */
interface Cut {
  a: number;
  b: number;
  open: number;
  top: number;
  arch: boolean;
  /** The walls' foot under a car park's floor */
  deep: number;
  info: WallCut;
}

/**
 * Wall `w` of body `m` in its pieces round the openings that cross it
 * (MassBody.openings), added to `out`: beside each opening the whole
 * height, over it the lintel, an arch's head; the wall itself where none
 * crosses it
 */
export function pushWall(out: WallPiece[], m: MassBody, w: WallPiece): void {
  const ground = m.ground ?? m.rings;
  const cuts: Cut[] = [];
  for (const o of m.openings ?? []) {
    const g = openingGeometry(o, ground, m.walls ?? ground);
    // A wall standing over the opening's top (a part on a roof) stays whole; one on the ground opens to a car park's
    // entrance however deep it lies
    if (!g.inside.length || (w.bottom >= g.top - 0.1 && (w.bottom > 0 || g.style !== CUT_GARAGE))) continue;
    // The wall, from its start along it: across the line (s) and along it (t)
    const s0 = (w.sx - g.ex) * g.lx + (w.sz - g.ez) * g.lz;
    const sa = w.ax * g.lx + w.az * g.lz;
    const t0 = (w.sx - g.ex) * g.dx + (w.sz - g.ez) * g.dz;
    const ta = w.ax * g.dx + w.az * g.dz;
    const span = clip(0, w.length, s0, sa, -g.half, g.half);
    const run = span && clip(span[0], span[1], t0, ta, g.tmin, g.tmax);
    if (!run || run[1] - run[0] < 0.05) continue;
    // A wall across the way takes the arch's head; one along it (a part's wall in the passage) opens to the top
    const across = Math.abs(sa) > 0.5;
    const arch = across && g.style === CUT_ARCH;
    const centre = Math.abs(sa) > 1e-6 ? Math.min(run[1], Math.max(run[0], -s0 / sa)) : (run[0] + run[1]) / 2;
    const at = (w.u0 ?? 0) + centre;
    cuts.push({
      a: run[0],
      b: run[1],
      open: arch ? g.spring : g.top,
      top: g.top,
      arch,
      deep: g.style === CUT_GARAGE && across ? g.base : Infinity,
      info: { mid: at, half: (run[1] - run[0]) / 2, top: g.top, rise: arch ? g.top - g.spring : 0, style: g.style, floor: g.style === CUT_GARAGE ? g.floor : g.base },
    });
  }
  if (!cuts.length) {
    out.push(w);
    return;
  }
  cuts.sort((p, q) => p.a - q.a);
  const bottom = Math.min(w.bottom, ...cuts.map((c) => c.deep));
  const wallLength = w.wallLength ?? w.length;
  const u0 = w.u0 ?? 0;
  const piece = (a: number, b: number, lo: number, hi: number, kind: number, cut: WallCut): WallPiece => ({
    ...w,
    sx: w.sx + w.ax * a,
    sz: w.sz + w.az * a,
    length: b - a,
    bottom: lo,
    top: hi,
    kind,
    // Metres over the seat from its foot up, as the whole wall's
    lift: -lo,
    wallTop: w.wallTop ?? w.top,
    u0: u0 + a,
    wallLength,
    cut,
  });
  let u = 0;
  cuts.forEach((c, k) => {
    // Beside it the whole height; the opening of the nearer cut tells the shader what to leave out
    const near = (a: number, b: number) => cuts[k - 1] && Math.abs(u0 + (a + b) / 2 - cuts[k - 1].info.mid) < Math.abs(u0 + (a + b) / 2 - c.info.mid) ? cuts[k - 1].info : c.info;
    if (c.a > u + 0.01) out.push(piece(u, c.a, bottom, w.top, w.kind, near(u, c.a)));
    const a = Math.max(u, c.a);
    if (c.b > a + 0.01) {
      if (c.arch && c.open < w.top) out.push(piece(a, c.b, Math.max(c.open, w.bottom), Math.min(c.top, w.top), WALL_ARCH, c.info));
      const over = c.arch ? c.top : c.open;
      if (over < w.top - 0.02) out.push(piece(a, c.b, Math.max(over, w.bottom), w.top, w.kind, c.info));
    }
    u = Math.max(u, c.b);
  });
  if (u < w.length - 0.01) out.push(piece(u, w.length, bottom, w.top, w.kind, cuts[cuts.length - 1].info));
}

/** Of [a, b] the stretch where lo <= c + k u <= hi; null where none */
function clip(a: number, b: number, c: number, k: number, lo: number, hi: number): [number, number] | null {
  if (Math.abs(k) < 1e-9) return c >= lo && c <= hi ? [a, b] : null;
  let u1 = (lo - c) / k;
  let u2 = (hi - c) / k;
  if (u1 > u2) [u1, u2] = [u2, u1];
  const from = Math.max(a, u1);
  const to = Math.min(b, u2);
  return to > from ? [from, to] : null;
}

/**
 * The insides of the openings body `m` hosts (MassBody.hosts): per stretch
 * on the ground the two reveals, the ceiling or the arch's vault, a back
 * wall where the way ends inside
 */
export function openingInsides(m: MassBody): WallPiece[] {
  const out: WallPiece[] = [];
  const ground = m.ground ?? m.rings;
  for (const o of m.hosts ?? m.openings ?? []) {
    const g = openingGeometry(o, ground, m.walls ?? ground);
    const garage = g.style === CUT_GARAGE;
    const reveal = garage ? GARAGE_SHADE : PASSAGE_REVEAL_SHADE;
    const ceiling = garage ? GARAGE_SHADE : PASSAGE_CEILING_SHADE;
    const h = g.half;
    // A point on the ground at metres t along the line and s to its left, at height y
    const at = (s: number, t: number, y: number): [number, number, number] => [g.ex + g.dx * t + g.lx * s, y, g.ez + g.dz * t + g.lz * s];
    for (const st of g.inside) {
      // Where the walls meet a line s to the left (between the sides' crossings: a straight wall across)
      const t0 = (s: number) => st.r0 + ((st.l0 - st.r0) * (s + h)) / (2 * h);
      const t1 = (s: number) => st.r1 + ((st.l1 - st.r1) * (s + h)) / (2 * h);
      const revealTop = g.style === CUT_ARCH ? g.spring + h * Math.tan(FACET_HALF) : g.top;
      for (const s of [h, -h]) {
        // Each reveal faces into the way, open where another way crosses it
        const from = s > 0 ? st.l0 : st.r0;
        const to = s > 0 ? st.l1 : st.r1;
        for (const [t0r, t1r] of open(from, to, s, g, o, m.openings ?? [], ground, m.walls ?? ground)) {
          const p = at(s, t0r, 0);
          const q = at(s, t1r, 0);
          out.push(upright(p[0], p[2], q[0], q[2], -Math.sign(s) * g.lx, -Math.sign(s) * g.lz, g.base, revealTop, garage ? WALL_PLAIN : WALL_REVEAL, reveal));
        }
      }
      if (g.style === CUT_ARCH) {
        // The vault: a polygon round the arch's circle (radius h, over the springing), its facets tangent at 30° to 150°
        const r = h / Math.cos(FACET_HALF);
        const points: [number, number][] = [[h, h * Math.tan(FACET_HALF)]];
        for (const deg of [45, 75, 105, 135]) points.push([r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)]);
        points.push([-h, h * Math.tan(FACET_HALF)]);
        for (let k = 1; k < points.length; k++) {
          const [s1, y1] = points[k - 1];
          const [s2, y2] = points[k];
          const phi = (30 * k * Math.PI) / 180;
          // Down and in, toward the arch's middle
          const normal: [number, number, number] = [-Math.cos(phi) * g.lx, -Math.sin(phi), -Math.cos(phi) * g.lz];
          quad(out, at(s1, t0(s1), g.spring + y1), at(s1, t1(s1), g.spring + y1), at(s2, t1(s2), g.spring + y2), at(s2, t0(s2), g.spring + y2), normal, ceiling);
        }
      } else {
        quad(out, at(h, t0(h), g.top), at(h, t1(h), g.top), at(-h, t1(-h), g.top), at(-h, t0(-h), g.top), [0, -1, 0], ceiling);
      }
      // A way that ends inside ends at a wall across it (a car park's in the dark)
      for (const [blind, t, facing] of [[st.blind1, st.t1, -1], [st.blind0, st.t0, 1]] as const) {
        if (!blind) continue;
        const p = at(-h, t, 0);
        const q = at(h, t, 0);
        out.push(upright(p[0], p[2], q[0], q[2], facing * g.dx, facing * g.dz, g.base, g.top, WALL_PLAIN, garage ? GARAGE_BACK_SHADE : PASSAGE_REVEAL_SHADE));
      }
    }
  }
  return out;
}

/**
 * Of the reveal from `from` to `to` along opening `self`'s line, `s` to its
 * left, the stretches no other opening crosses (two passages that meet
 * inside: each open into the other)
 */
function open(
  from: number,
  to: number,
  s: number,
  g: OpeningGeometry,
  self: MapMassOpening,
  all: readonly MapMassOpening[],
  ground: readonly number[][],
  walls: readonly (readonly number[])[],
): [number, number][] {
  let left: [number, number][] = [[from, to]];
  const sx = g.ex + g.lx * s;
  const sz = g.ez + g.lz * s;
  for (const other of all) {
    if (other === self) continue;
    const o = openingGeometry(other, ground, walls);
    if (!o.inside.length) continue;
    // The reveal's line in the other's frame: across it and along it
    const s0 = (sx - o.ex) * o.lx + (sz - o.ez) * o.lz;
    const sa = g.dx * o.lx + g.dz * o.lz;
    const t0 = (sx - o.ex) * o.dx + (sz - o.ez) * o.dz;
    const ta = g.dx * o.dx + g.dz * o.dz;
    const next: [number, number][] = [];
    for (const [a, b] of left) {
      const span = clip(a, b, s0, sa, -o.half, o.half);
      const run = span && clip(span[0], span[1], t0, ta, o.tmin, o.tmax);
      if (!run) {
        next.push([a, b]);
        continue;
      }
      if (run[0] - a > 0.05) next.push([a, run[0]]);
      if (b - run[1] > 0.05) next.push([run[1], b]);
    }
    left = next;
  }
  return left;
}

/** An upright plain piece from (px, pz) to (qx, qz), facing (nx, nz) */
function upright(px: number, pz: number, qx: number, qz: number, nx: number, nz: number, bottom: number, top: number, kind: number, shade: number): WallPiece {
  // Along x up must be the normal (the unit quad faces out): along = (nz, -nx), from the end that lies first that way
  const ax = nz;
  const az = -nx;
  const first = px * ax + pz * az <= qx * ax + qz * az;
  return { sx: first ? px : qx, sz: first ? pz : qz, ax, az, length: Math.hypot(qx - px, qz - pz), nx, nz, bottom, top, kind, band: 0, lift: -bottom, shade };
}

/** A flat four-cornered piece (corners in order round it) as two wedges facing `normal` */
function quad(out: WallPiece[], a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], normal: readonly [number, number, number], shade: number): void {
  out.push(wedge(a, b, c, normal, shade), wedge(a, c, d, normal, shade));
}

/** A triangle a, b, c facing `normal` as a wedge: its corner a, its edges to b and c, turned so the quad faces the normal */
export function wedge(a: readonly number[], b: readonly number[], c: readonly number[], normal: readonly [number, number, number], shade: number): WallPiece {
  let e1: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let e2: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1];
  const cy = e1[2] * e2[0] - e1[0] * e2[2];
  const cz = e1[0] * e2[1] - e1[1] * e2[0];
  if (cx * normal[0] + cy * normal[1] + cz * normal[2] < 0) [e1, e2] = [e2, e1];
  const length = Math.hypot(...e1);
  const up = Math.hypot(...e2);
  const n = Math.hypot(...normal) || 1;
  return {
    sx: a[0],
    sz: a[2],
    ax: 0,
    az: 0,
    length,
    nx: normal[0] / n,
    ny: normal[1] / n,
    nz: normal[2] / n,
    bottom: a[1],
    top: a[1] + up,
    kind: WALL_WEDGE,
    band: 0,
    lift: -a[1],
    corner: [a[0], a[1], a[2]],
    e1,
    e2,
    shade,
  };
}
