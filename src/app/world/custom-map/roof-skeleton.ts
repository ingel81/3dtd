/**
 * The straight skeleton of a building's outline and its courtyards
 * (docs/OSM_LANDMARKS_PLAN.md L4): every wall moves inwards at the same speed,
 * and where the moving walls meet they leave the ridges, hips and valleys of
 * a roof whose slopes all rise alike. One face per wall: the ground it sweeps
 * until it is gone, each point of it as high as it lies in from the wall's
 * line ("time"). Walls may also stand still (a weighted skeleton with
 * weights 1 and 0): a gable at a wing's end, a wall another building stands
 * against; the slopes beside them run on up to them, and what rises over
 * such a wall is an upright gable, its top the nodes along its line (chains).
 *
 * Felkel and Obdrzalek's wavefront with edge and split events (polygons with
 * holes, the courtyards), checked when done: every face closes round its
 * wall, lies on its wall's slope and the faces together cover the outline
 * once. A run that does not check out is tried again with the corners a few
 * millimetres off (simultaneous events of right-angled outlines), then given
 * up (null).
 *
 * Pure, and only + - * / and square roots: the same on every machine (the
 * roof grid towers stand on, object-mass.ts, is read by the simulation).
 */

/** One wall of the cleaned rings: start, end, unit direction, inward normal (the interior lies on its left), length */
export interface SkeletonEdge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  dx: number;
  dz: number;
  nx: number;
  nz: number;
  len: number;
  /** Its ring and the index of its start in it */
  ring: number;
  i: number;
  /** Whether it stands still (an upright gable over it) */
  still: boolean;
}

export interface Skeleton {
  /** The rings as the skeleton read them: repeated and nearly straight corners out, interior on the left (the outline counter-clockwise in x, z) */
  rings: number[][];
  edges: SkeletonEdge[];
  /** Its nodes: x, z, time per node; the rings' corners first, ring by ring */
  nodes: number[];
  /** Nodes linked by a moving wall or an arc of the skeleton, per node */
  links: number[][];
  /** One face per edge (the same index): its nodes round it, the edge's start and end first; none for a wall that stands still */
  faces: number[][];
  /** Per wall that stands still the nodes along it from its start to its end: the top of the gable over it */
  chains: number[][];
  /** The latest time any node has: half the width of the widest wing */
  maxT: number;
}

/** The cleaned rings and, per cleaned corner, the index of the corner of the given ring it is */
export interface CleanRings {
  rings: number[][];
  from: number[][];
  /** Per ring whether it was turned round */
  turned: boolean[];
  /** The given ring of each cleaned one */
  ring: number[];
}

/** Corners nearer than this to the line of their neighbours go before the skeleton is made, m */
const STRAIGHT = 0.06;
/** Nodes nearer than this are one, m */
const SNAP = 2e-3;
/** Most corners a skeleton is made for (the split events grow as corners times reflex corners) */
const MAX_CORNERS = 480;
/** How far off a face's corner may lie from its wall's slope and still check out, m (and a share of its time) */
const PLANE_SLACK = 0.02;

const cache = new WeakMap<readonly (readonly number[])[], Map<string, Skeleton | null>>();
const cleaned = new WeakMap<readonly (readonly number[])[], CleanRings | null>();

/** The rings as the skeleton cleans them (cleanRings), worked out once per set of rings */
export function cleanedRings(rings: readonly (readonly number[])[]): CleanRings | null {
  let c = cleaned.get(rings);
  if (c === undefined) cleaned.set(rings, (c = cleanRings(rings)));
  return c;
}

/**
 * The straight skeleton of `rings` (the outline then its courtyards, x, z
 * pairs, either way round), the walls in `still` standing still (indices of
 * the cleaned rings' walls, cleanedRings, ring by ring); null where it cannot
 * be made. Worked out once per set of rings and walls standing still
 */
