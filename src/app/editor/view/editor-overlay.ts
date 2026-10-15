/**
 * What the editor draws over the map and the game never shows: the brush
 * ring draped on the ground, spawns and the HQ, path nodes, the selection,
 * the gizmo ring, a line being drawn, the life areas while the Life tool is
 * in hand, and the routes from each spawn to the HQ with a moving dash.
 * Spawn colours are the game's lane colours.
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
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  CanvasTexture,
  DataTexture,
  DoubleSide,
  NearestFilter,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { TD_THEME } from '../../styles/td-theme';
import type { CustomMapDocument, MapLifeArea, MapPoint, MapRiver } from '../../world/custom-map/map-document';
import { LIFE_KIND_INFO } from '../../world/custom-map/map-life';
import { selectedEdges, selectedNodes, selectedSpawns, type Selection } from '../model/editor-document';
import { pointAt, polylineLength, type Route } from '../ops/path-graph';
import type { SymmetryMode } from '../ops/symmetry';
import type { Contours } from '../ops/contours';
import { BuildCell, type BuildAreas } from '../validation/build-areas';
import { TransformGizmo } from './transform-gizmo';

const RING_SEGMENTS = 72;
/** River points with a handle at most */
const RIVER_HANDLES = 2048;
const PREVIEW_DOTS = 600;
const ROUTE_DOT_SPACING = 40;
/** Metres per second the dots move, about a fast enemy */
const ROUTE_DOT_SPEED = 28;

export type GroundHeight = (x: number, y: number) => number;

/** Metres between two points of a line laid on the ground: the height grid's cells are about this size */
const DRAPE_STEP_M = 2;

/**
 * Scene positions of a map polyline laid `lift` metres over `height`, each
 * piece cut into steps of at most DRAPE_STEP_M: a road between two points
 * far apart follows the hill it crosses instead of cutting through it.
 */
export function drapedLine(points: readonly MapPoint[], height: GroundHeight, lift: number): Float32Array {
  let count = 1;
  for (let k = 1; k < points.length; k++) {
    count += Math.max(1, Math.ceil(Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y) / DRAPE_STEP_M));
  }
  const pos = new Float32Array(count * 3);
  const put = (i: number, x: number, y: number) => {
    pos[i * 3] = -x;
    pos[i * 3 + 1] = height(x, y) + lift;
    pos[i * 3 + 2] = y;
  };
  put(0, points[0].x, points[0].y);
  let i = 1;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / DRAPE_STEP_M));
    for (let s = 1; s <= n; s++) put(i++, a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
  }
  return pos;
}

