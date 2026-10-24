/**
 * The ground under the railways (rails.ts, phase 2): each chain's profile
 * smoothed along it and agreed where lines meet, the beds levelled with
 * their shoulders, crossings flush with the road, the gravel painted.
 */
import type { MapPaths, MapPoint, MapTerrain } from '../../custom-map/map-document';
import type { RailBridge, RailChain, RailGroundReport, RailPlan } from './rails-types';
import { HeightField } from '../../custom-map/render/height-field';
import { bridgeDecks, deckHeightAt } from '../../custom-map/bridge-decks';
import { BED_HALF, BRANCH_RAMP, BRANCH_REACH, CROSSING_RAMP, CROSSING_SINK, FIELD_PASSES, FIELD_REACH, OVER_CLEARANCE, PROFILE_STEP, RAIL_DECK_DEPTH, RAMP_GRADE, RAMP_MAX, RAMP_MIN, ROAD_DECK_DEPTH, SMOOTHING, SMOOTHING_BUILT, STREET_SINK, UNDER_CLEARANCE } from './rails-config';
import { crossingSpan, LineIndex, merged, outside, pointOn, profileAt, roadReach, segmentAt, smooth } from './rails-lines';
import { heightAt } from '../../../map-ops/grid';
import { bridgeWaterLevel } from '../../custom-map/render/paths/bridge-water';
import { EdgeIndex } from '../../../map-ops/path-graph';
import { type PaintBand, paintBands } from './roads';

/**
 * The profile of every line (RailChain.profile) and the ground levelled to
 * it under the beds (after the roads are levelled and the water carved).
 * `keep`: ground samples left alone besides the roads of `paths` with
 * their pavements (the road bands and the water)
 */
