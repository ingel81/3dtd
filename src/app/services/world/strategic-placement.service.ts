/**
 * Strategic Placement Service
 *
 * Calculates optimal tower placement positions along enemy paths.
 * Avoids trial & error by using geometric calculations and placement constraints.
 */

import { Injectable, inject } from '@angular/core';
import { OsmStreetService, StreetNetwork } from '../location/osm-street.service';
import { TowerPlacementService } from '../tower-placement.service';
import { GeoPosition } from '../../models/game.types';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { SpawnPoint } from '../../managers/wave.manager';
import { Tower } from '../../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';

/**
 * Weight of the HQ end of the path relative to the spawn end, in the U-shaped
 * placement score.
 *
 * Below 1.0 on purpose: the spawn end keeps the edge, so a two-tower opening
 * places exactly where it did before and the early waves are unaffected. From
 * roughly the fourth tower on, the HQ end outscores the middle and a second
 * killzone forms — which is the whole point, since the last stretch of path had
 * no defenses at all and enemies reaching it arrived at the base 95% of the time.
 */
const END_ZONE_HQ_WEIGHT = 0.8;

/** Radius (m) the path coverage of a candidate is scored in for a tower without range (Research Center). */
const DEFAULT_SEARCH_RANGE_M = 60;

/**
 * U-shaped weight over the normalised path position (0 = spawn, 1 = HQ).
 *
 * Exported so the shape can be asserted directly: both ends must beat the
 * middle, and the spawn end must keep the edge. The previous linear
 * spawn-proximity weight is what produced a defense with one killzone and an
 * undefended corridor behind it.
 */
export function endZoneProximity(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.max(1 - clamped, END_ZONE_HQ_WEIGHT * clamped);
}

export interface PlacementCandidate {
  position: GeoPosition;
  score: number;              // 0-1: How good is this position?
  distanceFromSpawn: number;  // Meters along path
  pathCoverage: number;       // How much % of path is covered?
  reason: string;             // "Near spawn A (75m along path)"
}

@Injectable({ providedIn: 'root' })
export class StrategicPlacementService {
  private osmService = inject(OsmStreetService);
  /** Source of the placement rules, the same the player's clicks go through. */
  private towerPlacement = inject(TowerPlacementService);

  private streetNetwork: StreetNetwork | null = null;

  /**
   * Initialize with street network
   */
  initialize(streetNetwork: StreetNetwork): void {
    this.streetNetwork = streetNetwork;
  }

  /**
   * Finds optimal positions for a tower of `typeId` based on spawn points
   * and paths, best first. Every candidate passes the placement rules,
   * checked against the current towers; the first also stands on its
   * footprint (standingFirst).
   */
  findStrategicPositions(
    spawnPoints: SpawnPoint[],
    paths: Map<string, GeoPosition[]>,
    typeId: TowerTypeId,
  ): PlacementCandidate[] {
    const candidates: PlacementCandidate[] = [];
    const isPlaceable = this.towerPlacement.placementChecker();
    const towerRange = TOWER_TYPES[typeId].range || DEFAULT_SEARCH_RANGE_M;

    for (const [spawnId, path] of paths.entries()) {
      const spawnPoint = spawnPoints.find(s => s.id === spawnId);
      if (!spawnPoint) continue;

      // Calculate total path length to generate distances covering the full route
      const pathLength = this.getPathLength(path);

      // Generate distances every 15m along the entire path (dense placement allowed)
      const distances: number[] = [];
      for (let d = 35; d < pathLength; d += 15) {
        distances.push(d);
      }

      for (const distance of distances) {
        // 1. Find position along path
        const pathPos = this.getPositionAlongPath(path, distance);
        if (!pathPos) continue;

        // 2. Find nearest street segment
        if (!this.streetNetwork) continue;
        const streetInfo = this.osmService.findNearestStreetPoint(this.streetNetwork, pathPos.lat, pathPos.lon);
        if (!streetInfo || !streetInfo.street) continue;

        // Get segment start and end positions
        const segmentStart = streetInfo.street.nodes[streetInfo.nodeIndex];
        const segmentEnd = streetInfo.street.nodes[streetInfo.nodeIndex + 1] || segmentStart;

        // 3. Calculate perpendicular offsets (15m, 20m, 25m from street)
        const offsets = [15, 20, 25];

        for (const offset of offsets) {
          // Test both sides of the street
          for (const side of [-1, 1]) {
            const position = this.getPerpendicularPosition(
              segmentStart,
              segmentEnd,
              pathPos,
              offset * side
            );

            // 4. Placement rules, the same the player's clicks go through
            if (!isPlaceable(position.lat, position.lon).valid) {
              continue;
            }

            // 5. Calculate score
            const score = this.calculatePlacementScore(
              position,
              spawnPoint,
              path,
              towerRange,
            );

            candidates.push({
              position,
              score,
              distanceFromSpawn: distance,
              pathCoverage: this.estimatePathCoverage(position, path, towerRange),
              reason: `Near ${spawnPoint.name} (${distance}m along path, ${Math.abs(offset)}m offset)`
            });
          }
        }
      }
    }

    // Sort by score (highest first)
    return this.standingFirst(candidates.sort((a, b) => b.score - a.score), typeId);
  }