export function straightSkeleton(rings: readonly (readonly number[])[], still: readonly number[] = []): Skeleton | null {
  let byStill = cache.get(rings);
  if (!byStill) cache.set(rings, (byStill = new Map()));
  const key = still.join(',');
  const cached = byStill.get(key);
  if (cached !== undefined) return cached;
  let out: Skeleton | null = null;
  const clean = cleanedRings(rings);
  if (clean && clean.rings.reduce((s, r) => s + r.length / 2, 0) <= MAX_CORNERS) {
    const standing = new Set(still);
    // Simultaneous events (right-angled outlines meet in single points) are what goes wrong: the corners a little off
    for (const jiggle of [0, 0.003, 0.007]) {
      out = skeletonOf(jiggle ? jiggled(clean.rings, jiggle) : clean.rings, standing);
      if (out) {
        if (jiggle) out.rings = clean.rings;
        break;
      }
    }
  }
  byStill.set(key, out);
  return out;
}

/** Twice the signed area of a ring (positive: counter-clockwise in x, z) */
function area2(ring: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a;
}

/**
 * The rings with repeated corners, spikes and corners nearer than STRAIGHT
 * to the line of their neighbours left out, the outline counter-clockwise
 * and the courtyards clockwise; null when the outline is gone
 */
export function cleanRings(rings: readonly (readonly number[])[]): CleanRings | null {
  const out: CleanRings = { rings: [], from: [], turned: [], ring: [] };
  for (let k = 0; k < rings.length; k++) {
    const pts: number[] = [];
    const from: number[] = [];
    const r = rings[k];
    for (let i = 0; i < r.length; i += 2) {
      pts.push(r[i], r[i + 1]);
      from.push(i / 2);
    }
    let changed = true;
    while (changed && pts.length >= 6) {
      changed = false;
      for (let i = 0; i < pts.length / 2 && pts.length >= 6; ) {
        const m = pts.length / 2;
        const p = (i + m - 1) % m;
        const q = (i + 1) % m;
        const px = pts[2 * p];
        const pz = pts[2 * p + 1];
        const x = pts[2 * i];
        const z = pts[2 * i + 1];
        const qx = pts[2 * q];
        const qz = pts[2 * q + 1];
        const lx = qx - px;
        const lz = qz - pz;
        const l = Math.sqrt(lx * lx + lz * lz);
        const near = (x - px) * (x - px) + (z - pz) * (z - pz) < 1e-4;
        // Its distance from the line of its neighbours; a spike (back the way it came) goes when it is thin
        const off = l > 1e-6 ? Math.abs((x - px) * lz - (z - pz) * lx) / l : 0;
        const back = (x - px) * (qx - x) + (z - pz) * (qz - z) < 0;
        if (near || off < (back ? 0.02 : STRAIGHT)) {
          pts.splice(2 * i, 2);
          from.splice(i, 1);
          changed = true;
        } else {
          i++;
        }
      }
    }
    if (pts.length < 6 || Math.abs(area2(pts)) < 0.5) {
      if (k === 0) return null;
      continue;
    }
    // The outline counter-clockwise, courtyards clockwise: the interior on the left of every wall
    const turn = area2(pts) > 0 !== (k === 0);
    if (turn) {
      const rev: number[] = [];
      for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
      out.rings.push(rev);
      out.from.push([...from].reverse());
    } else {
      out.rings.push(pts);
      out.from.push(from);
    }
    out.turned.push(turn);
    out.ring.push(k);
  }
  return out;
}

/**
 * The cleaned walls (indices ring by ring, as straightSkeleton takes them)
 * that run mostly along the given walls `of` ring `ring` (indices of the
 * given ring: wall k from its corner k to k + 1)
 */