export function levelRails(terrain: MapTerrain, plan: RailPlan, paths: MapPaths, keep?: (k: number) => boolean): RailGroundReport {
  const report: RailGroundReport = { samples: 0, raisedM: 0, loweredM: 0 };
  const field = new HeightField(terrain.grid, terrain.width, terrain.depth);
  const decks = plan.overpasses.length ? bridgeDecks(paths, terrain, field) : [];
  // Per line the samples its bridges raise and its road bridges lower, ramps included (agreeField)
  const raised: Uint8Array[] = [];
  const lowered: Uint8Array[] = [];
  plan.chains.forEach((c, ci) => {
    const bridges = plan.bridges.filter((b) => b.chain === ci);
    const base = groundProfile(c, terrain, bridges);
    const out = Float32Array.from(base);
    const n = base.length;
    const sAt = (k: number) => Math.min(c.length, k * PROFILE_STEP);
    const baseAt = (s: number) => {
      const f = Math.max(0, Math.min(n - 1, s / PROFILE_STEP));
      const k = Math.min(n - 2, Math.floor(f));
      return k < 0 ? base[0] : base[k] + (base[k + 1] - base[k]) * (f - k);
    };
    // A bump of `d` metres over [from, to], ramped out on both sides. Bumps up take the highest where they overlap,
    // bumps down the lowest: two bridges side by side (a short one over a footway, then the long one over the
    // river) raised the line between them twice, and it fell from that hump onto the deck at a tilt
    const up = new Float32Array(n);
    const down = new Float32Array(n);
    const bump = (from: number, to: number, d: number) => {
      const ramp = Math.max(RAMP_MIN, Math.min(RAMP_MAX, Math.abs(d) / RAMP_GRADE));
      for (let k = 0; k < n; k++) {
        const s = sAt(k);
        const off = s < from ? from - s : s > to ? s - to : 0;
        if (off >= ramp) continue;
        const v = d * (1 - smooth(off / ramp));
        if (v > 0) up[k] = Math.max(up[k], v);
        else down[k] = Math.min(down[k], v);
      }
    };
    for (const b of bridges) {
      const hA = baseAt(b.from);
      const hB = baseAt(b.to);
      const deck = (s: number) => hA + ((hB - hA) * (s - b.from)) / Math.max(1e-6, b.to - b.from);
      let d = 0;
      for (const u of b.under) d = Math.max(d, heightAt(terrain, u.at.x, u.at.y) + u.clear + RAIL_DECK_DEPTH - deck(u.along));
      const water = bridgeWaterLevel(slice(c, b.from, b.to), terrain, field);
      if (Number.isFinite(water)) d = Math.max(d, water + UNDER_CLEARANCE.water + RAIL_DECK_DEPTH - Math.min(hA, hB));
      if (d > 0.01) {
        bump(b.from, b.to, d);
        report.raisedM = Math.max(report.raisedM, d);
      }
    }
    const electrified = c.ways.some((w) => w.tags['electrified'] === 'contact_line');
    for (const o of plan.overpasses.filter((x) => x.chain === ci)) {
      const top = deckHeightAt(decks, o.at.x, o.at.y);
      if (!Number.isFinite(top)) continue;
      const d = top - ROAD_DECK_DEPTH - (electrified ? OVER_CLEARANCE.electrified : OVER_CLEARANCE.plain) - baseAt(o.along);
      if (d < -0.01) {
        bump(o.along - o.half, o.along + o.half, d);
        report.loweredM = Math.max(report.loweredM, -d);
      }
    }
    for (let k = 0; k < n; k++) out[k] += up[k] + down[k];
    raised[ci] = Uint8Array.from(up, (v) => (v > 0.01 ? 1 : 0));
    lowered[ci] = Uint8Array.from(down, (v) => (v < -0.01 ? 1 : 0));
    // Where the line runs in a road: STREET_SINK under it (the road's height at the line, held from the stretch's ends on)
    for (const st of plan.streets.filter((x) => x.chain === ci)) {
      for (let k = 0; k < n; k++) {
        const s = sAt(k);
        const off = s < st.from ? st.from - s : s > st.to ? s - st.to : 0;
        if (off >= CROSSING_RAMP) continue;
        const p = pointOn(c, Math.max(st.from, Math.min(st.to, s)));
        const h = heightAt(terrain, p.x, p.y) - STREET_SINK;
        out[k] = h + (out[k] - h) * smooth(off / CROSSING_RAMP);
      }
    }
    // Last: CROSSING_SINK under the road at each level crossing, the road's height read on its middle (it is level
    // across) where the line crosses it, held from its edges on: a graded road climbs across a slanted crossing
    for (const x of plan.crossings.filter((x) => x.chain === ci)) {
      const reach = roadReach(c, x);
      for (let k = 0; k < n; k++) {
        const s = sAt(k);
        const off = Math.max(0, Math.abs(s - x.along) - x.half);
        if (off >= CROSSING_RAMP) continue;
        const p = pointOn(c, Math.max(x.along - reach, Math.min(x.along + reach, s)));
        const d = (p.x - x.at.x) * x.roadDir.x + (p.y - x.at.y) * x.roadDir.y;
        const h = heightAt(terrain, x.at.x + x.roadDir.x * d, x.at.y + x.roadDir.y * d) - CROSSING_SINK;
        out[k] = h + (out[k] - h) * smooth(off / CROSSING_RAMP);
      }
    }
    c.profile = out;
  });
  const lines = new LineIndex(plan.chains);
  // The lines of a track field at one level, before the branches take their lines' heights
  agreeField(plan, lines, raised, lowered);
  // A line starting or ending on another (a branch at a switch) takes that line's height there, over BRANCH_RAMP
  const ends = plan.chains.map((c) =>
    [0, c.length].map((s) => {
      const on = lines.nearest(pointOn(c, s), BRANCH_REACH, c);
      if (!on || plan.bridges.some((b) => b.chain === plan.chains.indexOf(on.chain) && on.along > b.from && on.along < b.to)) return NaN;
      const there = profileAt(on.chain, on.along, terrain);
      // Two ends meeting (a bend too sharp for a through line): halfway, so both come to the same height
      return on.along < BRANCH_REACH || on.along > on.chain.length - BRANCH_REACH ? (there + profileAt(c, s, terrain)) / 2 : there;
    }),
  );
  plan.chains.forEach((c, ci) => {
    const out = c.profile!;
    const [h0, h1] = ends[ci];
    const d0 = h0 === h0 ? h0 - out[0] : 0;
    const d1 = h1 === h1 ? h1 - out[out.length - 1] : 0;
    if (!d0 && !d1) return;
    for (let k = 0; k < out.length; k++) {
      const s = Math.min(c.length, k * PROFILE_STEP);
      out[k] += d0 * (1 - smooth(s / BRANCH_RAMP)) + d1 * (1 - smooth((c.length - s) / BRANCH_RAMP));
    }
  });
  report.raisedM = Math.round(report.raisedM * 100) / 100;
  report.loweredM = Math.round(report.loweredM * 100) / 100;
  report.samples = levelBeds(terrain, plan, paths, keep);
  return report;
}