  /**
   * Finds positions for a tower of `typeId` distributed evenly across zones
   * along the path, best first. Instead of clustering near spawn, prioritizes
   * under-defended zones. `existingTowers` only weighs the zones; every
   * candidate passes the placement rules, checked against the current
   * towers, and the first also stands on its footprint (standingFirst).
   */
  findDistributedPositions(
    spawnPoints: SpawnPoint[],
    paths: Map<string, GeoPosition[]>,
    typeId: TowerTypeId,
    existingTowers: Tower[] = [],
    numZones = 5
  ): PlacementCandidate[] {
    const candidates: PlacementCandidate[] = [];
    const isPlaceable = this.towerPlacement.placementChecker();
    const towerRange = TOWER_TYPES[typeId].range || DEFAULT_SEARCH_RANGE_M;

    for (const [spawnId, path] of paths.entries()) {
      const spawnPoint = spawnPoints.find(s => s.id === spawnId);
      if (!spawnPoint) continue;

      const pathLength = this.getPathLength(path);
      if (pathLength < 50) continue;

      // Count existing towers per zone
      const towersPerZone = new Array(numZones).fill(0);
      for (const tower of existingTowers) {
        const towerPos = tower.transform.position;
        if (!towerPos) continue;
        const zone = this.getZoneForPosition(towerPos, path, pathLength, numZones);
        if (zone >= 0) towersPerZone[zone]++;
      }

      const maxTowersPerZone = Math.ceil(existingTowers.length / numZones) + 1;

      // Generate candidates every 15m along path (skip first 35m near spawn)
      for (let d = 35; d < pathLength - 30; d += 15) {
        const pathPos = this.getPositionAlongPath(path, d);
        if (!pathPos) continue;

        if (!this.streetNetwork) continue;
        const streetInfo = this.osmService.findNearestStreetPoint(this.streetNetwork, pathPos.lat, pathPos.lon);
        if (!streetInfo || !streetInfo.street) continue;

        const segmentStart = streetInfo.street.nodes[streetInfo.nodeIndex];
        const segmentEnd = streetInfo.street.nodes[streetInfo.nodeIndex + 1] || segmentStart;

        const offsets = [15, 20, 25];
        for (const offset of offsets) {
          for (const side of [-1, 1]) {
            const position = this.getPerpendicularPosition(segmentStart, segmentEnd, pathPos, offset * side);

            if (!isPlaceable(position.lat, position.lon).valid) continue;

            // Zone-based scoring
            const zone = Math.min(numZones - 1, Math.floor((d / pathLength) * numZones));
            const zoneNeed = 1.0 - (towersPerZone[zone] / Math.max(1, maxTowersPerZone));
            const coverage = this.estimatePathCoverage(position, path, towerRange);

            let streetScore = 0;
            if (this.streetNetwork) {
              const si = this.osmService.findNearestStreetPoint(this.streetNetwork, position.lat, position.lon);
              if (si) {
                const distDeviation = Math.abs(si.distance - 20) / 10;
                streetScore = 1 - Math.min(distDeviation, 1);
              }
            }

            const score = 0.5 * Math.max(0, zoneNeed) + 0.3 * coverage + 0.2 * streetScore;

            candidates.push({
              position,
              score: Math.max(0, Math.min(1, score)),
              distanceFromSpawn: d,
              pathCoverage: coverage,
              reason: `Zone ${zone + 1}/${numZones} (${d}m along path, need=${zoneNeed.toFixed(2)})`
            });
          }
        }
      }
    }

    return this.standingFirst(candidates.sort((a, b) => b.score - a.score), typeId);
  }

