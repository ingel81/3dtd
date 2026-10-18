/**
 * What the editor draws over the map and the game never shows, as layers
 * of their own (view/overlay/): what tools draw (`tool`, emptied at every
 * tool switch), the document's markers, selection and routes (the view
 * keeps them in step), and the ground aids (brush ring, height lines, grid,
 * build areas, symmetry guides).
 */
import { Group, SphereGeometry } from 'three';
import type { GroundHeight } from './overlay/draping';
import { BrushLayer, BuildAreaLayer, ContourLayer, GridLayer, GuideLayer } from './overlay/ground-layers';
import { MarkerLayer, RouteLayer, SelectionLayer } from './overlay/map-layers';
import { ToolOverlay } from './overlay/tool-overlay';

export class EditorOverlay {
  readonly group = new Group();
  /** The layers tools draw on (ToolContext.overlay) */
  readonly tool: ToolOverlay;
  readonly brush: BrushLayer;
  readonly markers: MarkerLayer;
  readonly selection: SelectionLayer;
  readonly routes: RouteLayer;
  readonly contours = new ContourLayer();
  readonly grid: GridLayer;
  readonly buildAreas: BuildAreaLayer;
  readonly guides: GuideLayer;
  /** The handles' and dots' shape, one for all layers */
  private readonly sphere = new SphereGeometry(1, 10, 8);
  /** Markers and handles grow with the view distance so they keep a size on screen */
  private markerScale = 1;

  /**
   * @param height The ground: markers, rings and handles stand on it
   * @param walk Where a walker goes: the ground, or a bridge deck over it (roads and routes)
   */
  constructor(height: GroundHeight, walk: GroundHeight = height) {
    this.group.name = 'editor-overlay';
    this.tool = new ToolOverlay(height, this.sphere);
    this.brush = new BrushLayer(height);
    this.markers = new MarkerLayer(height, walk, this.sphere);
    this.selection = new SelectionLayer(height, walk);
    this.routes = new RouteLayer(walk, this.sphere);
    this.grid = new GridLayer(height);
    this.buildAreas = new BuildAreaLayer(height);
    this.guides = new GuideLayer(height);
    const t = this.tool;
    this.group.add(
      t.hover.loop,
      this.buildAreas.group,
      this.contours.group,
      this.grid.group,
      t.measure.line,
      this.guides.group,
      this.markers.markers,
      this.routes.group,
      this.markers.nodes,
      this.selection.group,
      this.brush.outer,
      this.brush.inner,
      t.gizmo.ring.loop,
      t.draft.line,
      t.preview.dots,
      t.gizmo.handles.group,
      t.rivers.handles,
      t.shapes.lines,
      t.shapes.handles,
    );
  }

  /**
   * The ground moved under what the overlay laid on it (a height stroke, a
   * bridge over new water): markers, nodes, roads, the selection and the
   * routes take the new heights where they stand, without being built anew
   */
  redrape(): void {
    this.markers.redrape();
    this.selection.redrape();
    this.routes.redrape();
  }

  /** Scale markers and handles for a camera this far from its target */
  setViewDistance(distance: number): void {
    const scale = Math.max(1, distance / 220);
    if (Math.abs(scale - this.markerScale) < 0.02) return;
    this.markerScale = scale;
    this.markers.setScale(scale);
    this.routes.scale = scale;
    this.tool.setScale(scale);
  }

  /** Once a frame: the routes' dots move */
  update(dt: number): void {
    this.routes.update(dt);
  }

  dispose(): void {
    this.tool.dispose();
    this.brush.dispose();
    this.markers.dispose();
    this.selection.dispose();
    this.routes.dispose();
    this.contours.dispose();
    this.grid.dispose();
    this.buildAreas.dispose();
    this.guides.dispose();
    this.sphere.dispose();
    this.group.removeFromParent();
  }
}
