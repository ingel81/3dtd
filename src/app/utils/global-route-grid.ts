import {
  InstancedMesh,
  ShaderMaterial,
  InstancedBufferAttribute,
  BufferAttribute,
  BoxGeometry,
  Matrix4,
  DoubleSide,
  StaticDrawUsage,
  DynamicDrawUsage,
} from 'three';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition } from '../models/game.types';
import { CoordinateSync } from '../three-engine/renderers';
import { TerrainRaycaster, TerrainSampleRaycaster, LineOfSightRaycaster } from '../three-engine/renderers/three-tower.renderer';

/**
 * RouteCell - Single cell in the global route grid
 *
 * Contains:
 * - Position (cell center in local coordinates)
 * - Terrain height at cell center
 * - Skyline height (max ground/building height around cell — for air LOS)
 * - Set of enemies currently in this cell
 * - Map of tower visibility for ground LOS (LOS check results per tower)
 * - Map of tower visibility for air LOS (raycast against cell air-height)
 */
/**
 * Per-cell sampling metadata. Maintained exclusively by `sampleCellY` —
 * never write from anywhere else, otherwise the single-source-of-truth
 * invariant breaks.
 *
 * `tileDepth` and `tileGeometricError` are the LOD metadata of the tile
 * that produced the last successful sample. They drive the quality-
 * versioned idempotency in `sampleCellY`: a new sample at strictly worse
 * LOD (lower depth, higher geometricError) does not overwrite a cached
 * good sample. Stable under tile streaming.
 */
export interface CellSample {
  /**
   * `unsampled` — terrain raycast hasn't returned a hit yet, `terrainHeight`
   *   is still a fallback (route-anchor Y). Viz call sites skip these cells.
   * `stable` — terrain raycast returned a hit; `terrainHeight` is real.
   */
  state: 'unsampled' | 'stable';
  /** Internal frame counter at last successful sample (debug only). */
  sampledAt: number;
  /** 3D Tiles tile depth at last sample. Higher = better LOD. 0 if unknown. */
  tileDepth: number;
  /** Tile geometricError at last sample. Lower = better LOD. Infinity if unknown. */
  tileGeometricError: number;
}

export interface RouteCell {
  /** Unique cell key (integer hash) */
  key: number;
  /** Cell center X in local coordinates */
  x: number;
  /** Cell center Z in local coordinates */
  z: number;
  /** Terrain height at cell center (local Y coordinate) */
  terrainHeight: number;
  /**
   * Skyline height at cell — local Y of the highest geometry sampled in a
   * small neighbourhood around the cell. Used as the LOS target altitude
   * for air enemies and as the floor for skyline-adaptive flight height.
   * Falls back to terrainHeight when not yet sampled.
   */
  skylineHeight: number;
  /**
   * Route-anchor Y derived at generation time from the nearest route sample
   * point's smoothed terrain height. Used to validate terrain raycasts —
   * hits more than `GROUND_ANCHOR_TOLERANCE_M` from this anchor are discarded
   * as bridge decks / tree canopies / mesh artifacts.
   */
  routeAnchorY: number;
  /**
   * Sampling state of `terrainHeight`. See `CellSample`. Written only by
   * `sampleCellY`. Convenience read: `cell.sample.state === 'stable'`.
   */
  sample: CellSample;
  /**
   * Mirror of `sample.state === 'stable'`. Kept as a property (rather than
   * a getter) for hot-path read access. Set in lockstep by `sampleCellY`.
   */
  heightSampled: boolean;
  /** Set of enemies currently in this cell */
  enemies: Set<Enemy>;
  /** Map of tower ID -> visibility for ground targets (true = can see this cell) */
  towerVisibility: Map<string, boolean>;
  /** Map of tower ID -> visibility for air targets (raycast against skyline + clearance) */
  airVisibility: Map<string, boolean>;
}

/**
 * Vertical clearance over local skyline used for air-LOS raycast targets and
 * skyline-adaptive air flight height. Air enemies fly at
 * `cell.skylineHeight + AIR_CLEARANCE_M`, which is also where tower LOS rays
 * are aimed when computing air visibility.
 *
 * Picked so a Rocket missile arc still reads visually plausible above a
 * Tokyo-class skyscraper roof.
 */
export const AIR_CLEARANCE_M = 10;

/**
 * ──────────────────────────────────────────────────────────────────────────
 * Debug-Logging — unified prefix `[CELL-GRID]` so the entire subsystem can
 * be filtered as one stream in DevTools / log output. Each sub-tag is a
 * single token after the prefix to keep the format greppable:
 *
 *   [CELL-GRID] BOOTUP  ...
 *   [CELL-GRID] SAMPLE  ...
 *   [CELL-GRID] REFINE  ...
 *
 * Sub-tag toggles control verbosity per category. Keep BOOTUP / REFINE /
 * VIZ-MODE / DISPOSE on for production-light tracing; the rest fires
 * very often and stays off unless investigating.
 * ──────────────────────────────────────────────────────────────────────────
 */
const CELL_GRID_LOG = {
  BOOTUP: true,
  CELL_GEN: false,
  SAMPLE: false,
  REFINE: true,
  VIZ_MODE: true,
  TOWER_REG: false,
  HEIGHT_UPDATE: false,
  DISPOSE: true,
} as const;

type CellGridLogTag = keyof typeof CELL_GRID_LOG;

/** Single helper so the `[CELL-GRID]` prefix never drifts. */
function logGrid(tag: CellGridLogTag, ...args: unknown[]): void {
  if (!CELL_GRID_LOG[tag]) return;
  // eslint-disable-next-line no-console
  console.log(`[CELL-GRID] ${tag}`, ...args);
}

/**
 * Visualisation geometry — decal-like flat plates that hug the surface.
 * Increase `HEIGHT_M` to give the cells perceptible thickness; raise
 * `Y_OFFSET_M` if Z-fighting reappears (currently depthTest is off, so
 * even +0.05m is safe). Modern-Minimal target: barely noticeable plates.
 */
const CELL_VIZ_HEIGHT_M = 0.02;
const CELL_VIZ_Y_OFFSET_M = 0.05;

/**
 * Shader for LOS cell visualization with multi-color support
 */
const LOS_CELL_VERTEX = /* glsl */ `
attribute float aCellState;
varying float vCellState;

void main() {
  vCellState = aCellState;

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader with multi-color support.
 * States: 0 = gray (no tower), 1 = green (ground visible), 2 = red (blocked),
 *         3 = muted blue (air-only visible), 4 = purple (enemy in cell),
 *         5 = yellow (enemy + any visibility)
 */
const LOS_CELL_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
varying float vCellState;

void main() {
  vec3 color;
  float alpha;

  // Modern-Minimal palette: desaturated, low alpha, gentle pulse.

  // Gray: No tower in range (or blocked everywhere)
  if (vCellState < 0.5) {
    color = vec3(0.60, 0.60, 0.63);
    alpha = 0.15;
  }
  // Green: At least one tower has ground LoS
  else if (vCellState < 1.5) {
    color = vec3(0.35, 0.70, 0.52);
    alpha = 0.35;
  }
  // Red: legacy state, no longer written for the global overlay but kept
  // for shader stability if a future caller re-enables it.
  else if (vCellState < 2.5) {
    color = vec3(0.70, 0.35, 0.35);
    alpha = 0.35;
  }
  // Muted blue: Only air LoS is clear (no ground LoS)
  else if (vCellState < 3.5) {
    color = vec3(0.35, 0.55, 0.85);
    alpha = 0.35;
  }
  // Purple: Enemy in cell, not currently visible
  else if (vCellState < 4.5) {
    color = vec3(0.55, 0.35, 0.75);
    alpha = 0.45;
  }
  // Muted gold: Enemy + tower can see = active target
  else {
    color = vec3(0.85, 0.72, 0.25);
    alpha = 0.55;
  }

  float pulse = sin(uTime * 2.0) * 0.05 + 0.95;
  gl_FragColor = vec4(color, alpha * pulse);
}
`;

