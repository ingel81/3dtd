import { Injectable, inject, signal, effect, isDevMode } from '@angular/core';
import { Object3D } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { StreetNetwork } from './location/osm-street.service';
import { OsmStreetService } from './location/osm-street.service';
import { PathAndRouteService } from './world/path-route.service';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import type { GameStateManager } from '../managers/game-state.manager';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { AssetManagerService } from './infrastructure/asset-manager.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { checkTowerPlacement, TowerPlacementContext, TowerPlacementResult } from '../utils/tower-placement-rules';
import { ResearchStore } from '../store/research.store';
import { TowerLosRegistry } from './tower-los-registry';
import { BuildPreviewLos } from './build-preview-los';
import { makeModelTransparent, tintPreviewModel } from './tower-preview-model';
import {
  FootprintColumn,
  FootprintDecision,
  FootprintRefusal,
  FootprintRule,
  TowerFootprint,
  decideTowerFootprint,
  footprintInnerCount,
  footprintSampleOffsets,
  footprintSurroundingOffsets,
  levelWithCursor,
  resolveTowerFootprint,
  sameFootprint,
} from '../utils/tower-footprint';
import { TowerPlinthPreview } from './tower-plinth-preview';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';

/** One row of `__footprintDebug()`: how the last preview footprint was decided, heights in m. */
export interface FootprintDebugRow {
  tower: TowerTypeId;
  lat: number;
  lon: number;
  /** Surface under the cursor */
  surfaceY: number;
  /** Ground and top of the cursor's column: equal where it shows nothing under a roof */
  centreGroundY: number | null;
  centreTopY: number | null;
  /** `level-inner-ring`: the inner ring lies level, the outer ring is not probed yet */
  rule: FootprintRule | 'level-inner-ring';
  footY: number;
  plinthHeight: number;
  bottom: number | null;
  groundTop: number | null;
  roofTop: number | null;
  /** How many probes the plinth hangs over a drop at: where it ends above an edge, on braces */
  overhang: number;
  /** Why the spot is refused (`wall`, `edge`), null where it is not */
  refusal: FootprintRefusal | null;
  /** Ground of the eight surroundings probes, `-` where one hit nothing */
  surroundingsGroundY: string;
}

/** `__footprintDebug`: the table for the last preview validation, and the watch. */
export interface FootprintDebugHook {
  (): FootprintDebugRow | null;
  /**
   * From now on one console line per preview spot the cursor rests on and
   * per placement click; `false` stops.
   */
  watch(on?: boolean): void;
}

declare global {
  interface Window {
    /** Dev builds: how the footprint of the last build preview validation was decided. */
    __footprintDebug?: FootprintDebugHook;
  }
}

/** How the footprint of a validation was decided, see TowerPlacementService.footprintNote */
interface FootprintNote {
  typeId: TowerTypeId;
  lat: number;
  lon: number;
  surfaceY: number;
  centre: FootprintColumn | null;
  decision: FootprintDecision | null;
}

/** `__footprintDebug.watch()`: the note waiting for the cursor to rest since `since` (tick seconds), the last one logged */
interface FootprintWatch {
  pending: FootprintNote | null;
  since: number;
  logged: FootprintNote | null;
}

/**
 * TowerPlacementService
 *
 * Professional tower placement with:
 * - 3D tower preview following mouse cursor
 * - Green/red tint based on placement validity
 * - Line-of-Sight hex grid preview (BuildPreviewLos)
 * - Direct rotation control (tower faces mouse direction)
 *
 * Also the entry point for a placed tower's LOS on the route grid; the work
 * is done by TowerLosRegistry.
 */
@Injectable({ providedIn: 'root' })
export class TowerPlacementService {
  private globalRouteGrid = inject(GlobalRouteGridService);
  private assetManager = inject(AssetManagerService);
  private uiStore = inject(UIStore);
  private store = inject(TowerDefenseStore);
  private pathRouteService = inject(PathAndRouteService);
  private researchStore = inject(ResearchStore);

  // ========================================
  // SIGNALS (UIStore-backed)
  // ========================================

  /** Build mode active — owned by UIStore */
  readonly buildMode = this.uiStore.buildMode;

  /** Selected tower type — owned by UIStore */
  readonly selectedTowerType = this.uiStore.selectedTowerType;

