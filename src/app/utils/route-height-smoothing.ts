import { Vector3 } from 'three';

// ========================================
// HEIGHT SMOOTHING - CONSTANTS
// ========================================

/**
 * Max slope (rise/run) by OSM highway type.
 * Based on AASHTO road design standards with margin for photogrammetric noise.
 * Values represent the steepest realistic grade for each road category.
 */
const SLOPE_LIMITS: Record<string, number> = {
  'motorway': 0.08,
  'motorway_link': 0.10,
  'trunk': 0.10,
  'trunk_link': 0.12,
  'primary': 0.12,
  'primary_link': 0.12,
  'secondary': 0.12,
  'secondary_link': 0.15,
  'tertiary': 0.15,
  'tertiary_link': 0.15,
  'residential': 0.15,
  'living_street': 0.15,
  'unclassified': 0.15,
  'service': 0.20,
  'pedestrian': 0.20,
  'footway': 0.35,
  'path': 0.35,
  'cycleway': 0.15,
  'track': 0.25,
  'steps': 0.80,
};
const DEFAULT_SLOPE_LIMIT = 0.20;

/**
 * Sliding window size (meters) by road type.
 * Larger windows catch wider tree clusters but risk affecting bridges.
 * Smaller windows are more precise but miss wide anomalies.
 */
const WINDOW_SIZES: Record<string, number> = {
  'motorway': 50,
  'motorway_link': 40,
  'trunk': 40,
  'trunk_link': 35,
  'primary': 35,
  'primary_link': 30,
  'secondary': 30,
  'secondary_link': 25,
  'tertiary': 25,
  'residential': 20,
  'living_street': 20,
  'service': 15,
  'footway': 12,
  'path': 12,
  'cycleway': 20,
  'track': 15,
};
const DEFAULT_WINDOW_SIZE = 20;

/**
 * Threshold (meters) above sliding window minimum to flag as obstacle.
 * Must be high enough to preserve bridges (typically 2-4m above nearest ramp within window)
 * but low enough to catch trees (typically 5-15m above ground).
 */
const OBSTACLE_THRESHOLD = 5;

// ========================================
// HEIGHT SMOOTHING - ALGORITHM
// ========================================

/**
 * Smooth path heights using a multi-pass algorithm to remove terrain sampling anomalies
 * (trees, buildings, vehicles hitting raycast instead of ground).
 *
 * Pipeline:
 * 1. Compute cumulative distances (meters) for distance-based operations
 * 2. Distance-based sliding window minimum to detect obstacles
 * 3. Forward-backward slope enforcement to remove remaining spikes
 * 4. Light distance-weighted smoothing for visual quality
 *
 * Preserves bridges: bridge ramps have realistic slopes (within limits) and
 * the sliding window minimum threshold is set above typical bridge elevation differences.
 *
 * Only the rendered street overlay (StreetRenderingService) uses this; route
 * and cell heights come from the route grid.
 *
 * @param points Path points with potentially noisy heights
 * @param streetType OSM highway type (e.g., 'residential', 'primary') for slope/window tuning
 * @returns Smoothed path points
 */
export function smoothPathHeights(points: Vector3[], streetType?: string): Vector3[] {
  if (points.length < 3) return points.map(p => p.clone());

  // === Step 1: Compute cumulative distances in meters ===
  const cumDist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dz * dz));
  }

  // Clone points for modification
  const result = points.map(p => p.clone());

  // === Step 2: Distance-based sliding window minimum ===
  // Compute window minimums from ORIGINAL heights (no cascading)
  const windowSize = (streetType && WINDOW_SIZES[streetType]) || DEFAULT_WINDOW_SIZE;
  const halfWindow = windowSize / 2;
  const windowMins: number[] = [];

  for (let i = 0; i < result.length; i++) {
    let minY = result[i].y;

    // Look backward within window distance
    for (let j = i - 1; j >= 0 && (cumDist[i] - cumDist[j]) <= halfWindow; j--) {
      minY = Math.min(minY, result[j].y);
    }

    // Look forward within window distance
    for (let j = i + 1; j < result.length && (cumDist[j] - cumDist[i]) <= halfWindow; j++) {
      minY = Math.min(minY, result[j].y);
    }

    windowMins.push(minY);
  }

  // Correct points significantly above their window minimum (skip endpoints)
  for (let i = 1; i < result.length - 1; i++) {
    if (result[i].y - windowMins[i] > OBSTACLE_THRESHOLD) {
      result[i].y = windowMins[i];
    }
  }

  // === Step 3: Forward-backward slope enforcement ===
  // Multiple iterations for convergence on consecutive anomalies
  const maxSlope = (streetType && SLOPE_LIMITS[streetType]) || DEFAULT_SLOPE_LIMIT;

  for (let iteration = 0; iteration < 3; iteration++) {
    // Forward pass: cap how high each point can be relative to its predecessor
    for (let i = 1; i < result.length; i++) {
      const dist = cumDist[i] - cumDist[i - 1];
      if (dist < 0.001) continue;
      const maxRise = dist * maxSlope;
      result[i].y = Math.min(result[i].y, result[i - 1].y + maxRise);
    }

    // Backward pass: cap how high each point can be relative to its successor
    for (let i = result.length - 2; i >= 0; i--) {
      const dist = cumDist[i + 1] - cumDist[i];
      if (dist < 0.001) continue;
      const maxRise = dist * maxSlope;
      result[i].y = Math.min(result[i].y, result[i + 1].y + maxRise);
    }
  }

  // === Step 4: Light distance-weighted smoothing ===
  // Gaussian-like smooth to remove jaggedness after correction passes.
  // Uses real distance (sigma in meters) so effect is consistent regardless of point density.
  const SIGMA = 3; // meters - smoothing radius
  const SIGMA_SQ_2 = 2 * SIGMA * SIGMA;
  const MAX_SMOOTH_DIST = SIGMA * 3; // beyond 3*sigma, weight is negligible
  const smoothed = result.map(p => p.clone());

  for (let i = 1; i < result.length - 1; i++) {
    let weightedSum = 0;
    let weightTotal = 0;

    // Only scan nearby points within the smoothing radius
    for (let j = i; j >= 0 && (cumDist[i] - cumDist[j]) <= MAX_SMOOTH_DIST; j--) {
      const dist = cumDist[i] - cumDist[j];
      const weight = Math.exp(-(dist * dist) / SIGMA_SQ_2);
      weightedSum += result[j].y * weight;
      weightTotal += weight;
    }
    for (let j = i + 1; j < result.length && (cumDist[j] - cumDist[i]) <= MAX_SMOOTH_DIST; j++) {
      const dist = cumDist[j] - cumDist[i];
      const weight = Math.exp(-(dist * dist) / SIGMA_SQ_2);
      weightedSum += result[j].y * weight;
      weightTotal += weight;
    }

    if (weightTotal > 0) {
      smoothed[i].y = weightedSum / weightTotal;
    }
  }

  return smoothed;
}