/**
 * Per-tower LOS visualization shader.
 * Three-way state per cell:
 *   ground visible → green (best — tower can hit ground units here)
 *   air-only visible → muted blue (only air units reachable, e.g. over a building)
 *   neither → red (blocked)
 */
const TOWER_LOS_VERTEX = /* glsl */ `
attribute float aGroundVisible;
attribute float aAirVisible;
varying float vGroundVisible;
varying float vAirVisible;

void main() {
  vGroundVisible = aGroundVisible;
  vAirVisible = aAirVisible;

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const TOWER_LOS_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
varying float vGroundVisible;
varying float vAirVisible;

void main() {
  // Modern-Minimal palette — same tones as the global overlay so both
  // visualisations read as one design language.
  vec3 greenColor = vec3(0.35, 0.70, 0.52);
  vec3 blueColor  = vec3(0.35, 0.55, 0.85);
  vec3 redColor   = vec3(0.70, 0.35, 0.35);

  float gVis = step(0.5, vGroundVisible);
  float aVis = step(0.5, vAirVisible);

  // Priority: ground > air > blocked (red)
  vec3 color = redColor;
  color = mix(color, blueColor, aVis);
  color = mix(color, greenColor, gVis);

  // Per-state alpha — blocked sits back, visible reads strongest.
  float alpha = 0.40;
  alpha = mix(alpha, 0.35, aVis);
  alpha = mix(alpha, 0.45, gVis);

  float pulse = sin(uTime * 2.0) * 0.05 + 0.95;
  gl_FragColor = vec4(color, alpha * pulse);
}
`;

/**
 * GlobalRouteGrid - Unified Cell System for Enemy Tracking and LOS
 *
 * Replaces both EnemySpatialGrid and RouteLosGrid with a single global system.
 * Cells are pre-generated along enemy routes and store:
 * - Terrain height (for visualization)
 * - Current enemies in the cell
 * - LOS visibility per tower
 *
 * Benefits:
 * - Single point of truth for cell-based queries
 * - O(1) enemy position updates
 * - O(1) LOS checks (pre-computed per tower)
 * - Unified visualization
 */
export class GlobalRouteGrid {
  /** Map of cell keys to RouteCell data */
  private cells = new Map<number, RouteCell>();

  /**
   * Listener called when `updateTerrainHeights` promotes cells from
   * unsampled to sampled (heightSampled flipped false→true). Consumers
   * (e.g. tower-placement-service) use this to re-compute LOS for the
   * affected cells per placed tower and to refresh per-tower viz meshes.
   */
  private onCellsPromoted: ((promoted: RouteCell[]) => void) | null = null;

  /** Map of enemy ID to current cell key (for fast cell transitions) */
  private enemyCellKeys = new Map<string, number>();

  /** Grid cell size in meters (matches original CELL_SIZE) */
  private readonly CELL_SIZE = 2;

  /** Corridor width from route center in meters */
  private readonly CORRIDOR_WIDTH = 7;

  /** Cached inverse cell size for fast multiplication instead of division */
  private readonly INV_CELL_SIZE = 1 / 2; // 1 / CELL_SIZE

  /** Integer hash for cell key (avoids string allocation in hot path) */
  private intCellKey(cx: number, cz: number): number {
    return ((cx & 0xFFFF) << 16) | (cz & 0xFFFF);
  }

  /** LOS offset from tower center (raycast starts from tower edge) */
  private readonly LOS_OFFSET = 2.4;

  /** Terrain raycaster for height sampling */
  private terrainRaycaster: TerrainRaycaster | null = null;

  /**
   * Detailed terrain sample raycaster — returns hit Y plus tile LOD info.
   * Used by `sampleCellY` for quality-versioned idempotency. Set
   * alongside `terrainRaycaster` in `initialize()`. When null,
   * `sampleCellY` falls back to the plain raycaster without LOD tracking.
   */
  private terrainSampleRaycaster: TerrainSampleRaycaster | null = null;

  /**
   * Skyline raycaster — top-down sample of the highest geometry (terrain or
   * building roof) around a local position. Used to give cells a skyline
   * altitude for air-LOS pre-compute and adaptive air flight height.
   */
  private skylineRaycaster: TerrainRaycaster | null = null;

  /** Coordinate sync for geo <-> local conversions */
  private coordinateSync: CoordinateSync | null = null;

  /** Visualization mesh */
  private visualization: InstancedMesh | null = null;
  private visualizationMaterial: ShaderMaterial | null = null;
  private cellStateAttribute: InstancedBufferAttribute | null = null;

  /** Animation time accumulator */
  private animationTime = 0;

  /** Maximum cells for visualization (pre-allocated) */
  private readonly MAX_VIZ_CELLS = 5000;

  /** Monotonic counter incremented on each successful sample (debug only). */
  private sampleFrame = 0;

  // ========================================
  // SAMPLE — SINGLE SOURCE OF TRUTH FOR cell.terrainHeight
  // ========================================

  /**
   * Attempt to write `cell.terrainHeight` from a fresh terrain raycast.
   *
   * **This is the ONLY function in the codebase that writes
   * `cell.terrainHeight` after a cell has been added to `this.cells`.** All
   * other call sites read the cached value. The single-source-of-truth
   * invariant lets us reason about cell state without tracking who-wrote-
   * what-when across the grid / tower-reg / viz pathways.
   *
   * Phase 1 semantics:
   *  - If raycast misses: `cell.sample.state` stays `unsampled`,
   *    `cell.terrainHeight` keeps its previous value (anchor fallback).
   *  - If raycast hits: `cell.terrainHeight` and `cell.sample` are updated,
   *    `cell.heightSampled` mirrors `state === 'stable'`.
   *
   * Phase 2 will add tile-LOD versioning (reject samples with strictly
   * worse `geometricError` than the cached one), making this fully
   * idempotent under streaming.
   *
   * @returns `true` when the cell was promoted to / refreshed in `stable`.
   */
  private sampleCellY(cell: RouteCell): boolean {
    // Prefer the detailed raycaster (returns LOD info) so we can implement
    // quality-versioned idempotency. Falls back to the plain raycaster
    // when only that is wired (legacy tests, DevWorld bootstrap).
    let hit: { y: number; tileDepth: number; tileGeometricError: number } | null = null;

    if (this.terrainSampleRaycaster) {
      hit = this.terrainSampleRaycaster(cell.x, cell.z, cell.routeAnchorY);
    } else if (this.terrainRaycaster) {
      const y = this.terrainRaycaster(cell.x, cell.z, cell.routeAnchorY);
      if (y !== null) {
        hit = { y, tileDepth: 0, tileGeometricError: Infinity };
      }
    }

    if (hit === null) {
      logGrid('SAMPLE', `miss key=${cell.key} anchor=${cell.routeAnchorY.toFixed(2)}`);
      return false;
    }

    // Quality-versioned idempotency: if the cell already has a stable sample
    // from a strictly better tile (deeper LOD), refuse to overwrite with
    // potentially-degraded data. This keeps the grid robust against LOD
    // drops during streaming (e.g. user zooms out and tiles re-stream at
    // coarser detail).
    if (cell.sample.state === 'stable') {
      const oldDepth = cell.sample.tileDepth;
      const oldErr = cell.sample.tileGeometricError;
      const newDepth = hit.tileDepth;
      const newErr = hit.tileGeometricError;
      // Strictly worse LOD: lower depth AND higher geometricError.
      if (newDepth < oldDepth && newErr > oldErr) {
        logGrid(
          'SAMPLE',
          `reject reason=worseLOD key=${cell.key} oldDepth=${oldDepth} newDepth=${newDepth} oldErr=${oldErr.toFixed(2)} newErr=${newErr.toFixed(2)}`,
        );
        return false;
      }
      // Same Y and same LOD: nothing to do.
      if (
        Math.abs(hit.y - cell.terrainHeight) < 0.01 &&
        newDepth === oldDepth
      ) {
        return false;
      }
    }

    const wasStable = cell.sample.state === 'stable';
    cell.terrainHeight = hit.y;
    cell.sample = {
      state: 'stable',
      sampledAt: ++this.sampleFrame,
      tileDepth: hit.tileDepth,
      tileGeometricError: hit.tileGeometricError,
    };
    cell.heightSampled = true;
    logGrid(
      'SAMPLE',
      `${wasStable ? 'refresh' : 'promote'} key=${cell.key} y=${hit.y.toFixed(2)} depth=${hit.tileDepth} err=${hit.tileGeometricError.toFixed(2)}`,
    );
    return true;
  }

