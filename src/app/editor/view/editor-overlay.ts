/**
 * What the editor draws over the map and the game never shows: the brush
 * ring draped on the ground, spawns and the HQ, path nodes, the selection,
 * the gizmo ring, a line being drawn, and the routes from each spawn to the
 * HQ with a moving dash. Spawn colours are the game's lane colours.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  InstancedMesh,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { TD_THEME } from '../../styles/td-theme';
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';
import type { Selection } from '../model/editor-document';
import { pointAt, polylineLength, type Route } from '../ops/path-graph';

const RING_SEGMENTS = 72;
const PREVIEW_DOTS = 600;
const ROUTE_DOT_SPACING = 40;
/** Metres per second the dots move, about a fast enemy */
const ROUTE_DOT_SPEED = 28;

export type GroundHeight = (x: number, y: number) => number;

export class EditorOverlay {
  readonly group = new Group();
  private readonly brush: LineLoop;
  private readonly brushInner: LineLoop;
  private readonly gizmo: LineLoop;
  private readonly markers = new Group();
  private readonly nodes = new Group();
  private readonly selection = new Group();
  private readonly routes = new Group();
  private readonly draft: Line;
  private readonly routeMaterial = new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true, opacity: 0.7 });
  private readonly dotMaterial = new MeshBasicMaterial({ color: TD_THEME.tealLight, depthTest: false });
  private dots: InstancedMesh | null = null;
  /** Where a brush would grow things, a hint under the cursor */
  private readonly preview: InstancedMesh;
  private readonly previewMaterial = new MeshBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true, opacity: 0.7 });
  private routePaths: { points: MapPoint[]; length: number }[] = [];
  private readonly nodeGeometry = new SphereGeometry(1, 10, 8);
  private readonly nodeMaterial = new MeshBasicMaterial({ color: TD_THEME.knobLight, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly nodeSelected = new MeshBasicMaterial({ color: TD_THEME.brass, depthTest: false });
  private readonly selectMaterial = new LineBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true });
  private routeTime = 0;
  /** Markers and handles grow with the view distance so they keep a size on screen */
  private markerScale = 1;
  private showNodes = true;

  constructor(private readonly height: GroundHeight) {
    this.group.name = 'editor-overlay';
    this.brush = ring(TD_THEME.brassLight, 0.95);
    this.brushInner = ring(TD_THEME.brass, 0.55);
    this.gizmo = ring(TD_THEME.tealLight, 0.95);
    this.draft = new Line(new BufferGeometry(), new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true }));
    for (const o of [this.brush, this.brushInner, this.gizmo, this.draft]) {
      o.visible = false;
      o.renderOrder = 10;
      o.frustumCulled = false;
    }
    this.preview = new InstancedMesh(this.nodeGeometry, this.previewMaterial, PREVIEW_DOTS);
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 12;
    this.group.add(this.markers, this.routes, this.nodes, this.selection, this.brush, this.brushInner, this.gizmo, this.draft, this.preview);
  }

  /** The brush ring at a map point, draped on the ground; radius 0 hides it */
  setBrush(center: MapPoint | null, radius: number, falloff: number): void {
    if (!center || radius <= 0) {
      this.brush.visible = false;
      this.brushInner.visible = false;
      return;
    }
    drape(this.brush, center, radius, this.height);
    const inner = radius * (1 - falloff);
    this.brushInner.visible = inner > 0.5 && falloff > 0.02;
    if (this.brushInner.visible) drape(this.brushInner, center, inner, this.height);
  }

  /** The gizmo ring around a selection */
  setGizmo(center: MapPoint | null, radius: number): void {
    if (!center) {
      this.gizmo.visible = false;
      return;
    }
    drape(this.gizmo, center, radius, this.height);
  }

  /** A polyline being drawn (path draft, ramp), or null */
  setDraft(points: readonly MapPoint[] | null): void {
    if (!points || points.length < 2) {
      this.draft.visible = false;
      return;
    }
    const pos = new Float32Array(points.length * 3);
    points.forEach((p, k) => pos.set([-p.x, this.height(p.x, p.y) + 0.8, p.y], k * 3));
    this.draft.geometry.dispose();
    this.draft.geometry = new BufferGeometry();
    this.draft.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    this.draft.visible = true;
  }

  setNodesVisible(on: boolean): void {
    this.showNodes = on;
    this.nodes.visible = on;
  }

  /** Spawns, HQ and path nodes from the document */
  updateMarkers(doc: CustomMapDocument, selection: Selection): void {
    clear(this.markers);
    doc.spawns.forEach((s, k) => {
      const color = new Color(SPAWN_COLORS[k % SPAWN_COLORS.length]);
      const chosen = selection?.kind === 'spawn' && selection.id === s.id;
      const marker = spawnMarker(color, chosen);
      marker.position.set(-s.x, this.height(s.x, s.y), s.y);
      marker.scale.setScalar(this.markerScale);
      marker.userData = { pick: { kind: 'spawn', id: s.id } };
      this.markers.add(marker);
    });
    const hq = hqMarker(selection?.kind === 'hq');
    hq.position.set(-doc.hq.x, this.height(doc.hq.x, doc.hq.y), doc.hq.y);
    hq.scale.setScalar(this.markerScale);
    hq.userData = { pick: { kind: 'hq' } };
    this.markers.add(hq);

    clear(this.nodes);
    this.nodes.visible = this.showNodes;
    for (const n of doc.paths.nodes) {
      const chosen = selection?.kind === 'node' && selection.id === n.id;
      const mesh = new Mesh(this.nodeGeometry, chosen ? this.nodeSelected : this.nodeMaterial);
      const degree = doc.paths.edges.reduce((d, e) => d + (e.a === n.id || e.b === n.id ? 1 : 0), 0);
      mesh.userData['size'] = degree > 2 ? 2.4 : 1.8;
      mesh.scale.setScalar(mesh.userData['size'] * this.markerScale);
      mesh.position.set(-n.x, this.height(n.x, n.y) + 1, n.y);
      mesh.renderOrder = 11;
      this.nodes.add(mesh);
    }
  }

  /** Rings around selected objects, a line along a selected edge */
  updateSelection(doc: CustomMapDocument, selection: Selection, radiusOf: (asset: string) => number): void {
    clear(this.selection);
    if (selection?.kind === 'objects') {
      const ids = new Set(selection.ids);
      for (const o of doc.objects) {
        if (!ids.has(o.id)) continue;
        const r = ring(TD_THEME.brassLight, 1);
        r.material = this.selectMaterial;
        drape(r, o, Math.max(1, radiusOf(o.asset) * o.scale * 1.15), this.height);
        this.selection.add(r);
      }
    } else if (selection?.kind === 'edge') {
      const edge = doc.paths.edges.find((e) => e.id === selection.id);
      if (edge) {
        const a = doc.paths.nodes.find((n) => n.id === edge.a);
        const b = doc.paths.nodes.find((n) => n.id === edge.b);
        if (a && b) {
          const pts = [a, ...(edge.via ?? []), b];
          const line = new Line(new BufferGeometry(), this.selectMaterial);
          const pos = new Float32Array(pts.length * 3);
          pts.forEach((p, k) => pos.set([-p.x, this.height(p.x, p.y) + 1.2, p.y], k * 3));
          line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
          line.renderOrder = 10;
          this.selection.add(line);
        }
      }
    }
  }

  /** The routes to show, with dots moving toward the HQ */
  /** Small dots on the ground in a colour (the biome brush's spots), none for null */
  setPreview(points: readonly MapPoint[] | null, color: string = TD_THEME.brassLight): void {
    if (!points?.length) {
      this.preview.count = 0;
      return;
    }
    this.previewMaterial.color.set(color);
    const m = new Matrix4();
    const n = Math.min(points.length, PREVIEW_DOTS);
    const size = 0.5 * this.markerScale;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      m.makeScale(size, size, size).setPosition(-p.x, this.height(p.x, p.y) + 0.6, p.y);
      this.preview.setMatrixAt(k, m);
    }
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
  }

  setRoutes(routes: readonly (Route | null)[]): void {
    clear(this.routes);
    this.dots = null;
    this.routePaths = [];
    let dots = 0;
    for (const r of routes) {
      if (!r || r.points.length < 2) continue;
      const pos = new Float32Array(r.points.length * 3);
      r.points.forEach((p, k) => pos.set([-p.x, this.height(p.x, p.y) + 1.6, p.y], k * 3));
      const line = new Line(new BufferGeometry(), this.routeMaterial);
      line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      line.renderOrder = 9;
      line.frustumCulled = false;
      this.routes.add(line);
      const length = polylineLength(r.points);
      this.routePaths.push({ points: r.points, length });
      dots += Math.floor(length / ROUTE_DOT_SPACING) + 1;
    }
    if (!dots) return;
    this.dots = new InstancedMesh(this.nodeGeometry, this.dotMaterial, Math.min(dots, 4000));
    this.dots.renderOrder = 12;
    this.dots.frustumCulled = false;
    this.routes.add(this.dots);
    this.update(0);
  }

  /** Scale markers and handles for a camera this far from its target */
  setViewDistance(distance: number): void {
    const scale = Math.max(1, distance / 220);
    if (Math.abs(scale - this.markerScale) < 0.02) return;
    this.markerScale = scale;
    for (const m of this.markers.children) m.scale.setScalar(scale);
    for (const n of this.nodes.children) n.scale.setScalar(n.userData['size'] * scale);
  }

  /** Moves the dots along the routes, spawn to HQ */
  update(dt: number): void {
    const dots = this.dots;
    if (!dots) return;
    this.routeTime += dt;
    const shift = (this.routeTime * ROUTE_DOT_SPEED) % ROUTE_DOT_SPACING;
    const m = new Matrix4();
    let k = 0;
    for (const r of this.routePaths) {
      for (let along = shift; along <= r.length && k < dots.count; along += ROUTE_DOT_SPACING) {
        const p = pointAt(r.points, along);
        const d = 0.9 * this.markerScale;
        m.makeScale(d, d, d).setPosition(-p.x, this.height(p.x, p.y) + 1.8, p.y);
        dots.setMatrixAt(k++, m);
      }
    }
    for (; k < dots.count; k++) dots.setMatrixAt(k, m.makeScale(0, 0, 0));
    dots.instanceMatrix.needsUpdate = true;
  }

  /** What under the pointer is a marker: spawn or HQ */
  markerObjects(): Object3D[] {
    return this.markers.children;
  }

  dispose(): void {
    clear(this.markers);
    clear(this.nodes);
    clear(this.selection);
    clear(this.routes);
    this.nodeGeometry.dispose();
    this.group.removeFromParent();
  }
}

