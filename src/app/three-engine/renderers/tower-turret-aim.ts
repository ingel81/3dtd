import type { TowerTypeConfig } from '../../configs/tower-types.config';
import type { TowerRenderData } from './three-tower.renderer';

/**
 * How a tower's turret turns: towards a target, to its guard heading, and
 * through the reference sweep after placement. Gameplay-affecting, so it
 * runs per sub-step in game-time (ThreeTowerRenderer.advanceTurretAim);
 * the purely visual extras (magic hover, debug arrow) stay in the renderer.
 */

/** Turret turn rate, rad/s game-time. */
const TURRET_TURN_SPEED = Math.PI;

/** How far the reference sweep after placement turns either side: 75° in radians. */
const SCAN_ANGLE = 1.309;

/** Wrap an angle difference into [-π, π]. */
function wrapAngle(diff: number): number {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * Geo heading to the turret's rotation relative to the tower mesh.
 *
 * Coordinate system mapping:
 * - Geo: North (+lat), East (+lon)
 * - Three.js local: North → -Z, East → +X
 * - geoHeading = atan2(dLon·cos(lat), dLat): 0=North, π/2=East
 * - Three.js rotation.y: 0 faces -Z (North), -π/2 faces +X (East)
 * - Conversion: threeJsRotation = -geoHeading
 */
export function headingToLocalRotation(
  typeConfig: TowerTypeConfig,
  parentRotation: number,
  heading: number,
): number {
  // Turret barrel offset: compensates for models where barrels don't point -Z
  // For dual-gatling: barrels point +X in model space, so turretBarrelOffset = -π/2
  // Most towers have barrels pointing -Z, so turretBarrelOffset = 0 (default)
  const turretBarrelOffset = typeConfig.turretBarrelOffset ?? 0;
  const turretModelOffset = -turretBarrelOffset;

  // Convert geo heading to Three.js target rotation for the turret
  // geoHeading 0 = North = -Z = Three.js rotation 0
  // But if model barrels are offset, add that offset
  const threeJsTargetRotation = -heading + turretModelOffset;

  // Convert to local space: subtract the parent's rotation
  // (config.rotationY + customRotation)
  return threeJsTargetRotation - parentRotation;
}

/**
 * Turn one tower's turret for `gameTimeStepMs` of game-time. Rotation speed
 * is a constant ~PI rad/s game-time, so combat alignment advances at the
 * same rate at every training timescale (sub-stepping provides the "more
 * ticks per real-frame" at high speeds). Towers without a turret part are
 * left alone.
 */
export function stepTurretAim(data: TowerRenderData, gameTimeStepMs: number): void {
  if (!data.turretPart) return;
  const maxRotationThisStep = TURRET_TURN_SPEED * (gameTimeStepMs / 1000);

  // Cancel scan if tower acquires a target
  if (data.scanPhase > 0 && data.hasTarget) {
    data.scanPhase = 0;
    data.scanDelayRemaining = 0;
  }

  // Tick scan delay in game-time
  if (data.scanDelayRemaining > 0) {
    data.scanDelayRemaining -= gameTimeStepMs;
  }

  if (data.scanPhase > 0 && !data.hasTarget && data.scanDelayRemaining <= 0) {
    let scanTarget: number;
    if (data.scanPhase === 1) {
      scanTarget = data.scanStartRotation - SCAN_ANGLE;
    } else if (data.scanPhase === 2) {
      scanTarget = data.scanStartRotation + SCAN_ANGLE;
    } else {
      scanTarget = data.scanStartRotation;
    }
    const diff = wrapAngle(scanTarget - data.currentLocalRotation);
    if (Math.abs(diff) < 0.02) {
      data.currentLocalRotation = scanTarget;
      data.scanPhase++;
      if (data.scanPhase > 3) data.scanPhase = 0;
    } else {
      const scanSpeed = maxRotationThisStep * 0.7;
      const rotation = Math.sign(diff) * Math.min(Math.abs(diff), scanSpeed);
      data.currentLocalRotation += rotation;
    }
    data.turretPart.rotation.y = data.currentLocalRotation;
  } else if (data.scanPhase === 0) {
    const current = data.currentLocalRotation;
    const target = data.targetLocalRotation;
    const diff = wrapAngle(target - current);
    if (Math.abs(diff) < 0.01) {
      data.currentLocalRotation = target;
    } else {
      const rotation = Math.sign(diff) * Math.min(Math.abs(diff), maxRotationThisStep);
      data.currentLocalRotation += rotation;
    }
    data.turretPart.rotation.y = data.currentLocalRotation;
  }
}

/** How far the turret still is from its target rotation, radians in [0, π]. */
export function turretAimError(data: TowerRenderData): number {
  return Math.abs(wrapAngle(data.targetLocalRotation - data.currentLocalRotation));
}
