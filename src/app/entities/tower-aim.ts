import type { TowerTypeConfig } from '../configs/tower-types.config';

/**
 * Where a tower's turret points and how it turns: towards a target, to its
 * guard heading, and through the reference sweep after placement. Simulation
 * state on the Tower (Tower.aim), stepped once per sub-step in game time for
 * every tower (GameStateManager.runSubStep), with or without a renderer and
 * whether its model has loaded or not. The renderer only reads it to draw the
 * turret part and the gun tilt (ThreeTowerRenderer.updateAnimations).
 *
 * Headings follow the geoHeading convention: 0 = North, π/2 = East.
 *
 * A tower without a turret part (TowerTypeConfig.turnsTurret false) turns its
 * aim all the same, only nothing in the model shows it: the blood moon
 * searchlight points along it. Firing never waits for that aim (isAimAligned).
 */

/** Turret turn rate, rad/s game-time. */
const TURRET_TURN_SPEED = Math.PI;

/** How far the reference sweep after placement turns either side: 75° in radians. */
const SCAN_ANGLE = 1.309;

/** Game time after placement before the reference sweep starts, ms. */
const SCAN_DELAY_MS = 800;

/** Gun tilt rate, rad/s game-time: as fast as the turn. */
const PITCH_SPEED = Math.PI;

/** Pitch range of guns without their own (TowerTypeConfig.pitchRange), rad. */
const DEFAULT_PITCH_RANGE = { min: -Math.PI / 4, max: Math.PI / 4 };

/** How far the turret may be off its target and still fire, rad (~15°). */
export const TURRET_ALIGN_TOLERANCE = Math.PI / 12;