function ring(color: string, opacity: number): LineLoop {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3));
  const loop = new LineLoop(geo, new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
  loop.frustumCulled = false;
  loop.renderOrder = 10;
  return loop;
}

function drape(loop: LineLoop, c: MapPoint, radius: number, height: GroundHeight): void {
  const pos = loop.geometry.attributes['position'] as BufferAttribute;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const a = (k / RING_SEGMENTS) * Math.PI * 2;
    const x = c.x + Math.cos(a) * radius;
    const y = c.y + Math.sin(a) * radius;
    pos.setXYZ(k, -x, height(x, y) + 0.4, y);
  }
  pos.needsUpdate = true;
  loop.geometry.computeBoundingSphere();
  loop.visible = true;
}

function spawnMarker(color: Color, chosen: boolean): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const pole = new Mesh(new CylinderGeometry(0.6, 0.6, 14, 8), mat);
  pole.position.y = 7;
  const head = new Mesh(new ConeGeometry(3, 5, 4), mat);
  head.position.y = 16;
  head.rotation.x = Math.PI;
  g.add(pole, head);
  if (chosen) g.add(baseRing(TD_THEME.brassLight));
  return g;
}

function hqMarker(chosen: boolean): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: TD_THEME.brass });
  const body = new Mesh(new BoxGeometry(10, 8, 10), mat);
  body.position.y = 4;
  const top = new Mesh(new ConeGeometry(7.5, 5, 4), new MeshBasicMaterial({ color: TD_THEME.brassLight }));
  top.position.y = 10.5;
  top.rotation.y = Math.PI / 4;
  g.add(body, top);
  if (chosen) g.add(baseRing(TD_THEME.tealLight));
  return g;
}

function baseRing(color: string): LineLoop {
  const r = ring(color, 1);
  const pos = r.geometry.attributes['position'] as BufferAttribute;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const a = (k / RING_SEGMENTS) * Math.PI * 2;
    pos.setXYZ(k, Math.cos(a) * 9, 0.5, Math.sin(a) * 9);
  }
  return r;
}

function clear(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry && mesh.geometry.type !== 'SphereGeometry') mesh.geometry.dispose();
    });
  }
}
