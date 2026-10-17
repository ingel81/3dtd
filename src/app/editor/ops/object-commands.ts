/**
 * The ground levelled under buildings placed anew as an undo step: the map
 * operation is levelUnderBuilding (map-ops/object-ops.ts), the commands are
 * the editor's.
 */
import type { CustomMapDocument, MapObject } from '../../world/custom-map/map-document';
import type { GroundBox } from '../../world/custom-map/object-ground';
import { levelsGround, levelUnderBuilding } from '../../map-ops/object-ops';
import { CompoundCommand, PatchCommand, patchLayout, type EditCommand } from '../model/editor-document';
import { RegionRecorder } from '../model/region-patch';

/**
 * Levels the ground under buildings placed anew (levelUnderBuilding), each
 * of them, and returns that change as a command already in the map: the
 * editor's Place and line, and the agent's place put it in one step with
 * the placement (withGround). Null for any other asset or level ground.
 */
export function levelForBuildings(
  doc: CustomMapDocument,
  label: string,
  objects: readonly MapObject[],
  entry: { footing?: { category: string; float?: boolean; box?: GroundBox }; radius: number },
): EditCommand | null {
  if (!levelsGround(entry)) return null;
  const recorder = new RegionRecorder(doc.terrain.grid.heights, patchLayout(doc, 'heights'));
  let changed = false;
  for (const o of objects) changed = !!levelUnderBuilding(doc.terrain, o, entry, (r) => recorder.touch(r)) || changed;
  return changed ? new PatchCommand(label, [{ target: 'heights', patches: recorder.finish() }]) : null;
}

/** The placement and the levelled ground under it as one undo step */
export function withGround(label: string, ground: EditCommand | null, add: EditCommand): EditCommand {
  return ground ? new CompoundCommand(label, [ground, add]) : add;
}
