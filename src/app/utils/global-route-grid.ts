import {
  InstancedMesh,
  ShaderMaterial,
  InstancedBufferAttribute,
  BoxGeometry,
  Matrix4,
  DoubleSide,
  StaticDrawUsage,
  DynamicDrawUsage,
} from 'three';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition } from '../models/game.types';
import { CoordinateSync } from '../three-engine/renderers';
import { TerrainRaycaster, TerrainSampleRaycaster } from '../three-engine/renderers/three-tower.renderer';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { LosResolveContext, isCubeVisible } from './gpu-cube-resolve';

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
  /**
   * True once `skylineHeight` has been written from a successful raycast
   * (rather than the anchor fallback). Flipped only by `sampleCellSkyline`.
   * Treated as terminal — the skyline is robust against LOD changes
   * (rooftops stay rooftops), so we never re-sample once stable. If the
   * initial raycast fails (tile not loaded), the flag stays false and
   * subsequent calls retry until success → self-heal under tile streaming.
   */
  skylineSampled: boolean;
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
 * Globaler Debug-Route-Grid-Shader.
 *
 * Teilt sich die 3-State-Coverage-Palette mit der per-Tower-Viz (green /
 * cyan / gold) — single source of truth. "Keine Coverage" hat im Aggregat
 * eine andere Semantik (kein Tower in Range) als im per-Tower-Viz (rot =
 * in Reichweite aber blockiert), daher hier ein neutrales Grau statt rot.
 *
 * State-Codes (von updateVisualization gesetzt):
 *   0 → uncovered   (grau, niedrige Alpha — kein Tower in Range)
 *   1 → groundOnly  (grün)
 *   2 → airOnly     (cyan)
 *   3 → both        (gold)
 *   4 → enemyInCell (purple — enemy hier, kein Tower sieht ihn)
 *   5 → enemyVisible(stronger gold — enemy + sichtbar = aktives Ziel)
 */
const LOS_CELL_VERTEX = /* glsl */ `
attribute float aCellState;
varying float vCellState;
varying vec3 vWorldPosition;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vCellState = aCellState;

  vec4 localPos = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif

  vec4 worldPos = modelMatrix * localPos;
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Build the per-cell fragment shader for the global aggregate viz.
 *
 * Strikt 2-State pro Layer: jede Aggregate-Mesh zeigt NUR ihre Layer-
 * Coverage (Layer-Primärfarbe) oder uncovered (grau). Gold gibt es im
 * Aggregat NICHT — Gold ist Per-Tower-Both-Filter-only.
 *
 * Wenn beide Aggregate gleichzeitig sichtbar sind, sieht der Spieler
 * "both ground+air" implizit durch das visuelle Stapeln zweier
 * Schichten (grün am Boden + blau auf +15m für dieselbe Cell).
 *
 * Zukünftige Merged-View (gold in Aggregat) kann als dritte Variante
 * dieses Shaders gebaut werden — der State-Buffer enthält state 3
 * (both) weiterhin, nur die Interpretation hier collapsed ihn auf die
 * Layer-Primärfarbe.
 *
 *   Ground-Layer (gridLayer) — 2-State:
 *     state 0 (neither)       → grey
 *     state 1 (groundOnly)    → green (ground covered)
 *     state 2 (airOnly)       → grey  (ground NICHT covered)
 *     state 3 (both)          → green (ground IS covered, ignore air info)
 *     state 4 (enemyInCell)   → grey
 *     state 5 (enemyVisible)  → green (covered → use layer color)
 *
 *   Air-Layer (airLayer) — 2-State:
 *     state 0 → grey
 *     state 1 → grey  (air NICHT covered)
 *     state 2 → blue  (air covered)
 *     state 3 → blue  (air IS covered, ignore ground info)
 *     state 4 → grey
 *     state 5 → blue
 */
function buildLosCellFragment(opts: { airLayer: boolean }): string {
  const s = LOS_VIZ_CONFIG.states;
  const g = LOS_VIZ_CONFIG.globalStates;
  const c = (col: { color: { r: number; g: number; b: number } }) =>
    `vec3(${col.color.r.toFixed(4)}, ${col.color.g.toFixed(4)}, ${col.color.b.toFixed(4)})`;

  const grey = `color = ${c(g.uncovered)}; alpha = ${g.uncovered.alpha.toFixed(3)};`;
  // Layer-Primärfarbe (green für Ground-Layer, blue für Air-Layer):
  const primary = opts.airLayer
    ? `color = ${c(s.airOnly)}; alpha = ${s.airOnly.alpha.toFixed(3)};`
    : `color = ${c(s.groundOnly)}; alpha = ${s.groundOnly.alpha.toFixed(3)};`;

  // Per-Layer-Coverage-Test: ground-grid zeigt primary für state 1 (groundOnly)
  // UND state 3 (both); air-grid zeigt primary für state 2 (airOnly) UND state
  // 3 (both). state 5 (enemyVisible) = covered → primary auf beiden Layern.
  // Alle anderen States → grey.
  const groundLayerOnly = opts.airLayer ? grey : primary;
  const airLayerOnly    = opts.airLayer ? primary : grey;
  const both            = primary;          // beide Layer covered → ihre primary
  const enemyVisible    = primary;          // enemy + covered → covered

  return /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying float vCellState;
varying vec3 vWorldPosition;

void main() {
  #include <logdepthbuf_fragment>
  vec3 color;
  float alpha;

  // 0 → uncovered
  if (vCellState < 0.5) {
    ${grey}
  }
  // 1 → groundOnly
  else if (vCellState < 1.5) {
    ${groundLayerOnly}
  }
  // 2 → airOnly
  else if (vCellState < 2.5) {
    ${airLayerOnly}
  }
  // 3 → both ground+air (Aggregate: collapsed auf Layer-Primärfarbe,
  //                       Gold ausschliesslich Per-Tower-Both-Filter)
  else if (vCellState < 3.5) {
    ${both}
  }
  // 4 → enemyInCell (kein Tower covered → grey auf jeder Layer)
  else if (vCellState < 4.5) {
    ${grey}
  }
  // 5 → enemyVisible (Enemy + covered → Layer-Primärfarbe)
  else {
    ${enemyVisible}
  }

  float pulse = sin(uTime * ${LOS_VIZ_CONFIG.pulseSpeed.toFixed(2)}) *
                ${LOS_VIZ_CONFIG.pulseDepth.toFixed(3)} +
                (1.0 - ${LOS_VIZ_CONFIG.pulseDepth.toFixed(3)} * 0.5);
  gl_FragColor = vec4(color, alpha * pulse);
}
`;
}

