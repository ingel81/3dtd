/**
 * Collects the document's change notices between two frames and hands them
 * to the view once a frame: only the touched chunks, slow rebuilds (sky,
 * life, water) at most every few frames while a slider or a brush moves,
 * the overlay laid again on moving ground at most every DRAPE_INTERVAL_MS.
 * It knows no renderer: the view and the overlay are behind ChangeTarget,
 * the clock can be given, so it is tested without WebGL.
 */
import type { GridRect } from '../../map-ops/grid';
import { mergeChanges, type DocChange } from '../model/doc-change';

/** Milliseconds between two sky rebuilds while an environment slider moves (the life's sliders too) */
export const ENV_INTERVAL_MS = 100;
/** Milliseconds between two water rebuilds while a brush changes the masks */
export const WATER_INTERVAL_MS = 120;
/** Milliseconds at least between two layings of the overlay on moving ground (a height stroke) */
export const DRAPE_INTERVAL_MS = 200;

/** What the collected changes go to: the map view, the overlay over it, the sound */
export interface ChangeTarget {
  /** A new terrain (resize): the whole view anew */
  rebuild(): void;
  layers(): void;
  heights(rect: GridRect): void;
  splat(rect: GridRect): void;
  /** All water anew */
  water(): void;
  /** Only body k (0..) of the further water bodies, within `rect` */
  waterBody(k: number, rect: GridRect): void;
  objects(ids: readonly string[] | 'all'): void;
  paths(): void;
  environment(): void;
  life(): void;
  /** Surfaces added, removed or changed */
  surfaces(): void;
  /** Life or environment changed: what follows at once (the sound) */
  soundChanged(): void;
  /** The heights changed: what is drawn from them alone (guides, height lines) draws again */
  groundMoved(): void;
  /** The ground under the overlay moved: it takes the new heights */
  redrape(): void;
  /** Markers and selection built anew (the routes come from the editor's worker, EditorRoutes) */
  markers(): void;
  /** Only the rings of these objects follow (they moved, turned or went) */
  selection(ids: readonly string[] | 'all'): void;
}

/** Runs `run` at most once every `interval` ms: a request too early waits for a later poll */
export class Throttle {
  private at = -Infinity;
  private waiting = false;

  constructor(
    private readonly interval: number,
    private readonly clock: () => number,
    private readonly run: () => void,
  ) {}

  /** Runs now when the interval has passed, else on the first poll after it */
  request(): void {
    if (this.clock() - this.at >= this.interval) this.fire();
    else this.waiting = true;
  }

  /** Runs on the first poll once the interval has passed */
  defer(): void {
    this.waiting = true;
  }

  poll(): void {
    if (this.waiting && this.clock() - this.at >= this.interval) this.fire();
  }

  private fire(): void {
    this.waiting = false;
    this.at = this.clock();
    this.run();
  }
}

export class ChangeApplier {
  private pending: DocChange | null = null;
  private markersDirty = true;
  private readonly env: Throttle;
  private readonly life: Throttle;
  private readonly water: Throttle;
  private readonly drape: Throttle;

  constructor(
    private readonly target: ChangeTarget,
    clock: () => number = () => performance.now(),
  ) {
    this.env = new Throttle(ENV_INTERVAL_MS, clock, () => target.environment());
    this.life = new Throttle(ENV_INTERVAL_MS, clock, () => target.life());
    this.water = new Throttle(WATER_INTERVAL_MS, clock, () => target.water());
    this.drape = new Throttle(DRAPE_INTERVAL_MS, clock, () => target.redrape());
  }

  add(change: DocChange): void {
    this.pending = this.pending ? mergeChanges(this.pending, change) : change;
  }

  /** The selection changed: markers and rings follow */
  selectionChanged(): void {
    this.markersDirty = true;
  }

  /** A new view shows the document as it is: nothing waits, the markers are laid anew */
  reset(): void {
    this.pending = null;
    this.markersDirty = true;
  }

  /** Hands the collected changes to the target */
  flush(): void {
    this.env.poll();
    this.life.poll();
    this.water.poll();
    this.drape.poll();
    const c = this.pending;
    if (!c) {
      if (this.markersDirty) this.markers();
      return;
    }
    this.pending = null;
    const t = this.target;
    if (c.terrain) {
      // A new terrain (resize): the renderer builds its ground anew
      t.rebuild();
    } else {
      if (c.layers) t.layers();
      if (c.heights) t.heights(c.heights);
      if (c.splat) t.splat(c.splat);
      if (c.water) this.water.request();
      // A pool brush on one body: just that surface (about a millisecond)
      else if (c.bodies && c.bodyRect) for (const k of c.bodies) t.waterBody(k, c.bodyRect);
      // A list goes in place where it can; new objects rebuild at most every few frames
      if (c.objects) t.objects(c.objects);
      if (c.paths) t.paths();
      if (c.surfaces) t.surfaces();
      if (c.environment) this.env.request();
      if (c.life) this.life.request();
      // The sound areas and the bed (its biome's sounds) follow at once: setMap only changes gains
      if (c.life || c.environment) t.soundChanged();
    }
    if (c.heights || c.terrain) t.groundMoved();
    // Spawns, HQ and roads are built anew when they changed; ground and water under them (a deck rises over
    // water) only lay them again on the new heights, at most every DRAPE_INTERVAL_MS while a stroke goes on.
    // The routes stay as the worker found them and lie again on a new terrain
    if (c.paths || c.markers || c.terrain) {
      this.markersDirty = true;
      if (c.terrain) this.drape.defer();
    } else if (c.heights || c.water || c.bodies) {
      this.drape.defer();
    }
    if (this.markersDirty) this.markers();
    // Objects leave the rest as it is (a gizmo drag every frame): the rings follow
    else if (c.objects) t.selection(c.objects);
  }

  private markers(): void {
    this.markersDirty = false;
    this.target.markers();
  }
}
