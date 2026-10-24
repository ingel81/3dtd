/**
 * The ground under the buildings (buildings.ts, step 6): where no building
 * may cut it (roads), a model's floor at the ground before its entrance,
 * the slope cut to that floor up the hill with a yard, a bank and a
 * retaining wall where the bank would stand high.
 */
import type { CustomMapDocument, MapMass, MapObject, MapPoint } from '../../custom-map/map-document';
import { BANK_REACH, BANK_SLOPE, ENTRANCE_OUT, MAX_BASEMENT, RETAINING_ASSET, RETAINING_BOX, RETAINING_FROM, RETAINING_HOLD, RETAINING_HQ_CLEAR, ROAD_GUARD, SCALE_MAX, SCALE_MIN, UPHILL, YARD } from './building-config';
import { pointSegmentDistance } from '../../../map-ops/path-graph';
import type { Placement } from './building-types';
import { type GroundBox, groundRing, toModel } from '../../custom-map/object-ground';
import { boxCorners, boxDistance, origin, rightOf, toBox } from './building-placement';
import { heightAt } from '../../../map-ops/grid';
import { BoxIndex } from './building-indexes';
import { round2, round3 } from './geom';
import { massOnRamp } from '../../custom-map/object-mass';
import { waterLevelAt } from '../../custom-map/water-level';

/** Height samples beside the roads (their half width and ROAD_GUARD) and under water: the pads leave them */
export function roadGuard(doc: CustomMapDocument): Uint8Array {
  const t = doc.terrain;
  const g = t.grid;
  const mask = new Uint8Array(g.columns * g.rows);
  const nodes = new Map(doc.paths.nodes.map((nd) => [nd.id, nd]));
  for (const e of doc.paths.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    const line = [a, ...(e.via ?? []), b];
    const reach = e.width / 2 + ROAD_GUARD;
    for (let s = 0; s + 1 < line.length; s++) {
      const p = line[s];
      const q = line[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach + t.width / 2) / g.cellSize));
      const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(p.x, q.x) + reach + t.width / 2) / g.cellSize));
      const j0 = Math.max(0, Math.floor((Math.min(p.y, q.y) - reach + t.depth / 2) / g.cellSize));
      const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(p.y, q.y) + reach + t.depth / 2) / g.cellSize));
      for (let j = j0; j <= j1; j++) {
        const y = -t.depth / 2 + j * g.cellSize;
        for (let i = i0; i <= i1; i++) {
          const x = -t.width / 2 + i * g.cellSize;
          if (pointSegmentDistance({ x, y }, p, q) <= reach) mask[j * g.columns + i] = 1;
        }
      }
    }
  }
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (!body) continue;
    for (let k = 0; k < mask.length; k++) if (body.mask[k]) mask[k] = 1;
  }
  return mask;
}

/**
 * The floor a building stands at on a slope: the ground before its entrance
 * (ENTRANCE_OUT outside the middle of its front wall, on hill `t` as it
 * was), within the ground under its walls and at most MAX_BASEMENT over the
 * lowest of it. That lowest (its corners and the points the renderer seats
 * it by, the catalogue's footprint at scale 1 and ground rectangle,
 * object-seat.ts) for one without an `entrance`. A car park's ramp before
 * the building is no ground it stands on
 */