export function cleanedWalls(rings: readonly (readonly number[])[], clean: CleanRings, ring: number, of: readonly number[]): number[] {
  if (!of.length) return [];
  const wanted = new Set(of);
  const out: number[] = [];
  let first = 0;
  clean.rings.forEach((r, c) => {
    const n = r.length / 2;
    if (clean.ring[c] === ring) {
      const src = rings[ring];
      const m = src.length / 2;
      const from = clean.from[c];
      for (let i = 0; i < n; i++) {
        // The given walls between this cleaned wall's two corners, the given ring's way round
        let a = from[i];
        let b = from[(i + 1) % n];
        if (clean.turned[c]) [a, b] = [b, a];
        let along = 0;
        let total = 0;
        for (let k = a, steps = 0; k !== b && steps < m; k = (k + 1) % m, steps++) {
          const j = (k + 1) % m;
          const len = Math.sqrt((src[2 * j] - src[2 * k]) ** 2 + (src[2 * j + 1] - src[2 * k + 1]) ** 2);
          total += len;
          if (wanted.has(k)) along += len;
        }
        if (total > 0 && along >= total / 2) out.push(first + i);
      }
    }
    first += n;
  });
  return out;
}

/** The corners moved up to `by` metres, the same way on every run (a hash of their index) */
function jiggled(rings: readonly number[][], by: number): number[][] {
  let n = 0;
  return rings.map((r) =>
    r.map((v) => {
      const h = Math.imul((++n * 2654435761) ^ 0x9e3779b9, 2246822519) >>> 0;
      return v + ((h % 2001) / 1000 - 1) * by;
    }),
  );
}

/**
 * A corner of the moving walls: where and when it started, its unit
 * direction and the time it gains per metre (0 running along a ridge,
 * Infinity standing still between two walls that stand), its walls
 */
interface Corner {
  x: number;
  z: number;
  t: number;
  dx: number;
  dz: number;
  k: number;
  eL: number;
  eR: number;
  prev: Corner;
  next: Corner;
  node: number;
  valid: boolean;
  reflex: boolean;
}

/** An event: two corners that meet (`b`), or a reflex corner that hits wall `e`; at time t in point x, z */
interface SkEvent {
  t: number;
  seq: number;
  a: Corner;
  b: Corner | null;
  e: number;
  x: number;
  z: number;
}