  /**
   * `candidates` from the first one a tower of `typeId` can stand on
   * (TowerPlacementService.placementAt): those ahead of it would stand in a
   * wall or over a drop and are left out. The ones behind it are not probed,
   * the footprint costs raycasts and the strategies build on the first.
   */
  private standingFirst(candidates: PlacementCandidate[], typeId: TowerTypeId): PlacementCandidate[] {
    const first = candidates.findIndex(
      ({ position }) => this.towerPlacement.placementAt(position.lat, position.lon, typeId)?.result.valid,
    );
    return first < 0 ? [] : candidates.slice(first);
  }

  /**
   * Determines which zone a position belongs to based on nearest path point.
   */
  private getZoneForPosition(pos: GeoPosition, path: GeoPosition[], pathLength: number, numZones: number): number {
    let minDist = Infinity;
    let closestIdx = 0;

    for (let i = 0; i < path.length; i++) {
      const d = this.osmService.haversineDistance(pos.lat, pos.lon, path[i].lat, path[i].lon);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }

    // Only count towers within 80m of path
    if (minDist > 80) return -1;

    // Estimate distance along path for this index
    let distAlongPath = 0;
    for (let i = 0; i < closestIdx && i < path.length - 1; i++) {
      distAlongPath += this.osmService.haversineDistance(
        path[i].lat, path[i].lon, path[i + 1].lat, path[i + 1].lon
      );
    }

    return Math.min(numZones - 1, Math.floor((distAlongPath / pathLength) * numZones));
  }

