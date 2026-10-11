/**
 * The map in plain colours: a chunked height mesh tinted by the splat
 * weights (cliff colour on steep faces), a water sheet over the masked
 * cells, objects as instanced stand-in shapes by catalogue colour, paths as
 * ribbons. The editor uses it while the real renderer is not there; it
 * implements the same `EditorMapView`, so swapping is one line.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  type Camera,
  type Ray,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CustomMapDocument, MapPathKind } from '../../world/custom-map/map-document';
import type { CatalogIndex, ObjectShape } from '../catalog/asset-catalog';
import { heightAt, type GridRect } from '../model/grid';
import { MAX_LAYERS, readWeights } from '../ops/paint-ops';
import { edgePolyline, pointAt, polylineLength } from '../ops/path-graph';
import type { EditorMapView } from './map-view';

const CHUNK = 64;

interface Chunk {
  i0: number;
  j0: number;
  w: number;
  h: number;
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
}

export const SKY_PRESETS: Record<CustomMapDocument['environment']['sky'], { sky: string; ground: string; sun: string; fog: string; intensity: number }> = {
  day: { sky: '#9ec3dd', ground: '#5a5a48', sun: '#fff4e0', fog: '#b9cbd6', intensity: 2.4 },
  dusk: { sky: '#d99a6c', ground: '#3e3530', sun: '#ffb070', fog: '#b98a70', intensity: 1.6 },
  night: { sky: '#1c2433', ground: '#14161a', sun: '#9fb4d9', fog: '#1d2430', intensity: 0.5 },
  overcast: { sky: '#a7adb2', ground: '#55574f', sun: '#e8ecef', fog: '#a3a9ad', intensity: 1.2 },
};

const PATH_COLORS: Record<MapPathKind, string> = { road: '#a08463', path: '#8c7a5c', bridge: '#6f5a44' };

export class PlaceholderMapView implements EditorMapView {
  readonly group = new Group();
  readonly ready: Promise<void> = Promise.resolve();
  private readonly terrainGroup = new Group();
  private readonly objectGroup = new Group();
  private readonly pathGroup = new Group();
  private chunks: Chunk[] = [];
  private chunkCols = 0;
  private water: Mesh | null = null;
  private readonly terrainMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly waterMaterial = new MeshStandardMaterial({ transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1 });
  private readonly pathMaterials = new Map<MapPathKind, MeshLambertMaterial>();
  private readonly shapeGeometries = new Map<ObjectShape, BufferGeometry>();
  private readonly objectMaterials = new Map<string, MeshLambertMaterial>();
  private readonly hemi = new HemisphereLight();
  private readonly sun = new DirectionalLight();
  private layerColors: Color[] = [];
  private cliffColor = new Color();

  constructor(
    private readonly getDoc: () => CustomMapDocument,
    private readonly catalog: CatalogIndex,
    private readonly scene: Scene,
  ) {
    this.group.name = 'custom-map';
    this.group.add(this.terrainGroup, this.objectGroup, this.pathGroup, this.hemi, this.sun, this.sun.target);
    this.buildTerrain();
    this.setObjects();
    this.updatePaths();
    this.updateWater();
    this.setEnvironment();
  }

  private get doc(): CustomMapDocument {
    return this.getDoc();
  }

  heightAt(x: number, y: number): number {
    return heightAt(this.doc.terrain, x, y);
  }

  raycast(ray: Ray): { x: number; y: number; z: number } | null {
    return raycastHeightfield(this.doc, ray);
  }

  update(_dt: number, _camera: Camera): void {
    // Nothing streams or animates in the placeholder
  }

  /** Rebuild every chunk (new or resized terrain) */
  rebuild(): void {
    this.buildTerrain();
    this.setObjects();
    this.updatePaths();
    this.updateWater();
  }

  updateHeights(rect: GridRect): void {
    invalidateHeightBounds();
    this.refreshChunks(rect, 1);
    // Objects and paths stand on the ground: redo them when the change reaches them
    const t = this.doc.terrain;
    const g = t.grid;
    const x0 = -t.width / 2 + (rect.i0 - 1) * g.cellSize;
    const x1 = -t.width / 2 + (rect.i1 + 1) * g.cellSize;
    const y0 = -t.depth / 2 + (rect.j0 - 1) * g.cellSize;
    const y1 = -t.depth / 2 + (rect.j1 + 1) * g.cellSize;
    const inside = (p: { x: number; y: number }, pad = 0) => p.x >= x0 - pad && p.x <= x1 + pad && p.y >= y0 - pad && p.y <= y1 + pad;
    if (this.doc.objects.some((o) => inside(o))) this.setObjects();
    const paths = this.doc.paths;
    if (paths.edges.some((e) => edgePolyline(paths, e).some((p) => inside(p, 200)))) this.updatePaths();
  }

  updateSplat(rect: GridRect): void {
    const t = this.doc.terrain;
    const sx = (t.grid.columns - 1) / t.splat.resolution;
    const sy = (t.grid.rows - 1) / t.splat.resolution;
    this.refreshChunks(
      { i0: Math.floor(rect.i0 * sx), j0: Math.floor(rect.j0 * sy), i1: Math.ceil((rect.i1 + 1) * sx), j1: Math.ceil((rect.j1 + 1) * sy) },
      0,
    );
  }

  updateLayers(): void {
    this.readLayerColors();
    const t = this.doc.terrain;
    this.refreshChunks({ i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 }, 0);
  }

  updateWater(): void {
    if (this.water) {
      this.group.remove(this.water);
      this.water.geometry.dispose();
      this.water = null;
    }
    const t = this.doc.terrain;
    const w = t.water;
    if (!w) return;
    const g = t.grid;
    const pos: number[] = [];
    for (let j = 0; j < g.rows - 1; j++) {
      for (let i = 0; i < g.columns - 1; i++) {
        const k = j * g.columns + i;
        if (!(w.mask[k] || w.mask[k + 1] || w.mask[k + g.columns] || w.mask[k + g.columns + 1])) continue;
        const x0 = -t.width / 2 + i * g.cellSize;
        const y0 = -t.depth / 2 + j * g.cellSize;
        const x1 = x0 + g.cellSize;
        const y1 = y0 + g.cellSize;
        pos.push(-x0, w.level, y0, -x1, w.level, y0, -x1, w.level, y1, -x0, w.level, y0, -x1, w.level, y1, -x0, w.level, y1);
      }
    }
    if (!pos.length) return;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.computeVertexNormals();
    this.waterMaterial.color.set(w.color);
    this.water = new Mesh(geo, this.waterMaterial);
    this.water.name = 'water';
    this.water.renderOrder = 2;
    this.group.add(this.water);
  }

  setObjects(): void {
    for (const child of [...this.objectGroup.children]) {
      this.objectGroup.remove(child);
      (child as InstancedMesh).dispose();
    }
    const doc = this.doc;
    const byAsset = new Map<string, typeof doc.objects>();
    for (const o of doc.objects) {
      let list = byAsset.get(o.asset);
      if (!list) byAsset.set(o.asset, (list = []));
      list.push(o);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const p = new Vector3();
    const s = new Vector3();
    for (const [asset, list] of byAsset) {
      const entry = this.catalog.object(asset);
      const mesh = new InstancedMesh(this.shapeGeometry(entry.shape), this.objectMaterial(entry.color), list.length);
      mesh.name = `objects:${asset}`;
      list.forEach((o, k) => {
        q.setFromAxisAngle(up, o.rotation);
        p.set(-o.x, heightAt(doc.terrain, o.x, o.y) + o.z, o.y);
        s.set(entry.radius * o.scale, entry.height * o.scale, entry.radius * o.scale);
        mesh.setMatrixAt(k, m.compose(p, q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.objectGroup.add(mesh);
    }
  }

  updateObject(_id: string): void {
    this.setObjects();
  }

  updatePaths(): void {
    for (const child of [...this.pathGroup.children]) {
      this.pathGroup.remove(child);
      (child as Mesh).geometry.dispose();
    }
    const doc = this.doc;
    for (const edge of doc.paths.edges) {
      const line = edgePolyline(doc.paths, edge);
      const length = polylineLength(line);
      if (length < 0.1) continue;
      const steps = Math.max(1, Math.ceil(length / 2));
      const pos = new Float32Array((steps + 1) * 2 * 3);
      const index: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const a = pointAt(line, (length * k) / steps);
        const b = pointAt(line, Math.min(length, (length * k) / steps + 0.5));
        const c = pointAt(line, Math.max(0, (length * k) / steps - 0.5));
        let dx = b.x - c.x;
        let dy = b.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        const nx = -dy * (edge.width / 2);
        const ny = dx * (edge.width / 2);
        const lift = edge.kind === 'bridge' ? 0.6 : 0.12;
        const l = { x: a.x + nx, y: a.y + ny };
        const r = { x: a.x - nx, y: a.y - ny };
        const lh = edge.kind === 'bridge' ? this.bridgeHeight(a.x, a.y) : heightAt(doc.terrain, l.x, l.y);
        const rh = edge.kind === 'bridge' ? lh : heightAt(doc.terrain, r.x, r.y);
        pos.set([-l.x, lh + lift, l.y, -r.x, rh + lift, r.y], k * 6);
        if (k > 0) {
          const v = k * 2;
          index.push(v - 2, v - 1, v, v - 1, v + 1, v);
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const mesh = new Mesh(geo, this.pathMaterial(edge.kind));
      mesh.name = `path:${edge.id}`;
      mesh.renderOrder = 1;
      this.pathGroup.add(mesh);
    }
  }

  setEnvironment(): void {
    const env = this.doc.environment;
    const preset = SKY_PRESETS[env.sky] ?? SKY_PRESETS.day;
    const tint = new Color(env.tint);
    this.hemi.color.set(preset.sky).multiply(tint);
    this.hemi.groundColor.set(preset.ground);
    this.hemi.intensity = preset.intensity * 0.55;
    this.sun.color.set(preset.sun).multiply(tint);
    this.sun.intensity = preset.intensity;
    const az = (env.sunAzimuth * Math.PI) / 180;
    const el = (Math.max(1, env.sunElevation) * Math.PI) / 180;
    const r = Math.max(this.doc.terrain.width, this.doc.terrain.depth);
    // Azimuth from north (+z) clockwise toward east (-x)
    this.sun.position.set(-Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    this.sun.target.position.set(0, 0, 0);
    this.scene.background = new Color(preset.sky).multiply(tint);
    this.scene.fog = env.fogDensity > 0 ? new FogExp2(new Color(preset.fog).getHex(), env.fogDensity) : new Fog(0x000000, 1e9, 1e9 + 1);
  }

  triangles(): number {
    let n = 0;
    for (const c of this.chunks) n += (c.mesh.geometry.index?.count ?? 0) / 3;
    for (const child of this.pathGroup.children) n += ((child as Mesh).geometry.index?.count ?? 0) / 3;
    for (const child of this.objectGroup.children) {
      const mesh = child as InstancedMesh;
      n += ((mesh.geometry.index?.count ?? mesh.geometry.attributes['position'].count) / 3) * mesh.count;
    }
    if (this.water) n += this.water.geometry.attributes['position'].count / 3;
    return Math.round(n);
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    this.water?.geometry.dispose();
    for (const child of this.pathGroup.children) (child as Mesh).geometry.dispose();
    for (const child of this.objectGroup.children) (child as InstancedMesh).dispose();
    for (const g of this.shapeGeometries.values()) g.dispose();
    for (const m of this.objectMaterials.values()) m.dispose();
    for (const m of this.pathMaterials.values()) m.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.group.removeFromParent();
  }

  private bridgeHeight(x: number, y: number): number {
    const t = this.doc.terrain;
    return Math.max(heightAt(t, x, y), (t.water?.level ?? -Infinity) + 1);
  }

  private buildTerrain(): void {
    for (const c of this.chunks) {
      this.terrainGroup.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    this.chunks = [];
    this.readLayerColors();
    const g = this.doc.terrain.grid;
    const cells = { x: g.columns - 1, y: g.rows - 1 };
    this.chunkCols = Math.ceil(cells.x / CHUNK);
    const chunkRows = Math.ceil(cells.y / CHUNK);
    for (let cj = 0; cj < chunkRows; cj++) {
      for (let ci = 0; ci < this.chunkCols; ci++) {
        const i0 = ci * CHUNK;
        const j0 = cj * CHUNK;
        const w = Math.min(CHUNK, cells.x - i0);
        const h = Math.min(CHUNK, cells.y - j0);
        const verts = (w + 1) * (h + 1);
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('normal', new BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('color', new BufferAttribute(new Float32Array(verts * 3), 3));
        const index = new (verts > 65535 ? Uint32Array : Uint16Array)(w * h * 6);
        let n = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const a = y * (w + 1) + x;
            const b = a + 1;
            const c = a + (w + 1);
            const d = c + 1;
            index.set([a, b, c, b, d, c], n);
            n += 6;
          }
        }
        geo.setIndex(new BufferAttribute(index, 1));
        const mesh = new Mesh(geo, this.terrainMaterial);
        mesh.name = `terrain:${ci},${cj}`;
        const chunk = { i0, j0, w, h, mesh };
        this.chunks.push(chunk);
        this.terrainGroup.add(mesh);
        this.fillChunk(chunk);
      }
    }
  }

  private refreshChunks(rect: GridRect, pad: number): void {
    for (const c of this.chunks) {
      if (rect.i1 + pad < c.i0 || rect.i0 - pad > c.i0 + c.w || rect.j1 + pad < c.j0 || rect.j0 - pad > c.j0 + c.h) continue;
      this.fillChunk(c);
    }
  }

  private fillChunk(c: Chunk): void {
    const t = this.doc.terrain;
    const g = t.grid;
    const geo = c.mesh.geometry;
    const pos = geo.attributes['position'].array as Float32Array;
    const nor = geo.attributes['normal'].array as Float32Array;
    const col = geo.attributes['color'].array as Float32Array;
    const res = t.splat.resolution;
    const weights = new Float32Array(MAX_LAYERS);
    const cliffCos = Math.cos((t.cliffAngle * Math.PI) / 180);
    const tmp = new Color();
    const h = g.heights;
    const at = (i: number, j: number) => h[Math.min(g.rows - 1, Math.max(0, j)) * g.columns + Math.min(g.columns - 1, Math.max(0, i))];
    let v = 0;
    for (let y = 0; y <= c.h; y++) {
      const j = c.j0 + y;
      for (let x = 0; x <= c.w; x++) {
        const i = c.i0 + x;
        const hx = at(i, j);
        pos[v * 3] = -(-t.width / 2 + i * g.cellSize);
        pos[v * 3 + 1] = hx;
        pos[v * 3 + 2] = -t.depth / 2 + j * g.cellSize;
        // Normal from central differences, in scene axes (x is -east, z is north)
        const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * g.cellSize);
        const dy = (at(i, j + 1) - at(i, j - 1)) / (2 * g.cellSize);
        const len = Math.hypot(dx, 1, dy);
        const ny = 1 / len;
        nor[v * 3] = dx / len;
        nor[v * 3 + 1] = ny;
        nor[v * 3 + 2] = -dy / len;
        // Colour from the splat weights
        const u = Math.min(res - 1, Math.floor((i / (g.columns - 1)) * res));
        const s = Math.min(res - 1, Math.floor((j / (g.rows - 1)) * res));
        readWeights(t, s * res + u, weights);
        let r = 0;
        let gg = 0;
        let b = 0;
        let sum = 0;
        for (let k = 0; k < this.layerColors.length; k++) {
          const wk = weights[k];
          if (!wk) continue;
          r += this.layerColors[k].r * wk;
          gg += this.layerColors[k].g * wk;
          b += this.layerColors[k].b * wk;
          sum += wk;
        }
        tmp.setRGB(sum ? r / sum : 0.4, sum ? gg / sum : 0.4, sum ? b / sum : 0.4);
        if (ny < cliffCos) tmp.lerp(this.cliffColor, Math.min(1, (cliffCos - ny) * 8));
        col[v * 3] = tmp.r;
        col[v * 3 + 1] = tmp.g;
        col[v * 3 + 2] = tmp.b;
        v++;
      }
    }
    geo.attributes['position'].needsUpdate = true;
    geo.attributes['normal'].needsUpdate = true;
    geo.attributes['color'].needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  private readLayerColors(): void {
    const t = this.doc.terrain;
    this.layerColors = t.layers.map((l) => new Color(this.catalog.material(l.material).color));
    this.cliffColor = new Color(this.catalog.material(t.cliffMaterial).color);
  }

  private shapeGeometry(shape: ObjectShape): BufferGeometry {
    let geo = this.shapeGeometries.get(shape);
    if (geo) return geo;
    geo = buildShape(shape);
    this.shapeGeometries.set(shape, geo);
    return geo;
  }

  private objectMaterial(color: string): MeshLambertMaterial {
    let m = this.objectMaterials.get(color);
    if (!m) this.objectMaterials.set(color, (m = new MeshLambertMaterial({ color })));
    return m;
  }

  private pathMaterial(kind: MapPathKind): MeshLambertMaterial {
    let m = this.pathMaterials.get(kind);
    if (!m) {
      m = new MeshLambertMaterial({ color: PATH_COLORS[kind], side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.pathMaterials.set(kind, m);
    }
    return m;
  }
}

/** A unit stand-in (radius 1, height 1, standing on y = 0) for a shape */
function buildShape(shape: ObjectShape): BufferGeometry {
  const lift = (g: BufferGeometry, y: number) => g.translate(0, y, 0);
  switch (shape) {
    case 'tree': {
      const trunk = lift(new CylinderGeometry(0.12, 0.16, 0.45, 6), 0.225);
      const crown = lift(new IcosahedronGeometry(0.75, 0).scale(1, 0.75, 1), 0.68);
      return merge([trunk, crown]);
    }
    case 'pine': {
      const trunk = lift(new CylinderGeometry(0.08, 0.12, 0.25, 6), 0.125);
      const cone = lift(new ConeGeometry(1, 0.8, 7), 0.6);
      return merge([trunk, cone]);
    }
    case 'bush':
      return lift(new SphereGeometry(1, 7, 5).scale(1, 0.6, 1), 0.35);
    case 'rock':
      return lift(new DodecahedronGeometry(1, 0).scale(1, 0.6, 0.85), 0.3);
    case 'house': {
      const body = lift(new BoxGeometry(1.6, 0.6, 1.2), 0.3);
      const roof = lift(new ConeGeometry(1.15, 0.4, 4).rotateY(Math.PI / 4).scale(1.1, 1, 0.85), 0.8);
      return merge([body, roof]);
    }
    case 'tower':
      return lift(new CylinderGeometry(0.8, 1, 1, 8), 0.5);
    case 'wall':
      return lift(new BoxGeometry(2, 1, 0.3), 0.5);
    case 'crate':
      return lift(new BoxGeometry(1.4, 1, 1.4), 0.5);
    default:
      return lift(new BoxGeometry(1.4, 1, 1.4), 0.5);
  }
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of clean) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  return mergeGeometries(clean) ?? clean[0];
}

/**
 * Ray against the height field: march in steps of half a cell from where
 * the ray enters the map's box, then bisect the crossing. Map-space result.
 */
export function raycastHeightfield(doc: CustomMapDocument, ray: Ray): { x: number; y: number; z: number } | null {
  const t = doc.terrain;
  const { min: minH, max: maxH } = heightBounds(t.grid.heights);
  const o = ray.origin;
  const d = ray.direction;
  // Clip to the box [-w/2, w/2] x [minH, maxH] x [-d/2, d/2]
  let t0 = 0;
  let t1 = 1e6;
  const clip = (origin: number, dir: number, lo: number, hi: number): boolean => {
    if (Math.abs(dir) < 1e-9) return origin >= lo && origin <= hi;
    let a = (lo - origin) / dir;
    let b = (hi - origin) / dir;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!clip(o.x, d.x, -t.width / 2, t.width / 2)) return null;
  if (!clip(o.y, d.y, minH - 1, maxH + 1)) return null;
  if (!clip(o.z, d.z, -t.depth / 2, t.depth / 2)) return null;
  const step = t.grid.cellSize / 2;
  const above = (s: number) => o.y + d.y * s - heightAt(t, -(o.x + d.x * s), o.z + d.z * s);
  let prev = t0;
  if (above(prev) < 0) return toMap(o, d, prev);
  for (let s = t0 + step; s <= t1 + step; s += step) {
    const cur = Math.min(s, t1);
    if (above(cur) <= 0) {
      let lo = prev;
      let hi = cur;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return toMap(o, d, hi);
    }
    prev = cur;
    if (cur >= t1) break;
  }
  return null;
}

function toMap(o: Vector3, d: Vector3, s: number): { x: number; y: number; z: number } {
  return { x: -(o.x + d.x * s), y: o.z + d.z * s, z: o.y + d.y * s };
}

const boundsCache = new WeakMap<Float32Array, { min: number; max: number; stamp: number }>();
let boundsStamp = 0;

/** Call after heights change so the ray box grows with them */
export function invalidateHeightBounds(): void {
  boundsStamp++;
}

function heightBounds(h: Float32Array): { min: number; max: number } {
  const cached = boundsCache.get(h);
  if (cached && cached.stamp === boundsStamp) return cached;
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const b = { min, max, stamp: boundsStamp };
  boundsCache.set(h, b);
  return b;
}
