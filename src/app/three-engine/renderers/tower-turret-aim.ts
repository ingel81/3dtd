import { Object3D, Vector3 } from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import { headingToLocalRotation, type TowerAim } from '../../entities/tower-aim';

/**
 * Draws a tower's aim (Tower.aim, entities/tower-aim.ts) on its model: the
 * turret part turned to the aim heading, the guns tilted to the aim pitch.
 * The simulation turns the aim per sub-step; this only reads it, once per
 * render frame (ThreeTowerRenderer.updateAnimations).
 */

/**
 * The guns of a turret that tilt towards the target's height
 * (TowerTypeConfig.pitchNodes). Purely visual: firing never waits for it.
 */
export interface TurretPitch {
  nodes: Object3D[];
  /** Axis across the barrels in turret space: turning about it by +angle raises the muzzle */
  axis: Vector3;
  /** Tilt the nodes show, rad; NaN before the first draw */
  drawn: number;
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
  return { nodes, axis: new Vector3(-Math.cos(o), 0, Math.sin(o)), drawn: NaN };
}

/**
 * Turn `turretPart` (a node under the mesh, the mesh turned by
 * `meshRotation`) to the aim heading and tilt the guns to the aim pitch.
 * Nothing for a tower without a turret part.
 */
export function drawTurretAim(
  typeConfig: TowerTypeConfig,
  meshRotation: number,
  turretPart: Object3D | null,
  pitch: TurretPitch | undefined,
  aim: TowerAim,
): void {
  if (!turretPart) return;
  turretPart.rotation.y = headingToLocalRotation(typeConfig, meshRotation, aim.current);
  if (pitch && pitch.drawn !== aim.pitch) {
    pitch.drawn = aim.pitch;
    for (const node of pitch.nodes) node.quaternion.setFromAxisAngle(pitch.axis, aim.pitch);
  }
}