  /**
   * Calculates total path length in meters
   */
  private getPathLength(path: GeoPosition[]): number {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      total += this.osmService.haversineDistance(
        path[i].lat, path[i].lon,
        path[i+1].lat, path[i+1].lon
      );
    }
    return total;
  }

  /**
   * Finds position X meters along a path
   */
  getPositionAlongPath(path: GeoPosition[], distanceMeters: number): GeoPosition | null {
    let accumulated = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const segmentDistance = this.osmService.haversineDistance(
        path[i].lat, path[i].lon,
        path[i+1].lat, path[i+1].lon
      );

      if (accumulated + segmentDistance >= distanceMeters) {
        // Interpolate within segment
        const remaining = distanceMeters - accumulated;
        const ratio = remaining / segmentDistance;

        return {
          lat: path[i].lat + (path[i+1].lat - path[i].lat) * ratio,
          lon: path[i].lon + (path[i+1].lon - path[i].lon) * ratio,
          height: (path[i].height || 0) + ((path[i+1].height || 0) - (path[i].height || 0)) * ratio
        };
      }

      accumulated += segmentDistance;
    }

    return null; // Distance too far
  }

  /**
   * Calculates perpendicular offset from street segment
   */
  getPerpendicularPosition(
    segmentStart: GeoPosition,
    segmentEnd: GeoPosition,
    sourcePoint: GeoPosition,
    offsetMeters: number
  ): GeoPosition {
    // 1. Calculate segment vector
    const dx = segmentEnd.lon - segmentStart.lon;
    const dy = segmentEnd.lat - segmentStart.lat;
    const length = Math.sqrt(dx*dx + dy*dy);

    // Guard against degenerate segment (start === end)
    if (length === 0) {
      console.warn('[StrategicPlacement] Degenerate street segment, using source position');
      return sourcePoint;
    }

    // 2. Normalize
    const nx = dx / length;
    const ny = dy / length;

    // 3. Perpendicular vector (90° rotated)
    const px = -ny;  // Perpendicular
    const py = nx;

    // 4. Offset in meters → degrees
    const offsetDegrees = offsetMeters / METERS_PER_DEGREE_LAT;

    // 5. Calculate new position
    return {
      lat: sourcePoint.lat + py * offsetDegrees,
      lon: sourcePoint.lon + px * offsetDegrees,
      height: sourcePoint.height || 0
    };
  }

  /**
   * Calculates placement score (0-1)
   *
   * Strategy: build killzones at BOTH ends of the path — near spawn and near
   * HQ — and treat the middle as the last thing to fill.
   *
   * This used to be "build from spawn outward towards HQ", weighting spawn
   * proximity at 0.6. Combined with an upgrade strategy that also only funded
   * the spawn-nearest towers, the defense came out as a single wall at the
   * spawn with an undefended corridor behind it. Measured over 1834 waves: in
   * waves that leaked nothing, the furthest enemy died at a median of 12% along
   * the path; once any enemy passed 80%, one reached the base in 95% of cases.
   * The defense killed everything (70% of waves) or let a lot through (28%),
   * with 2% in between.
   *
   * A U-shaped weight keeps the early game intact — the spawn end still scores
   * highest, which is what a two-tower opening needs — while making the HQ end
   * the next-best choice rather than the last one. The far end is also the one
   * that matters most when it is reached at all: an enemy stopped there was
   * genuinely nearly through.
   */
  private calculatePlacementScore(
    position: GeoPosition,
    spawnPoint: SpawnPoint,
    path: GeoPosition[],
    towerRange: number,
  ): number {
    let score = 0;

    // 1. Proximity to EITHER end of the path - 0.6 weight
    //    U-shaped in the normalised distance from spawn: 1.0 at the spawn,
    //    dipping to SPAWN_END_BIAS at the middle, rising again towards the HQ.
    //    The spawn end keeps a slight edge (the asymmetry below) so opening
    //    placements are unchanged, while the far end stops being the position
    //    of last resort.
    const pathLength = this.getPathLength(path);
    const distToSpawn = this.osmService.haversineDistance(
      position.lat, position.lon, spawnPoint.lat, spawnPoint.lon
    );
    const t = Math.min(distToSpawn / Math.max(pathLength, 200), 1);   // 0 spawn, 1 HQ
    const endProximity = endZoneProximity(t);
    score += 0.6 * endProximity;

    // 2. Path coverage from this position - 0.2 weight
    const coverage = this.estimatePathCoverage(position, path, towerRange);
    score += 0.2 * coverage;

    // 3. Distance to street (15-25m is optimal) - 0.2 weight
    if (this.streetNetwork) {
      const streetInfo = this.osmService.findNearestStreetPoint(this.streetNetwork, position.lat, position.lon);
      if (streetInfo) {
        const streetDist = streetInfo.distance;
        const optimalDist = 20;
        const distDeviation = Math.abs(streetDist - optimalDist) / 10;
        score += 0.2 * (1 - Math.min(distDeviation, 1));
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Estimates path coverage from a tower position
   */
  private estimatePathCoverage(position: GeoPosition, path: GeoPosition[], range: number): number {
    if (path.length === 0) return 0; // Guard against empty path

    let coveredWaypoints = 0;

    for (const waypoint of path) {
      const dist = this.osmService.haversineDistance(
        position.lat, position.lon,
        waypoint.lat, waypoint.lon
      );

      if (dist <= range) {
        coveredWaypoints++;
      }
    }

    return coveredWaypoints / path.length; // 0-1
  }
}