  /**
   * Initialize the grid with required dependencies
   * @param terrainRaycaster Function to sample terrain height at local coordinates
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   * @param skylineRaycaster Optional top-down sampler for skyline (terrain + buildings)
   *                         — falls back to terrainRaycaster when omitted.
   */
  initialize(
    terrainRaycaster: TerrainRaycaster,
    coordinateSync: CoordinateSync,
    skylineRaycaster?: TerrainRaycaster,
    terrainSampleRaycaster?: TerrainSampleRaycaster,
  ): void {
    this.terrainRaycaster = terrainRaycaster;
    this.terrainSampleRaycaster = terrainSampleRaycaster ?? null;
    this.coordinateSync = coordinateSync;
    this.skylineRaycaster = skylineRaycaster ?? terrainRaycaster;
  }

  /**
   * Get the CoordinateSync instance (for DPS profile computation)
   */
  getCoordinateSync(): CoordinateSync | null {
    return this.coordinateSync;
  }

  /**
   * Generate grid cells from enemy routes
   * Creates cells along the route corridor and samples terrain height at each
   * @param routes Array of route paths (each path is GeoPosition[])
   */
  generateFromRoutes(routes: GeoPosition[][]): void {
    if (!this.coordinateSync || !this.terrainRaycaster) {
      console.error('[GlobalRouteGrid] Cannot generate - not initialized');
      return;
    }

    this.cells.clear();
    this.enemyCellKeys.clear();

    const processedCells = new Set<number>();

    for (const route of routes) {
      if (route.length < 2) continue;

      // Process each segment of the route
      for (let i = 0; i < route.length - 1; i++) {
        const startGeo = route[i];
        const endGeo = route[i + 1];

        // Convert to local coordinates
        const startLocal = this.coordinateSync.geoToLocalSimple(startGeo.lat, startGeo.lon, startGeo.height ?? 0);
        const endLocal = this.coordinateSync.geoToLocalSimple(endGeo.lat, endGeo.lon, endGeo.height ?? 0);

        // Sample points along this segment
        const segmentLength = Math.sqrt(
          Math.pow(endLocal.x - startLocal.x, 2) + Math.pow(endLocal.z - startLocal.z, 2)
        );
        const numSamples = Math.max(2, Math.ceil(segmentLength / this.CELL_SIZE));

        for (let s = 0; s <= numSamples; s++) {
          const t = s / numSamples;
          const sampleX = startLocal.x + (endLocal.x - startLocal.x) * t;
          const sampleZ = startLocal.z + (endLocal.z - startLocal.z) * t;
          // Anchor Y from the smoothed route — used to validate cell raycasts
          // against bridge decks / tree canopies.
          const anchorY = startLocal.y + (endLocal.y - startLocal.y) * t;

          // Generate cells in corridor around this sample point
          this.generateCorridorCells(sampleX, sampleZ, anchorY, processedCells);
        }
      }
    }
  }

  /**
   * Generate cells in a circular corridor around a route sample point.
   * @param anchorY Smoothed route Y at the corridor centre — stored on each
   *   new cell as its `routeAnchorY` and used to validate the initial
   *   terrain raycast against overhead clutter.
   */
  private generateCorridorCells(
    centerX: number,
    centerZ: number,
    anchorY: number,
    processedCells: Set<number>
  ): number {
    const corridorWidthSq = this.CORRIDOR_WIDTH * this.CORRIDOR_WIDTH;
    const numCells = Math.ceil(this.CORRIDOR_WIDTH / this.CELL_SIZE);
    let newCells = 0;

    for (let dx = -numCells; dx <= numCells; dx++) {
      for (let dz = -numCells; dz <= numCells; dz++) {
        const cellX = centerX + dx * this.CELL_SIZE;
        const cellZ = centerZ + dz * this.CELL_SIZE;

        // Check if within corridor width (circular)
        const distSq = (dx * this.CELL_SIZE) ** 2 + (dz * this.CELL_SIZE) ** 2;
        if (distSq > corridorWidthSq) continue;

        // Create cell key (quantized to grid)
        const cellKeyX = Math.floor(cellX / this.CELL_SIZE);
        const cellKeyZ = Math.floor(cellZ / this.CELL_SIZE);
        const key = this.intCellKey(cellKeyX, cellKeyZ);

        // Skip if already processed
        if (processedCells.has(key)) continue;
        processedCells.add(key);

        // Construct the cell in unsampled state with anchorY as a temporary
        // terrain-Y fallback (combat-side reads need *some* value). Then
        // funnel through sampleCellY — the sole writer of terrainHeight —
        // which promotes the cell to `stable` iff the raycast hits.
        const cellCenterX = (cellKeyX + 0.5) * this.CELL_SIZE;
        const cellCenterZ = (cellKeyZ + 0.5) * this.CELL_SIZE;

        const cell: RouteCell = {
          key,
          x: cellCenterX,
          z: cellCenterZ,
          terrainHeight: anchorY,        // Fallback until sampleCellY succeeds.
          skylineHeight: anchorY,        // Refined below if skylineRaycaster set.
          routeAnchorY: anchorY,
          sample: {
            state: 'unsampled',
            sampledAt: 0,
            tileDepth: 0,
            tileGeometricError: Infinity,
          },
          heightSampled: false,
          enemies: new Set(),
          towerVisibility: new Map(),
          airVisibility: new Map(),
        };

        this.cells.set(key, cell);
        newCells++;

        // Promote to `stable` if tiles are loaded at this position.
        this.sampleCellY(cell);

        // Sample local skyline (max-Y over a small neighbourhood) for air-LOS.
        // Falls back to terrainHeight when no skyline sampler is wired.
        const skylineY = this.skylineRaycaster
          ? this.skylineRaycaster(cellCenterX, cellCenterZ)
          : null;
        cell.skylineHeight = skylineY ?? cell.terrainHeight;
      }
    }

    return newCells;
  }

