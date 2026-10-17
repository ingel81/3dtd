/**
 * The overlay's layers that show the document itself: spawns and the HQ
 * with their names, the path nodes and every road as a line, the selection,
 * and the routes from each spawn to the HQ with moving dots. The view keeps
 * them in step with the document (ChangeApplier). Spawn colours are the
 * game's lane colours.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
} from 'three';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { TD_THEME } from '../../../styles/td-theme';
import type { CustomMapDocument, MapPoint } from '../../../world/custom-map/map-document';
import { pointAt, polylineLength, type Route } from '../../../map-ops/path-graph';
import { selectedEdges, selectedNodes, selectedSpawns, type Selection } from '../../model/editor-document';
import { RING_SEGMENTS, clearGroup, drape, drapedLine, relift, ring, type GroundHeight, type OverlayLayer } from './draping';

const ROUTE_DOT_SPACING = 40;
/** Metres per second the dots move, about a fast enemy */
const ROUTE_DOT_SPEED = 28;
/** Radius in metres of a path node outside the Paths tool: a dot on the road that does not grow from far */
const NODE_DOT = 0.6;

/** Spawns, HQ, path nodes and roads */
export class MarkerLayer implements OverlayLayer {
  /** Spawns and the HQ with their name tags */
  readonly markers = new Group();
  /** Path nodes and the roads' lines */
  readonly nodes = new Group();
  /** The path nodes as instances: map x, y and scene height per node, and its size as a handle */
  private nodeSets: { mesh: InstancedMesh; at: Float64Array; size: Float32Array }[] = [];
  /** Name tag pictures by colour and text, kept while the layer lives */
  private readonly tags = new Map<string, { material: SpriteMaterial; width: number }>();
  private readonly nodeMaterial = new MeshBasicMaterial({ color: TD_THEME.knobLight, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly nodeSelected = new MeshBasicMaterial({ color: TD_THEME.brass, depthTest: false });
  /** Every road as a line while the nodes show: a road under another or one that was bent away stays in sight */
  private readonly edgeMaterial = new LineBasicMaterial({ color: TD_THEME.knobLight, depthTest: false, transparent: true, opacity: 0.55 });
  /** Markers and handles grow with the view distance so they keep a size on screen */
  private scaleNow = 1;
  /** Path nodes as handles that grow with the view distance (the Paths tool), else as small dots of a fixed size */
  private nodeHandles = false;

  constructor(
    private readonly height: GroundHeight,
    private readonly walk: GroundHeight,
    private readonly sphere: BufferGeometry,
  ) {}

  /** Spawns, HQ and path nodes from the document */
  set(doc: CustomMapDocument, selection: Selection): void {
    clearGroup(this.markers);
    const spawns = new Set(selectedSpawns(selection));
    const nodes = new Set(selectedNodes(selection));
    const scale = this.scaleNow;
    doc.spawns.forEach((s, k) => {
      const color = new Color(SPAWN_COLORS[k % SPAWN_COLORS.length]);
      const marker = spawnMarker(color, spawns.has(s.id));
      marker.position.set(-s.x, this.height(s.x, s.y), s.y);
      marker.scale.setScalar(scale);
      marker.userData = { pick: { kind: 'spawn', id: s.id } };
      this.markers.add(marker);
      this.markers.add(this.nameTag(s.name, '#' + color.getHexString(), -s.x, this.height(s.x, s.y), 22, scale, s.y));
    });
    const hq = hqMarker(selection?.kind === 'hq');
    hq.position.set(-doc.hq.x, this.height(doc.hq.x, doc.hq.y), doc.hq.y);
    hq.scale.setScalar(scale);
    hq.userData = { pick: { kind: 'hq' } };
    this.markers.add(hq);
    this.markers.add(this.nameTag('HQ', TD_THEME.brassLight, -doc.hq.x, this.height(doc.hq.x, doc.hq.y), 18, scale, doc.hq.y));

    clearGroup(this.nodes);
    this.nodeSets = [];
    const paths = doc.paths;
    const degree = new Map<string, number>();
    for (const e of paths.edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    // One instance per node: the chosen ones in brass, the rest in their own set
    for (const chosen of [false, true]) {
      const list = paths.nodes.filter((n) => nodes.has(n.id) === chosen);
      if (!list.length) continue;
      const mesh = new InstancedMesh(this.sphere, chosen ? this.nodeSelected : this.nodeMaterial, list.length);
      mesh.renderOrder = 11;
      mesh.frustumCulled = false;
      const at = new Float64Array(list.length * 3);
      const size = new Float32Array(list.length);
      list.forEach((n, k) => {
        at.set([n.x, n.y, this.height(n.x, n.y) + 1], k * 3);
        size[k] = (degree.get(n.id) ?? 0) > 2 ? 2.4 : 1.8;
      });
      this.nodeSets.push({ mesh, at, size });
      this.nodes.add(mesh);
    }
    // Every road in one set of segments
    const byId = new Map(paths.nodes.map((n) => [n.id, n]));
    const pieces: Float32Array[] = [];
    let count = 0;
    for (const e of paths.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      const strip = drapedLine([a, ...(e.via ?? []), b], this.walk, 1);
      pieces.push(strip);
      count += strip.length / 3 - 1;
    }
    if (count > 0) {
      const pos = new Float32Array(count * 6);
      let o = 0;
      for (const strip of pieces) {
        for (let k = 3; k < strip.length; k += 3, o += 6) {
          pos.set(strip.subarray(k - 3, k + 3), o);
        }
      }
      const lines = new LineSegments(new BufferGeometry(), this.edgeMaterial);
      lines.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      lines.renderOrder = 10;
      lines.frustumCulled = false;
      this.nodes.add(lines);
    }
    this.scaleNodes();
  }

  /**
   * Path nodes as handles (the Paths tool) or as small dots that keep their size on the map: an OSM map's
   * thousands of nodes as handles would cover it from far. A selected node is a handle either way.
   */
  setNodeHandles(on: boolean): void {
    if (this.nodeHandles === on) return;
    this.nodeHandles = on;
    this.scaleNodes();
  }

  /** Markers and handles at this scale (EditorOverlay.setViewDistance) */
  setScale(scale: number): void {
    this.scaleNow = scale;
    for (const m of this.markers.children) {
      // A tag keeps its size on the screen and rides on top of its grown marker
      if (m instanceof Sprite) m.position.y = m.userData['ground'] + m.userData['lift'] * scale;
      else m.scale.setScalar(scale);
    }
    this.scaleNodes();
  }

  /** The ground moved: markers, nodes and roads take the new heights where they stand */
  redrape(): void {
    for (const m of this.markers.children) {
      const ground = this.height(-m.position.x, m.position.z);
      if (m instanceof Sprite) {
        m.userData['ground'] = ground;
        m.position.y = ground + m.userData['lift'] * this.scaleNow;
      } else {
        m.position.y = ground;
      }
    }
    for (const set of this.nodeSets) {
      for (let k = 0; k < set.mesh.count; k++) set.at[k * 3 + 2] = this.height(set.at[k * 3], set.at[k * 3 + 1]) + 1;
    }
    this.scaleNodes();
    for (const o of this.nodes.children) if (o instanceof LineSegments) relift(o, this.walk, 1);
  }

  clear(): void {
    clearGroup(this.markers);
    clearGroup(this.nodes);
    this.nodeSets = [];
  }

  dispose(): void {
    this.clear();
    for (const t of this.tags.values()) {
      t.material.map?.dispose();
      t.material.dispose();
    }
    this.tags.clear();
  }

  /** Writes the nodes' instances: position over the ground, size as handle or dot */
  private scaleNodes(): void {
    const m = new Matrix4();
    for (const set of this.nodeSets) {
      const handle = this.nodeHandles || set.mesh.material === this.nodeSelected;
      for (let k = 0; k < set.mesh.count; k++) {
        const s = handle ? set.size[k] * this.scaleNow : NODE_DOT;
        m.makeScale(s, s, s).setPosition(-set.at[k * 3], set.at[k * 3 + 2], set.at[k * 3 + 1]);
        set.mesh.setMatrixAt(k, m);
      }
      set.mesh.instanceMatrix.needsUpdate = true;
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
}

/** Rings around selected objects, a line along a selected road */
export class SelectionLayer implements OverlayLayer {
  readonly group = new Group();
  private readonly material = new LineBasicMaterial({ color: TD_THEME.brassLight, depthTest: false, transparent: true });

  constructor(
    private readonly height: GroundHeight,
    private readonly walk: GroundHeight,
  ) {}

  set(doc: CustomMapDocument, selection: Selection, radiusOf: (asset: string) => number): void {
    clearGroup(this.group);
    if (selection?.kind === 'objects') {
      const ids = new Set(selection.ids);
      for (const o of doc.objects) {
        if (!ids.has(o.id)) continue;
        const r = ring(TD_THEME.brassLight, 1);
        r.material = this.material;
        drape(r, o, Math.max(1, radiusOf(o.asset) * o.scale * 1.15), this.height);
        this.group.add(r);
      }
    }
    for (const id of selectedEdges(selection)) {
      const edge = doc.paths.edges.find((e) => e.id === id);
      if (edge) {
        const a = doc.paths.nodes.find((n) => n.id === edge.a);
        const b = doc.paths.nodes.find((n) => n.id === edge.b);
        if (a && b) {
          const line = new Line(new BufferGeometry(), this.material);
          const pos = drapedLine([a, ...(edge.via ?? []), b], this.walk, 1.2);
          line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
          line.renderOrder = 10;
          this.group.add(line);
        }
      }
    }
  }

  redrape(): void {
    for (const o of this.group.children) {
      if (o instanceof LineLoop) relift(o, this.height, 0.4);
      else if (o instanceof Line) relift(o, this.walk, 1.2);
    }
  }

  clear(): void {
    clearGroup(this.group);
  }

  dispose(): void {
    this.clear();
  }
}

/** The routes to show, with dots moving along them toward the HQ */
export class RouteLayer implements OverlayLayer {
  readonly group = new Group();
  private readonly lineMaterial = new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true, opacity: 0.7 });
  private readonly dotMaterial = new MeshBasicMaterial({ color: TD_THEME.tealLight, depthTest: false });
  private dots: InstancedMesh | null = null;
  private paths: { points: MapPoint[]; length: number }[] = [];
  private time = 0;
  /** Dots keep a size on screen */
  scale = 1;

  constructor(
    private readonly walk: GroundHeight,
    private readonly sphere: BufferGeometry,
  ) {}

  set(routes: readonly (Route | null)[]): void {
    this.clear();
    let dots = 0;
    for (const r of routes) {
      if (!r || r.points.length < 2) continue;
      const pos = drapedLine(r.points, this.walk, 1.6);
      const line = new Line(new BufferGeometry(), this.lineMaterial);
      line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      line.renderOrder = 9;
      line.frustumCulled = false;
      this.group.add(line);
      const length = polylineLength(r.points);
      this.paths.push({ points: r.points, length });
      dots += Math.floor(length / ROUTE_DOT_SPACING) + 1;
    }
    if (!dots) return;
    this.dots = new InstancedMesh(this.sphere, this.dotMaterial, Math.min(dots, 4000));
    this.dots.renderOrder = 12;
    this.dots.frustumCulled = false;
    this.group.add(this.dots);
    this.update(0);
  }

  /** Moves the dots along the routes, spawn to HQ */
  update(dt: number): void {
    const dots = this.dots;
    if (!dots) return;
    this.time += dt;
    const shift = (this.time * ROUTE_DOT_SPEED) % ROUTE_DOT_SPACING;
    const m = new Matrix4();
    let k = 0;
    for (const r of this.paths) {
      for (let along = shift; along <= r.length && k < dots.count; along += ROUTE_DOT_SPACING) {
        const p = pointAt(r.points, along);
        const d = 0.9 * this.scale;
        m.makeScale(d, d, d).setPosition(-p.x, this.walk(p.x, p.y) + 1.8, p.y);
        dots.setMatrixAt(k++, m);
      }
    }
    for (; k < dots.count; k++) dots.setMatrixAt(k, m.makeScale(0, 0, 0));
    dots.instanceMatrix.needsUpdate = true;
  }

  redrape(): void {
    for (const o of this.group.children) if (o instanceof Line) relift(o, this.walk, 1.6);
  }

  clear(): void {
    clearGroup(this.group);
    this.dots = null;
    this.paths = [];
  }

  dispose(): void {
    this.clear();
  }
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
