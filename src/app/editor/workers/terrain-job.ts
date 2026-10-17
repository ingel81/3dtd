/**
 * Heavy terrain work off the page: generating a preset over a big map and
 * eroding the whole map. A job runs in slices; each slice hands back what
 * changed (a band of rows, or all heights), so the editor shows the land
 * as it forms and can stop the job at any time. The job runs in the
 * editor's worker (editor-core-host.ts, EditorCore.terrain) on its mirror of
 * the map, a quiet moment between two slices.
 */
import type { CustomMapDocument, MapGroundLayer, MapPaths, MapTerrain } from '../../world/custom-map/map-document';
import { finishGenerated, generateRows, presetResult, type GenerateOptions, type GenerateResult } from '../../map-ops/generate';
import { erodeMap } from '../ops/landscape/erosion';
import { emptyWater } from '../../map-ops/water-ops';

/**
 * What a generate job needs to finish the map as well (finishGenerated):
 * water, roads levelled, extra layers and the auto paint, all over the map,
 * off the page too
 */
export interface GenerateFinish {
  /** The map's ground; its heights are the job's */
  terrain: Omit<MapTerrain, 'grid'>;
  paths: MapPaths;
  /** The catalogue's materials */
  materials: string[];
  repaint: boolean;
}

export type TerrainJob =
  | {
      kind: 'generate';
      width: number;
      depth: number;
      columns: number;
      rows: number;
      cellSize: number;
      /** The current heights (the preset adds to them with `options.add`) */
      heights: Float32Array;
      options: GenerateOptions;
      /** Finish the map after the rows (the editor's Generate) */
      finish?: GenerateFinish;
    }
  | {
      kind: 'erode';
      columns: number;
      rows: number;
      cellSize: number;
      heights: Float32Array;
      seed: number;
      /** 0..1, how hard each drop erodes */
      strength: number;
      drops: number;
    };

export type TerrainJobMessage =
  /** Rows `j0` to `j1` (exclusive) are final; `heights` holds just them */
  | { kind: 'rows'; j0: number; j1: number; heights: Float32Array; progress: number }
  /** All heights as they stand now */
  | { kind: 'heights'; heights: Float32Array; progress: number }
  /** The finished map (GenerateFinish): all heights, the layer list and the splat maps */
  | { kind: 'finished'; heights: Float32Array; layers: MapGroundLayer[]; splat: Uint8Array[]; progress: number }
  | { kind: 'done'; result: GenerateResult | null };

/**
 * The Map panel's "Erode the map" for a grid: `strength` 0..1 sets how many
 * drops (from 15 % to all of the samples) and how hard each one erodes
 */
export function erodeJob(g: { columns: number; rows: number; cellSize: number; heights: Float32Array }, strength: number, seed: number): TerrainJob {
  const drops = Math.round(g.columns * g.rows * (0.15 + 0.85 * strength));
  return { kind: 'erode', columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights, seed, strength: 0.4 + 0.6 * strength, drops };
}

/** Rows a generate slice covers */
const ROWS_PER_SLICE = 48;
/** Drops an erosion slice runs */
const DROPS_PER_SLICE = 4000;

/** The job's slices in order; each message owns its array (it may be transferred) */
export function* runTerrainJob(job: TerrainJob): Generator<TerrainJobMessage> {
  if (job.kind === 'generate') {
    const t = { width: job.width, depth: job.depth, grid: { columns: job.columns, rows: job.rows, cellSize: job.cellSize, heights: job.heights } };
    for (let j0 = 0; j0 < job.rows; j0 += ROWS_PER_SLICE) {
      const j1 = Math.min(job.rows, j0 + ROWS_PER_SLICE);
      generateRows(t, job.options, j0, j1);
      yield { kind: 'rows', j0, j1, heights: job.heights.slice(j0 * job.columns, j1 * job.columns), progress: j1 / job.rows };
    }
    const result = presetResult(job.options);
    if (job.finish) yield finish(job.finish, { ...t.grid }, result);
    yield { kind: 'done', result };
    return;
  }
  for (let from = 0; from < job.drops; from += DROPS_PER_SLICE) {
    const to = Math.min(job.drops, from + DROPS_PER_SLICE);
    erodeMap(job.heights, job.columns, job.rows, job.cellSize, job.seed, job.strength, from, to, to === job.drops);
    yield { kind: 'heights', heights: job.heights.slice(), progress: to / job.drops };
  }
  yield { kind: 'done', result: null };
}

/**
 * The buffers a message can hand over without a copy, each once: two
 * arrays on one buffer (splat maps cut from one block) listed twice make
 * postMessage throw a DataCloneError
 */
export function transferList(m: TerrainJobMessage): ArrayBuffer[] {
  if (m.kind === 'done') return [];
  const arrays = m.kind === 'finished' ? [m.heights, ...m.splat] : [m.heights];
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}

/** The finished map from its generated heights, as the editor finishes it (EditorSession.finishGenerate) */
function finish(f: GenerateFinish, grid: MapTerrain['grid'], result: GenerateResult): TerrainJobMessage {
  const terrain = { ...f.terrain, grid } as MapTerrain;
  // The water the editor makes for the preset (LandscapeContext.ensureWater): the roads rise over it
  if (result.water !== null) {
    terrain.water ??= emptyWater(terrain, Math.round(result.water * 10) / 10);
    terrain.water.mask.fill(255);
  }
  const hasMaterial = new Set(f.materials);
  finishGenerated({ terrain, paths: f.paths } as CustomMapDocument, { ...result, water: null }, (m) => hasMaterial.has(m), f.repaint);
  return { kind: 'finished', heights: grid.heights, layers: terrain.layers, splat: terrain.splat.maps, progress: 1 };
}