  /**
   * Update terrain + skyline heights for all cells.
   * Call this after terrain tiles have loaded for accurate visualization
   * and for valid air-LOS pre-compute. Uses ABSOLUTE raycast heights.
   */
  updateTerrainHeights(): void {
    if (!this.terrainRaycaster) return;

    const promoted: RouteCell[] = [];
    let total = 0;
    let promotedCount = 0;
    let refreshedCount = 0;

    for (const cell of this.cells.values()) {
      total++;
      const wasUnsampled = !cell.heightSampled;
      const accepted = this.sampleCellY(cell);
      if (accepted) {
        if (wasUnsampled) {
          promoted.push(cell);
          promotedCount++;
        } else {
          refreshedCount++;
        }
      }
      if (this.skylineRaycaster) {
        const skylineY = this.skylineRaycaster(cell.x, cell.z);
        if (skylineY !== null && skylineY !== cell.skylineHeight) {
          cell.skylineHeight = skylineY;
        }
      }
    }

    logGrid(
      'HEIGHT_UPDATE',
      `cells=${total} promoted=${promotedCount} refreshed=${refreshedCount}`,
    );

    // Refresh the active spatial-grid visualisation so cells snap to the
    // newly sampled heights — fixes "Cell sticks in ground" on toggle-race.
    if (this.visualization) {
      this.initializePositions();
    }

    // Notify listeners about promoted cells so per-tower LOS / viz can
    // be recomputed for them. Cells that had heightSampled=true already
    // are not included — their data was already valid.
    if (promoted.length > 0) {
      this.onCellsPromoted?.(promoted);
    }
  }

  /**
   * Subscribe to terrain-promotion events. Called by tower-placement-service
   * to keep per-tower LOS / viz in sync with cell heightSampled flips.
   */
  setCellsPromotedListener(listener: (promoted: RouteCell[]) => void): void {
    this.onCellsPromoted = listener;
  }

  /**
   * Retry sampling for cells that have never had a real raycast hit
   * (`state === 'unsampled'`). Cheap — only walks the unsampled subset.
   *
   * Intended to be called from tile-load-end callbacks so cells self-heal
   * as tiles stream in, without re-sampling already-stable cells.
   *
   * Triggers `onCellsPromoted` and refreshes the global viz mesh when at
   * least one cell flipped from `unsampled` → `stable`.
   */
  retryUnsampledCells(): void {
    if (!this.terrainRaycaster && !this.terrainSampleRaycaster) return;

    const promoted: RouteCell[] = [];
    let totalUnsampled = 0;

    for (const cell of this.cells.values()) {
      if (cell.sample.state !== 'unsampled') continue;
      totalUnsampled++;
      if (this.sampleCellY(cell)) {
        promoted.push(cell);
      }
    }

    logGrid(
      'HEIGHT_UPDATE',
      `retryUnsampled unsampledBefore=${totalUnsampled} promoted=${promoted.length}`,
    );

    if (promoted.length === 0) return;

    if (this.visualization) {
      this.initializePositions();
    }
    this.onCellsPromoted?.(promoted);
  }

  /**
   * Register a tower and compute LOS for all cells within range.
   * Pre-computes ground LOS and/or air LOS depending on the tower's
   * targeting capabilities. Samples terrain + skyline at registration time
   * (tiles are expected to be loaded) for accurate LOS.
   *
   * Visible cells are the UNION of ground- and air-visible cells: a cell
   * counts as visible if the tower can see *something* in it (ground at
   * skyline-cleared height OR air at skyline + clearance), so the
   * tower-targeting fast path picks up enemies of either type.
   *
   * @param towerId Tower unique ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param tipY Tower tip Y position (for LOS origin)
   * @param range Tower targeting range
   * @param losRaycaster LOS raycaster function
   * @param canTargetGround Whether tower targets ground enemies (default true)
   * @param canTargetAir Whether tower targets air enemies (default false)
   * @returns Array of cells visible from this tower (ground or air)
   */
  registerTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    canTargetGround = true,
    canTargetAir = false
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const rangeSq = range * range;

    for (const cell of this.cells.values()) {
      // Check if cell is within tower range
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq > rangeSq) continue;

      // Try to refresh terrain height from current tile state via the
      // single-source-of-truth sampler. When the raycast fails, the cell
      // keeps its previous terrainHeight (anchor fallback) — register the
      // cell defensively so a later terrain promotion via
      // setCellsPromotedListener can recompute LOS for it instead of
      // leaving holes in tower coverage.
      this.sampleCellY(cell);
      const skylineY = this.skylineRaycaster ? this.skylineRaycaster(cell.x, cell.z) : null;
      if (skylineY !== null) cell.skylineHeight = skylineY;

      // LOS origin offset from tower centre toward cell (raycast from edge)
      const dirX = cell.x - towerX;
      const dirZ = cell.z - towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const atTower = dirLen < 0.1;
      const originX = atTower ? towerX : towerX + (dirX / dirLen) * this.LOS_OFFSET;
      const originZ = atTower ? towerZ : towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

      // Ground visibility: target eye height above terrain
      let groundVisible = false;
      if (canTargetGround) {
        if (atTower) {
          groundVisible = true;
        } else {
          const targetY = cell.terrainHeight + 1.5;
          groundVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
        }
        cell.towerVisibility.set(towerId, groundVisible);
      }

      // Air visibility: target altitude is local skyline + clearance
      let airVisible = false;
      if (canTargetAir) {
        if (atTower) {
          airVisible = true;
        } else {
          const targetY = cell.skylineHeight + AIR_CLEARANCE_M;
          airVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
        }
        cell.airVisibility.set(towerId, airVisible);
      }