export interface TowerAim {
  /** The model turns a turret part (TowerTypeConfig.turnsTurret): only then firing waits for the aim */
  readonly turret: boolean;
  /** Heading the turret points at now, rad */
  current: number;
  /** Heading it turns to, rad */
  target: number;
  /** It aims at an enemy (or the player's aim); breaks off the reference sweep */
  hasTarget: boolean;
  /** Reference sweep: 0 = none, 1 = going left, 2 = going right, 3 = back to the start */
  scanPhase: number;
  /** Heading the sweep turns around, rad */
  scanStart: number;
  /** Game time before the sweep starts, ms */
  scanDelayRemaining: number;
  /**
   * Gun tilt now and where it tilts to, rad, muzzle up positive. Only the
   * model shows it (TowerTypeConfig.pitchNodes): firing never waits for it.
   * Types without pitch nodes have a range of 0, so it stays 0.
   */
  pitch: number;
  pitchTarget: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
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
 *
 * `parentRotation` is the mesh's rotation.y: rotationY plus the placement's customRotation.
 */
export function headingToLocalRotation(
  typeConfig: TowerTypeConfig,
  parentRotation: number,
  heading: number,
): number {
  // Turret barrel offset: compensates for models where barrels don't point +Z
  // For dual-gatling: barrels point -X in model space, so turretBarrelOffset = -π/2
  // Most towers have barrels pointing +Z, so turretBarrelOffset = 0 (default)
  const turretModelOffset = -(typeConfig.turretBarrelOffset ?? 0);
  return -heading + turretModelOffset - parentRotation;
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
 * The aim of a tower just placed with `customRotation`: it points where the
 * placement preview showed the turret (the model's rest pose,
 * TowerTypeConfig.turretRestY) and, with a turret part, starts its reference
 * sweep around it after SCAN_DELAY_MS. The caller turns it to the guard
 * heading (aimIdle), which it faces after the sweep.
 */
export function createTowerAim(typeConfig: TowerTypeConfig, customRotation: number): TowerAim {
  const parentRotation = (typeConfig.rotationY ?? 0) + customRotation;
  const heading = localRotationToHeading(typeConfig, parentRotation, typeConfig.turretRestY ?? 0);
  const turret = typeConfig.turnsTurret;
  const range = typeConfig.pitchNodes ? typeConfig.pitchRange ?? DEFAULT_PITCH_RANGE : { min: 0, max: 0 };
  return {
    turret,
    current: heading,
    target: heading,
    hasTarget: false,
    scanPhase: turret ? 1 : 0,
    scanStart: heading,
    scanDelayRemaining: turret ? SCAN_DELAY_MS : 0,
    pitch: 0,
    pitchTarget: 0,
    pitchMin: range.min,
    pitchMax: range.max,
  };
}

/** Aim at a target at `heading`; the turn itself happens in stepTowerAim. */
export function aimAt(aim: TowerAim, heading: number): void {
  aim.target = heading;
  aim.hasTarget = true;
}

/**
 * Turn to a heading without a target (the guard heading between waves), at
 * the same speed as aiming. The guns level out.
 */
export function aimIdle(aim: TowerAim, heading: number): void {
  aim.target = heading;
  aim.hasTarget = false;
  aim.pitchTarget = 0;
}

/** The tower has no target any more: the turret finishes its current turn and holds that heading. */
export function releaseAim(aim: TowerAim): void {
  aim.hasTarget = false;
}

/** Tilt the guns to `angle` (rad, muzzle up positive), clamped to their range. */
export function aimPitch(aim: TowerAim, angle: number): void {
  aim.pitchTarget = Math.min(aim.pitchMax, Math.max(aim.pitchMin, angle));
}

/** Tilt the guns towards a point `dy` above the muzzle and `horizontal` away. */
export function aimPitchTowards(aim: TowerAim, dy: number, horizontal: number): void {
  aimPitch(aim, Math.atan2(dy, horizontal));
}

/** Wrap an angle difference into [-π, π]. */
function wrapAngle(diff: number): number {
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * Turn and tilt for `gameTimeStepMs` of game time. The turn rate is a
 * constant π rad/s game-time, so alignment advances at the same rate at
 * every timescale (sub-stepping provides the "more ticks per real frame" at
 * high speeds). Allocation-free.
 */
export function stepTowerAim(aim: TowerAim, gameTimeStepMs: number): void {
  const pitchDiff = aim.pitchTarget - aim.pitch;
  if (pitchDiff !== 0) {
    const maxTilt = PITCH_SPEED * (gameTimeStepMs / 1000);
    aim.pitch += Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), maxTilt);
  }
  const maxRotationThisStep = TURRET_TURN_SPEED * (gameTimeStepMs / 1000);

  // Cancel scan if tower acquires a target
  if (aim.scanPhase > 0 && aim.hasTarget) {
    aim.scanPhase = 0;
    aim.scanDelayRemaining = 0;
  }

  // Tick scan delay in game-time
  if (aim.scanDelayRemaining > 0) {
    aim.scanDelayRemaining -= gameTimeStepMs;
  }

  if (aim.scanPhase > 0 && !aim.hasTarget && aim.scanDelayRemaining <= 0) {
    // Left first, as seen from above: a larger heading
    let scanTarget: number;
    if (aim.scanPhase === 1) {
      scanTarget = aim.scanStart + SCAN_ANGLE;
    } else if (aim.scanPhase === 2) {
      scanTarget = aim.scanStart - SCAN_ANGLE;
    } else {
      scanTarget = aim.scanStart;
    }
    const diff = wrapAngle(scanTarget - aim.current);
    if (Math.abs(diff) < 0.02) {
      aim.current = scanTarget;
      aim.scanPhase++;
      if (aim.scanPhase > 3) aim.scanPhase = 0;
    } else {
      const scanSpeed = maxRotationThisStep * 0.7;
      aim.current += Math.sign(diff) * Math.min(Math.abs(diff), scanSpeed);
    }
  } else if (aim.scanPhase === 0) {
    const diff = wrapAngle(aim.target - aim.current);
    if (Math.abs(diff) < 0.01) {
      aim.current = aim.target;
    } else {
      aim.current += Math.sign(diff) * Math.min(Math.abs(diff), maxRotationThisStep);
    }
  }
}

/** How far the turret still is from its target heading, radians in [0, π]. */
export function towerAimError(aim: TowerAim): number {
  return Math.abs(wrapAngle(aim.target - aim.current));
}

/**
 * Whether the tower may fire: its turret within `toleranceRadians` of the
 * target heading. A tower without a turret part never waits.
 */
export function isAimAligned(aim: TowerAim, toleranceRadians = TURRET_ALIGN_TOLERANCE): boolean {
  return !aim.turret || towerAimError(aim) <= toleranceRadians;
}