  /** Build validation reason — owned by UIStore */
  readonly validationReason = this.uiStore.buildValidationReason;

  // ========================================
  // LOCAL SIGNALS (service-internal)
  // ========================================

  readonly currentRotation = signal(0);

  // ========================================
  // STATE
  // ========================================

  /** Per-tower LOS on the route grid: registration and refresh. */
  private readonly losRegistry = new TowerLosRegistry(
    this.globalRouteGrid,
    () => this.researchStore.airTargetingUnlocked(),
  );

  /** GPU-LOS-Viz der Build-Preview. */
  private readonly buildPreviewLos = new BuildPreviewLos(
    this.globalRouteGrid,
    () => this.researchStore.airTargetingUnlocked(),
  );

  /** Single preview tower mesh - used throughout placement */
  private previewTowerMesh: Object3D | null = null;

  /** Plinth under the preview tower on uneven ground */
  private readonly plinthPreview = new TowerPlinthPreview();

  /**
   * Reactive sync: jedes Mal wenn der User `perTowerLosFilter` im
   * UIStore cycled, applien wir den neuen Mode auf die aktive Build-
   * Preview-Viz. Selection-Viz hat ihr eigenes Pendant in TowerManager.
   */
  private readonly losFilterSync = effect(() => {
    const mode = this.uiStore.perTowerLosFilter();
    this.buildPreviewLos.setFilterMode(mode);
  });

  /** Flag indicating model is being loaded */
  private modelLoading = false;

  /**
   * Bumped by every exitBuildMode. A preview load that finishes after the
   * token moved on belongs to a build mode that is gone: cancelled, or
   * replaced by another type.
   */
  private previewLoadToken = 0;

  /** Queued position update while model was loading */
  private queuedPosition: { lat: number; lon: number; height: number } | null = null;

  /** Current preview position and where the tower stands there */
  private currentPosition: { lat: number; lon: number; footprint: TowerFootprint } | null = null;

  /** Rotation speed (radians per second when holding R) */
  private readonly ROTATION_SPEED = Math.PI; // 180 degrees per second

  /** Is currently rotating (R key held) */
  private isRotating = false;

  /**
   * Last validated position, with its cursor surface, footprint and
   * validation result. `partial`: the centre and inner-ring columns while the
   * outer ring waits (probeFootprint), and the frame they were probed in.
   */
  private lastValidation:
    | {
        lat: number;
        lon: number;
        surfaceY: number;
        footprint: TowerFootprint;
        valid: boolean;
        reason: string | null;
        partial: { columns: (FootprintColumn | null)[]; frame: number } | null;
      }
    | null = null;

  /** Frames counted by tickBuildPreviewViz, see settleFootprint */
  private previewFrame = 0;

  /**
   * How the footprint of the last validation was decided, for
   * `__footprintDebug()`. `decision` null: the inner ring lay level and the
   * outer ring waits (probeFootprint).
   */
  private footprintNote: FootprintNote | null = null;

  /** The console hook this service put on window, see initialize */
  private readonly footprintDebugHook: FootprintDebugHook = Object.assign(() => this.footprintDebug(), {
    watch: (on = true) => this.watchFootprint(on),
  });

  /** `__footprintDebug.watch()`, null while off */
  private footprintWatch: FootprintWatch | null = null;

  /** Seconds the footprint note has to stay the same before the watch logs it */
  private static readonly FOOTPRINT_WATCH_REST_S = 0.3;

  /** Distance (m) the cursor must travel before validation re-runs */
  private static readonly VALIDATION_MOVEMENT_THRESHOLD_M = 1.0;

  /** Track loaded model URLs for reference counting */
  private loadedModelUrls = new Set<string>();

  /** Dependencies */
  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private osmService: OsmStreetService | null = null;
  private baseCoords: GeoPosition | null = null;
  private gameState: GameStateManager | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    osmService: OsmStreetService,
    baseCoords: GeoPosition,
    gameState: GameStateManager
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.osmService = osmService;
    this.baseCoords = baseCoords;
    this.gameState = gameState;

    // Runs again on every location change; the registry drops what it
    // queued for the previous one.
    this.losRegistry.attach(engine, gameState);