      if (groundVisible || airVisible) {
        visibleCells.push(cell);
      }
    }

    // Tower-reg re-sampled cell.terrainHeight for each visited cell — refresh
    // the global viz so its mesh positions match the new cached values,
    // preventing a visible Y-drift between global overlay and per-tower
    // overlay for the same cells.
    if (this.visualization) this.initializePositions();

    return visibleCells;
  }

  /**
   * Re-register a tower after a range change (e.g. range upgrade) without
   * discarding existing LOS data.
   *
   * Behaves like `registerTower`, but for cells already having an entry for
   * this tower (in either visibility map), the cached value is reused — no
   * raycast. Cells outside the new range with a stale entry get cleaned up.
   *
   * This means a range-upgrade only raycasts the *new* cells (the annulus
   * between old and new range), not the entire disc.
   */
  registerTowerIncremental(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    canTargetGround = true,
    canTargetAir = false,
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const rangeSq = range * range;

    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      const inRange = distSq <= rangeSq;

      if (!inRange) {
        // Stale entry outside new range (e.g. range shrunk) — clean up.
        cell.towerVisibility.delete(towerId);
        cell.airVisibility.delete(towerId);
        continue;
      }

      // Refresh heights via single-source-of-truth sampler. If raycast
      // fails, the cached value is kept and a later promotion via
      // setCellsPromotedListener will recompute LOS for this cell.
      this.sampleCellY(cell);
      const skylineY = this.skylineRaycaster ? this.skylineRaycaster(cell.x, cell.z) : null;
      if (skylineY !== null) cell.skylineHeight = skylineY;

      const dirX = cell.x - towerX;
      const dirZ = cell.z - towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const atTower = dirLen < 0.1;
      const originX = atTower ? towerX : towerX + (dirX / dirLen) * this.LOS_OFFSET;
      const originZ = atTower ? towerZ : towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

      // Ground visibility — reuse cached value if present
      let groundVisible = false;
      if (canTargetGround) {
        if (cell.towerVisibility.has(towerId)) {
          groundVisible = cell.towerVisibility.get(towerId)!;
        } else if (atTower) {
          groundVisible = true;
          cell.towerVisibility.set(towerId, groundVisible);
        } else {
          const targetY = cell.terrainHeight + 1.5;
          groundVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
          cell.towerVisibility.set(towerId, groundVisible);
        }
      } else {
        // Capability removed — drop any stale entry
        cell.towerVisibility.delete(towerId);
      }

      // Air visibility — reuse cached value if present
      let airVisible = false;
      if (canTargetAir) {
        if (cell.airVisibility.has(towerId)) {
          airVisible = cell.airVisibility.get(towerId)!;
        } else if (atTower) {
          airVisible = true;
          cell.airVisibility.set(towerId, airVisible);
        } else {
          const targetY = cell.skylineHeight + AIR_CLEARANCE_M;
          airVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
          cell.airVisibility.set(towerId, airVisible);
        }
      } else {
        cell.airVisibility.delete(towerId);
      }

      if (groundVisible || airVisible) {
        visibleCells.push(cell);
      }
    }

    // Same rationale as in registerTower — incremental re-sampling may have
    // updated cell.terrainHeight, keep the global viz mesh in sync.
    if (this.visualization) this.initializePositions();

    return visibleCells;
  }

  /**
   * Unregister a tower (remove LOS data from all cells)
   * @param towerId Tower ID to unregister
   */
  unregisterTower(towerId: string): void {
    for (const cell of this.cells.values()) {
      cell.towerVisibility.delete(towerId);
      cell.airVisibility.delete(towerId);
    }
  }

  /**
   * Update enemy position in the grid
   * Handles cell transitions efficiently
   * @param enemy Enemy entity
   * @param localX New X position (local coordinates)
   * @param localZ New Z position (local coordinates)
   */
  updateEnemyPosition(enemy: Enemy, localX: number, localZ: number): void {
    const cellKeyX = (localX * this.INV_CELL_SIZE) | 0;
    const cellKeyZ = (localZ * this.INV_CELL_SIZE) | 0;
    const newCellKey = this.intCellKey(cellKeyX, cellKeyZ);

    const currentCellKey = this.enemyCellKeys.get(enemy.id);

    // If enemy is in same cell, nothing to do
    if (currentCellKey === newCellKey) return;

    // Remove from old cell
    if (currentCellKey) {
      const oldCell = this.cells.get(currentCellKey);
      if (oldCell) {
        oldCell.enemies.delete(enemy);
      }
    }

    // Add to new cell (if cell exists in our grid)
    const newCell = this.cells.get(newCellKey);
    if (newCell) {
      newCell.enemies.add(enemy);
      this.enemyCellKeys.set(enemy.id, newCellKey);
    } else if (this.enemyCellKeys.has(enemy.id)) {
      // Enemy moved outside tracked corridor cells — no longer targetable by route-grid towers
      this.enemyCellKeys.delete(enemy.id);
    }
  }

  /**
   * Remove enemy from grid (call when enemy dies or is removed)
   * @param enemy Enemy entity
   */
  removeEnemy(enemy: Enemy): void {
    const currentCellKey = this.enemyCellKeys.get(enemy.id);
    if (currentCellKey) {
      const cell = this.cells.get(currentCellKey);
      if (cell) {
        cell.enemies.delete(enemy);
      }
      this.enemyCellKeys.delete(enemy.id);
    }
  }

  /**
   * Get enemies for tower targeting (from visible cells)
   * @param visibleCells Array of cells the tower can see
   * @returns Array of alive enemies in those cells
   */
  getEnemiesForTower(visibleCells: RouteCell[]): Enemy[] {
    const enemies: Enemy[] = [];
    for (const cell of visibleCells) {
      for (const enemy of cell.enemies) {
        if (enemy.alive) {
          enemies.push(enemy);
        }
      }
    }
    return enemies;
  }

  /**
   * Get cell at local coordinates
   * @param localX Local X coordinate
   * @param localZ Local Z coordinate
   * @returns RouteCell or undefined if not in grid
   */
  getCellAt(localX: number, localZ: number): RouteCell | undefined {
    const cellKeyX = (localX * this.INV_CELL_SIZE) | 0;
    const cellKeyZ = (localZ * this.INV_CELL_SIZE) | 0;
    return this.cells.get(this.intCellKey(cellKeyX, cellKeyZ));
  }

  /**
   * Get all alive enemies within a radius of a local position
   * Optimized: O(cells_in_radius) instead of O(all_enemies)
   *
   * @param localX Center X position (local coordinates)
   * @param localZ Center Z position (local coordinates)
   * @param radiusMeters Radius in meters
   * @param excludeId Optional enemy ID to exclude (e.g., the primary target)
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadius(
    localX: number,
    localZ: number,
    radiusMeters: number,
    excludeId?: string
  ): Enemy[] {
    if (!this.coordinateSync) return [];

    const enemies: Enemy[] = [];
    const radiusSq = radiusMeters * radiusMeters;

    // Calculate cell range to check
    const cellRadius = Math.ceil(radiusMeters * this.INV_CELL_SIZE);
    const centerCellX = (localX * this.INV_CELL_SIZE) | 0;
    const centerCellZ = (localZ * this.INV_CELL_SIZE) | 0;

    // Iterate only over cells within radius
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const cellKey = this.intCellKey(centerCellX + dx, centerCellZ + dz);
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        // Check each enemy in cell
        for (const enemy of cell.enemies) {
          if (!enemy.alive) continue;
          if (excludeId && enemy.id === excludeId) continue;

          // Convert enemy geo position to local for precise distance check
          const enemyLocal = this.coordinateSync.geoToLocalSimple(
            enemy.position.lat,
            enemy.position.lon,
            0
          );
          const distSq = (enemyLocal.x - localX) ** 2 + (enemyLocal.z - localZ) ** 2;
          if (distSq <= radiusSq) {
            enemies.push(enemy);
          }
        }
      }
    }

    return enemies;
  }

  /**
   * Get all alive enemies within a radius of a geo position
   * Convenience method that converts geo to local coordinates
   *
   * @param center Center point (lat, lon)
   * @param radiusMeters Radius in meters
   * @param excludeId Optional enemy ID to exclude
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadiusGeo(
    center: GeoPosition,
    radiusMeters: number,
    excludeId?: string
  ): Enemy[] {
    if (!this.coordinateSync) {
      console.warn('[GlobalRouteGrid] getEnemiesInRadiusGeo called before initialization');
      return [];
    }

    const local = this.coordinateSync.geoToLocalSimple(center.lat, center.lon, center.height ?? 0);
    return this.getEnemiesInRadius(local.x, local.z, radiusMeters, excludeId);
  }

  /**
   * Check if position is visible from tower for ground targets (uses pre-computed LOS)
   * @param towerId Tower ID
   * @param localX Target X (local coordinates)
   * @param localZ Target Z (local coordinates)
   * @returns true if visible, false if blocked, undefined if not in grid
   */
  isPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    const cell = this.getCellAt(localX, localZ);
    if (!cell) return undefined;
    return cell.towerVisibility.get(towerId);
  }

  /**
   * Check if position is visible from tower for air targets — pre-computed
   * against `cell.skylineHeight + AIR_CLEARANCE_M`. Distinct from ground
   * visibility because a tall building can block one altitude but not the
   * other.
   * @returns true if visible, false if blocked, undefined if not in grid /
   *          tower has no air-LOS data registered
   */
  isAirPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    const cell = this.getCellAt(localX, localZ);
    if (!cell) return undefined;
    return cell.airVisibility.get(towerId);
  }

  /**
   * Get cell skyline height at a local position. Used by air movement
   * to fly above local rooftops.
   * @returns Skyline local-Y, or null if no cell at that position.
   */
  getSkylineHeightAt(localX: number, localZ: number): number | null {
    const cell = this.getCellAt(localX, localZ);
    return cell ? cell.skylineHeight : null;
  }

  /**
   * Get grid statistics
   */
  getStats(): { totalCells: number; trackedEnemies: number; occupiedCells: number } {
    let occupiedCells = 0;
    for (const cell of this.cells.values()) {
      if (cell.enemies.size > 0) occupiedCells++;
    }
    return {
      totalCells: this.cells.size,
      trackedEnemies: this.enemyCellKeys.size,
      occupiedCells,
    };
  }

  // ========================================
  // VISUALIZATION
  // ========================================

  /** Map cell key to instance index for fast state updates */
  private cellIndexMap = new Map<number, number>();

  /**
   * Create visualization mesh (InstancedMesh with shader)
   * Call once, then use updateVisualization() each frame for color updates only
   */
  createVisualization(): InstancedMesh {
    this.disposeVisualization();

    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    this.visualizationMaterial = new ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: LOS_CELL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS);
    this.visualization = new InstancedMesh(geometry, this.visualizationMaterial, maxCells);
    this.visualization.frustumCulled = false;
    this.visualization.renderOrder = 3;
    // Static usage - positions set once and don't change
    this.visualization.instanceMatrix.setUsage(StaticDrawUsage);

    // Create cell state attribute (updated each frame for colors)
    const stateArray = new Float32Array(maxCells);
    this.cellStateAttribute = new InstancedBufferAttribute(stateArray, 1);
    this.cellStateAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCellState', this.cellStateAttribute);

    // Initialize positions ONCE with live terrain sampling
    this.initializePositions();

    // Initial state update
    this.updateVisualization();

    return this.visualization;
  }

  /**
   * Initialize cell positions (called once when visualization is created)
   * Samples terrain heights live for accurate positioning
   */
  private initializePositions(): void {
    if (!this.visualization) return;

    const maxCells = this.visualization.instanceMatrix.count;
    const matrix = new Matrix4();
    let index = 0;
    this.cellIndexMap.clear();

    for (const cell of this.cells.values()) {
      if (index >= maxCells) break;

      // Only include cells whose terrainHeight came from a real raycast.
      // Unsampled cells (fallback to anchorY at gen-time) would otherwise
      // render far below the map until tiles stream in. They re-enter
      // the viz once updateTerrainHeights promotes them.
      if (!cell.heightSampled) continue;

      const y = cell.terrainHeight + CELL_VIZ_Y_OFFSET_M;
      matrix.setPosition(cell.x, y, cell.z);
      this.visualization.setMatrixAt(index, matrix);

      // Store mapping for fast state updates
      this.cellIndexMap.set(cell.key, index);
      index++;
    }

    this.visualization.count = index;
    this.visualization.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update visualization colors only (call each frame when visible)
   * FAST: Only updates state attribute, no terrain sampling or matrix updates
   */
  updateVisualization(): void {
    if (!this.visualization || !this.cellStateAttribute) return;

    let index = 0;
    for (const cell of this.cells.values()) {
      if (index >= this.visualization.count) break;
      // Same skip-rule as initializePositions — keeps the state buffer
      // aligned with the matrix buffer (both indexed by sampled cells only).
      if (!cell.heightSampled) continue;

      // Determine cell state for coloring (no expensive operations)
      let state: number;
      const hasEnemies = cell.enemies.size > 0;
      const groundVisibleByAny = this.isGroundVisibleByAnyTower(cell);
      const airVisibleByAny = this.isAirVisibleByAnyTower(cell);
      const anyVisible = groundVisibleByAny || airVisibleByAny;

      if (hasEnemies && anyVisible) {
        state = 5; // Yellow: Enemy + visible = target
      } else if (hasEnemies) {
        state = 4; // Purple: Enemy in cell
      } else if (groundVisibleByAny) {
        state = 1; // Green: Ground LoS by at least one tower
      } else if (airVisibleByAny) {
        state = 3; // Muted blue: Air-only LoS
      } else {
        // Gray: either not in any tower's range, or in range but blocked.
        // We don't surface a distinct red "registered-but-blocked" state in
        // the global debug view — that level of detail belongs on the
        // per-tower overlay, not on the always-on global toggle.
        state = 0;
      }

      this.cellStateAttribute.setX(index, state);
      index++;
    }

    this.cellStateAttribute.needsUpdate = true;
  }

  /**
   * Check if cell has ground LoS from any registered tower
   */
  private isGroundVisibleByAnyTower(cell: RouteCell): boolean {
    for (const visible of cell.towerVisibility.values()) {
      if (visible) return true;
    }
    return false;
  }

  /**
   * Check if cell has air LoS from any registered tower
   */
  private isAirVisibleByAnyTower(cell: RouteCell): boolean {
    for (const visible of cell.airVisibility.values()) {
      if (visible) return true;
    }
    return false;
  }

  /**
   * Update animation time (call each frame)
   * @param deltaTime Delta time in milliseconds
   */
  updateAnimation(deltaTime: number): void {
    this.animationTime += deltaTime * 0.001;
    // Wrap animation time to avoid floating point precision issues over time
    // 2*PI ensures seamless looping of sin() based animations
    if (this.animationTime > Math.PI * 2000) {
      this.animationTime = this.animationTime % (Math.PI * 2);
    }
    if (this.visualizationMaterial?.uniforms?.['uTime']) {
      this.visualizationMaterial.uniforms['uTime'].value = this.animationTime;
    }
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): InstancedMesh | null {
    return this.visualization;
  }

  /**
   * Dispose visualization resources
   */
  disposeVisualization(): void {
    if (this.visualization) {
      this.visualization.geometry.dispose();
      this.visualization = null;
    }
    if (this.visualizationMaterial) {
      this.visualizationMaterial.dispose();
      this.visualizationMaterial = null;
    }
    this.cellStateAttribute = null;
    this.cellIndexMap.clear();
  }

  // ========================================
  // PER-TOWER VISUALIZATION
  // ========================================

  /**
   * Create visualization for a specific tower's LOS coverage
   * Shows all cells within range: green = visible, red = blocked
   * Used when tower is selected (always visible, not just debug mode)
   *
   * @param towerId Tower ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param range Tower targeting range
   * @returns InstancedMesh visualization or null if no cells
   */
  createTowerVisualization(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number
  ): InstancedMesh | null {
    const rangeSq = range * range;
    const cellsInRange: { cell: RouteCell; groundVis: boolean; airVis: boolean }[] = [];

    // Collect all cells within tower range that have visibility data.
    // Track ground and air visibility separately so the shader can render
    // a three-way state (green / blue / red). Air-only cells only appear
    // for towers registered with canTargetAir; ground-only towers have
    // no entries in cell.airVisibility and therefore never show blue.
    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq > rangeSq) continue;

      // Unsampled cells: skip — their cell.terrainHeight is still anchor
      // fallback and would render at a wrong Y. They'll appear once
      // updateTerrainHeights promotes them and the per-tower viz is rebuilt.
      if (!cell.heightSampled) continue;

      const hasGround = cell.towerVisibility.has(towerId);
      const hasAir = cell.airVisibility.has(towerId);
      if (!hasGround && !hasAir) continue;

      const groundVis = hasGround ? cell.towerVisibility.get(towerId)! : false;
      const airVis = hasAir ? cell.airVisibility.get(towerId)! : false;
      cellsInRange.push({ cell, groundVis, airVis });
    }

    if (cellsInRange.length === 0) return null;

    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    const material = new ShaderMaterial({
      vertexShader: TOWER_LOS_VERTEX,
      fragmentShader: TOWER_LOS_FRAGMENT,
      uniforms: {
        uTime: { value: this.animationTime },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const mesh = new InstancedMesh(geometry, material, cellsInRange.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    // Build instance matrices and per-instance visibility attributes
    const groundVisibleArray = new Float32Array(cellsInRange.length);
    const airVisibleArray = new Float32Array(cellsInRange.length);
    const matrix = new Matrix4();

    for (let i = 0; i < cellsInRange.length; i++) {
      const { cell, groundVis, airVis } = cellsInRange[i];
      const y = cell.terrainHeight + CELL_VIZ_Y_OFFSET_M;
      matrix.setPosition(cell.x, y, cell.z);
      mesh.setMatrixAt(i, matrix);

      groundVisibleArray[i] = groundVis ? 1 : 0;
      airVisibleArray[i] = airVis ? 1 : 0;
    }

    geometry.setAttribute(
      'aGroundVisible',
      new InstancedBufferAttribute(groundVisibleArray, 1)
    );
    geometry.setAttribute(
      'aAirVisible',
      new InstancedBufferAttribute(airVisibleArray, 1)
    );

    mesh.instanceMatrix.needsUpdate = true;

    return mesh;
  }

  /**
   * Update tower visualization animation time
   * Call this each frame for selected tower's visualization
   */
  updateTowerVisualizationTime(mesh: InstancedMesh): void {
    const material = mesh.material as ShaderMaterial;
    if (material?.uniforms?.['uTime']) {
      material.uniforms['uTime'].value = this.animationTime;
    }
  }

  // ========================================
  // PROGRESSIVE TOWER REGISTRATION
  // ========================================

  /** State for progressive tower LOS computation */
  private towerRegState: {
    towerId: string;
    cells: RouteCell[];
    towerX: number;
    towerZ: number;
    tipY: number;
    losRaycaster: LineOfSightRaycaster;
    canTargetGround: boolean;
    canTargetAir: boolean;
    currentIndex: number;
    batchSize: number;
    visibleCells: RouteCell[];
    onComplete: (visibleCells: RouteCell[]) => void;
  } | null = null;

  /**
   * Start progressive tower LOS registration.
   * Returns immediately — LOS computed over multiple frames via continueTowerRegistration().
   * @param onComplete Called when LOS is fully computed, with final visibleCells array
   */
  registerTowerProgressive(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    canTargetGround: boolean,
    canTargetAir: boolean,
    onComplete: (visibleCells: RouteCell[]) => void
  ): void {
    const rangeSq = range * range;
    const cellsInRange: RouteCell[] = [];

    // Collect cells in range (quick distance check, no raycasts)
    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq <= rangeSq) {
        cellsInRange.push(cell);
      }
    }

    this.registerTowerProgressiveForCells(
      towerId,
      cellsInRange,
      towerX,
      towerZ,
      tipY,
      losRaycaster,
      canTargetGround,
      canTargetAir,
      [],
      onComplete,
    );
  }

  /**
   * Start progressive tower LOS registration for a pre-filtered cell list.
   * Used by `consumePreviewIntoTower` to register only the cells NOT already
   * processed by an active placement preview.
   *
   * @param initialVisibleCells Cells already known visible from the preview
   *   transfer (will be prepended to the final visibleCells array).
   */
  registerTowerProgressiveForCells(
    towerId: string,
    cells: RouteCell[],
    towerX: number,
    towerZ: number,
    tipY: number,
    losRaycaster: LineOfSightRaycaster,
    canTargetGround: boolean,
    canTargetAir: boolean,
    initialVisibleCells: RouteCell[],
    onComplete: (visibleCells: RouteCell[]) => void,
  ): void {
    if (cells.length === 0) {
      onComplete(initialVisibleCells);
      return;
    }

    this.towerRegState = {
      towerId,
      cells,
      towerX,
      towerZ,
      tipY,
      losRaycaster,
      canTargetGround,
      canTargetAir,
      currentIndex: 0,
      batchSize: 50, // 50 cells/frame — faster than preview (tower already placed)
      visibleCells: initialVisibleCells.slice(),
      onComplete,
    };
  }

  /**
   * Transfer the active placement preview's already-computed LOS data into the
   * tower-visibility cell maps. Eliminates redundant raycasts when the player
   * confirms placement at the exact preview position.
   *
   * Returns null when the preview cannot be reused (no active preview, or any
   * of the placement parameters differ from the preview's). The caller must
   * then fall back to a normal registration.
   *
   * On success, returns the cells already known visible from the preview
   * (`consumedCells`) plus the cells still needing a raycast
   * (`remainingCells`). The preview state is cleared afterwards.
   */
  consumePreviewIntoTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    canTargetGround: boolean,
    canTargetAir: boolean,
  ): { consumedCells: RouteCell[]; remainingCells: RouteCell[] } | null {
    const p = this.previewState;
    if (!p) return null;
    if (p.towerX !== towerX || p.towerZ !== towerZ) return null;
    if (p.tipY !== tipY || p.range !== range) return null;
    if (p.canTargetGround !== canTargetGround || p.canTargetAir !== canTargetAir) return null;

    const consumedCells: RouteCell[] = [];
    for (let i = 0; i < p.currentIndex; i++) {
      const cell = p.cells[i];
      const groundVis = p.groundVisibleArray[i] > 0.5;
      const airVis = p.airVisibleArray[i] > 0.5;
      if (canTargetGround) cell.towerVisibility.set(towerId, groundVis);
      if (canTargetAir) cell.airVisibility.set(towerId, airVis);
      if (groundVis || airVis) consumedCells.push(cell);
    }

    const remainingCells = p.cells.slice(p.currentIndex);
    this.previewState = null;
    return { consumedCells, remainingCells };
  }

  /**
   * Continue progressive tower LOS computation.
   * Call each frame from game loop. Returns true when complete.
   */
  continueTowerRegistration(): boolean {
    if (!this.towerRegState) return true;

    const s = this.towerRegState;
    const endIndex = Math.min(s.currentIndex + s.batchSize, s.cells.length);

    for (let i = s.currentIndex; i < endIndex; i++) {
      const cell = s.cells[i];

      // Refresh heights from current tile state. If the raycast fails we
      // keep the cached value and proceed — defensively registering the
      // cell so a later terrain promotion can recompute LOS without
      // leaving holes in tower coverage.
      this.sampleCellY(cell);
      const skylineY = this.skylineRaycaster ? this.skylineRaycaster(cell.x, cell.z) : null;
      if (skylineY !== null) cell.skylineHeight = skylineY;

      const dirX = cell.x - s.towerX;
      const dirZ = cell.z - s.towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const atTower = dirLen < 0.1;
      const originX = atTower ? s.towerX : s.towerX + (dirX / dirLen) * this.LOS_OFFSET;
      const originZ = atTower ? s.towerZ : s.towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

      let groundVisible = false;
      if (s.canTargetGround) {
        if (atTower) {
          groundVisible = true;
        } else {
          const targetY = cell.terrainHeight + 1.5;
          groundVisible = !s.losRaycaster(originX, s.tipY, originZ, cell.x, targetY, cell.z);
        }
        cell.towerVisibility.set(s.towerId, groundVisible);
      }

      let airVisible = false;
      if (s.canTargetAir) {
        if (atTower) {
          airVisible = true;
        } else {
          const targetY = cell.skylineHeight + AIR_CLEARANCE_M;
          airVisible = !s.losRaycaster(originX, s.tipY, originZ, cell.x, targetY, cell.z);
        }
        cell.airVisibility.set(s.towerId, airVisible);
      }

      if (groundVisible || airVisible) {
        s.visibleCells.push(cell);
      }
    }

    s.currentIndex = endIndex;

    if (endIndex >= s.cells.length) {
      const visibleCells = s.visibleCells;
      const onComplete = s.onComplete;
      this.towerRegState = null;
      // Refresh the global viz mesh so its positions reflect the cell
      // terrainHeight values written during this progressive registration.
      // Without this, the global overlay and the per-tower overlay can
      // sit on slightly different Y for the same cells.
      if (this.visualization) this.initializePositions();
      onComplete(visibleCells);
      return true;
    }

    return false;
  }

  // ========================================
  // PROGRESSIVE PLACEMENT PREVIEW
  // ========================================

  /** State for progressive preview building */
  private previewState: {
    mesh: InstancedMesh;
    cells: RouteCell[];
    towerX: number;
    towerZ: number;
    tipY: number;
    range: number;
    losRaycaster: LineOfSightRaycaster;
    groundVisibleArray: Float32Array;
    airVisibleArray: Float32Array;
    currentIndex: number;
    batchSize: number;
    canTargetGround: boolean;
    canTargetAir: boolean;
  } | null = null;

  /**
   * Start progressive placement preview (for build mode).
   * Returns mesh immediately, call continuePreviewBuild() each frame to populate.
   *
   * Preview "visible" colour: cell is shown green if either ground OR air
   * LOS is clear — i.e. the tower can hit *something* in that cell. For an
   * air-only tower this means the green disc reflects skyline-based reach.
   *
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param tipY Tower tip Y position (for LOS origin)
   * @param range Tower targeting range
   * @param losRaycaster LOS raycaster function
   * @param canTargetGround Whether the previewed tower targets ground
   * @param canTargetAir Whether the previewed tower targets air
   * @returns InstancedMesh (empty initially) or null if no cells
   */
  createPlacementPreview(
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    canTargetGround = true,
    canTargetAir = false
  ): InstancedMesh | null {
    // Cancel any ongoing preview build
    this.previewState = null;

    const rangeSq = range * range;
    const cellsInRange: RouteCell[] = [];

    // Collect cells in range (no LOS computation yet)
    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq <= rangeSq) {
        cellsInRange.push(cell);
      }
    }

    if (cellsInRange.length === 0) return null;

    // Sort by distance from tower (radiates outward from center)
    cellsInRange.sort((a, b) => {
      const distA = (a.x - towerX) ** 2 + (a.z - towerZ) ** 2;
      const distB = (b.x - towerX) ** 2 + (b.z - towerZ) ** 2;
      return distA - distB;
    });

    // Create mesh with full capacity but count=0
    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    const material = new ShaderMaterial({
      vertexShader: TOWER_LOS_VERTEX,
      fragmentShader: TOWER_LOS_FRAGMENT,
      uniforms: {
        uTime: { value: this.animationTime },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const mesh = new InstancedMesh(geometry, material, cellsInRange.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.count = 0; // Start empty

    // Pre-allocate per-instance visibility attributes
    const groundVisibleArray = new Float32Array(cellsInRange.length);
    const airVisibleArray = new Float32Array(cellsInRange.length);
    geometry.setAttribute('aGroundVisible', new InstancedBufferAttribute(groundVisibleArray, 1));
    geometry.setAttribute('aAirVisible', new InstancedBufferAttribute(airVisibleArray, 1));
    (geometry.getAttribute('aGroundVisible') as BufferAttribute).setUsage(DynamicDrawUsage);
    (geometry.getAttribute('aAirVisible') as BufferAttribute).setUsage(DynamicDrawUsage);

    // Store state for progressive building
    this.previewState = {
      mesh,
      cells: cellsInRange,
      towerX,
      towerZ,
      tipY,
      range,
      losRaycaster,
      groundVisibleArray,
      airVisibleArray,
      currentIndex: 0,
      batchSize: 50, // Cells per frame — raycast is the bottleneck, see continuePreviewBuild short-circuit
      canTargetGround,
      canTargetAir,
    };

    return mesh;
  }

  /**
   * Continue building the placement preview
   * Call each frame until it returns true (complete)
   * @returns true when preview is fully built
   */
  continuePreviewBuild(): boolean {
    if (!this.previewState) return true;

    const { mesh, cells, towerX, towerZ, tipY, losRaycaster, groundVisibleArray, airVisibleArray, batchSize, currentIndex, canTargetGround, canTargetAir } = this.previewState;

    const matrix = new Matrix4();
    const endIndex = Math.min(currentIndex + batchSize, cells.length);

    for (let i = currentIndex; i < endIndex; i++) {
      const cell = cells[i];

      // Refresh cell-Y via single-source-of-truth sampler. If raycast
      // fails AND the cell was never sampled, we hide its preview
      // instance via a degenerate matrix below.
      this.sampleCellY(cell);
      const terrainY = cell.heightSampled ? cell.terrainHeight : null;
      if (terrainY === null) {
        // Collapse instance to a point off-screen until cell is sampled.
        matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, matrix);
        groundVisibleArray[i] = 0;
        airVisibleArray[i] = 0;
        continue;
      }
      const skylineY = this.skylineRaycaster ? this.skylineRaycaster(cell.x, cell.z) : null;
      const skyline = skylineY ?? cell.skylineHeight;

      const dirX = cell.x - towerX;
      const dirZ = cell.z - towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const atTower = dirLen < 0.1;
      const originX = atTower ? towerX : towerX + (dirX / dirLen) * this.LOS_OFFSET;
      const originZ = atTower ? towerZ : towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

      // Compute ground and air visibility independently — shader paints
      // green / blue / red based on the three-way state. Both flags reflect
      // ground truth even when the current shader prioritises ground over air,
      // so future visualisations / data consumers can rely on the full info.
      let groundVisible = false;
      if (canTargetGround) {
        if (atTower) {
          groundVisible = true;
        } else {
          const targetY = terrainY + 1.5;
          groundVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
        }
      }
      let airVisible = false;
      if (canTargetAir) {
        if (atTower) {
          airVisible = true;
        } else {
          const targetY = skyline + AIR_CLEARANCE_M;
          airVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
        }
      }

      // Set matrix and attributes — identity() first because the previous
      // iteration may have left scale=0 for an unsampled cell.
      matrix.identity();
      matrix.setPosition(cell.x, terrainY + CELL_VIZ_Y_OFFSET_M, cell.z);
      mesh.setMatrixAt(i, matrix);
      groundVisibleArray[i] = groundVisible ? 1 : 0;
      airVisibleArray[i] = airVisible ? 1 : 0;
    }

    // Update mesh
    mesh.count = endIndex;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.geometry.getAttribute('aGroundVisible') as BufferAttribute).needsUpdate = true;
    (mesh.geometry.getAttribute('aAirVisible') as BufferAttribute).needsUpdate = true;

    this.previewState.currentIndex = endIndex;

    // Check if complete
    if (endIndex >= cells.length) {
      this.previewState = null;
      return true;
    }

    return false;
  }

  /**
   * Cancel ongoing preview build
   */
  cancelPreviewBuild(): void {
    this.previewState = null;
  }

  /**
   * Dispose a placement preview mesh
   */
  disposePlacementPreview(mesh: InstancedMesh): void {
    this.previewState = null;
    mesh.geometry.dispose();
    (mesh.material as ShaderMaterial).dispose();
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.cells.clear();
    this.enemyCellKeys.clear();
    this.disposeVisualization();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.terrainRaycaster = null;
    this.coordinateSync = null;
  }
}