/**
 * The lines of a track field brought to one level: each line's profile is
 * its own (the ground along it, averaged; its bridges' and crossings'
 * bumps), and the ground under the beds took the nearest line's. Side by
 * side, four or five metres apart, two lines met a metre or more apart in
 * height (a siding averaged over less toward its end, a bridge's bump of its
 * own for each track over an underpass), the beds' ground stepped between
 * them and the steps showed as rock between the tracks (Würzburg: 1248 of
 * 14291 pairs of samples 3 to 7 m apart, the ground under them as level as
 * the lines' own). Each sample takes, FIELD_PASSES times, the mean of its
 * own height and those of the other lines within FIELD_REACH, the nearer
 * weighing more. Crossings and street track keep theirs (the road's level),
 * a bridge's span and its ramps (`raised`) only rise (its headroom), a
 * stretch under a road bridge and its ramps (`lowered`) only sink (the
 * bridge's): the lines beside them come to them, so a field's tracks rise
 * over an underpass together
 */
function agreeField(plan: RailPlan, lines: LineIndex, raised: readonly Uint8Array[], lowered: readonly Uint8Array[]): void {
  const within = (ci: number, list: readonly (readonly [number, number])[]) => {
    const c = plan.chains[ci];
    return Uint8Array.from(c.profile ?? [], (_, k) => (list.some(([a, b]) => k * PROFILE_STEP >= a && k * PROFILE_STEP <= b) ? 1 : 0));
  };
  const fixed = plan.chains.map((_, ci) =>
    within(ci, [...plan.crossings.filter((x) => x.chain === ci).map((x) => crossingSpan(x)), ...plan.streets.filter((x) => x.chain === ci).map((x) => [x.from, x.to] as const)]),
  );
  const bridged = plan.chains.map((_, ci) => within(ci, plan.bridges.filter((b) => b.chain === ci).map((b) => [b.from, b.to] as const)));
  const under = plan.chains.map((_, ci) => within(ci, plan.overpasses.filter((o) => o.chain === ci).map((o) => [o.along - o.half, o.along + o.half] as const)));
  const floor = bridged.map((b, ci) => b.map((v, k) => v | (raised[ci]?.[k] ?? 0)));
  const ceiling = under.map((u, ci) => u.map((v, k) => v | (lowered[ci]?.[k] ?? 0)));
  const own = plan.chains.map((c) => Float32Array.from(c.profile ?? []));
  // Per sample the other lines near it: their index, the metres along them, the weight
  const near = plan.chains.map((c, ci) =>
    Array.from(c.profile ?? [], (_, k) => {
      if (fixed[ci][k]) return [];
      const at = pointOn(c, Math.min(c.length, k * PROFILE_STEP));
      return lines.within(at, FIELD_REACH, c).map((n) => ({ chain: plan.chains.indexOf(n.chain), along: n.along, w: 1 - n.dist / FIELD_REACH }));
    }),
  );
  for (let pass = 0; pass < FIELD_PASSES; pass++) {
    const next = plan.chains.map((c, ci) =>
      Float32Array.from(c.profile ?? [], (h, k) => {
        const list = near[ci][k];
        if (!list.length) return h;
        let sum = h;
        let weight = 1;
        for (const n of list) {
          const other = plan.chains[n.chain].profile;
          if (!other) continue;
          sum += sampled(other, n.along) * n.w;
          weight += n.w;
        }
        const mean = sum / weight;
        if (floor[ci][k]) return Math.max(own[ci][k], mean);
        if (ceiling[ci][k]) return Math.min(own[ci][k], mean);
        return mean;
      }),
    );
    plan.chains.forEach((c, ci) => {
      if (c.profile) c.profile = next[ci];
    });
  }
}

