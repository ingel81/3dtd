// Tiles on the ray path of 3d-tiles-renderer itself, for specs of what a ray
// into the tiles group meets. Not app code: import only from specs.

import { Box3, Vector3, type Object3D } from 'three';
import { TilesRenderer } from '3d-tiles-renderer';

/** A tile as the renderer preprocessed it, with the fields a spec touches. */
export interface LibraryTile {
  geometricError: number;
  children: LibraryTile[];
  internal: { depth: number };
  traversal: { used: boolean };
  engineData: { scene: Object3D | null };
}

/** What the renderer does with tiles and does not declare. */
interface RendererInternals {
  rootTileset: { root: LibraryTile } | null;
  preprocessNode(tile: object, tilesetDir: string, parentTile: LibraryTile | null): void;
  setTileActive(tile: LibraryTile, active: boolean): void;
  setTileVisible(tile: LibraryTile, visible: boolean): void;
}

/**
 * A real TilesRenderer over hand-made tiles. A ray into `renderer.group`
 * takes the library's own way: TilesGroup.raycast hands it to
 * TilesRenderer.raycast and ends three's recursion into the group's
 * children, and raycastTraverse walks the tile tree by bounding volume and
 * intersects only tiles in `activeTiles`. Each tile is preprocessed by the
 * renderer under one root; only download and parse are left out, so the
 * scene is handed in as parseTile would set it. setActive and setVisible
 * are the renderer's setTileActive and setTileVisible, as its traversal
 * calls them: an active scene is parented to the group, a visible one is
 * one of its children.
 */
export class LibraryTiles {
  readonly renderer = new TilesRenderer();
  private readonly internals = this.renderer as unknown as RendererInternals;
  private readonly root: LibraryTile;
  private count = 0;

  constructor() {
    const root = { geometricError: 1e4, boundingVolume: { box: [0, 0, 0, 1e5, 0, 0, 0, 1e5, 0, 0, 0, 1e5] } };
    this.internals.preprocessNode(root, '', null);
    this.root = root as unknown as LibraryTile;
    this.root.traversal.used = true;
    this.internals.rootTileset = { root: this.root };
  }

  /**
   * `scene` as a loaded tile of `depth` and `geometricError` under the root,
   * its bounding box the scene's own, 1 m larger each way. Active and on
   * screen unless `active` or `visible` say otherwise.
   */
  add(
    scene: Object3D,
    depth: number,
    geometricError: number,
    { active = true, visible = active }: { active?: boolean; visible?: boolean } = {},
  ): LibraryTile {
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene).expandByScalar(1);
    const centre = box.getCenter(new Vector3());
    const half = box.getSize(new Vector3()).multiplyScalar(0.5);
    const json = {
      geometricError,
      boundingVolume: { box: [centre.x, centre.y, centre.z, half.x, 0, 0, 0, half.y, 0, 0, 0, half.z] },
      content: { uri: `tile-${++this.count}.glb` },
    };
    this.internals.preprocessNode(json, '', this.root);
    const tile = json as unknown as LibraryTile;
    this.root.children.push(tile);
    tile.internal.depth = depth;
    tile.traversal.used = true;
    tile.engineData.scene = scene;
    scene.traverse((object) => {
      object.userData['tile'] = tile;
    });
    if (active) this.setActive(tile, true);
    if (visible) this.setVisible(tile, true);
    return tile;
  }

  setActive(tile: LibraryTile, active: boolean): void {
    this.internals.setTileActive(tile, active);
  }

  setVisible(tile: LibraryTile, visible: boolean): void {
    this.internals.setTileVisible(tile, visible);
  }
}
