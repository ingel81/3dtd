/**
 * What lies under a screen point: the ground (a ray to the map view's
 * terrain), the marker, node, object or road a click would take, the gizmo
 * handle, and the way back from map points to screen pixels.
 */
import { MathUtils, Raycaster, Vector2, type PerspectiveCamera } from 'three';
import type { MapPoint } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import { edgePolyline, nearestOnPolyline } from '../../map-ops/path-graph';
import type { EditorDocument, PickResult } from '../model/editor-document';
import type { MapHit, ToolPointer } from '../tools/tool';
import type { CameraController } from './camera-controller';
import type { GizmoHandle, TransformGizmo } from './transform-gizmo';
import { mapToScene, type EditorMapView } from './map-view';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class ViewPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
    private readonly controller: CameraController,
    private readonly editor: EditorDocument,
    private readonly catalog: CatalogIndex,
    private readonly gizmoHandles: TransformGizmo,
    /** The map view now (a rebuild replaces it) */
    private readonly view: () => EditorMapView,
    private readonly heightAt: (x: number, y: number) => number,
  ) {}

  /** The ground under a client pixel */
  ground(clientX: number, clientY: number): MapHit | null {
    return this.aim(clientX, clientY) ? this.view().raycast(this.raycaster.ray) : null;
  }

  /** The ground at a point of the view in device coordinates (-1 to 1) */
  groundAtNdc(x: number, y: number): MapHit | null {
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.view().raycast(this.raycaster.ray);
  }

  /** The ground point the camera looks at and how far the view reaches (minimap frame) */
  footprint(): MapPoint[] {
    const out: MapPoint[] = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const hit = this.groundAtNdc(x, y);
      if (hit) out.push(hit);
    }
    return out;
  }

  gizmo(p: ToolPointer): GizmoHandle | null {
    return this.aim(p.clientX, p.clientY) ? this.gizmoHandles.pick(this.raycaster) : null;
  }

  /** What a click at the pointer would take, nearest first */
  pick(p: ToolPointer): PickResult | null {
    const hit = p.hit;
    if (!hit) return null;
    const doc = this.editor.doc;
    // A pick radius that grows with the view distance, so markers stay clickable from far
    const reach = Math.max(4, this.controller.current.distance * 0.015);
    let best: { d: number; r: PickResult } | null = null;
    const consider = (d: number, r: PickResult) => {
      if (!best || d < best.d) best = { d, r };
    };
    const hq = Math.hypot(doc.hq.x - hit.x, doc.hq.y - hit.y);
    if (hq <= Math.max(8, reach)) consider(hq - 4, { kind: 'hq' });
    for (const s of doc.spawns) {
      const d = Math.hypot(s.x - hit.x, s.y - hit.y);
      if (d <= Math.max(6, reach)) consider(d - 3, { kind: 'spawn', id: s.id });
    }
    for (const n of doc.paths.nodes) {
      const d = Math.hypot(n.x - hit.x, n.y - hit.y);
      if (d <= reach) consider(d - 2, { kind: 'node', id: n.id });
    }
    // Objects by their models; the footprint where the ray misses a thin one
    const modelHit = this.aim(p.clientX, p.clientY) ? this.view().pickObject(this.raycaster.ray) : null;
    if (modelHit) consider(0, { kind: 'object', id: modelHit });
    for (const o of doc.objects) {
      const r = this.catalog.object(o.asset).radius * o.scale;
      const d = Math.hypot(o.x - hit.x, o.y - hit.y);
      if (d <= Math.max(r, 1)) consider(d + 0.5, { kind: 'object', id: o.id });
    }
    if (!best) {
      for (const e of doc.paths.edges) {
        const on = nearestOnPolyline(edgePolyline(doc.paths, e), hit);
        if (on && on.dist <= e.width / 2 + reach * 0.5) consider(on.dist + 1, { kind: 'edge', id: e.id });
      }
    }
    return (best as { d: number; r: PickResult } | null)?.r ?? null;
  }

  /** Metres one screen pixel covers at a map point */
  metresPerPixel(at: MapPoint): number {
    const d = this.camera.position.distanceTo(mapToScene(at.x, at.y, this.heightAt(at.x, at.y)));
    return (2 * d * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) / Math.max(1, this.canvas.clientHeight);
  }

  /** Client pixel position of a map point at height z; null behind the camera */
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = mapToScene(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Map points of a screen box's corners, null when one misses the ground */
  boxToMap(box: Box): MapPoint[] | null {
    const rect = this.canvas.getBoundingClientRect();
    const corners = [
      [box.x0, box.y0],
      [box.x1, box.y0],
      [box.x1, box.y1],
      [box.x0, box.y1],
    ].map(([cx, cy]) => this.groundAtNdc(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1));
    return corners.every((c) => c) ? (corners as MapPoint[]) : null;
  }

  /** Sets the ray through a client pixel; false when the canvas has no size */
  private aim(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return true;
  }
}
