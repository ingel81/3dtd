import { Injectable, inject, signal } from '@angular/core';
import {
  Group, Mesh, MeshPhongMaterial, MeshBasicMaterial, Color,
  BufferGeometry, Vector3, LineLoop, LineDashedMaterial, Line,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { MarkerVisualizationService } from './marker-visualization.service';
import { OsmStreetService, StreetNetwork } from './osm-street.service';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { UIStore } from '../store/ui.store';
import { GeoPosition } from '../models/game.types';
import {
  MIN_MANUAL_SPAWN_DISTANCE,
  MAX_MANUAL_SPAWN_DISTANCE,
  MAX_PLACEMENT_STREET_DISTANCE,
} from '../configs/map-constants.config';

/**
 * Result of a successful placement click
 */
export interface PlacementResult {
  mode: 'hq' | 'spawn';
  lat: number;
  lon: number;
  height: number;
}

// Colors for valid/invalid preview
const HQ_COLOR = 0x22c55e;
const SPAWN_COLOR = 0xef4444;
const INVALID_COLOR = 0xff0000;
const HEIGHT_ABOVE_GROUND = 30;

/**
 * MapPlacementService
 *
 * Handles interactive HQ and spawn point placement on the 3D map.
 * Manages preview marker (follows cursor), position validation,
 * and mode lifecycle. Follows the TowerPlacementService pattern.
 */
@Injectable({ providedIn: 'root' })
export class MapPlacementService {
  private readonly uiStore = inject(UIStore);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly osmService = inject(OsmStreetService);

  /** Current validation reason (null when valid) — read by component for context hints */
  readonly validationReason = signal<string | null>(null);

  // Preview marker that follows the cursor
  private previewMarker: Group | null = null;

  // Distance rings (min/max spawn distance from HQ)
  private distanceRings: Line[] = [];

  // Current validated position (set on mouse move)
  private currentPosition: { lat: number; lon: number; height: number } | null = null;
  private currentValid = false;

  // Dependencies (set via initialize)
  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private baseCoords: GeoPosition | null = null;

  // Original marker color for valid state
  private validColor = HQ_COLOR;

  // ========================================
  // PUBLIC API
  // ========================================

  /** Current placement mode (delegates to UIStore) */
  placementMode(): 'hq' | 'spawn' | null {
    return this.uiStore.mapPlacementMode();
  }

  /**
   * Initialize with engine and current game state.
   * Called from VisualizationFacade after engine + streets are ready.
   */
  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork | null,
    baseCoords: GeoPosition,
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.baseCoords = baseCoords;
  }

  /**
   * Update dependencies after location change.
   */
  updateDependencies(
    streetNetwork: StreetNetwork | null,
    baseCoords: GeoPosition,
  ): void {
    this.streetNetwork = streetNetwork;
    this.baseCoords = baseCoords;
  }

  /**
   * Enter placement mode. Creates a preview marker that follows the cursor.
   * @param mode 'hq' to place headquarters, 'spawn' to place spawn point
   */
  startPlacement(mode: 'hq' | 'spawn'): void {
    // Clean up any previous placement
    this.exitPlacementMode();

    // Set mode signal
    this.uiStore.mapPlacementMode.set(mode);

    // Determine color
    this.validColor = mode === 'hq' ? HQ_COLOR : SPAWN_COLOR;

    // Create preview marker (semi-transparent)
    this.previewMarker = this.markerViz.createDiamondMarker({
      color: this.validColor,
      size: 0.8,
      showRings: mode === 'hq',
      glowIntensity: 0.6,
    });
    this.previewMarker.name = 'placementPreview';
    this.previewMarker.visible = false;

    // Make semi-transparent
    this.setMarkerOpacity(this.previewMarker, 0.5);

    // Add to overlay group
    if (this.engine) {
      this.engine.getOverlayGroup().add(this.previewMarker);
    }

    // Show distance rings for spawn mode
    if (mode === 'spawn') {
      this.createDistanceRings();
    }
  }

  /**
   * Update preview marker position (called on mouse move).
   * Validates position and colorizes green/red.
   */
  updatePreviewPosition(lat: number, lon: number, height: number): void {
    if (!this.previewMarker || !this.engine) return;

    const mode = this.uiStore.mapPlacementMode();
    if (!mode) return;

    // Store current position
    this.currentPosition = { lat, lon, height };

    // Position the marker
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);
    const originTerrainY = this.baseCoords
      ? this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon)
      : 0;
    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon);

    let markerY = HEIGHT_ABOVE_GROUND;
    if (originTerrainY !== null && terrainY !== null) {
      markerY = terrainY - originTerrainY + HEIGHT_ABOVE_GROUND;
    }

    this.previewMarker.position.set(local.x, markerY, local.z);
    this.previewMarker.visible = true;

    // Validate and colorize
    const validation = this.validatePosition(mode, lat, lon);
    this.currentValid = validation.valid;
    this.validationReason.set(validation.valid ? null : (validation.reason ?? 'Invalid position'));
    this.colorizePreviewMarker(validation.valid);
  }

  /**
   * Handle placement click. Returns result if valid, null if invalid.
   * Automatically exits placement mode on success.
   */
  handlePlacementClick(): PlacementResult | null {
    const mode = this.uiStore.mapPlacementMode();
    if (!mode || !this.currentPosition || !this.currentValid) return null;

    const result: PlacementResult = {
      mode,
      lat: this.currentPosition.lat,
      lon: this.currentPosition.lon,
      height: this.currentPosition.height,
    };

    this.exitPlacementMode();
    return result;
  }

  /**
   * Exit placement mode, clean up preview marker.
   */
  exitPlacementMode(): void {
    if (this.previewMarker && this.engine) {
      this.engine.getOverlayGroup().remove(this.previewMarker);
      this.markerViz.disposeDiamondMarker(this.previewMarker);
      this.previewMarker = null;
    }

    this.removeDistanceRings();
    this.currentPosition = null;
    this.currentValid = false;
    this.validationReason.set(null);
    this.uiStore.mapPlacementMode.set(null);
  }

  /**
   * Validate a position for the given placement mode.
   */
  validatePosition(mode: 'hq' | 'spawn', lat: number, lon: number): { valid: boolean; reason?: string } {
    // HQ can be placed anywhere — streets will be loaded afterwards via the slow path
    // in LocationFacadeService.applyNewHqPosition()
    if (mode === 'hq') {
      if (this.streetNetwork) {
        // If we have a street network, validate proximity only within loaded bounds
        const b = this.streetNetwork.bounds;
        const inBounds = lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
        if (inBounds) {
          const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
          if (!nearest || nearest.distance > MAX_PLACEMENT_STREET_DISTANCE) {
            return { valid: false, reason: 'Too far from streets' };
          }
        }
        // Outside bounds → allow (streets will be loaded for new area)
      }
      // No street network at all → allow
      return { valid: true };
    }

    // Spawn mode: requires loaded street network
    if (!this.streetNetwork) {
      return { valid: false, reason: 'No street network loaded' };
    }

    // Check proximity to a street
    const nearest = this.osmService.findNearestStreetPoint(this.streetNetwork, lat, lon);
    if (!nearest || nearest.distance > MAX_PLACEMENT_STREET_DISTANCE) {
      return { valid: false, reason: 'Too far from streets' };
    }

    if (mode === 'spawn') {
      // Spawn-specific validation
      if (!this.baseCoords) {
        return { valid: false, reason: 'No HQ placed' };
      }

      const distToHq = this.osmService.haversineDistance(
        lat, lon,
        this.baseCoords.lat, this.baseCoords.lon,
      );

      if (distToHq < MIN_MANUAL_SPAWN_DISTANCE) {
        return { valid: false, reason: 'Too close to HQ' };
      }

      if (distToHq > MAX_MANUAL_SPAWN_DISTANCE) {
        return { valid: false, reason: 'Too far from HQ' };
      }
    }

    return { valid: true };
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.exitPlacementMode();
    this.engine = null;
    this.streetNetwork = null;
    this.baseCoords = null;
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Colorize preview marker: valid color or red for invalid.
   */
  private colorizePreviewMarker(valid: boolean): void {
    if (!this.previewMarker) return;

    const targetColor = valid ? this.validColor : INVALID_COLOR;
    const color = new Color(targetColor);

    this.previewMarker.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mat = (obj as Mesh).material;
      if (mat instanceof MeshPhongMaterial) {
        mat.color.copy(color);
        mat.emissive.copy(color.clone().multiplyScalar(0.3));
      } else if (mat instanceof MeshBasicMaterial) {
        mat.color.copy(color.clone().lerp(new Color(0xffffff), 0.4));
      }
    });
  }

  /**
   * Set opacity on all materials in a marker group.
   */
  private setMarkerOpacity(marker: Group, opacity: number): void {
    marker.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mat = (obj as Mesh).material;
      if (mat instanceof MeshPhongMaterial || mat instanceof MeshBasicMaterial) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity, opacity);
      }
    });
  }

  // ========================================
  // DISTANCE RINGS (spawn placement)
  // ========================================

  /**
   * Create min/max distance rings around HQ for spawn placement feedback.
   */
  private createDistanceRings(): void {
    if (!this.engine || !this.baseCoords) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // HQ position in local coordinates
    const hqLocal = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    const ringY = HEIGHT_ABOVE_GROUND + (originTerrainY ? 0 : 0); // Relative to overlay origin

    // Inner ring (min distance) — red/orange, shows "too close" boundary
    const minRadius = this.metersToLocalRadius(MIN_MANUAL_SPAWN_DISTANCE);
    const innerRing = this.createRingLine(minRadius, 0xff6633, 8, 6);
    innerRing.position.set(hqLocal.x, ringY, hqLocal.z);
    overlayGroup.add(innerRing);
    this.distanceRings.push(innerRing);

    // Outer ring (max distance) — green, shows "too far" boundary
    const maxRadius = this.metersToLocalRadius(MAX_MANUAL_SPAWN_DISTANCE);
    const outerRing = this.createRingLine(maxRadius, 0x22c55e, 20, 15);
    outerRing.position.set(hqLocal.x, ringY, hqLocal.z);
    overlayGroup.add(outerRing);
    this.distanceRings.push(outerRing);
  }

  /**
   * Remove distance rings from the scene and dispose resources.
   */
  private removeDistanceRings(): void {
    if (!this.engine) return;
    const overlayGroup = this.engine.getOverlayGroup();

    for (const ring of this.distanceRings) {
      overlayGroup.remove(ring);
      ring.geometry.dispose();
      (ring.material as LineDashedMaterial).dispose();
    }
    this.distanceRings = [];
  }

  /**
   * Create a single dashed circle line at a given radius.
   */
  private createRingLine(radius: number, color: number, dashSize: number, gapSize: number): Line {
    const segments = 128;
    const points: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      ));
    }

    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineDashedMaterial({
      color,
      dashSize,
      gapSize,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    const line = new LineLoop(geometry, material);
    line.computeLineDistances(); // Required for dashed lines
    line.renderOrder = 998;
    return line;
  }

  /**
   * Convert a distance in meters to local 3D coordinate radius.
   */
  private metersToLocalRadius(meters: number): number {
    if (!this.engine || !this.baseCoords) return 0;

    const deltaLat = meters / METERS_PER_DEGREE_LAT;
    const hqLocal = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
    const offsetLocal = this.engine.sync.geoToLocalSimple(
      this.baseCoords.lat + deltaLat, this.baseCoords.lon, 0,
    );
    return Math.sqrt(
      (offsetLocal.x - hqLocal.x) ** 2 + (offsetLocal.z - hqLocal.z) ** 2,
    );
  }
}