/** A binary heap of events, earliest first (ties in the order they came) */
class EventHeap {
  private readonly items: SkEvent[] = [];
  get size(): number {
    return this.items.length;
  }
  push(e: SkEvent): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): SkEvent | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l], a[m])) m = l;
        if (r < a.length && before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function before(p: SkEvent, q: SkEvent): boolean {
  return p.t < q.t || (p.t === q.t && p.seq < q.seq);
}

/** The skeleton of cleaned rings with the walls in `still` standing, checked; null where it does not check out */
function skeletonOf(rings: readonly number[][], still: ReadonlySet<number>): Skeleton | null {
  const edges: SkeletonEdge[] = [];
  rings.forEach((r, ring) => {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = r[2 * j] - r[2 * i];
      const dz = r[2 * j + 1] - r[2 * i + 1];
      const len = Math.sqrt(dx * dx + dz * dz);
      edges.push({ ax: r[2 * i], az: r[2 * i + 1], bx: r[2 * j], bz: r[2 * j + 1], dx: dx / len, dz: dz / len, nx: -dz / len, nz: dx / len, len, ring, i, still: still.has(edges.length) });
    }
  });
  // At least one wall must move, or there is no roof
  if (edges.every((e) => e.still)) return null;
  const w = (e: number): number => (edges[e].still ? 0 : 1);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.ax);
    maxX = Math.max(maxX, e.ax);
    minZ = Math.min(minZ, e.az);
    maxZ = Math.max(maxZ, e.az);
  }
  // A wall standing still lets the others run as far as across the outline
  const tMax = Math.max(maxX - minX, maxZ - minZ) + 1;

  // Nodes, snapped together within SNAP on a hash of cells
  const nodes: number[] = [];
  const cells = new Map<number, number[]>();
  const nodeAt = (x: number, z: number, t: number, fresh = false): number => {
    // Cells twice the snap: what lies within it is in this cell or the next one on the near side
    const fx = x / (2 * SNAP);
    const fz = z / (2 * SNAP);
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    if (!fresh) {
      // The cells beside only where the point lies near their border
      const i0 = fx - cx < 0.5 ? -1 : 0;
      const j0 = fz - cz < 0.5 ? -1 : 0;
      for (let i = i0; i <= i0 + 1; i++) {
        for (let j = j0; j <= j0 + 1; j++) {
          for (const id of cells.get((cx + i) * 1e6 + cz + j) ?? []) {
            const ox = nodes[3 * id] - x;
            const oz = nodes[3 * id + 1] - z;
            // One node in one place at one time: over a corner between two walls that stand, the slopes arrive later
            if (ox * ox + oz * oz <= SNAP * SNAP && Math.abs(nodes[3 * id + 2] - t) <= 0.05 + 0.01 * t) return id;
          }
        }
      }
    }
    const id = nodes.length / 3;
    nodes.push(x, z, t);
    const key = cx * 1e6 + cz;
    const list = cells.get(key);
    if (list) list.push(id);
    else cells.set(key, [id]);
    return id;
  };
  const arcs = new Set<number>();
  const links: number[][] = [];
  /** Corners standing still (between two walls that stand) leave no arc: what reaches them runs on above them */
  const standing = new Set<number>();
  const link = (a: number, b: number) => {
    if (a === b || standing.has(a) || standing.has(b)) return;
    const key = a < b ? a * 1e7 + b : b * 1e7 + a;
    if (arcs.has(key)) return;
    arcs.add(key);
    (links[a] ??= []).push(b);
    (links[b] ??= []).push(a);
  };

  const heap = new EventHeap();
  let seq = 0;
  /** Per wall standing still the nodes events left on its line: the corners sliding along it end there */
  const onStill = new Map<number, number[]>();
  const onWall = (node: number, e: number) => {
    if (!edges[e].still) return;
    const list = onStill.get(e);
    if (list) list.push(node);
    else onStill.set(e, [node]);
  };
  /** A node where corners met: on the lines of their walls */
  const onLine = (node: number, ...cs: Corner[]) => {
    for (const c of cs) {
      onWall(node, c.eL);
      onWall(node, c.eR);
    }
  };
  const all: Corner[] = [];
  /** The corners per wall they start a stretch of (Corner.eR): where a reflex corner may hit that wall */
  const starting: Corner[][] = [];
  const corner = (x: number, z: number, t: number, eL: number, eR: number, node: number): Corner => {
    const L = edges[eL];
    const R = edges[eR];
    const cross = L.dx * R.dz - L.dz * R.dx;
    const wL = w(eL);
    const wR = w(eR);
    let dx = 0;
    let dz = 0;
    let k = Infinity;
    // Its velocity keeps it on both walls' lines as they move their speed (a metre a unit of time, or none)
    const det = L.nx * R.nz - L.nz * R.nx;
    if (Math.abs(det) > 1e-9) {
      const vx = (wL * R.nz - L.nz * wR) / det;
      const vz = (L.nx * wR - wL * R.nx) / det;
      const v = Math.sqrt(vx * vx + vz * vz);
      if (v > 1e-12) {
        dx = vx / v;
        dz = vz / v;
        k = 1 / v;
      }
    } else if (L.nx * R.nx + L.nz * R.nz > 0) {
      // In line: it moves with them
      if (wL || wR) {
        dx = L.nx;
        dz = L.nz;
        k = 1;
      }
    } else {
      // Walls back to back (a wing gone to its ridge): the corner runs along the ridge, no time passing
      dx = R.dx;
      dz = R.dz;
      k = 0;
    }
    const c = { x, z, t, dx, dz, k, eL, eR, node, valid: true, reflex: cross < -1e-9 && k < Infinity } as Corner;
    all.push(c);
    (starting[eR] ??= []).push(c);
    return c;
  };
  /** Where corners a and b (a.next) meet, as an event */
  const edgeEvent = (a: Corner, b: Corner) => {
    const E = edges[a.eR];
    if (E.still) {
      // Both on the line of a wall that stands: they slide along it towards each other (or stand)
      const va = a.k === Infinity ? 0 : (a.dx * E.dx + a.dz * E.dz) / a.k;
      const vb = b.k === Infinity ? 0 : (b.dx * E.dx + b.dz * E.dz) / b.k;
      const ua = (a.x - E.ax) * E.dx + (a.z - E.az) * E.dz;
      const ub = (b.x - E.ax) * E.dx + (b.z - E.az) * E.dz;
      const rate = va - vb;
      if (rate <= 1e-12) {
        if (Math.abs(ub - ua) <= SNAP) heap.push({ t: Math.max(a.t, b.t), seq: seq++, a, b, e: -1, x: a.x, z: a.z });
        return;
      }
      const t = (ub - vb * b.t - ua + va * a.t) / rate;
      if (t < Math.max(a.t, b.t) - 1e-9 || t > tMax) return;
      const u = ua + va * (t - a.t);
      heap.push({ t: Math.max(t, a.t, b.t), seq: seq++, a, b, e: -1, x: E.ax + E.dx * u, z: E.az + E.dz * u });
      return;
    }
    const den = a.dx * b.dz - a.dz * b.dx;
    const wx = b.x - a.x;
    const wz = b.z - a.z;
    if (Math.abs(den) < 1e-12) {
      // Running side by side: an event only where they stand together
      if (wx * wx + wz * wz <= SNAP * SNAP) heap.push({ t: Math.max(a.t, b.t), seq: seq++, a, b, e: -1, x: a.x, z: a.z });
      return;
    }
    const s = (wx * b.dz - wz * b.dx) / den;
    const u = (wx * a.dz - wz * a.dx) / den;
    if (s < -1e-7 || u < -1e-7) return;
    const x = a.x + a.dx * s;
    const z = a.z + a.dz * s;
    const t = Math.max((x - E.ax) * E.nx + (z - E.az) * E.nz, a.t, b.t);
    if (t > tMax) return;
    heap.push({ t, seq: seq++, a, b, e: -1, x, z });
  };
  /** Where a reflex corner would hit each wall's line (where it is by then), as events checked when they come */
  const splitEvents = (v: Corner) => {
    for (let e = 0; e < edges.length; e++) {
      if (e === v.eL || e === v.eR) continue;
      const E = edges[e];
      const wE = w(e);
      const A = (v.x - E.ax) * E.nx + (v.z - E.az) * E.nz;
      if (A < wE * v.t - 1e-9) continue;
      // How fast it closes in on the wall's line, per unit time
      const B = (v.dx * E.nx + v.dz * E.nz) / v.k;
      const den = B - wE;
      if (den > -1e-12) continue;
      const t = (B * v.t - A) / den;
      if (t > tMax) continue;
      const s = (t - v.t) / v.k;
      const x = v.x + v.dx * s;
      const z = v.z + v.dz * s;
      if (x < minX - 0.01 || x > maxX + 0.01 || z < minZ - 0.01 || z > maxZ + 0.01) continue;
      heap.push({ t, seq: seq++, a: v, b: null, e, x, z });
    }
  };
  const eventsOf = (c: Corner) => {
    edgeEvent(c.prev, c);
    edgeEvent(c, c.next);
    if (c.reflex && c.k > 0) splitEvents(c);
  };
  /** Where a corner is at time t on its way */
  const at = (c: Corner, t: number): [number, number] => {
    if (c.k <= 1e-12 || c.k === Infinity) return [c.x, c.z];
    const s = (t - c.t) / c.k;
    return [c.x + c.dx * s, c.z + c.dz * s];
  };
  /** A ring of corners down to two (two walls face to face): the two joined by a ridge, both done */
  const closePair = (c: Corner): boolean => {
    if (c.next === c) {
      c.valid = false;
      return true;
    }
    if (c.next.next !== c) return false;
    link(c.node, c.next.node);
    c.valid = c.next.valid = false;
    return true;
  };

  // The rings' corners: nodes 0 on, in order; walls standing still are no links (their gables' chains run along them)
  let edge0 = 0;
  for (const r of rings) {
    const n = r.length / 2;
    const ring: Corner[] = [];
    for (let i = 0; i < n; i++) {
      const node = nodeAt(r[2 * i], r[2 * i + 1], 0, true);
      const c = corner(r[2 * i], r[2 * i + 1], 0, edge0 + ((i + n - 1) % n), edge0 + i, node);
      if (c.k === Infinity) standing.add(node);
      ring.push(c);
    }
    for (let i = 0; i < n; i++) {
      ring[i].next = ring[(i + 1) % n];
      ring[i].prev = ring[(i + n - 1) % n];
      if (!edges[edge0 + i].still) link(ring[i].node, ring[(i + 1) % n].node);
    }
    edge0 += n;
  }
  for (const c of [...all]) {
    edgeEvent(c, c.next);
    if (c.reflex && c.k > 0) splitEvents(c);
  }

  // Each event takes corners away or splits a ring: far more corners than walls is a run going round in circles
  const most = 6 * edges.length + 64;
  while (heap.size) {
    if (all.length > most) return null;
    const ev = heap.pop()!;
    const v = ev.a;
    if (!v.valid) continue;
    if (ev.b) {
      // Two corners meet: the wall between them is gone
      const a = v;
      const b = ev.b;
      if (!b.valid || a.next !== b) continue;
      const node = nodeAt(ev.x, ev.z, ev.t);
      const c = b.next;
      onLine(node, a, b);
      if (c === a) {
        link(a.node, b.node);
        a.valid = b.valid = false;
        continue;
      }
      if (c.next === a) {
        // The last three: the top of a hip or the end of a ridge
        onLine(node, c);
        link(a.node, node);
        link(b.node, node);
        link(c.node, node);
        a.valid = b.valid = c.valid = false;
        continue;
      }
      link(a.node, node);
      link(b.node, node);
      a.valid = b.valid = false;
      if (a.eL === b.eR) continue;
      const w2 = corner(ev.x, ev.z, ev.t, a.eL, b.eR, node);
      w2.prev = a.prev;
      w2.next = c;
      a.prev.next = w2;
      c.prev = w2;
      if (!closePair(w2)) eventsOf(w2);
      continue;
    }
    // A reflex corner hits wall e: on the stretch of its line the event's point lies on
    const E = edges[ev.e];
    let x: Corner | null = null;
    let best = -Infinity;
    for (const c of starting[ev.e] ?? []) {
      if (!c.valid || c.next.eL !== ev.e || c === v || c.next === v) continue;
      const [px, pz] = at(c, ev.t);
      const [qx, qz] = at(c.next, ev.t);
      const from = (ev.x - px) * E.dx + (ev.z - pz) * E.dz;
      const to = (qx - ev.x) * E.dx + (qz - ev.z) * E.dz;
      const margin = Math.min(from, to);
      if (margin >= -1e-5 && margin > best) {
        best = margin;
        x = c;
      }
    }
    if (!x) continue;
    const y = x.next;
    const node = nodeAt(ev.x, ev.z, ev.t);
    onLine(node, v);
    if (E.still) onWall(node, ev.e);
    link(v.node, node);
    v.valid = false;
    const v1 = corner(ev.x, ev.z, ev.t, v.eL, ev.e, node);
    const v2 = corner(ev.x, ev.z, ev.t, ev.e, v.eR, node);
    const vp = v.prev;
    const vn = v.next;
    vp.next = v1;
    v1.prev = vp;
    v1.next = y;
    y.prev = v1;
    x.next = v2;
    v2.prev = x;
    v2.next = vn;
    vn.prev = v2;
    if (!closePair(v1)) eventsOf(v1);
    if (!closePair(v2)) eventsOf(v2);
  }
  if (all.some((c) => c.valid)) return null;

  // The faces: round each moving wall's face, from its end, the arc turning least clockwise from the way back each time
  const nodeCount = nodes.length / 3;
  for (let k = 0; k < nodeCount; k++) links[k] ??= [];
  const faces: number[][] = [];
  const chains: number[][] = [];
  let first = 0;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const a = first + i;
      const b = first + ((i + 1) % n);
      const E = edges[a];
      if (E.still) {
        faces.push([]);
        chains[a] = chainAlong(nodes, E, a, b, onStill.get(a) ?? []);
        continue;
      }
      const face = [a, b];
      let prev = a;
      let cur = b;
      for (let steps = 0; ; steps++) {
        if (steps > nodeCount) return null;
        const next = turnFrom(nodes, links[cur], cur, prev);
        if (next < 0) return null;
        if (next === a) break;
        face.push(next);
        prev = cur;
        cur = next;
      }
      faces.push(face);
    }
    first += n;
  }
  let maxT = 0;
  for (let k = 0; k < nodeCount; k++) maxT = Math.max(maxT, nodes[3 * k + 2]);
  const sk: Skeleton = { rings: rings.map((r) => [...r]), edges, nodes, links, faces, chains, maxT };
  return checks(sk) ? sk : null;
}