    if (isDevMode() && typeof window !== 'undefined') window.__footprintDebug = this.footprintDebugHook;
  }

  updateStreetNetwork(streetNetwork: StreetNetwork): void {
    this.streetNetwork = streetNetwork;
  }

  // ========================================
  // BUILD MODE
  // ========================================

  toggleBuildMode(): void {
    if (this.buildMode()) {
      this.exitBuildMode();
    } else {
      // Don't enter build mode here - use selectTowerType
    }
  }

  selectTowerType(typeId: TowerTypeId): void {
    // Clean up any previous state
    this.exitBuildMode();

    this.selectedTowerType.set(typeId);
    this.buildMode.set(true);

    // Deselect any previously selected tower (hides its LOS visualization)
    this.gameState?.towerManager.selectTower(null);

    // Pre-load the preview model
    this.loadPreviewModel(typeId);
  }

  /**
   * Exit build mode - cleanup all previews
   * Called internally after successful placement or externally on cancel (ESC)
   */
  exitBuildMode(): void {
    this.currentPosition = null;
    this.currentRotation.set(0);
    this.lastValidation = null;
    this.validationReason.set(null);
    this.isRotating = false;

    // Drop a preview that is still loading, and the cursor it would apply.
    this.previewLoadToken++;
    this.modelLoading = false;
    this.queuedPosition = null;

    // Clean up preview tower
    this.cleanupPreviewTower();

    // GPU-LOS-Preview-Viz auflösen
    this.buildPreviewLos.dispose();

    this.buildMode.set(false);
  }

  // ========================================
  // PREVIEW MODEL
  // ========================================

  private async loadPreviewModel(typeId: TowerTypeId): Promise<void> {
    // Clean up existing
    this.cleanupPreviewTower();
    this.modelLoading = true;

    const config = TOWER_TYPES[typeId];
    if (!config || !this.engine) {
      this.modelLoading = false;
      return;
    }

    const token = this.previewLoadToken;
    try {
      // Load via AssetManager (cached)
      await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);
      // Build mode was left (or switched to another type) while loading.
      if (token !== this.previewLoadToken || !this.engine) return;

      // Clone the model for preview
      const model = this.assetManager.cloneModel(config.modelUrl);
      if (!model) {
        console.error(`[TowerPlacement] Failed to clone model: ${typeId}`);
        return;
      }

      model.scale.setScalar(config.scale);
      // Apply base rotation from config
      model.rotation.y = config.rotationY ?? 0;
      makeModelTransparent(model, 0.7);

      this.previewTowerMesh = model;
      this.previewTowerMesh.visible = false;
      this.engine.getOverlayGroup().add(this.previewTowerMesh);
    } catch (err) {
      console.error(`[TowerPlacement] Failed to load preview model: ${typeId}`, err);
    } finally {
      if (token === this.previewLoadToken) this.modelLoading = false;
    }
    if (token !== this.previewLoadToken) return;

    // Process queued position if any
    if (this.queuedPosition && this.buildMode()) {
      this.updatePreviewPosition(
        this.queuedPosition.lat,
        this.queuedPosition.lon,
        this.queuedPosition.height
      );
      this.queuedPosition = null;
    }
  }

  private cleanupPreviewTower(): void {
    if (this.previewTowerMesh && this.engine) {
      this.engine.getOverlayGroup().remove(this.previewTowerMesh);
      // Shown only with a preview model (updatePreviewPosition)
      this.engine.towers.hidePreviewRange();
      this.previewTowerMesh = null;
    }
    this.plinthPreview.dispose();
  }

  // ========================================
  // PREVIEW POSITION UPDATE
  // ========================================

  private resolvePlacementHeight(lat: number, lon: number, fallbackHeight: number): number {
    if (!this.engine) {
      return fallbackHeight;
    }

    const devProvider = this.engine.getDevTerrainProvider();
    if (!devProvider) {
      return fallbackHeight;
    }

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const hit = devProvider.raycastDown(local.x, local.z, 10000);
    return hit ? hit.y : fallbackHeight;
  }

  /**
   * Public wrapper around resolvePlacementHeight — raycasts terrain+buildings
   * and returns the highest surface (rooftop if building is below).
   * Used by the bot so towers land on rooftops in DevWorld.
   */
  getSurfaceHeightAt(lat: number, lon: number, fallbackHeight: number): number {
    return this.resolvePlacementHeight(lat, lon, fallbackHeight);
  }

  /**
   * Where a tower of `typeId` stands at (lat, lon) when the surface under the
   * cursor is at `surfaceY`: on the highest point of the ground under its
   * footprint (`footprintRadius`), with a plinth down to the lowest one, see
   * resolveTowerFootprint. Shared by preview, click and bot.
   */
  resolveFootprint(lat: number, lon: number, typeId: TowerTypeId, surfaceY: number): TowerFootprint {
    const radius = TOWER_TYPES[typeId]?.footprintRadius;
    if (!this.engine || radius === undefined) return { footY: surfaceY, plinthHeight: 0 };
    return resolveTowerFootprint(
      surfaceY, radius, this.footprintColumns(lat, lon, radius, 0), this.surroundingColumns(lat, lon, radius),
    );
  }

  /**
   * resolveFootprint for the build preview, with the outer ring put off where
   * it rarely changes anything: the centre and the inner ring come first, and
   * when they lie level with the cursor surface (levelWithCursor) the preview
   * takes the even-ground answer and leaves the outer ring to settleFootprint.
   * Sweeping over level ground then costs the inner probes per validation
   * instead of all of them. Uneven ground is probed whole at once.
   * `partial` holds the probed columns while the outer ring waits.
   */
  private probeFootprint(
    lat: number,
    lon: number,
    typeId: TowerTypeId,
    surfaceY: number,
  ): { footprint: TowerFootprint; partial: (FootprintColumn | null)[] | null } {
    const even = { footY: surfaceY, plinthHeight: 0 };
    const radius = TOWER_TYPES[typeId]?.footprintRadius;
    if (!this.engine || radius === undefined) return { footprint: even, partial: null };

    const inner = this.footprintColumns(lat, lon, radius, 0, footprintInnerCount(radius));
    const note = { typeId, lat, lon, surfaceY, centre: inner[0] ?? null };
    if (levelWithCursor(surfaceY, inner)) {
      this.footprintNote = { ...note, decision: null };
      return { footprint: even, partial: inner };
    }
    const columns = inner.concat(this.footprintColumns(lat, lon, radius, inner.length));
    const decision = decideTowerFootprint(surfaceY, radius, columns, this.surroundingColumns(lat, lon, radius));
    this.footprintNote = { ...note, decision };
    return { footprint: decision.footprint, partial: null };
  }

  /**
   * Probe the outer ring probeFootprint put off for the last validation and
   * keep the whole footprint there, the same resolveFootprint gives. From the
   * frame tick (`now` false) only on a frame after the one it was put off
   * in: a cursor that moves on by a metre every frame never pays for it, one
   * that stays within the metre for a frame does. The click settles it at
   * once. Returns the footprint when it differs from the provisional one.
   *
   * The validation stays as it was: the outer ring cannot refuse the spot.
   * The provisional footprint stands on an inner ring that hit a surface
   * within MIN_UNEVENNESS of the cursor at every probe, so none of it lies in
   * a wall or past an edge (FootprintRefusal), whatever the outer ring shows.
   */
  private settleFootprint(now: boolean): TowerFootprint | null {
    const validation = this.lastValidation;
    const partial = validation?.partial;
    const typeId = this.selectedTowerType();
    if (!validation || !partial || !typeId) return null;
    if (!now && partial.frame >= this.previewFrame - 1) return null;
    validation.partial = null;

    const { lat, lon, surfaceY } = validation;
    const radius = TOWER_TYPES[typeId].footprintRadius;
    const outer = this.footprintColumns(lat, lon, radius, partial.columns.length);
    const decision = decideTowerFootprint(
      surfaceY, radius, partial.columns.concat(outer), this.surroundingColumns(lat, lon, radius),
    );
    this.footprintNote = { typeId, lat, lon, surfaceY, centre: decision.centre, decision };
    const footprint = decision.footprint;
    const provisional = validation.footprint;
    validation.footprint = footprint;
    return sameFootprint(footprint, provisional) ? null : footprint;
  }

  /** Columns of the footprint probes `from` up to `to` (default: all the rest) around (lat, lon). */
  private footprintColumns(
    lat: number,
    lon: number,
    radius: number,
    from: number,
    to?: number,
  ): (FootprintColumn | null)[] {
    return this.columnsAround(lat, lon, footprintSampleOffsets(radius).slice(from, to));
  }

  /**
   * The surroundings probes resolveTowerFootprint asks for to tell a roof
   * from the ground, probed only when it calls.
   */
  private surroundingColumns(lat: number, lon: number, radius: number): () => (FootprintColumn | null)[] {
    return () => this.columnsAround(lat, lon, footprintSurroundingOffsets(radius));
  }

  /** Columns at the offsets (dx, dz) around (lat, lon). */
  private columnsAround(
    lat: number,
    lon: number,
    offsets: readonly (readonly [number, number])[],
  ): (FootprintColumn | null)[] {
    const engine = this.engine;
    if (!engine) return [];
    const center = engine.sync.geoToLocalSimple(lat, lon, 0);
    return offsets.map(([dx, dz]) => this.footprintColumn(engine, center.x + dx, center.z + dz));
  }

  /**
   * `__footprintDebug()` in the console (dev builds): how the footprint of
   * the last preview validation was decided, as a table. For the roof rule
   * on real roofs: does the cursor's column show ground under the roof
   * (centreGroundY below centreTopY), and which rule set the foot.
   */
  private footprintDebug(): FootprintDebugRow | null {
    const note = this.footprintNote;
    if (!note) {
      console.log('[Footprint] no preview validation yet: enter build mode and point at the ground');
      return null;
    }
    const row = this.footprintRow(note);
    console.log(`[Footprint] ${row.tower}: rule ${row.rule}, foot ${row.footY} m, plinth ${row.plinthHeight} m`
      + (row.refusal ? `, refused: ${row.refusal}` : ''));
    console.table(row);
    return row;
  }

  /**
   * `__footprintDebug.watch()`: the same numbers as one line per spot, so
   * the cursor can stay in the game. See tickFootprintWatch and
   * handleBuildClick for when a line comes.
   */
  private watchFootprint(on: boolean): void {
    this.footprintWatch = on ? (this.footprintWatch ?? { pending: null, since: 0, logged: null }) : null;
    console.log(on
      ? '[Footprint] watch on: a line per preview spot the cursor rests on and per placement, __footprintDebug.watch(false) stops'
      : '[Footprint] watch off');
  }

  /**
   * Log the footprint note once it stayed the same for
   * FOOTPRINT_WATCH_REST_S, i.e. the cursor rests on a spot: a new
   * validation or the settled outer ring replaces the note and starts the
   * wait again. Allocates only for the line it logs.
   */
  private tickFootprintWatch(watch: FootprintWatch, timeSeconds: number): void {
    const note = this.lastValidation ? this.footprintNote : null;
    if (note !== watch.pending) {
      watch.pending = note;
      watch.since = timeSeconds;
      return;
    }
    if (!note || note === watch.logged) return;
    if (timeSeconds - watch.since < TowerPlacementService.FOOTPRINT_WATCH_REST_S) return;
    watch.logged = note;
    console.log(this.footprintLine(note, 'rest'));
  }

  /** One watch line: rule, the cursor's column, plinth, overhang, refusal, foot and where. */
  private footprintLine(note: FootprintNote, event: 'rest' | 'placed'): string {
    const row = this.footprintRow(note);
    return `[Footprint] ${event} ${row.tower} rule=${row.rule} centreGroundY=${row.centreGroundY} `
      + `centreTopY=${row.centreTopY} plinthHeight=${row.plinthHeight} overhang=${row.overhang} `
      + `refusal=${row.refusal ?? '-'} footY=${row.footY} `
      + `surfaceY=${row.surfaceY} at ${row.lat.toFixed(6)},${row.lon.toFixed(6)}`;
  }

  /** The note as a row, heights rounded to the centimetre. */
  private footprintRow(note: FootprintNote): FootprintDebugRow {
    const round = (y: number | null | undefined) => (y === null || y === undefined ? null : Math.round(y * 100) / 100);
    const decision = note.decision;
    const surroundings = decision?.surroundings;
    return {
      tower: note.typeId,
      lat: note.lat,
      lon: note.lon,
      surfaceY: round(note.surfaceY)!,
      centreGroundY: round(note.centre?.groundY),
      centreTopY: round(note.centre?.topY),
      rule: decision?.rule ?? 'level-inner-ring',
      footY: round(decision?.footprint.footY ?? note.surfaceY)!,
      plinthHeight: round(decision?.footprint.plinthHeight ?? 0)!,
      bottom: round(decision?.bottom),
      groundTop: round(decision?.groundTop),
      roofTop: round(decision?.roofTop),
      overhang: decision?.footprint.overhang?.length ?? 0,
      refusal: decision?.footprint.refusal ?? null,
      surroundingsGroundY: surroundings
        ? surroundings.map((column) => (column ? round(column.groundY)!.toFixed(2) : '-')).join(' ')
        : 'not probed',
    };
  }

  /**
   * Ground and highest surface of the column at a local position, null where
   * nothing is there: on the 3D tiles `raycastColumnSample`, in DevWorld the
   * same raycastDown as the cursor surface for the top and the terrain height
   * for the ground.
   */
  private footprintColumn(engine: ThreeTilesEngine, x: number, z: number): FootprintColumn | null {
    const devProvider = engine.getDevTerrainProvider();
    if (!devProvider) return engine.terrain.raycastColumnSample(x, z, 'towerFootprint');
    const top = devProvider.raycastDown(x, z, 10000);
    if (!top) return null;
    return { groundY: devProvider.getHeightAtLocal(x, z) ?? top.y, topY: top.y };
  }

  /**
   * Update preview position - called on mouse move
   * In normal mode: tower follows cursor with validation coloring
   * In rotation mode: tower stays fixed, only rotation updates
   */
  updatePreviewPosition(lat: number, lon: number, terrainHeight: number): void {
    if (!this.engine) {
      return;
    }

    // If model is still loading, queue this position for later.
    if (this.modelLoading || !this.previewTowerMesh) {
      this.queuedPosition = { lat, lon, height: terrainHeight };
      return;
    }

    const typeId = this.selectedTowerType();

    // Skip the expensive raycasts + validation if the cursor barely moved.
    // Distance approximation (good for <100m at typical latitudes): treat
    // lat-lon deltas as metric via METERS_PER_DEGREE_LAT and a cos(lat) longitude
    // scale. Cheaper than haversine and allocation-free.
    let footprint: TowerFootprint;
    let validValid: boolean;
    let validReason: string | null;

    const reuseCache = this.lastValidation !== null
      && this.metersFromLastValidated(lat, lon) < TowerPlacementService.VALIDATION_MOVEMENT_THRESHOLD_M;

    if (reuseCache && this.lastValidation) {
      footprint = this.lastValidation.footprint;
      validValid = this.lastValidation.valid;
      validReason = this.lastValidation.reason;
    } else {
      const surfaceY = this.resolvePlacementHeight(lat, lon, terrainHeight);
      const probe = typeId
        ? this.probeFootprint(lat, lon, typeId, surfaceY)
        : { footprint: { footY: surfaceY, plinthHeight: 0 }, partial: null };
      footprint = probe.footprint;
      const validation = this.validateTowerPosition(lat, lon, footprint);
      validValid = validation.valid;
      validReason = validation.valid ? null : (validation.reason ?? 'Invalid position');
      const previousValid = this.lastValidation?.valid ?? null;
      this.lastValidation = {
        lat,
        lon,
        surfaceY,
        footprint,
        valid: validValid,
        reason: validReason,
        partial: probe.partial ? { columns: probe.partial, frame: this.previewFrame } : null,
      };
      // Material tint only flips when the valid/invalid result changes.
      if (previousValid === null || previousValid !== validValid) {
        tintPreviewModel(this.previewTowerMesh, validValid);
      }
    }

    this.validationReason.set(validValid ? null : (validReason ?? 'Invalid position'));

    // Store current position for placement: the foot on the highest point
    // of the footprint, the plinth below it
    const resolvedHeight = footprint.footY;
    this.currentPosition = { lat, lon, footprint };

    if (!typeId) return;
    const config = TOWER_TYPES[typeId];
    if (!config) return;

    // Get local X/Z position (same as marker service)
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Absolute scene Y — the overlay group no longer carries a terrain offset.
    const relativeY = resolvedHeight;

    // Position the preview tower
    this.previewTowerMesh.position.set(
      local.x,
      relativeY + config.heightOffset,
      local.z
    );

    // Apply rotation (base rotation + user rotation)
    const baseRotation = config.rotationY ?? 0;
    this.previewTowerMesh.rotation.y = baseRotation + this.currentRotation();
    this.previewTowerMesh.visible = true;

    // The plinth the tower will get with its braces, hidden on even ground
    this.plinthPreview.show(
      this.engine.getOverlayGroup(),
      local.x,
      resolvedHeight,
      local.z,
      config.footprintRadius,
      footprint.plinthHeight,
      validValid,
      footprint.overhang,
    );

    // Its range ring around the foot, on valid and invalid spots alike
    this.engine.towers.showPreviewRange(local.x, resolvedHeight, local.z, config.range);

    // Update LoS preview only for valid positions (skip calculation for invalid spots)
    if (validValid) {
      this.buildPreviewLos.update(
        this.engine, lat, lon, resolvedHeight, typeId, this.uiStore.perTowerLosFilter(),
      );
    } else {
      // Invalid position — Preview-Viz auflösen (kein Debounce mehr).
      this.buildPreviewLos.dispose();
    }
  }

  /** Approximate meters between (lat, lon) and the last validated sample. */
  private metersFromLastValidated(lat: number, lon: number): number {
    const cache = this.lastValidation!;
    const dLat = (lat - cache.lat) * METERS_PER_DEGREE_LAT;
    const dLon = (lon - cache.lon) * METERS_PER_DEGREE_LAT * Math.cos(lat * DEG_TO_RAD);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  /**
   * Per-Frame-Tick der Bauvorschau: Pulse-Animation der GPU-LOS-Preview und
   * der äußere Ring des Footprints, den probeFootprint aufgeschoben hat
   * (settleFootprint). Ändert er Fuß oder Sockel, steht die Vorschau neu.
   */
  tickBuildPreviewViz(timeSeconds: number): void {
    this.previewFrame++;
    const position = this.currentPosition;
    if (this.settleFootprint(false) && position) {
      // Within the metre of the last validation: takes its footprint, validates nothing
      this.updatePreviewPosition(position.lat, position.lon, position.footprint.footY);
    }
    if (this.footprintWatch) this.tickFootprintWatch(this.footprintWatch, timeSeconds);
    this.buildPreviewLos.tick(timeSeconds);
  }

  // ========================================
  // ROTATION (R key hold)
  // ========================================

  /**
   * Start continuous rotation (called on R key down)
   */
  startRotating(): void {
    this.isRotating = true;
  }

  /**
   * Stop continuous rotation (called on R key up)
   */
  stopRotating(): void {
    this.isRotating = false;
  }

  /**
   * Update rotation - call this in animation loop
   * @param deltaTime Time since last frame in seconds
   */
  updateRotation(deltaTime: number): void {
    if (!this.isRotating || !this.buildMode() || !this.previewTowerMesh) return;

    const newRotation = this.currentRotation() + this.ROTATION_SPEED * deltaTime;
    this.currentRotation.set(newRotation);

    // Apply rotation
    const typeId = this.selectedTowerType();
    const config = typeId ? TOWER_TYPES[typeId] : undefined;
    const baseRotation = config?.rotationY ?? 0;
    this.previewTowerMesh.rotation.y = baseRotation + newRotation;
  }

  hidePreview(): void {
    if (this.previewTowerMesh) {
      this.previewTowerMesh.visible = false;
      this.engine?.towers.hidePreviewRange();
    }
    this.plinthPreview.hide();
  }

  // ========================================
  // CLICK HANDLING
  // ========================================

  /**
   * Handle click in build mode - directly places tower if valid
   */
  handleBuildClick(): boolean {
    const position = this.currentPosition;
    const typeId = this.selectedTowerType();
    if (!this.gameState || !position || !typeId) {
      return false;
    }

    // The outer ring of the footprint, if the preview put it off, shown at
    // once as the click may still be refused; then the rules with the
    // footprint the tower would stand on
    const settled = this.settleFootprint(true);
    if (settled) {
      position.footprint = settled;
      this.updatePreviewPosition(position.lat, position.lon, settled.footY);
    }
    const footprint = position.footprint;
    const validation = this.validateTowerPosition(position.lat, position.lon, footprint);
    if (!validation.valid) {
      return false;
    }

    const watch = this.footprintWatch;
    if (watch && this.footprintNote) {
      watch.logged = this.footprintNote;
      console.log(this.footprintLine(this.footprintNote, 'placed'));
    }

    // Emit command event — GSM handler places the tower
    this.gameState.getEventBus().emit({
      type: 'command:place-tower',
      position: {
        lat: position.lat,
        lon: position.lon,
        height: footprint.footY,
      },
      typeId,
      rotation: this.currentRotation(),
      plinthHeight: footprint.plinthHeight,
      plinthOverhang: footprint.overhang ?? [],
    });

    // Exit build mode (placement handled by GSM via event)
    this.exitBuildMode();
    return true;
  }

  // ========================================
  // VALIDATION
  // ========================================

  /**
   * Get active enemy routes from PathAndRouteService.
   * Returns array of route paths (each route is GeoPosition[]).
   */
  private getActiveRoutes(): GeoPosition[][] {
    const cachedPaths = this.pathRouteService.getCachedPaths();
    return Array.from(cachedPaths.values());
  }

  /**
   * Prüft eine Position gegen die Platzierungsregeln. Gemeinsamer Pfad für
   * Maus-Vorschau, Klick und Bot (Training-Client); die Regeln selbst stehen
   * in `checkTowerPlacement`. Mit `footprint` (resolveFootprint) auch den
   * Grund unter der Grundfläche: Wand oder Abbruch unter dem inneren Ring.
   */
  validateTowerPosition(lat: number, lon: number, footprint?: TowerFootprint): TowerPlacementResult {
    return this.placementChecker()(lat, lon, footprint);
  }

  /**
   * Dieselbe Prüfung für viele Positionen hintereinander, für die
   * Kandidatensuche der Bots: Der Kontext (Tower, Spawns, Routen) wird einmal
   * zusammengestellt statt pro Position. Gleiche Regeln, gleiche
   * Distanzformel. Ein Schnappschuss, nach einer Platzierung neu holen.
   */
  placementChecker(): (lat: number, lon: number, footprint?: TowerFootprint) => TowerPlacementResult {
    const osmService = this.osmService;
    if (!this.streetNetwork || !osmService || !this.baseCoords) {
      return () => ({ valid: false, reason: 'Service not initialized' });
    }

    if (this.streetNetwork.streets.length === 0) {
      return () => ({ valid: false, reason: 'No streets loaded' });
    }

    const ctx: TowerPlacementContext = {
      bounds: this.streetNetwork.bounds,
      base: this.baseCoords,
      // Aus dem Store-Signal, damit verschobene Spawns sofort gelten
      spawns: this.store.spawnPoints(),
      towers: this.gameState?.towerManager.getAll() ?? [],
      routes: this.getActiveRoutes(),
      geo: osmService,
    };
    return (lat, lon, footprint) => checkTowerPlacement(lat, lon, ctx, footprint);
  }

  // ========================================
  // PUBLIC GETTERS
  // ========================================

  getRotation(): number {
    return this.currentRotation();
  }

  // ========================================
  // TOWER GRID REGISTRATION (TowerLosRegistry)
  // ========================================

  /**
   * Register a placed tower on the GlobalRouteGrid: LOS resolve of the
   * cells in range, grid registration for targeting, selection viz refresh.
   */
  registerTowerOnGrid(tower: Tower, position: GeoPosition, typeId: TowerTypeId): void {
    this.losRegistry.register(tower, position, typeId);
  }

  /**
   * Unregister a tower from the GlobalRouteGrid.
   */
  unregisterTowerFromGrid(tower: Tower): void {
    this.losRegistry.unregister(tower);
  }

  /**
   * Recompute a tower's LOS now, e.g. after its range grew. Also settles
   * whatever the height-change queue held for it.
   */
  recomputeTowerLOS(tower: Tower): void {
    this.losRegistry.recompute(tower);
  }

  /**
   * recomputeTowerLOS in one of the next frames instead of right away. For
   * callers inside an event handler whose follow-up state the recompute has
   * to see.
   */
  scheduleLosRecompute(tower: Tower): void {
    this.losRegistry.scheduleRecompute(tower);
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  clearAllTowerOverlays(towers: Tower[]): void {
    for (const tower of towers) {
      this.unregisterTowerFromGrid(tower);
    }
  }

  // ========================================
  // CLEANUP
  // ========================================

  dispose(): void {
    this.exitBuildMode();
    this.losRegistry.detach();
    this.footprintNote = null;
    this.footprintWatch = null;
    if (typeof window !== 'undefined' && window.__footprintDebug === this.footprintDebugHook) {
      delete window.__footprintDebug;
    }

    // Release model references from AssetManager
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    this.engine = null;
    this.streetNetwork = null;
    this.osmService = null;
    this.baseCoords = null;
    this.gameState = null;
  }
}
