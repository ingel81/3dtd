/**
 * The overlay's layers that tools draw on: a line being drawn, the hover
 * ring, preview dots, the measured line, the gizmo ring and handles, the
 * rivers' handles and the outlines of life areas and surfaces. A tool reaches only these (through
 * ToolContext.overlay); the view empties them all at every tool switch, so
 * no tool leaves its lines to the next.
 */
import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Line, LineBasicMaterial, type LineLoop, Matrix4, MeshBasicMaterial } from 'three';
import { TD_THEME } from '../../../styles/td-theme';
import type { MapPoint, MapRiver } from '../../../world/custom-map/map-document';
import { TransformGizmo } from '../transform-gizmo';
import { clearGroup, drape, drapedLine, ring, type GroundHeight, type OverlayLayer } from './draping';

/** River points with a handle at most */
const RIVER_HANDLES = 2048;
const PREVIEW_DOTS = 600;

/** A polyline being drawn (path draft, ramp, outline), draped */
export class DraftLayer implements OverlayLayer {
  readonly line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true }));

  constructor(private readonly height: GroundHeight) {
    this.line.visible = false;
    this.line.renderOrder = 10;
    this.line.frustumCulled = false;
  }

  /** The line, or null (fewer than two points) to hide it */
  set(points: readonly MapPoint[] | null): void {
    if (!points || points.length < 2) {
      this.clear();
      return;
    }
    const pos = drapedLine(points, this.height, 0.8);
    this.line.geometry.dispose();
    this.line.geometry = new BufferGeometry();
    this.line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    this.line.visible = true;
  }

  clear(): void {
    this.line.visible = false;
  }

  dispose(): void {
    this.line.geometry.dispose();
  }
}

/** A ring on the ground around a point: what a click would take (hover), or the gizmo ring around a selection */
export class RingLayer implements OverlayLayer {
  readonly loop: LineLoop;

  /** @param least The ring's smallest radius */
  constructor(
    private readonly height: GroundHeight,
    color: string,
    opacity: number,
    private readonly least = 0,
  ) {
    this.loop = ring(color, opacity);
    this.loop.visible = false;
  }

  /** The ring around `at`; null hides it */
  set(at: MapPoint | null, radius = 0): void {
    if (!at) this.clear();
    else drape(this.loop, at, Math.max(this.least, radius), this.height);
  }

  clear(): void {
    this.loop.visible = false;
  }

  dispose(): void {
    this.loop.geometry.dispose();
  }
}

/** Small dots on the ground in a colour (the biome brush's spots) */
export class PreviewLayer implements OverlayLayer {
  readonly dots: InstancedMesh;
  private readonly material = new MeshBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true, opacity: 0.7 });
  /** Dots and handles keep a size on screen (EditorOverlay.setViewDistance) */
  scale = 1;

  constructor(
    private readonly height: GroundHeight,
    sphere: BufferGeometry,
  ) {
    this.dots = new InstancedMesh(sphere, this.material, PREVIEW_DOTS);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 12;
  }

  /** The dots, none for null */
  set(points: readonly MapPoint[] | null, color: string = TD_THEME.brassLight): void {
    if (!points?.length) {
      this.clear();
      return;
    }
    this.material.color.set(color);
    const m = new Matrix4();
    const n = Math.min(points.length, PREVIEW_DOTS);
    const size = 0.5 * this.scale;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      m.makeScale(size, size, size).setPosition(-p.x, this.height(p.x, p.y) + 0.6, p.y);
      this.dots.setMatrixAt(k, m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.dots.count = 0;
  }

  dispose(): void {
    this.dots.dispose();
  }
}

/** The measured line, draped */
export class MeasureLayer implements OverlayLayer {
  readonly line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true }));

  constructor(private readonly height: GroundHeight) {
    this.line.renderOrder = 13;
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  /** The line, null hides it */
  set(points: readonly MapPoint[] | null): void {
    if (!points || points.length < 2) {
      this.clear();
      return;
    }
    const pos: number[] = [];
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1];
      const b = points[k];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let s = k === 1 ? 0 : 1; s <= n; s++) {
        const x = a.x + ((b.x - a.x) * s) / n;
        const y = a.y + ((b.y - a.y) * s) / n;
        pos.push(-x, this.height(x, y) + 1, y);
      }
    }
    this.line.geometry.dispose();
    this.line.geometry = new BufferGeometry();
    this.line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.line.visible = true;
  }

  clear(): void {
    this.line.visible = false;
  }

  dispose(): void {
    this.line.geometry.dispose();
  }
}

/** Handles on the points of the map's rivers (the water tool's river mode) */
export class RiverHandleLayer implements OverlayLayer {
  readonly handles: InstancedMesh;
  private readonly water = new Color(TD_THEME.tealLight);
  private readonly lava = new Color('#ff7a3a');
  private readonly chosenColor = new Color(TD_THEME.brassLight);
  scale = 1;

  constructor(sphere: BufferGeometry) {
    this.handles = new InstancedMesh(sphere, new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 }), RIVER_HANDLES);
    this.handles.count = 0;
    this.handles.visible = false;
    this.handles.frustumCulled = false;
    this.handles.renderOrder = 14;
  }

  /** A handle on each river point, the chosen river's larger, its chosen point largest; null hides them */
  set(rivers: readonly MapRiver[] | null, chosen: { river: number; point: number } | null): void {
    const mesh = this.handles;
    if (!rivers) {
      this.clear();
      return;
    }
    const m = new Matrix4();
    let n = 0;
    rivers.forEach((r, ri) =>
      r.points.forEach((q, pi) => {
        if (n >= RIVER_HANDLES) return;
        const big = chosen && chosen.river === ri && chosen.point === pi ? 2.2 : chosen?.river === ri ? 1.5 : 1.1;
        const s = big * this.scale;
        m.makeScale(s, s, s).setPosition(-q.x, q.height + 0.6, q.y);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, chosen && chosen.river === ri && chosen.point === pi ? this.chosenColor : r.kind === 'lava' ? this.lava : this.water);
        n++;
      }),
    );
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = n > 0;
  }

  clear(): void {
    this.handles.visible = false;
  }

  dispose(): void {
    this.handles.dispose();
  }
}