/** A profile's height at `along` metres, between its samples */
function sampled(profile: Float32Array, along: number): number {
  const f = Math.max(0, Math.min(profile.length - 1, along / PROFILE_STEP));
  const k = Math.min(profile.length - 2, Math.floor(f));
  return k < 0 ? profile[0] : profile[k] + (profile[k + 1] - profile[k]) * (f - k);
}

/**
 * The ground along a line every PROFILE_STEP metres, straight over its
 * bridges, averaged over SMOOTHING metres (SMOOTHING_BUILT on ways tagged
 * `embankment` or `cutting`); toward its ends over less, evenly either side,
 * so a line ends on the ground there (lines meeting at a switch agree) and
 * a grade stays a grade
 */
function groundProfile(c: RailChain, terrain: MapTerrain, bridges: readonly RailBridge[]): Float32Array {
  const n = Math.max(2, Math.ceil(c.length / PROFILE_STEP) + 1);
  const raw = new Float64Array(n);
  const wide = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = Math.min(c.length, k * PROFILE_STEP);
    const p = pointOn(c, s);
    raw[k] = heightAt(terrain, p.x, p.y);
    const t = c.ways[segmentAt(c, s)].tags;
    wide[k] = t['embankment'] === 'yes' || t['cutting'] === 'yes' ? 1 : 0;
  }
  // Over a bridge, straight from end to end: the ground under it is no part of the line
  for (const b of bridges) {
    const k0 = Math.max(0, Math.floor(b.from / PROFILE_STEP));
    const k1 = Math.min(n - 1, Math.ceil(b.to / PROFILE_STEP));
    for (let k = k0 + 1; k < k1; k++) raw[k] = raw[k0] + ((raw[k1] - raw[k0]) * (k - k0)) / (k1 - k0);
  }
  const sum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) sum[k + 1] = sum[k] + raw[k];
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const half = Math.min(Math.round((wide[k] ? SMOOTHING_BUILT : SMOOTHING) / PROFILE_STEP / 2), k, n - 1 - k);
    out[k] = (sum[k + half + 1] - sum[k - half]) / (2 * half + 1);
  }
  return out;
}

/** The points of the line from `from` to `to` metres */
function slice(c: RailChain, from: number, to: number): MapPoint[] {
  const out = [pointOn(c, from)];
  for (let k = 0; k < c.line.length; k++) if (c.at[k] > from && c.at[k] < to) out.push(c.line[k]);
  out.push(pointOn(c, to));
  return out;
}

/** Most metres a bed's shoulder reaches past its levelled width (1:1.5 down a high embankment) */
const SHOULDER_MAX = 12;
const SHOULDER_MIN = 1.5;
const SHOULDER_SLOPE = 1.5;

/**
 * Levels the ground under the beds to the lines' profiles: the nearest
 * line's, flat over BED_HALF, the shoulder fading over 1.5 times the step
 * it makes; under a level crossing's panels and street track past the road
 * their sink higher, at the road's level (they lie in the ground as on the
 * road, the bed's ground falls to the formation where they end); the bridges'
 * ground, the roads with their pavements and what `keep` names untouched.
 * Returns the samples changed.
 */