/** The nodes events left on the line of a wall that stands still (`left`), from its start a to its end b: the top of its gable */
function chainAlong(nodes: readonly number[], E: SkeletonEdge, a: number, b: number, left: readonly number[]): number[] {
  const on: { k: number; u: number }[] = [];
  for (const k of new Set(left)) {
    // Nodes over its ends too: the slopes reach a corner between two walls that stand above it
    if (k === a || k === b || nodes[3 * k + 2] <= 1e-3) continue;
    const ox = nodes[3 * k] - E.ax;
    const oz = nodes[3 * k + 1] - E.az;
    const u = ox * E.dx + oz * E.dz;
    if (u < -2 * SNAP || u > E.len + 2 * SNAP || Math.abs(ox * E.nx + oz * E.nz) > 2 * SNAP) continue;
    on.push({ k, u });
  }
  on.sort((p, q) => p.u - q.u);
  return [a, ...on.map((o) => o.k), b];
}

/** Of the nodes linked to `cur`, the one turning least clockwise from the way back to `prev`; -1 for none */
function turnFrom(nodes: readonly number[], around: readonly number[], cur: number, prev: number): number {
  const cx = nodes[3 * cur];
  const cz = nodes[3 * cur + 1];
  const back = diamond(nodes[3 * prev] - cx, nodes[3 * prev + 1] - cz);
  let best = -1;
  let bestTurn = Infinity;
  for (const w of around) {
    if (w === prev) continue;
    let turn = back - diamond(nodes[3 * w] - cx, nodes[3 * w + 1] - cz);
    if (turn <= 0) turn += 4;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = w;
    }
  }
  return best;
}

