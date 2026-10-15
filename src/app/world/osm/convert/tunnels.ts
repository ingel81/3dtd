/**
 * The tunnels of an OSM world: a portal model at each mouth, turned along
 * the road, and the ground over the tunnel raised where it lies too low to
 * hide it (decision 8 of docs/OSM_WORLD_PLAN.md).
 *
 * The tunnel edges stay in the street graph (roads.ts), so routes run
 * through them as through a tunnel on a real place: the route cells there
 * take their height between the ground at the two mouths
 * (RouteCellSampler.tunnelColumn). The ground over the tunnel has to lie
 * above that line, else the enemies walk through the air over a valley or
 * the hill shows them: behind each mouth it is raised to the portal's top
 * over the facade's width (the hill the portal sits in), along the rest of
 * the tunnel to TUNNEL_COVER over the road, each falling off at 1:1 to the
 * sides. Where the real hill is higher nothing changes. Runs before the
 * water is carved, so a river over a tunnel still cuts its bed.
 */
import { heightAt, sampleX, sampleY } from '../../../editor/model/grid';
import { nearestOnPolyline } from '../../../editor/ops/path-graph';
import type { MapObject, MapPoint, MapTerrain } from '../../custom-map/map-document';
import type { TunnelLine, TunnelMouth } from './roads';

/** The portal model at every mouth */
export const TUNNEL_PORTAL_ASSET = 'tunnel-portal-concrete';
/** The model's measures (tools/map-assets/build_landmarks.py tunnel_portal, concrete): facade width, top over the road, facade thickness */
const PORTAL_WIDTH = 20;
const PORTAL_TOP = 9.6;
const PORTAL_FACADE = 1.6;
/** Metres behind a mouth the hill stands at the portal's top: over the 14 m vault and its shell */
const PORTAL_HILL = 20;
/** Width of road the opening (8 m) takes at scale 1, metres; wider roads scale the portal, up to PORTAL_SCALE_MAX */
const OPENING_ROAD = 7;
const PORTAL_SCALE_MAX = 2.2;
/** Metres of ground kept over the road along the rest of a tunnel, enough to hide the enemies in it */
export const TUNNEL_COVER = 4;
/** Mouths closer than this that face the same way (the two tubes of a motorway) share one portal, metres */
const TWIN_REACH = 20;

export interface TunnelReport {
  tunnels: number;
  portals: number;
  /** Mouths that shared a portal with their twin */
  twins: number;
  /** Height samples raised */
  raised: number;
}

/**
 * Portals for `mouths` (ids `tunnel-1`, ...) and the ground over `tunnels`
 * raised to hide them; changes `terrain`
 */
