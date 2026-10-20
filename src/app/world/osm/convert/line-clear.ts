import { EdgeIndex } from '../../../map-ops/path-graph';
import type { MapPaths, MapPoint } from '../../custom-map/map-document';
import { onTrackBed, RAIL_GROUND, type RailPlan } from './rails';

/**
 * Where the pieces of a line stop (fences, walls, hedges: OSM's barrier
 * lines, the plots' boundaries, the areas' fences): the roads and paths on
 * the ground and the track beds with their gravel verge (a crossing's panels
 * lie on the bed). A line is cut where it enters one (runs), and a piece
 * reaching into one with its length is left out (fits): a hedge ends at the
 * road's edge and at the bed's gravel instead of running over them.
 */
export class LineClearance {
  private readonly roads: EdgeIndex;
  private readonly onTrack: ((p: MapPoint) => boolean) | null;

  /**
   * `roadClear`: metres a line keeps past a road's half width; `pavements`:
   * past its pavements too
   */
  constructor(
    paths: MapPaths,
    rails: RailPlan | null,
    private readonly options: { roadClear: number; pavements: boolean },
  ) {
    this.roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => !e.tunnel && e.kind !== 'bridge') });
    this.onTrack = rails && rails.chains.length ? onTrackBed(rails, RAIL_GROUND.half) : null;
  }

  /** Whether a line may not pass `p` */
  blocked(p: MapPoint): boolean {
    const hit = this.roads.nearest(p, 16);
    if (hit && hit.dist < hit.edge.width / 2 + (this.options.pavements ? (hit.edge.sidewalk ?? 0) : 0) + this.options.roadClear) return true;
    return !!this.onTrack?.(p);
  }

  /** The parts of `line` outside what it may not pass, each from where it leaves one to where it enters the next (to STEP) */
  runs(line: readonly MapPoint[]): MapPoint[][] {
    const out: MapPoint[][] = [];
    let run: MapPoint[] = [];
    const close = () => {
      if (run.length >= 2) out.push(run);
      run = [];
    };
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k];
      const b = line[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
      for (let i = k === 0 ? 0 : 1; i <= n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        if (this.blocked(p)) close();
        // The line's own corners, and the first and last clear point of a run
        else if (i === 0 || i === n || !run.length) run.push(p);
        else if (i + 1 <= n && this.blocked({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n })) run.push(p);
      }
    }
    close();
    return out;
  }

  /** Whether a piece of a line (its length along model X, `reach` either side of its middle) keeps clear along all of it */
  fits(o: { x: number; y: number; rotation: number }, reach: number): boolean {
    const dx = Math.cos(o.rotation);
    const dy = Math.sin(o.rotation);
    for (const f of FIT_SAMPLES) if (this.blocked({ x: o.x + dx * reach * f, y: o.y + dy * reach * f })) return false;
    return true;
  }
}

/** Metres between the points a line is tested at */
const STEP = 0.5;
/** Where along a piece it is tested, in its reach either side of the middle */
const FIT_SAMPLES = [-1, -0.5, 0, 0.5, 1];
