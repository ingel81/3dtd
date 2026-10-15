import type { MapObject } from '../../map-document';
import { HeightField } from '../height-field';
import type { ApronProfile } from '../terrain/terrain-apron';

/** Trees this close to the border are mirrored onto the apron beyond it, metres */
export const EDGE_TREE_BAND = 40;

/**
 * The trees of a map's border mirrored across it onto the apron (the land
 * beyond the edge): a wood that reaches the border runs on past it instead
 * of ending in a straight line before bare ground; not where `stands` says
 * no (the sea that runs on beyond a coast). Drawn only, by a layer of
 * their own outside the line of sight (CustomMapView): nothing in the game
 * reads them. Ids `edge:<side>:<id>`, so each keeps its look
 * (instance-variation.ts) apart from the tree it mirrors.
 */
export function edgeTreeObjects(
  objects: readonly MapObject[],
  isTree: (asset: string) => boolean,
  width: number,
  depth: number,
  stands: (x: number, y: number) => boolean = () => true,
): MapObject[] {
  const out: MapObject[] = [];
  const hw = width / 2;
  const hd = depth / 2;
  for (const o of objects) {
    if (!isTree(o.asset)) continue;
    const mirror = (side: string, x: number, y: number) => {
      if (stands(x, y)) out.push({ ...o, id: `edge:${side}:${o.id}`, x, y, z: 0, pitch: undefined, roll: undefined });
    };
    if (o.x > hw - EDGE_TREE_BAND) mirror('e', 2 * hw - o.x, o.y);
    if (o.x < -hw + EDGE_TREE_BAND) mirror('w', -2 * hw - o.x, o.y);
    if (o.y > hd - EDGE_TREE_BAND) mirror('n', o.x, 2 * hd - o.y);
    if (o.y < -hd + EDGE_TREE_BAND) mirror('s', o.x, -2 * hd - o.y);
  }
  return out;
}

/** The map's heights inside the border, the apron's beyond it: where the mirrored trees stand */
export class ApronField extends HeightField {
  constructor(
    base: HeightField,
    width: number,
    depth: number,
    private readonly profile: () => ApronProfile,
  ) {
    super(base.grid, width, depth);
  }

  override heightAt(x: number, y: number): number {
    return this.profile().heightAt(x, y);
  }
}