export function floorLevel(
  t: CustomMapDocument['terrain'],
  pl: Placement,
  footprint: number,
  box: GroundBox | undefined,
  onRamp: ((x: number, y: number) => boolean) | undefined,
  entrance: boolean,
): number {
  const o = origin(pl);
  let low = heightAt(t, o.x, o.y);
  let high = low;
  for (const c of boxCorners(pl)) {
    if (onRamp?.(c.x, c.y)) continue;
    const h = heightAt(t, c.x, c.y);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  // The samples round each seat point, not the ground between them: one beside a seat point under the floor would
  // pull the seat under it
  const ring = groundRing(footprint, box, { x: o.x, y: o.y, rotation: pl.rotation, scale: pl.scale });
  for (let k = 0; k < ring.length; k += 2) if (!onRamp?.(ring[k], ring[k + 1])) low = Math.min(low, lowestSample(t, ring[k], ring[k + 1]));
  if (!entrance) return low;
  // Before its door: the front, or the side its door is in (doorFace)
  const f = pl.doorFace ?? pl.front;
  const r = rightOf(f);
  const turned = !!pl.doorFace && Math.abs(f.x * pl.front.x + f.y * pl.front.y) < 0.5;
  const d = (turned ? pl.hw : pl.hd) + ENTRANCE_OUT;
  const half = turned ? pl.hd : pl.hw;
  let sum = 0;
  for (const u of [-0.3, 0, 0.3]) sum += heightAt(t, pl.p.x + f.x * d + r.x * half * 2 * u, pl.p.y + f.y * d + r.y * half * 2 * u);
  return Math.min(Math.max(sum / 3, low), high, low + MAX_BASEMENT);
}

/**
 * Cuts the hill round a building down to its floor: level under its walls
 * and YARD beyond them, then a bank rising at BANK_SLOPE back to the hill,
 * BANK_REACH past the yard at most. Along a side where the hill past the yard
 * stands more than RETAINING_FROM over the floor, retaining walls at the
 * yard's edge (their face to the building, the yard's width past the
 * corners) hold it instead and the bank rises from RETAINING_HOLD over the
 * floor behind them; a stretch where no wall can stand (a road, water, the
 * map's edge, the next building) keeps the bank. Never under a road or in
 * water, nothing filled: towards the valley the hill stays, the building's
 * cellar shows there (MapObject.cellar). Without `onRoad` no walls.
 * The walls and the deepest cut
 */
export function cutSlope(
  doc: CustomMapDocument,
  pl: Placement,
  floor: number,
  guard: Uint8Array,
  onRoad: ((o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale'>) => boolean) | null,
  boxes: BoxIndex,
): { depth: number; walls: Omit<MapObject, 'id'>[] } {
  const t = doc.terrain;
  const g = t.grid;
  const f = pl.front;
  const r = rightOf(f);
  const [wl, wd] = RETAINING_BOX;
  // Each side: its outward normal and the way along it, which of the box's coordinates (toBox: s along r, t along f)
  // runs across it and with what sign, its half length, its distance from the middle; its walls' stretches
  const sides = [
    { n: f, along: r, across: 't' as const, sign: 1, half: pl.hw, off: pl.hd },
    { n: { x: -f.x, y: -f.y }, along: r, across: 't' as const, sign: -1, half: pl.hw, off: pl.hd },
    { n: r, along: f, across: 's' as const, sign: 1, half: pl.hd, off: pl.hw },
    { n: { x: -r.x, y: -r.y }, along: f, across: 's' as const, sign: -1, half: pl.hd, off: pl.hw },
  ].map((side) => {
    const run = side.half * 2 + YARD * 2;
    const count = Math.max(1, Math.round(run / wl));
    return { ...side, run, count, held: new Array<boolean>(count).fill(false) };
  });
  const walls: Omit<MapObject, 'id'>[] = [];
  // Walls only across the slope, on the sides facing up the hill: along it the bank runs down beside the building
  const mid = (d: MapPoint, k: number) => heightAt(t, pl.p.x + d.x * k, pl.p.y + d.y * k);
  const up = { x: f.x * (mid(f, pl.hd) - mid(f, -pl.hd)) / (2 * pl.hd) + r.x * (mid(r, pl.hw) - mid(r, -pl.hw)) / (2 * pl.hw), y: 0 };
  up.y = f.y * (mid(f, pl.hd) - mid(f, -pl.hd)) / (2 * pl.hd) + r.y * (mid(r, pl.hw) - mid(r, -pl.hw)) / (2 * pl.hw);
  const steep = Math.hypot(up.x, up.y);
  for (const side of onRoad ? sides : []) {
    if (side.half * 2 < 4 || side.n.x * up.x + side.n.y * up.y < UPHILL * steep) continue;
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, side.run / (side.count * wl)));
    for (let k = 0; k < side.count; k++) {
      const u = -side.run / 2 + (k + 0.5) * (side.run / side.count);
      const at = (d: number) => ({ x: pl.p.x + side.n.x * (side.off + d) + side.along.x * u, y: pl.p.y + side.n.y * (side.off + d) + side.along.y * u });
      const behind = at(YARD + wd + 1.5);
      if (!(heightAt(t, behind.x, behind.y) - floor > RETAINING_FROM)) continue;
      const p = at(YARD + wd / 2);
      // Its face to the building; not on a road (the editor's check), not in the water or off the map, not in the next building
      const wall = { asset: RETAINING_ASSET, x: round2(p.x), y: round2(p.y), rotation: round3(Math.atan2(side.n.x, -side.n.y)), scale: round3(scale) };
      if (onRoad!(wall) || inWater(t, p.x, p.y) || Math.abs(p.x) > t.width / 2 - wl || Math.abs(p.y) > t.depth / 2 - wl) continue;
      // The room round the HQ takes none, as it takes no furniture
      if (Math.hypot(p.x - doc.hq.x, p.y - doc.hq.y) < RETAINING_HQ_CLEAR) continue;
      if (boxes.near(p).some((q) => q !== pl && boxDistance(q, p) < wd)) continue;
      walls.push({ ...wall, z: 0 });
      side.held[k] = true;
    }
  }
  const corners = boxCorners(pl, YARD + wd + BANK_REACH);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) + t.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + t.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) + t.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + t.depth / 2) / g.cellSize));
  let depth = 0;
  for (let j = j0; j <= j1; j++) {
    const y = -t.depth / 2 + j * g.cellSize;
    for (let i = i0; i <= i1; i++) {
      const k = j * g.columns + i;
      const h = g.heights[k];
      if (guard[k] || h <= floor) continue;
      const x = -t.width / 2 + i * g.cellSize;
      const b = toBox(pl, { x, y });
      const dist = Math.hypot(Math.max(0, Math.abs(b.s) - pl.hw), Math.max(0, Math.abs(b.t) - pl.hd));
      let allowed = dist <= YARD ? floor : dist <= YARD + BANK_REACH ? floor + (dist - YARD) * BANK_SLOPE : Infinity;
      if (dist > YARD) {
        // Behind a retaining wall the hill it holds, a bank over its top
        for (const side of sides) {
          const e = side.sign * b[side.across] - side.off;
          const a = side.across === 't' ? b.s : b.t;
          if (e <= YARD || e > YARD + wd + BANK_REACH || Math.abs(a) > side.run / 2) continue;
          const piece = Math.min(side.count - 1, Math.floor(((a + side.run / 2) / side.run) * side.count));
          if (!side.held[piece]) continue;
          const held = e <= YARD + wd ? floor : floor + RETAINING_HOLD + (e - YARD - wd) * BANK_SLOPE;
          allowed = allowed === Infinity ? held : Math.max(allowed, held);
        }
      }
      if (h > allowed) {
        depth = Math.max(depth, h - allowed);
        g.heights[k] = allowed;
      }
    }
  }
  return { depth, walls };
}