const LOS_CELL_FRAGMENT = buildLosCellFragment({ airLayer: false });
const LOS_CELL_FRAGMENT_AIR = buildLosCellFragment({ airLayer: true });

/**
 * Single-source-of-truth for the LOS air-sample altitude of a cell.
 * Used by the layer-builder (per-tower visibility shader), the
 * air-route-tube debug overlay, and any future air-targeting code that
 * needs the canonical sample-Y. Keep this in lock-step with
 * `tower-los-layer-builder.ts` which inlines the same formula.
 */
export function getAirTargetY(cell: RouteCell): number {
  return cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset;
}

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

  /**
   * Last set of routes that `generateFromRoutes` was called with. Used
   * by the air-route-tube debug overlay to re-render along the same
   * geometry the grid was built from. Empty until `generateFromRoutes`
   * runs at least once.
   */
  private cachedRoutes: GeoPosition[][] = [];

  /** Cached enemy routes (geo-coordinate polylines) for debug overlays. */
  getCachedRoutes(): GeoPosition[][] {
    return this.cachedRoutes;
  }

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

  /**
   * Optional air-altitude mirror of the global Aggregate-Viz — same cell
   * set, same `aCellState` buffer (shared!), positioned at
   * `cell.terrainHeight + airSampleYOffset` with a stripe-pattern shader.
   * Built lazily by `createAirVisualization()` when the corresponding
   * toggle goes ON.
   */
  private airVisualization: InstancedMesh | null = null;
  private airVisualizationMaterial: ShaderMaterial | null = null;

  /** Animation time accumulator */
  private animationTime = 0;

  /**
   * Safety hard-limit for the viz InstancedMesh capacity. Real cell counts
   * are passed directly via `this.cells.size` — this cap only fires if the
   * grid grows pathologically (e.g. a Manhattan-scale route fan-out) and
   * keeps the buffer allocation bounded. 50k × (Matrix4 + Float32) ≈ 4 MB
   * per layer worst-case, which is fine.
   *
   * Three.js InstancedMesh cannot grow at runtime; if a grid genuinely
   * needs more than this, `disposeVisualization` + `createVisualization`
   * is the path forward (already invoked on toggle / location change).
   */
  private readonly MAX_VIZ_CELLS_HARDLIMIT = 50_000;

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
   * Single source of truth for `cell.skylineHeight`.
   *
   * Idempotent: once a successful raycast has written the skyline height
   * (`skylineSampled = true`), further calls are no-ops. Unlike
   * `sampleCellY`, we don't LOD-version this — rooftops don't move
   * between tile LODs in any way that matters for air-LOS (±0.5 m is
   * irrelevant against AIR_CLEARANCE_M = 10 m). If you ever need that,
   * mirror the `terrainSampleRaycaster` pattern here.
   *
   * Before this existed, every `registerTower` / `continuePreviewBuild`
   * iteration re-raycast the skyline for every cell every frame — ~33 %
   * of all raycasts during placement preview were redundant.
   *
   * @returns `true` when the cell was promoted from unsampled to sampled.
   */
  private sampleCellSkyline(cell: RouteCell): boolean {
    if (cell.skylineSampled) return false;
    if (!this.skylineRaycaster) return false;
    const skylineY = this.skylineRaycaster(cell.x, cell.z);
    if (skylineY === null) return false;
    cell.skylineHeight = skylineY;
    cell.skylineSampled = true;
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
    this.cachedRoutes = routes;

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
          skylineSampled: false,
          enemies: new Set(),
          towerVisibility: new Map(),
          airVisibility: new Map(),
        };

        this.cells.set(key, cell);
        newCells++;

        // Promote to `stable` if tiles are loaded at this position.
        this.sampleCellY(cell);
        this.sampleCellSkyline(cell);
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
      this.sampleCellSkyline(cell);
    }

    logGrid(
      'HEIGHT_UPDATE',
      `cells=${total} promoted=${promotedCount} refreshed=${refreshedCount}`,
    );

    // Refresh the active spatial-grid visualisation so cells snap to the
    // newly sampled heights — fixes "Cell sticks in ground" on toggle-race.
    this.refreshAggregateVizPositions();

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
      // Skyline can be unsampled independently from terrain (e.g. building
      // tiles stream after ground tiles). Retry it for any cell that needs it.
      if (!cell.skylineSampled) this.sampleCellSkyline(cell);

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

    this.refreshAggregateVizPositions();
    this.onCellsPromoted?.(promoted);
  }

  /**
   * Locally refine cell-Y for all cells within `radius` of (x, z). Walks
   * the candidate set, calls `sampleCellY` on each — promoting unsampled
   * cells and refreshing stable cells if the tile-LOD improved.
   *
   * Cheap relative to a full grid sweep: only cells inside the radius
   * are touched. Used right before tower placement / preview so the
   * tower's range gets the freshest possible per-cell heights without
   * waiting for a global tile-load-driven refresh.
   *
   * Returns counts for logging / verification. Triggers viz refresh +
   * onCellsPromoted when at least one cell flipped from unsampled.
   */
  /**
   * Schmal-Variante von `refineCellsInRadius`: ruft `sampleCellY` NUR
   * für Cells im Radius, die noch nicht `stable` sind. Skip-Pfad für
   * bereits-gesampelte Cells = kein Raycast.
   *
   * Use case: per-frame Build-Preview-Aufrufe, wo wir Cells in der
   * Cursor-Region zu `stable` bringen müssen damit sie in der Viz
   * erscheinen, aber wir keine LOD-Upgrades für bereits stabile Cells
   * brauchen (Y-Drift durch LOD bewegt sich im Sub-Meter-Bereich, was
   * für die Coverage-Viz und LOS-Raycasts irrelevant ist).
   *
   * Tile-Streaming-getriebene LOD-Upgrades laufen weiterhin über die
   * volle `refineCellsInRadius` aus dem Tile-Load-End-Pfad.
   */
  promoteUnsampledCellsInRadius(x: number, z: number, radius: number): { promoted: number } {
    if (!this.terrainRaycaster && !this.terrainSampleRaycaster) {
      return { promoted: 0 };
    }
    const rangeSq = radius * radius;
    const promoted: RouteCell[] = [];

    for (const cell of this.cells.values()) {
      if (cell.heightSampled) continue;
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq > rangeSq) continue;
      if (this.sampleCellY(cell)) {
        promoted.push(cell);
      }
    }

    if (promoted.length > 0) {
      this.refreshAggregateVizPositions();
      this.onCellsPromoted?.(promoted);
    }

    return { promoted: promoted.length };
  }

  refineCellsInRadius(x: number, z: number, radius: number): { promoted: number; refreshed: number; inRange: number } {
    if (!this.terrainRaycaster && !this.terrainSampleRaycaster) {
      return { promoted: 0, refreshed: 0, inRange: 0 };
    }
    const rangeSq = radius * radius;
    const promoted: RouteCell[] = [];
    let refreshed = 0;
    let inRange = 0;

    for (const cell of this.cells.values()) {
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq > rangeSq) continue;
      inRange++;
      const wasUnsampled = !cell.heightSampled;
      const accepted = this.sampleCellY(cell);
      if (accepted) {
        if (wasUnsampled) promoted.push(cell);
        else refreshed++;
      }
    }

    logGrid(
      'REFINE',
      `at=(${x.toFixed(1)},${z.toFixed(1)}) r=${radius.toFixed(1)} inRange=${inRange} promoted=${promoted.length} refreshed=${refreshed}`,
    );

    if (promoted.length > 0) {
      this.refreshAggregateVizPositions();
      this.onCellsPromoted?.(promoted);
    }

    return { promoted: promoted.length, refreshed, inRange };
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
   * @param range Tower targeting range
   * @param ctx GPU-cube resolve context (built by caller via TowerShadowMapper)
   * @param canTargetGround Whether tower targets ground enemies (default true)
   * @param canTargetAir Whether tower targets air enemies (default false)
   * @returns Array of cells visible from this tower (ground or air)
   */
  registerTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number,
    ctx: LosResolveContext,
    canTargetGround = true,
    canTargetAir = false
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const rangeSq = range * range;
    const tipX = ctx.referencePos.x;
    const tipY = ctx.referencePos.y;
    const tipZ = ctx.referencePos.z;
    const buf = new Uint8Array(4);

    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq > rangeSq) continue;

      // Try to refresh terrain height from current tile state via the
      // single-source-of-truth sampler. When the raycast fails, the cell
      // keeps its previous terrainHeight (anchor fallback) — register the
      // cell defensively so a later terrain promotion via
      // setCellsPromotedListener can recompute LOS for it instead of
      // leaving holes in tower coverage.
      this.sampleCellY(cell);

      const atTower = distSq < 0.01;

      // Ground visibility — GPU-cube sample at cell.terrainHeight + 1.5m
      let groundVisible = false;
      if (canTargetGround) {
        if (atTower) {
          groundVisible = true;
        } else {
          const targetY = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
          groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx, buf);
        }
        cell.towerVisibility.set(towerId, groundVisible);
      }

      // Air visibility — GPU-cube sample at getAirTargetY(cell) (terrain + 15m)
      let airVisible = false;
      if (canTargetAir) {
        if (atTower) {
          airVisible = true;
        } else {
          const targetY = getAirTargetY(cell);
          airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx, buf);
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
    this.refreshAggregateVizPositions();

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
    range: number,
    ctx: LosResolveContext,
    canTargetGround = true,
    canTargetAir = false,
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const rangeSq = range * range;
    const tipX = ctx.referencePos.x;
    const tipY = ctx.referencePos.y;
    const tipZ = ctx.referencePos.z;
    const buf = new Uint8Array(4);

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

      const atTower = distSq < 0.01;

      // Ground visibility — reuse cached value if present, otherwise GPU-sample
      let groundVisible = false;
      if (canTargetGround) {
        if (cell.towerVisibility.has(towerId)) {
          groundVisible = cell.towerVisibility.get(towerId)!;
        } else if (atTower) {
          groundVisible = true;
          cell.towerVisibility.set(towerId, groundVisible);
        } else {
          const targetY = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
          groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx, buf);
          cell.towerVisibility.set(towerId, groundVisible);
        }
      } else {
        // Capability removed — drop any stale entry
        cell.towerVisibility.delete(towerId);
      }

      // Air visibility — reuse cached value if present, otherwise GPU-sample
      let airVisible = false;
      if (canTargetAir) {
        if (cell.airVisibility.has(towerId)) {
          airVisible = cell.airVisibility.get(towerId)!;
        } else if (atTower) {
          airVisible = true;
          cell.airVisibility.set(towerId, airVisible);
        } else {
          const targetY = getAirTargetY(cell);
          airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx, buf);
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
    this.refreshAggregateVizPositions();

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
   * Drop only the ground-visibility cache for this tower. The next
   * registerTowerIncremental call will re-resolve them from a fresh
   * cubemap render. Used by recomputeAllTowersGroundLOS on tile-streaming
   * events so stale tile-LOD geometry can't keep the cache outdated.
   *
   * Air-visibility is wiped too because the same render serves both —
   * keeping them in lock-step avoids divergence between the two maps.
   */
  clearGroundVisibilityForTower(towerId: string): void {
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

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
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

    // Initialize positions ONCE with live terrain sampling (ground Y)
    this.initializePositions(this.visualization, /* airLayer */ false);

    // If an air visualization already exists (toggle ordering: air ON
    // before ground), keep it consistent with the same cell index map.
    if (this.airVisualization) {
      this.initializePositions(this.airVisualization, /* airLayer */ true);
      this.airVisualization.geometry.setAttribute('aCellState', this.cellStateAttribute);
    }

    // Initial state update
    this.updateVisualization();

    return this.visualization;
  }

  /**
   * Create the air-layer mirror of the global aggregate viz. Same cell
   * set, same state buffer (shared with `visualization`), positioned at
   * `terrainHeight + airSampleYOffset` with a stripe-pattern fragment.
   *
   * Lazily created on first toggle; if `createVisualization()` has not
   * been called yet (no ground layer), the state attribute is created
   * here and re-used when the ground layer comes online later.
   */
  createAirVisualization(): InstancedMesh {
    this.disposeAirVisualization();

    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    this.airVisualizationMaterial = new ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: LOS_CELL_FRAGMENT_AIR,
      uniforms: {
        uTime: { value: 0 },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      // Air-Plate auf gleicher Y wie Air-Enemies (terrainHeight + 15m).
      // depthTest:true + polygonOffset schiebt die Plate hinter den vor-
      // gerenderten Enemy, sonst paint-over → Enemy unsichtbar. Siehe
      // Begründung in tower-los-layer-builder.ts.
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 1.0,
      side: DoubleSide,
    });

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
    this.airVisualization = new InstancedMesh(geometry, this.airVisualizationMaterial, maxCells);
    this.airVisualization.frustumCulled = false;
    this.airVisualization.renderOrder = 4;
    this.airVisualization.instanceMatrix.setUsage(StaticDrawUsage);

    // State attribute: re-use the ground-layer buffer if it exists, else
    // create it here. Ground-layer-creation will re-bind when it runs.
    if (!this.cellStateAttribute) {
      const stateArray = new Float32Array(maxCells);
      this.cellStateAttribute = new InstancedBufferAttribute(stateArray, 1);
      this.cellStateAttribute.setUsage(DynamicDrawUsage);
    }
    geometry.setAttribute('aCellState', this.cellStateAttribute);

    this.initializePositions(this.airVisualization, /* airLayer */ true);
    this.updateVisualization();

    return this.airVisualization;
  }

  /**
   * Initialize cell positions for one of the two layer-meshes. Ground
   * uses `terrainHeight + CELL_VIZ_Y_OFFSET_M`, Air uses
   * `terrainHeight + airSampleYOffset`. Both layers share the same
   * `cellIndexMap` ordering — instance N on both meshes refers to the
   * same `RouteCell`, so the shared state attribute aligns correctly.
   */
  /**
   * Refresh the cell positions of WHICHEVER aggregate-viz meshes are
   * currently built (ground, air, both, or neither). Cheap idempotent
   * helper for the three "cells were re-sampled, sync the viz" sites
   * in registerTower / refineCellsInRadius / registerTowerIncremental.
   */
  private refreshAggregateVizPositions(): void {
    if (this.visualization) {
      this.initializePositions(this.visualization, /* airLayer */ false);
    }
    if (this.airVisualization) {
      this.initializePositions(this.airVisualization, /* airLayer */ true);
      // Re-bind the (possibly re-built) state attribute so both layers
      // stay aligned.
      if (this.cellStateAttribute) {
        this.airVisualization.geometry.setAttribute('aCellState', this.cellStateAttribute);
      }
    }
  }

  private initializePositions(mesh: InstancedMesh, airLayer: boolean): void {
    const maxCells = mesh.instanceMatrix.count;
    const matrix = new Matrix4();
    let index = 0;

    // The ground-layer call is authoritative for the index map. The
    // air-layer call (called second) just re-walks in the same order.
    const writeIndexMap = !airLayer;
    if (writeIndexMap) this.cellIndexMap.clear();

    for (const cell of this.cells.values()) {
      if (index >= maxCells) break;

      // Only include cells whose terrainHeight came from a real raycast.
      // Unsampled cells (fallback to anchorY at gen-time) would otherwise
      // render far below the map until tiles stream in. They re-enter
      // the viz once updateTerrainHeights promotes them.
      if (!cell.heightSampled) continue;

      const y = airLayer
        ? getAirTargetY(cell)
        : cell.terrainHeight + CELL_VIZ_Y_OFFSET_M;
      matrix.setPosition(cell.x, y, cell.z);
      mesh.setMatrixAt(index, matrix);

      if (writeIndexMap) this.cellIndexMap.set(cell.key, index);
      index++;
    }

    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update visualization colors only (call each frame when visible)
   * FAST: Only updates state attribute, no terrain sampling or matrix updates
   */
  updateVisualization(): void {
    if (!this.cellStateAttribute) return;
    // State buffer is shared between ground & air meshes — write once,
    // both layers read it. We need at least one of the two meshes for
    // the per-mesh `count` (cap of the loop).
    const meshCount = this.visualization?.count ?? this.airVisualization?.count ?? 0;
    if (meshCount === 0) return;

    let index = 0;
    for (const cell of this.cells.values()) {
      if (index >= meshCount) break;
      // Same skip-rule as initializePositions — keeps the state buffer
      // aligned with the matrix buffer (both indexed by sampled cells only).
      if (!cell.heightSampled) continue;

      // 4-State Aggregate (shared palette with per-tower viz) + Enemy-Overlays.
      // State-Codes siehe buildLosCellFragment() oben.
      const hasEnemies = cell.enemies.size > 0;
      const groundByAny = this.isGroundVisibleByAnyTower(cell);
      const airByAny = this.isAirVisibleByAnyTower(cell);

      let state: number;
      if (hasEnemies && (groundByAny || airByAny)) {
        state = 5; // enemyVisible — aktives Ziel
      } else if (hasEnemies) {
        state = 4; // enemyInCell — Enemy, kein Tower sieht ihn
      } else if (groundByAny && airByAny) {
        state = 3; // both
      } else if (groundByAny) {
        state = 1; // groundOnly
      } else if (airByAny) {
        state = 2; // airOnly
      } else {
        state = 0; // neither
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
    if (this.airVisualizationMaterial?.uniforms?.['uTime']) {
      this.airVisualizationMaterial.uniforms['uTime'].value = this.animationTime;
    }
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): InstancedMesh | null {
    return this.visualization;
  }

  /** Get the optional air-layer aggregate viz (NULL until toggled on). */
  getAirVisualization(): InstancedMesh | null {
    return this.airVisualization;
  }

  /**
   * Dispose ground visualization resources. The shared state attribute
   * stays alive as long as the air layer references it — only cleared
   * when BOTH layers are disposed.
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
    if (!this.airVisualization) {
      // No more consumers of the shared state buffer → safe to drop.
      this.cellStateAttribute = null;
      this.cellIndexMap.clear();
    }
  }

  /** Dispose air-layer aggregate viz (mirror of disposeVisualization). */
  disposeAirVisualization(): void {
    if (this.airVisualization) {
      this.airVisualization.geometry.dispose();
      this.airVisualization = null;
    }
    if (this.airVisualizationMaterial) {
      this.airVisualizationMaterial.dispose();
      this.airVisualizationMaterial = null;
    }
    if (!this.visualization) {
      this.cellStateAttribute = null;
      this.cellIndexMap.clear();
    }
  }

  // ========================================
  // CELLS-IN-RANGE QUERY (GPU-LOS-Pipeline)
  // ========================================

  /**
   * Liefert alle Cells deren Center innerhalb `range` von (x, z) liegt
   * UND deren Terrain-Sample stabil ist. Wird von der GPU-LOS-Viz-
   * Pipeline (TowerLosViz / TowerLosLayerBuilder) als Cell-Set genutzt.
   */
  getCellsInRange(x: number, z: number, range: number): RouteCell[] {
    const rangeSq = range * range;
    const result: RouteCell[] = [];
    for (const cell of this.cells.values()) {
      if (!cell.heightSampled) continue;
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq <= rangeSq) result.push(cell);
    }
    return result;
  }

  /** Grid-Cell-Size (m). */
  getCellSize(): number {
    return this.CELL_SIZE;
  }


  /**
   * Clear all data
   */
  clear(): void {
    this.cells.clear();
    this.enemyCellKeys.clear();
    this.disposeVisualization();
    this.disposeAirVisualization();
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