export function buildTunnels(terrain: MapTerrain, tunnels: readonly TunnelLine[], mouths: readonly TunnelMouth[]): { objects: MapObject[]; report: TunnelReport } {
  const report: TunnelReport = { tunnels: tunnels.length, portals: 0, twins: 0, raised: 0 };
  // The road's height at each mouth, before anything is raised
  const mouthY = mouths.map((m) => heightAt(terrain, m.p.x, m.p.y));
  const portals = pairTwins(mouths);
  report.twins = portals.reduce((s, p) => s + (p.mouths.length > 1 ? p.mouths.length : 0), 0);

  const raised = new Uint8Array(terrain.grid.columns * terrain.grid.rows);
  const raise = (k: number, y: number) => {
    const h = terrain.grid.heights;
    if (y <= h[k]) return;
    h[k] = y;
    raised[k] = 1;
  };

  // Along each tunnel: TUNNEL_COVER over the line between its mouths
  tunnels.forEach((tunnel, index) => {
    const ends = mouths.flatMap((m, k) => (m.tunnel === index ? [{ p: m.p, y: mouthY[k] }] : []));
    if (!ends.length) return;
    const roadY = (q: MapPoint): number => {
      if (ends.length === 1) return ends[0].y;
      const da = Math.hypot(q.x - ends[0].p.x, q.y - ends[0].p.y);
      const db = Math.hypot(q.x - ends[1].p.x, q.y - ends[1].p.y);
      return ends[0].y + (ends[1].y - ends[0].y) * (da / (da + db || 1));
    };
    const reach = OPENING_ROAD / 2 + 2 + TUNNEL_COVER;
    for (const line of tunnel.lines) {
      forSamples(terrain, line, reach, (k, q) => {
        const hit = nearestOnPolyline(line, q);
        if (!hit || hit.dist >= reach) return;
        // Past the ends of the line the portals' hills take over
        if (ends.some((e) => Math.hypot(hit.point.x - e.p.x, hit.point.y - e.p.y) < PORTAL_FACADE)) return;
        raise(k, roadY(hit.point) + TUNNEL_COVER - Math.max(0, hit.dist - OPENING_ROAD / 2 - 2));
      });
    }
  });

  const objects: MapObject[] = [];
  for (const portal of portals) {
    const y = portal.mouths.reduce((s, k) => s + mouthY[k], 0) / portal.mouths.length;
    const half = (PORTAL_WIDTH * portal.scale) / 2;
    const top = PORTAL_TOP * portal.scale;
    const { p, inward } = portal;
    // The corners of the raised hill: from the facade back past PORTAL_HILL, out to where its sides reach the ground
    const box = [0, PORTAL_HILL + top].flatMap((d) =>
      [-1, 1].map((s) => ({ x: p.x + inward.x * d + inward.y * s * (half + top), y: p.y + inward.y * d - inward.x * s * (half + top) })),
    );
    forSamples(terrain, box, 0, (k, q) => {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const depth = dx * inward.x + dy * inward.y;
      if (depth < PORTAL_FACADE) return;
      const side = Math.abs(dx * inward.y - dy * inward.x);
      raise(k, y + top - Math.max(0, side - half) - Math.max(0, depth - PORTAL_HILL));
    });
    report.portals++;
    objects.push({
      id: `tunnel-${report.portals}`,
      asset: TUNNEL_PORTAL_ASSET,
      x: round2(p.x),
      y: round2(p.y),
      z: 0,
      // Model +z (the road into the vault) along `inward`, as buildings.ts turns its fronts
      rotation: round3(Math.atan2(-inward.x, inward.y)),
      scale: round3(portal.scale),
    });
  }
  report.raised = raised.reduce((s, v) => s + v, 0);
  return { objects, report };
}

interface Portal {
  p: MapPoint;
  inward: MapPoint;
  scale: number;
  /** Indices of the mouths it stands for */
  mouths: number[];
}

/**
 * One portal per mouth, a pair of mouths closer than TWIN_REACH facing the
 * same way sharing one between them, scaled so its opening spans both roads
 */
export function pairTwins(mouths: readonly TunnelMouth[]): Portal[] {
  const used = new Uint8Array(mouths.length);
  const out: Portal[] = [];
  for (let a = 0; a < mouths.length; a++) {
    if (used[a]) continue;
    used[a] = 1;
    const m = mouths[a];
    let twin = -1;
    let twinD = TWIN_REACH;
    for (let b = a + 1; b < mouths.length; b++) {
      const o = mouths[b];
      const d = Math.hypot(o.p.x - m.p.x, o.p.y - m.p.y);
      if (used[b] || d >= twinD || m.inward.x * o.inward.x + m.inward.y * o.inward.y < 0.7) continue;
      twin = b;
      twinD = d;
    }
    if (twin < 0) {
      out.push({ p: m.p, inward: m.inward, scale: portalScale(m.width), mouths: [a] });
      continue;
    }
    used[twin] = 1;
    const o = mouths[twin];
    const ix = m.inward.x + o.inward.x;
    const iy = m.inward.y + o.inward.y;
    const il = Math.hypot(ix, iy);
    const inward = { x: ix / il, y: iy / il };
    // Across the shared road: the two centres apart plus the half width of each
    const apart = Math.abs((o.p.x - m.p.x) * inward.y - (o.p.y - m.p.y) * inward.x);
    out.push({ p: { x: (m.p.x + o.p.x) / 2, y: (m.p.y + o.p.y) / 2 }, inward, scale: portalScale(apart + (m.width + o.width) / 2), mouths: [a, twin] });
  }
  return out;
}

const portalScale = (road: number): number => Math.min(PORTAL_SCALE_MAX, Math.max(1, road / OPENING_ROAD));

/** Calls `f` for each height sample within `pad` of the bounding box of `points` */
function forSamples(terrain: MapTerrain, points: readonly MapPoint[], pad: number, f: (k: number, q: MapPoint) => void): void {
  const g = terrain.grid;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad + terrain.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + pad + terrain.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - pad + terrain.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + pad + terrain.depth / 2) / g.cellSize));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * g.columns + i, { x: sampleX(terrain, i), y: sampleY(terrain, j) });
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