/** Whether map point (x, y) lies in the cutting of a car park's ramp before raised building `o` (object-mass.ts massOnRamp) */
export function onRampAt(o: Pick<MapObject, 'x' | 'y' | 'rotation' | 'scale'>, mass: MapMass, x: number, y: number): boolean {
  const m = toModel(x - o.x, y - o.y, Math.cos(o.rotation), Math.sin(o.rotation));
  const s = o.scale || 1;
  return massOnRamp(mass, m.x / s, m.z / s);
}

/** The lowest of the four height samples round map point (x, y) */
function lowestSample(t: CustomMapDocument['terrain'], x: number, y: number): number {
  const g = t.grid;
  const fi = Math.min(g.columns - 1, Math.max(0, (x + t.width / 2) / g.cellSize));
  const fj = Math.min(g.rows - 1, Math.max(0, (y + t.depth / 2) / g.cellSize));
  let low = Infinity;
  for (const j of [Math.floor(fj), Math.ceil(fj)]) for (const i of [Math.floor(fi), Math.ceil(fi)]) low = Math.min(low, g.heights[j * g.columns + i]);
  return low;
}

/** Whether map (x, y) lies in a water body's mask (its nearest height sample) or a river */
function inWater(t: CustomMapDocument['terrain'], x: number, y: number): boolean {
  const g = t.grid;
  const i = Math.round((x + t.width / 2) / g.cellSize);
  const j = Math.round((y + t.depth / 2) / g.cellSize);
  if (i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
    const k = j * g.columns + i;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) if (body?.mask[k]) return true;
  }
  return waterLevelAt(t, x, y, heightAt(t, x, y)) !== null;
}