export class EditorOverlay {
  readonly group = new Group();
  /** Arrows, ring or cube over the selected objects */
  readonly transform = new TransformGizmo();
  private readonly brush: LineLoop;
  private readonly brushInner: LineLoop;
  private readonly gizmo: LineLoop;
  private readonly markers = new Group();
  private readonly nodes = new Group();
  private readonly selection = new Group();
  /** Name tag pictures by colour and text, kept while the overlay lives */
  private readonly tags = new Map<string, { material: SpriteMaterial; width: number }>();
  /** What the pointer is over in Select: a click would take it */
  private readonly hover = ring(TD_THEME.brassLight, 0.45);
  private readonly routes = new Group();
  private readonly draft: Line;
  private readonly routeMaterial = new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true, opacity: 0.7 });
  private readonly dotMaterial = new MeshBasicMaterial({ color: TD_THEME.tealLight, depthTest: false });
  private dots: InstancedMesh | null = null;
  /** Where a brush would grow things, a hint under the cursor */
  private readonly preview: InstancedMesh;
  /** Height lines and the metre grid */
  private readonly contours = new Group();
  private readonly grid = new Group();
  /** Where a tower may stand (validation/build-areas.ts), a coloured sheet on the ground */
  private readonly buildAreas = new Group();
  private readonly contourMinor = new LineBasicMaterial({ color: TD_THEME.knobLight, transparent: true, opacity: 0.35 });
  private readonly contourMajor = new LineBasicMaterial({ color: TD_THEME.brassLight, transparent: true, opacity: 0.7 });
  private readonly gridMaterial = new LineBasicMaterial({ color: TD_THEME.frameLight, transparent: true, opacity: 0.45 });
  /** The measured line */
  private readonly measure: Line;
  /** The symmetry's axes, draped on the ground */
  private readonly guides = new Group();
  private readonly guideMaterial = new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true, opacity: 0.55 });
  private readonly previewMaterial = new MeshBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true, opacity: 0.7 });
  private routePaths: { points: MapPoint[]; length: number }[] = [];
  private readonly nodeGeometry = new SphereGeometry(1, 10, 8);
  private readonly nodeMaterial = new MeshBasicMaterial({ color: TD_THEME.knobLight, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly nodeSelected = new MeshBasicMaterial({ color: TD_THEME.brass, depthTest: false });
  private readonly selectMaterial = new LineBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true });
  /** Every road as a line while the nodes show: a road under another or one that was bent away stays in sight */
  private readonly edgeMaterial = new LineBasicMaterial({ color: TD_THEME.knobLight, depthTest: false, transparent: true, opacity: 0.55 });
  private routeTime = 0;
  /** Points of the rivers while they are edited */
  private readonly riverHandles: InstancedMesh;
  private readonly handleWater = new Color(TD_THEME.tealLight);
  private readonly handleLava = new Color('#ff7a3a');
  private readonly handleChosen = new Color(TD_THEME.brassLight);
  /** Life areas and routes in their kind's colour (setLife), the chosen one's points */
  private readonly life = new Group();
  private readonly lifeMaterials = new Map<string, LineBasicMaterial>();
  private readonly lifeHandles: InstancedMesh;
  private lifeHandleAt: MapPoint[] = [];
  private lifeChosenPoint = -1;
  /** Markers and handles grow with the view distance so they keep a size on screen */
  private markerScale = 1;
  private showNodes = true;

  /**
   * @param height The ground: markers, rings and handles stand on it
   * @param walk Where a walker goes: the ground, or a bridge deck over it (roads and routes)
   */
  constructor(
    private readonly height: GroundHeight,
    private readonly walk: GroundHeight = height,
  ) {
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
    this.riverHandles = new InstancedMesh(this.nodeGeometry, new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 }), RIVER_HANDLES);
    this.riverHandles.count = 0;
    this.riverHandles.visible = false;
    this.riverHandles.frustumCulled = false;
    this.riverHandles.renderOrder = 14;
    this.lifeHandles = new InstancedMesh(this.nodeGeometry, new MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 }), 256);
    this.lifeHandles.count = 0;
    this.lifeHandles.frustumCulled = false;
    this.lifeHandles.renderOrder = 14;
    this.preview = new InstancedMesh(this.nodeGeometry, this.previewMaterial, PREVIEW_DOTS);
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 12;
    this.measure = new Line(new BufferGeometry(), new LineBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true }));
    this.measure.renderOrder = 13;
    this.measure.frustumCulled = false;
    this.measure.visible = false;
    this.hover.visible = false;
    this.group.add(this.hover, this.buildAreas, this.contours, this.grid, this.measure, this.guides, this.markers, this.routes, this.nodes, this.selection, this.brush, this.brushInner, this.gizmo, this.draft, this.preview, this.transform.group, this.riverHandles, this.life, this.lifeHandles);
  }

  /** Handles on the points of the map's rivers (the water tool's river mode); null hides them */
  setRiverHandles(rivers: readonly MapRiver[] | null, chosen: { river: number; point: number } | null): void {
    const mesh = this.riverHandles;
    if (!rivers) {
      mesh.visible = false;
      return;
    }
    const m = new Matrix4();
    let n = 0;
    rivers.forEach((r, ri) =>
      r.points.forEach((q, pi) => {
        if (n >= RIVER_HANDLES) return;
        const big = chosen && chosen.river === ri && chosen.point === pi ? 2.2 : chosen?.river === ri ? 1.5 : 1.1;
        const s = big * this.markerScale;
        m.makeScale(s, s, s).setPosition(-q.x, q.height + 0.6, q.y);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, chosen && chosen.river === ri && chosen.point === pi ? this.handleChosen : r.kind === 'lava' ? this.handleLava : this.handleWater);
        n++;
      }),
    );
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = n > 0;
  }

  /**
   * The life areas (outlines closed, routes open) draped on the ground in
   * their kind's colour, the chosen one brighter with a handle on each point
   * (the chosen point larger); null hides them all
   */
  setLife(areas: readonly MapLifeArea[] | null, chosen: string | null, point: number): void {
    clear(this.life);
    this.lifeHandleAt = [];
    this.lifeChosenPoint = point;
    for (const a of areas ?? []) {
      if (a.points.length < 2) continue;
      const pts = a.shape === 'area' ? [...a.points, a.points[0]] : a.points;
      const line = new Line(new BufferGeometry(), this.lifeMaterial(LIFE_KIND_INFO[a.kind]?.color ?? '#ffffff', a.id === chosen));
      line.geometry.setAttribute('position', new BufferAttribute(drapedLine(pts, this.height, 1.2), 3));
      line.renderOrder = 11;
      line.frustumCulled = false;
      this.life.add(line);
      if (a.id === chosen) this.lifeHandleAt = a.points.slice(0, this.lifeHandles.instanceMatrix.count);
    }
    this.placeLifeHandles();
  }

  private lifeMaterial(color: string, chosen: boolean): LineBasicMaterial {
    const key = `${color}|${chosen}`;
    let m = this.lifeMaterials.get(key);
    if (!m) this.lifeMaterials.set(key, (m = new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: chosen ? 1 : 0.55 })));
    return m;
  }

  private placeLifeHandles(): void {
    const mesh = this.lifeHandles;
    const m = new Matrix4();
    this.lifeHandleAt.forEach((q, k) => {
      const s = (k === this.lifeChosenPoint ? 1.6 : 0.9) * this.markerScale;
      m.makeScale(s, s, s).setPosition(-q.x, this.height(q.x, q.y) + 1.2, q.y);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, k === this.lifeChosenPoint ? this.handleChosen : this.handleWater);
    });
    mesh.count = this.lifeHandleAt.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    const pos = drapedLine(points, this.height, 0.8);
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
    const spawns = new Set(selectedSpawns(selection));
    const nodes = new Set(selectedNodes(selection));
    doc.spawns.forEach((s, k) => {
      const color = new Color(SPAWN_COLORS[k % SPAWN_COLORS.length]);
      const chosen = spawns.has(s.id);
      const marker = spawnMarker(color, chosen);
      marker.position.set(-s.x, this.height(s.x, s.y), s.y);
      marker.scale.setScalar(this.markerScale);
      marker.userData = { pick: { kind: 'spawn', id: s.id } };
      this.markers.add(marker);
      this.markers.add(this.nameTag(s.name, '#' + color.getHexString(), -s.x, this.height(s.x, s.y), 22, this.markerScale, s.y));
    });
    const hq = hqMarker(selection?.kind === 'hq');
    hq.position.set(-doc.hq.x, this.height(doc.hq.x, doc.hq.y), doc.hq.y);
    hq.scale.setScalar(this.markerScale);
    hq.userData = { pick: { kind: 'hq' } };
    this.markers.add(hq);
    this.markers.add(this.nameTag('HQ', TD_THEME.brassLight, -doc.hq.x, this.height(doc.hq.x, doc.hq.y), 18, this.markerScale, doc.hq.y));

    clear(this.nodes);
    this.nodes.visible = this.showNodes;
    for (const n of doc.paths.nodes) {
      const chosen = nodes.has(n.id);
      const mesh = new Mesh(this.nodeGeometry, chosen ? this.nodeSelected : this.nodeMaterial);
      const degree = doc.paths.edges.reduce((d, e) => d + (e.a === n.id || e.b === n.id ? 1 : 0), 0);
      mesh.userData['size'] = degree > 2 ? 2.4 : 1.8;
      mesh.scale.setScalar(mesh.userData['size'] * this.markerScale);
      mesh.position.set(-n.x, this.height(n.x, n.y) + 1, n.y);
      mesh.renderOrder = 11;
      this.nodes.add(mesh);
    }
    for (const e of doc.paths.edges) {
      const a = doc.paths.nodes.find((n) => n.id === e.a);
      const b = doc.paths.nodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      const pos = drapedLine([a, ...(e.via ?? []), b], this.walk, 1);
      const line = new Line(new BufferGeometry(), this.edgeMaterial);
      line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      line.renderOrder = 10;
      line.frustumCulled = false;
      this.nodes.add(line);
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
    }
    for (const id of selectedEdges(selection)) {
      const edge = doc.paths.edges.find((e) => e.id === id);
      if (edge) {
        const a = doc.paths.nodes.find((n) => n.id === edge.a);
        const b = doc.paths.nodes.find((n) => n.id === edge.b);
        if (a && b) {
          const line = new Line(new BufferGeometry(), this.selectMaterial);
          const pos = drapedLine([a, ...(edge.via ?? []), b], this.walk, 1.2);
          line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
          line.renderOrder = 10;
          this.selection.add(line);
        }
      }
    }
  }

  /**
   * A name over a marker, the same size on the screen from near and far, in
   * front of the land: spawns and the HQ are found by name in an overview.
   * Markers are rebuilt on every change of the map (a brush stroke too): the
   * picture of a name is drawn once and kept.
   */
  private nameTag(text: string, color: string, x: number, ground: number, lift: number, scale: number, z: number): Sprite {
    const id = `${color}|${text}`;
    let tag = this.tags.get(id);
    if (!tag) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const font = '600 30px "Barlow Semi Condensed", "Barlow", sans-serif';
      let width = 64;
      if (ctx) {
        ctx.font = font;
        width = Math.ceil(ctx.measureText(text).width) + 28;
      }
      canvas.width = width;
      canvas.height = 44;
      if (ctx) {
        ctx.font = font;
        ctx.fillStyle = 'rgba(14, 16, 14, 0.78)';
        ctx.beginPath();
        ctx.roundRect(1, 1, width - 2, 42, 6);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#f0ece0';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 14, 23);
      }
      tag = { material: new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false, sizeAttenuation: false, transparent: true }), width };
      this.tags.set(id, tag);
    }
    const sprite = new Sprite(tag.material);
    // About 15 px high on a 900 px tall view
    const h = 0.034;
    sprite.scale.set((h * tag.width) / 44, h, 1);
    sprite.center.set(0.5, 0);
    sprite.position.set(x, ground + lift * scale, z);
    sprite.userData = { ground, lift };
    sprite.renderOrder = 10;
    return sprite;
  }

  /** A faint ring around what a click would pick, or none */
  setHover(at: MapPoint | null, radius = 0): void {
    if (!at) {
      this.hover.visible = false;
      return;
    }
    drape(this.hover, at, Math.max(1, radius), this.height);
    this.hover.visible = true;
  }

  /** The routes to show, with dots moving toward the HQ */
  /** Height lines (segments from contourLines) lifted a little off the ground; null hides them */
  setContours(lines: Contours | null): void {
    clear(this.contours);
    if (!lines) return;
    for (const [data, material] of [
      [lines.minor, this.contourMinor],
      [lines.major, this.contourMajor],
    ] as const) {
      if (!data.length) continue;
      const pos = new Float32Array(data.length);
      for (let k = 0; k < data.length; k += 3) {
        pos[k] = -data[k];
        pos[k + 1] = data[k + 2] + 0.3;
        pos[k + 2] = data[k + 1];
      }
      const seg = new LineSegments(new BufferGeometry(), material);
      seg.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      seg.frustumCulled = false;
      seg.renderOrder = 7;
      this.contours.add(seg);
    }
  }

  /**
   * Where a tower may stand: a sheet draped on the ground, a texel per
   * cell, strong green in reach of a route, pale green out of reach, red
   * where something rules a tower out; null hides it
   */
  setBuildAreas(areas: BuildAreas | null): void {
    for (const child of this.buildAreas.children) ((child as Mesh).material as MeshBasicMaterial).map?.dispose();
    clear(this.buildAreas);
    if (!areas) return;
    const { columns, rows, cell, x0, y0 } = areas;
    const texels = new Uint8Array(columns * rows * 4);
    for (let k = 0; k < areas.kind.length; k++) texels.set(BUILD_COLORS[areas.kind[k]] ?? BUILD_COLORS[BuildCell.Outside], k * 4);
    const texture = new DataTexture(texels, columns, rows);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    // A vertex every cell corner, at most 256 along a side: the sheet follows the ground, the texels stay sharp
    const step = Math.max(1, Math.ceil(Math.max(columns, rows) / 256));
    const vx = Math.ceil(columns / step) + 1;
    const vy = Math.ceil(rows / step) + 1;
    const pos = new Float32Array(vx * vy * 3);
    const uv = new Float32Array(vx * vy * 2);
    for (let j = 0; j < vy; j++) {
      for (let i = 0; i < vx; i++) {
        const u = Math.min(columns, i * step);
        const v = Math.min(rows, j * step);
        const x = x0 + u * cell;
        const y = y0 + v * cell;
        const k = j * vx + i;
        pos.set([-x, this.height(x, y) + 0.4, y], k * 3);
        uv.set([u / columns, v / rows], k * 2);
      }
    }
    const index: number[] = [];
    for (let j = 0; j + 1 < vy; j++) {
      for (let i = 0; i + 1 < vx; i++) {
        const a = j * vx + i;
        index.push(a, a + vx, a + 1, a + 1, a + vx, a + vx + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setIndex(index);
    const sheet = new Mesh(geometry, new MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide,
    }));
    sheet.frustumCulled = false;
    sheet.renderOrder = 6;
    this.buildAreas.add(sheet);
  }

  /** A metre grid draped on the ground every `spacing` metres; 0 hides it */
  setGrid(spacing: number, width: number, depth: number, sampleStep: number): void {
    clear(this.grid);
    if (spacing <= 0) return;
    const pos: number[] = [];
    const add = (ax: number, ay: number, bx: number, by: number) => {
      pos.push(-ax, this.height(ax, ay) + 0.35, ay, -bx, this.height(bx, by) + 0.35, by);
    };
    const hw = width / 2;
    const hd = depth / 2;
    const step = Math.max(1, sampleStep);
    for (let x = Math.ceil(-hw / spacing) * spacing; x <= hw; x += spacing) {
      for (let y = -hd; y < hd; y += step) add(x, y, x, Math.min(hd, y + step));
    }
    for (let y = Math.ceil(-hd / spacing) * spacing; y <= hd; y += spacing) {
      for (let x = -hw; x < hw; x += step) add(x, y, Math.min(hw, x + step), y);
    }
    const seg = new LineSegments(new BufferGeometry(), this.gridMaterial);
    seg.geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    seg.frustumCulled = false;
    seg.renderOrder = 7;
    this.grid.add(seg);
  }

  /** The measured line, draped; null hides it */
  setMeasure(points: readonly MapPoint[] | null): void {
    if (!points || points.length < 2) {
      this.measure.visible = false;
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
    this.measure.geometry.dispose();
    this.measure.geometry = new BufferGeometry();
    this.measure.geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.measure.visible = true;
  }

  /** Guide lines for a symmetry mode across a map of this size */
  setSymmetry(mode: SymmetryMode, width: number, depth: number): void {
    clear(this.guides);
    if (mode === 'none') return;
    const hw = width / 2;
    const hd = depth / 2;
    const lines: [MapPoint, MapPoint][] = [];
    if (mode === 'x' || mode === 'xy' || mode === 'rot2' || mode === 'rot4') lines.push([{ x: 0, y: -hd }, { x: 0, y: hd }]);
    if (mode === 'y' || mode === 'xy' || mode === 'rot2' || mode === 'rot4') lines.push([{ x: -hw, y: 0 }, { x: hw, y: 0 }]);
    if (mode === 'rot4') {
      const m = Math.min(hw, hd);
      lines.push([{ x: -m, y: -m }, { x: m, y: m }], [{ x: -m, y: m }, { x: m, y: -m }]);
    }
    for (const [a, b] of lines) {
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      const pos = new Float32Array((steps + 1) * 3);
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const y = a.y + ((b.y - a.y) * k) / steps;
        pos.set([-x, this.height(x, y) + 0.8, y], k * 3);
      }
      const line = new Line(new BufferGeometry(), this.guideMaterial);
      line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      line.renderOrder = 8;
      line.frustumCulled = false;
      this.guides.add(line);
    }
  }

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
      const pos = drapedLine(r.points, this.walk, 1.6);
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
    for (const m of this.markers.children) {
      // A tag keeps its size on the screen and rides on top of its grown marker
      if (m instanceof Sprite) m.position.y = m.userData['ground'] + m.userData['lift'] * scale;
      else m.scale.setScalar(scale);
    }
    for (const n of this.nodes.children) if (n instanceof Mesh) n.scale.setScalar(n.userData['size'] * scale);
    if (this.lifeHandleAt.length) this.placeLifeHandles();
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
        m.makeScale(d, d, d).setPosition(-p.x, this.walk(p.x, p.y) + 1.8, p.y);
        dots.setMatrixAt(k++, m);
      }
    }
    for (; k < dots.count; k++) dots.setMatrixAt(k, m.makeScale(0, 0, 0));
    dots.instanceMatrix.needsUpdate = true;
  }

  /** What under the pointer is a marker: spawn or HQ */
  markerObjects(): Object3D[] {
    // Name tags are not picked (a sprite's raycast needs the camera on the raycaster)
    return this.markers.children.filter((c) => !(c instanceof Sprite));
  }

  dispose(): void {
    clear(this.markers);
    clear(this.nodes);
    clear(this.selection);
    clear(this.routes);
    clear(this.life);
    for (const m of this.lifeMaterials.values()) m.dispose();
    this.nodeGeometry.dispose();
    for (const t of this.tags.values()) {
      t.material.map?.dispose();
      t.material.dispose();
    }
    this.tags.clear();
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

/** RGBA of each BuildCell on the sheet: the game's build preview speaks green and red too */
const BUILD_COLORS: Record<number, readonly number[]> = (() => {
  const rgba = (hex: string, alpha: number) => {
    const c = new Color(hex);
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), alpha];
  };
  const blocked = rgba(TD_THEME.dangerEdge, 150);
  return {
    [BuildCell.Outside]: [0, 0, 0, 0],
    [BuildCell.InReach]: rgba(TD_THEME.greenDark, 150),
    [BuildCell.OutOfReach]: rgba(TD_THEME.green, 60),
    [BuildCell.Water]: blocked,
    [BuildCell.Object]: blocked,
    [BuildCell.Steep]: blocked,
    [BuildCell.Route]: rgba(TD_THEME.dangerEdge, 70),
    [BuildCell.Marker]: blocked,
  };
})();

function clear(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    // A name tag's geometry is three's own and its material is kept by the overlay (tags)
    if (child instanceof Sprite) continue;
    child.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry && mesh.geometry.type !== 'SphereGeometry') mesh.geometry.dispose();
    });
  }
}
