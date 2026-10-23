/**
 * The path mask in the editor's worker: the roads, river banks and road
 * covers painted into the terrain's RGBA mask (path-mask.ts), kept between
 * changes (PathMaskRaster paints only round what moved). The main thread
 * builds the mask once with its view and hands over to the worker (`prime`):
 * from then on each change of the roads or rivers comes back as the texel
 * rectangle that changed and its bytes, which the view writes into its
 * texture and uploads alone. A drag of a road node on a map as large as an
 * OSM city painted 30 ms a frame on the main thread before.
 *
 * The road covers (where a paved road hides the ground) are the main
 * thread's: its road surface lays them, and each job brings what changed of
 * them. The surfaces' covers come from the mirror's map (doc.surfaces).
 * They and the generation are taken as the job comes, not when it runs, so
 * a job that a newer one took the place of loses nothing.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { PathMaskRaster, pathMaskResolution, type RoadCover } from '../../world/custom-map/render/paths/path-mask';
import type { TexelRect } from '../../world/custom-map/render/terrain/texture-ranges';

/** The covers against those sent last: all of them, or the ones that came or changed and the ids gone */
export interface CoverPatch {
  whole?: RoadCover[];
  set?: RoadCover[];
  drop?: string[];
}

export interface PathMaskInput {
  /** Counts the masks the main thread built (one per view of a map): a rectangle for an older one is dropped */
  generation: number;
  /** The main thread has just built its mask from the map as it is now: paint it here too, send nothing back */
  prime: boolean;
  covers: CoverPatch;
}

/** The texels of `rect` (RGBA, row by row) of a mask of `resolution`² over `width` x `depth` metres, and of its edge field (one byte a texel) */
export interface PathMaskRect {
  generation: number;
  width: number;
  depth: number;
  resolution: number;
  rect: TexelRect;
  data: Uint8Array;
  edge: Uint8Array;
}

export class PathMaskState {
  private generation = -1;
  private raster: PathMaskRaster | null = null;
  private readonly covers = new Map<string, RoadCover>();

  /** What a job brings that must not wait for it to run: a new mask, the covers that changed */
  take(input: PathMaskInput): void {
    if (input.generation !== this.generation || input.prime) {
      // The raster paints everything with its next update
      this.generation = input.generation;
      this.raster = null;
    }
    const c = input.covers;
    if (c.whole) {
      this.covers.clear();
      for (const cover of c.whole) this.covers.set(cover.id, cover);
    }
    for (const cover of c.set ?? []) this.covers.set(cover.id, cover);
    for (const id of c.drop ?? []) this.covers.delete(id);
  }

  /** Paints what changed since the last run; the rectangle and its bytes, or null (nothing changed, or primed) */
  run(doc: CustomMapDocument, input: PathMaskInput): PathMaskRect | null {
    const t = doc.terrain;
    let raster = this.raster;
    if (!raster || raster.width !== t.width || raster.depth !== t.depth) {
      raster = this.raster = new PathMaskRaster(t.width, t.depth, pathMaskResolution(t.width, t.depth));
    }
    const rect = raster.update(doc.paths, t.rivers ?? [], [...this.covers.values()], doc.surfaces ?? []);
    if (!rect || input.prime) return null;
    const res = raster.resolution;
    const row = (rect.i1 - rect.i0 + 1) * 4;
    const data = new Uint8Array(row * (rect.j1 - rect.j0 + 1));
    const span = rect.i1 - rect.i0 + 1;
    const edge = new Uint8Array(span * (rect.j1 - rect.j0 + 1));
    for (let j = rect.j0; j <= rect.j1; j++) {
      const from = (j * res + rect.i0) * 4;
      data.set(raster.data.subarray(from, from + row), (j - rect.j0) * row);
      edge.set(raster.edge.subarray(j * res + rect.i0, j * res + rect.i0 + span), (j - rect.j0) * span);
    }
    return { generation: this.generation, width: raster.width, depth: raster.depth, resolution: res, rect, data, edge };
  }
}
