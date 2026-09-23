import { Object3D, Vector3 } from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import type { TowerRenderData } from './three-tower.renderer';

/**
 * How a tower's turret turns: towards a target, to its guard heading, and
 * through the reference sweep after placement. Gameplay-affecting, so it
 * runs per sub-step in game-time (ThreeTowerRenderer.advanceTurretAim);
 * the purely visual extras (magic hover, debug arrow) stay in the renderer.
 *
 * A tower without a turret part turns its aim all the same, only nothing in
 * the model shows it: the blood moon searchlight points along it. Firing
 * never waits for that aim (ThreeTowerRenderer.isTurretAligned).
 */

/** Turret turn rate, rad/s game-time. */
const TURRET_TURN_SPEED = Math.PI;

/** How far the reference sweep after placement turns either side: 75° in radians. */
const SCAN_ANGLE = 1.309;

/** Gun tilt rate, rad/s game-time: as fast as the turn. */
const PITCH_SPEED = Math.PI;

/**
 * The guns of a turret that tilt towards the target's height
 * (TowerTypeConfig.pitchNodes). Purely visual: firing never waits for it.
 */
export interface TurretPitch {
  nodes: Object3D[];
  /** Axis across the barrels in turret space: turning about it by +angle raises the muzzle */
  axis: Vector3;
  min: number;
  max: number;
  current: number;
  target: number;
}

/**
 * Find the pitch nodes under `turretPart`. The axis runs across the barrels:
 * barrels along d = (sin o, 0, cos o) for turretBarrelOffset o tilt up about
 * d × up = (-cos o, 0, sin o).
 */
export function createTurretPitch(typeConfig: TowerTypeConfig, turretPart: Object3D): TurretPitch | undefined {
  const names = typeConfig.pitchNodes ?? [];
  const nodes: Object3D[] = [];
  turretPart.traverse((node) => {
    if (names.includes(node.name)) nodes.push(node);
  });
  if (nodes.length === 0) return undefined;
  const o = typeConfig.turretBarrelOffset ?? 0;
  const range = typeConfig.pitchRange ?? { min: -Math.PI / 4, max: Math.PI / 4 };
  return {
    nodes,
    axis: new Vector3(-Math.cos(o), 0, Math.sin(o)),
    min: range.min,
    max: range.max,
    current: 0,
    target: 0,
  };
}

/** Pitch towards a point `dy` above the tower tip and `horizontal` away, clamped to the gun's range. */
export function pitchTowards(pitch: TurretPitch, dy: number, horizontal: number): number {
  const angle = Math.atan2(dy, horizontal);
  return Math.min(pitch.max, Math.max(pitch.min, angle));
}

/** Tilt the guns for `gameTimeStepMs` of game-time towards their target pitch. */
function stepTurretPitch(pitch: TurretPitch, gameTimeStepMs: number): void {
  const diff = pitch.target - pitch.current;
  if (diff === 0) return;
  const maxStep = PITCH_SPEED * (gameTimeStepMs / 1000);
  pitch.current += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
  for (const node of pitch.nodes) node.quaternion.setFromAxisAngle(pitch.axis, pitch.current);
}

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
 * - Scene (EllipsoidSync.geoToLocalSimple): North → +Z, East → -X
 * - geoHeading = atan2(dLon·cos(lat), dLat): 0=North, π/2=East
 * - Three.js rotation.y: 0 turns a model's +Z to North, -π/2 turns it to East (-X)
 * - Conversion: threeJsRotation = -geoHeading (the blood moon searchlight takes the same turn)
 */
export function headingToLocalRotation(
  typeConfig: TowerTypeConfig,
  parentRotation: number,
  heading: number,
): number {
  // Turret barrel offset: compensates for models where barrels don't point +Z
  // For dual-gatling: barrels point -X in model space, so turretBarrelOffset = -π/2
  // Most towers have barrels pointing +Z, so turretBarrelOffset = 0 (default)
  const turretBarrelOffset = typeConfig.turretBarrelOffset ?? 0;
  const turretModelOffset = -turretBarrelOffset;

  // Convert geo heading to Three.js target rotation for the turret
  // geoHeading 0 = North = +Z = Three.js rotation 0
  // But if model barrels are offset, add that offset
  const threeJsTargetRotation = -heading + turretModelOffset;

  // Convert to local space: subtract the parent's rotation
  // (config.rotationY + customRotation)
  return threeJsTargetRotation - parentRotation;
}

/** The geo heading a turret rotation relative to the tower mesh points at: headingToLocalRotation reversed. */
export function localRotationToHeading(
  typeConfig: TowerTypeConfig,
  parentRotation: number,
  localRotation: number,
): number {
  return -(localRotation + parentRotation + (typeConfig.turretBarrelOffset ?? 0));
}

/**
 * Turn one tower's turret for `gameTimeStepMs` of game-time. Rotation speed
 * is a constant ~PI rad/s game-time, so combat alignment advances at the
 * same rate at every training timescale (sub-stepping provides the "more
 * ticks per real-frame" at high speeds). A tower without a turret part turns
 * only its aim, no node.
 */
export function stepTurretAim(data: TowerRenderData, gameTimeStepMs: number): void {
  if (data.pitch) stepTurretPitch(data.pitch, gameTimeStepMs);
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
    if (data.turretPart) data.turretPart.rotation.y = data.currentLocalRotation;
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
    if (data.turretPart) data.turretPart.rotation.y = data.currentLocalRotation;
  }
}

/** How far the turret still is from its target rotation, radians in [0, π]. */
export function turretAimError(data: TowerRenderData): number {
  return Math.abs(wrapAngle(data.targetLocalRotation - data.currentLocalRotation));
}