/** An angle's stand-in from 0 to 4, rising counter-clockwise from +x as the angle does: only + - * / */
function diamond(x: number, z: number): number {
  if (z >= 0) return x >= 0 ? z / (x + z || 1) : 1 - x / (-x + z);
  return x < 0 ? 2 - z / (-x - z) : 3 + x / (x - z);
}

/**
 * Whether a skeleton checks out: every moving wall's face a simple polygon
 * round it, every corner of it on its wall's slope (its time its distance
 * from the wall's line), the faces together the outline less its courtyards
 */
function checks(sk: Skeleton): boolean {
  const { edges, nodes, faces, rings } = sk;
  let total = 0;
  for (const r of rings) total += area2(r);
  let sum = 0;
  for (let k = 0; k < faces.length; k++) {
    if (edges[k].still) continue;
    const f = faces[k];
    if (f.length < 3) return false;
    const seen = new Set(f);
    if (seen.size !== f.length) return false;
    const E = edges[k];
    let a = 0;
    for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
      const p = f[i];
      const x = nodes[3 * p];
      const z = nodes[3 * p + 1];
      const t = nodes[3 * p + 2];
      const d = (x - E.ax) * E.nx + (z - E.az) * E.nz;
      if (t < -1e-6 || Math.abs(d - t) > PLANE_SLACK + 0.002 * t) return false;
      a += nodes[3 * f[j]] * z - x * nodes[3 * f[j] + 1];
    }
    if (a <= 0) return false;
    sum += a;
  }
  return Math.abs(sum - total) <= 0.004 * Math.abs(total) + 0.1;
}
