import { Box3, Quaternion, Vector3 } from 'three';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { MISSILE_LAUNCH_LOOK as LOOK } from '../../configs/visual-effects.config';
import type { TowerRenderData } from './three-tower.renderer';

/**
 * The missile at its silo: where the missile that lifts off starts, so it
 * takes the place of the one that stood there.
 */

const UP = new Vector3(0, 1, 0);
const bounds = new Box3();
const size = new Vector3();

/** Where a missile stands in its silo as it lifts off, local coordinates */
export interface MissileStart {
  /** The silo's base */
  readonly site: Vector3;
  /** The missile's nozzle: where the flight starts */
  readonly nozzle: Vector3;
  /** Its turn as it stands in the silo (the building's yaw) */
  readonly turn: Quaternion;
  /** Its size as it stands there, the scale of the model */
  scale: number;
  /** Top of the building over the site, m: the smoke wells out and the flash goes up there */
  shaftTop: number;
}

export function createMissileStart(): MissileStart {
  return { site: new Vector3(), nozzle: new Vector3(), turn: new Quaternion(), scale: 1, shaftTop: LOOK.shaftTop };
}

/**
 * The start of a missile from `tower`, the render object of a building of
 * `typeId` whose base is `site` (local), into `out`: the world pose of the
 * model's missile node (MISSILE_LAUNCH_LOOK.missile.node), its turn with the
 * building's yaw and its scale, and the top of the model. Without the
 * render object or without the node in its model the look values: the
 * nozzle `baseHeight` over the site, the type's scale and turn, `shaftTop`.
 */
export function missileStartAt(
  tower: TowerRenderData | undefined,
  typeId: TowerTypeId,
  site: Vector3,
  out: MissileStart,
): MissileStart {
  out.site.copy(site);
  const node = tower?.mesh.getObjectByName(LOOK.missile.node);
  if (tower && node) {
    tower.mesh.updateWorldMatrix(true, true);
    node.matrixWorld.decompose(out.nozzle, out.turn, size);
    out.scale = size.y;
    bounds.setFromObject(tower.mesh);
    out.shaftTop = bounds.isEmpty() ? LOOK.shaftTop : bounds.max.y - site.y;
    return out;
  }
  const config = TOWER_TYPES[typeId];
  out.nozzle.set(site.x, site.y + LOOK.missile.baseHeight, site.z);
  out.turn.setFromAxisAngle(UP, config.rotationY ?? 0);
  out.scale = config.scale;
  out.shaftTop = LOOK.shaftTop;
  return out;
}