/** An outline or line drawn over the ground (a life area, a surface, its marking) in its colour */
export interface OverlayShape {
  id: string;
  points: readonly MapPoint[];
  closed: boolean;
  color: string;
}

/** Outlines and lines (life areas, surfaces) in their colours, the chosen one's points as handles */
export class ShapeLayer implements OverlayLayer {
  readonly lines = new Group();
  readonly handles: InstancedMesh;
  private readonly materials = new Map<string, LineBasicMaterial>();
  private readonly plain = new Color(TD_THEME.tealLight);
  private readonly chosenColor = new Color(TD_THEME.brassLight);
  private handleAt: MapPoint[] = [];
  private chosenPoint = -1;
  private scaleNow = 1;

  constructor(
    private readonly height: GroundHeight,
    sphere: BufferGeometry,
  ) {
    this.handles = new InstancedMesh(sphere, new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 }), 256);
    this.handles.count = 0;
    this.handles.frustumCulled = false;
    this.handles.renderOrder = 14;
  }

  /** Handles keep a size on screen */
  set scale(scale: number) {
    this.scaleNow = scale;
    if (this.handleAt.length) this.placeHandles();
  }

  /**
   * The shapes draped on the ground, the chosen one brighter with a handle
   * on each point (the chosen point larger); shapes sharing the chosen id
   * (a surface and its marking) number their handles one after the other
   */
  set(shapes: readonly OverlayShape[] | null, chosen: string | null, point: number): void {
    clearGroup(this.lines);
    this.handleAt = [];
    this.chosenPoint = point;
    for (const a of shapes ?? []) {
      if (a.points.length < 2) continue;
      const pts = a.closed ? [...a.points, a.points[0]] : a.points;
      const line = new Line(new BufferGeometry(), this.material(a.color, a.id === chosen));
      line.geometry.setAttribute('position', new BufferAttribute(drapedLine(pts, this.height, 1.2), 3));
      line.renderOrder = 11;
      line.frustumCulled = false;
      this.lines.add(line);
      if (a.id === chosen) this.handleAt.push(...a.points.slice(0, this.handles.instanceMatrix.count - this.handleAt.length));
    }
    this.placeHandles();
  }

  clear(): void {
    this.set(null, null, -1);
  }

  dispose(): void {
    clearGroup(this.lines);
    for (const m of this.materials.values()) m.dispose();
    this.handles.dispose();
  }

  private material(color: string, chosen: boolean): LineBasicMaterial {
    const key = `${color}|${chosen}`;
    let m = this.materials.get(key);
    if (!m) this.materials.set(key, (m = new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: chosen ? 1 : 0.55 })));
    return m;
  }

  private placeHandles(): void {
    const mesh = this.handles;
    const m = new Matrix4();
    this.handleAt.forEach((q, k) => {
      const s = (k === this.chosenPoint ? 1.6 : 0.9) * this.scaleNow;
      m.makeScale(s, s, s).setPosition(-q.x, this.height(q.x, q.y) + 1.2, q.y);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, k === this.chosenPoint ? this.chosenColor : this.plain);
    });
    mesh.count = this.handleAt.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** The arrows, ring or cube over the selected objects and the ring around them */
export class GizmoLayer implements OverlayLayer {
  readonly handles = new TransformGizmo();
  readonly ring: RingLayer;

  constructor(height: GroundHeight) {
    this.ring = new RingLayer(height, TD_THEME.tealLight, 0.95);
  }

  clear(): void {
    this.ring.clear();
    this.handles.hide();
  }

  dispose(): void {
    this.ring.dispose();
  }
}

export class ToolOverlay implements OverlayLayer {
  readonly draft: DraftLayer;
  readonly hover: RingLayer;
  readonly preview: PreviewLayer;
  readonly measure: MeasureLayer;
  readonly gizmo: GizmoLayer;
  readonly rivers: RiverHandleLayer;
  readonly shapes: ShapeLayer;

  /** @param sphere The handles' and dots' shape, shared with the rest of the overlay */
  constructor(height: GroundHeight, sphere: BufferGeometry) {
    this.draft = new DraftLayer(height);
    this.hover = new RingLayer(height, TD_THEME.brassLight, 0.45, 1);
    this.preview = new PreviewLayer(height, sphere);
    this.measure = new MeasureLayer(height);
    this.gizmo = new GizmoLayer(height);
    this.rivers = new RiverHandleLayer(sphere);
    this.shapes = new ShapeLayer(height, sphere);
  }

  /** Handles and dots keep their size on screen at this scale */
  setScale(scale: number): void {
    this.preview.scale = scale;
    this.rivers.scale = scale;
    this.shapes.scale = scale;
  }

  /** Everything a tool drew goes (a tool switch) */
  clear(): void {
    for (const layer of this.layers()) layer.clear();
  }

  dispose(): void {
    for (const layer of this.layers()) layer.dispose();
  }

  private layers(): OverlayLayer[] {
    return [this.draft, this.hover, this.preview, this.measure, this.gizmo, this.rivers, this.shapes];
  }
}