function levelBeds(terrain: MapTerrain, plan: RailPlan, paths: MapPaths, keep?: (k: number) => boolean): number {
  const g = terrain.grid;
  const cs = g.cellSize;
  const ox = -terrain.width / 2;
  const oy = -terrain.depth / 2;
  const reach = BED_HALF + SHOULDER_MAX;
  // Per sample the nearest line's distance and its profile there (NaN: over a bridge); the samples touched in order
  const dist = new Float32Array(g.columns * g.rows).fill(Infinity);
  const target = new Float32Array(g.columns * g.rows);
  const touched: number[] = [];
  plan.chains.forEach((c, ci) => {
    if (!c.profile) return;
    const bridges = plan.bridges.filter((b) => b.chain === ci);
    // Under a crossing's panels and street track past the road: its level, the formation's sink higher
    const flush = [
      ...plan.crossings.filter((x) => x.chain === ci).map((x) => [...crossingSpan(x), CROSSING_SINK] as const),
      ...plan.streets.filter((x) => x.chain === ci).map((x) => [x.from, x.to, STREET_SINK] as const),
    ];
    for (let k = 0; k + 1 < c.line.length; k++) {
      const a = c.line[k];
      const b = c.line[k + 1];
      const len = c.at[k + 1] - c.at[k];
      if (len <= 0) continue;
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - ox) / cs));
      const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(a.x, b.x) + reach - ox) / cs));
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - oy) / cs));
      const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(a.y, b.y) + reach - oy) / cs));
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * cs;
        for (let i = i0; i <= i1; i++) {
          const x = ox + i * cs;
          const t = Math.max(0, Math.min(len, (x - a.x) * dx + (y - a.y) * dy));
          const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
          const key = j * g.columns + i;
          if (d >= reach || d >= dist[key]) continue;
          if (dist[key] === Infinity) touched.push(key);
          dist[key] = d;
          const along = c.at[k] + t;
          target[key] = bridges.some((br) => along > br.from - 0.5 && along < br.to + 0.5)
            ? NaN
            : profileAt(c, along, terrain) + lift(flush, along, d);
        }
      }
    }
  });
  // The roads with their pavements (drawn over the ground as the road is): a pavement levelled down would sink under the bed
  const roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => e.kind !== 'bridge' && !e.tunnel) });
  const underRoad = (key: number): boolean => {
    const hit = roads.nearest({ x: ox + (key % g.columns) * cs, y: oy + Math.floor(key / g.columns) * cs }, 20);
    return !!hit && hit.dist < hit.edge.width / 2 + (hit.edge.sidewalk ?? 0) + 0.25;
  };
  const onRoad = keep ? (key: number) => keep(key) || underRoad(key) : underRoad;
  let changed = 0;
  for (const key of touched) {
    const h = target[key];
    const d = dist[key];
    if (h !== h) continue;
    const cur = g.heights[key];
    const shoulder = Math.max(SHOULDER_MIN, Math.min(SHOULDER_MAX, Math.abs(h - cur) * SHOULDER_SLOPE));
    if (d >= BED_HALF + shoulder || onRoad(key)) continue;
    const w = d <= BED_HALF ? 1 : 1 - smooth((d - BED_HALF) / shoulder);
    g.heights[key] = cur + (h - cur) * w;
    changed++;
  }
  return changed;
}

/**
 * How far the ground at a bed sample `d` metres from the line stands over its
 * profile: under a crossing's panels or street track (`flush`: from, to,
 * sink) the sink, the road's level; beside the bed past their end it falls
 * back over FLUSH_FADE, so no ledge stands where they end (the bed itself
 * drops to the formation there, its ballast showing under their edge)
 */
function lift(flush: readonly (readonly [number, number, number])[], along: number, d: number): number {
  let out = 0;
  for (const [from, to, sink] of flush) {
    const off = along < from ? from - along : along > to ? along - to : 0;
    if (off === 0) return sink;
    if (d > BED_HALF && off < FLUSH_FADE) out = Math.max(out, sink * (1 - smooth(off / FLUSH_FADE)));
  }
  return out;
}

/** Metres beside the bed over which the ground falls from a crossing's or street track's level to the land's past their end */
const FLUSH_FADE = 6;

/** The ground beside a bed: gravel over its foot and a strip past it, fading into the land */
export const RAIL_GROUND = { material: 'gravel', half: BED_HALF + 0.6, soft: 1.4 } as const;

/** The ground materials paintRails lays for `plan` (none without track) */
export function railPaintMaterials(plan: RailPlan): Set<string> {
  return new Set(plan.chains.length ? [RAIL_GROUND.material] : []);
}

/**
 * The ground beside the beds painted (after the land, before the roads, so
 * a road over a crossing keeps its surface): RAIL_GROUND along every line
 * off its bridges. Returns the materials that got a layer
 */
export function paintRails(terrain: MapTerrain, plan: RailPlan): string[] {
  const bands: PaintBand[] = [];
  plan.chains.forEach((c, ci) => {
    const cuts = merged(plan.bridges.filter((b) => b.chain === ci).map((b) => [b.from, b.to]));
    for (const [from, to] of outside([0, c.length], cuts)) {
      if (to - from < 0.5) continue;
      bands.push({ line: slice(c, from, to), material: RAIL_GROUND.material, half: RAIL_GROUND.half, soft: RAIL_GROUND.soft });
    }
  });
  return paintBands(terrain, bands);
}
