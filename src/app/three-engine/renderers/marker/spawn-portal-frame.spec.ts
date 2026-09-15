import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SPAWN_PORTAL_FRAME_URL } from './spawn-portal-frame';
import { createPortalGateGeometry } from './spawn-portal-geometry';
import { SIGIL_LAYOUT, frameSigilCells } from './spawn-portal-sigils';
import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
  portalDepthScale,
} from '../../../configs/marker-geometry.config';
import { lateralLimit } from '../../../utils/route-corridor';

/** The frame asset as the game serves it (tools/blender/spawn_portal.py). */
const GLB = readFileSync(resolve('public', SPAWN_PORTAL_FRAME_URL));

interface TextureRef {
  index: number;
}

interface GlbJson {
  images?: { mimeType: string; bufferView: number }[];
  textures?: { source: number }[];
  samplers?: unknown[];
  materials: {
    normalTexture?: TextureRef;
    occlusionTexture?: TextureRef;
    emissiveTexture?: TextureRef;
    pbrMetallicRoughness?: { baseColorTexture?: TextureRef; metallicRoughnessTexture?: TextureRef };
  }[];
}

function glbJson(bytes: Uint8Array): GlbJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}

/**
 * The GLB without its images: jsdom cannot decode them, and these specs
 * read the geometry only (as tools/model-budget/glb-node.mjs does).
 */
function withoutImages(bytes: Uint8Array): ArrayBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = glbJson(bytes);
  for (const m of json.materials) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.pbrMetallicRoughness;
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const head = new TextEncoder().encode(text);
  const rest = bytes.subarray(20 + jsonLength);
  const out = new Uint8Array(20 + head.length + rest.length);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12));
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, head.length, true);
  outView.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(head, 20);
  out.set(rest, 20 + head.length);
  return out.buffer;
}

async function loadFrameGeometry(): Promise<BufferGeometry> {
  const gltf = await new Promise<{ scene: Object3D }>((done, fail) => {
    new GLTFLoader().parse(withoutImages(GLB), '', done, fail);
  });
  let geometry: BufferGeometry | undefined;
  gltf.scene.traverse((node) => {
    if (!geometry && (node as Mesh).isMesh) geometry = (node as Mesh).geometry;
  });
  if (!geometry) throw new Error('Der Rahmen hat kein Mesh');
  return geometry;
}

/** Triangles as vertex index triples. */
function triangles(geometry: BufferGeometry): [number, number, number][] {
  const index = geometry.getIndex()!;
  const out: [number, number, number][] = [];
  for (let i = 0; i < index.count; i += 3) out.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
  return out;
}

/**
 * The frame's stones: vertices at the same position welded, triangles
 * joined through them. The flat faces split their corners, so the index
 * alone does not hold a stone together; separate stones share no corner.
 */
function stones(geometry: BufferGeometry): Int32Array {
  const position = geometry.getAttribute('position');
  const weld = new Map<string, number>();
  const at = new Int32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
    if (!weld.has(key)) weld.set(key, i);
    at[i] = weld.get(key)!;
  }
  const parent = new Int32Array(position.count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const [a, b, c] of triangles(geometry)) {
    parent[find(at[b])] = find(at[a]);
    parent[find(at[c])] = find(at[a]);
  }
  return at.map((i) => find(i));
}

/**
 * Any-hit ray casts against a triangle soup, its triangles binned in a
 * uniform grid and the ray walked through it cell by cell: the volume
 * specs cast tens of thousands of rays at the frame's thousands of
 * triangles, too many for three's Raycaster, which tests every triangle.
 */
class TriangleGrid {
  private readonly min: number[];
  private readonly max: number[];
  private readonly dims: number[];
  private readonly cells: number[][];

  /** `tri` holds 9 numbers per triangle; `cell` is the grid's pitch (m). */
  constructor(private readonly tri: Float32Array, private readonly cell = 1) {
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tri.length; i++) {
      this.min[i % 3] = Math.min(this.min[i % 3], tri[i]);
      this.max[i % 3] = Math.max(this.max[i % 3], tri[i]);
    }
    for (let k = 0; k < 3; k++) {
      this.min[k] -= 1e-3;
      this.max[k] += 1e-3;
    }
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((this.max[k] - this.min[k]) / cell)));
    this.cells = Array.from({ length: this.dims[0] * this.dims[1] * this.dims[2] }, () => []);
    for (let t = 0; t < tri.length / 9; t++) {
      const lo = [0, 1, 2].map((k) => this.index(k, Math.min(tri[9 * t + k], tri[9 * t + 3 + k], tri[9 * t + 6 + k])));
      const hi = [0, 1, 2].map((k) => this.index(k, Math.max(tri[9 * t + k], tri[9 * t + 3 + k], tri[9 * t + 6 + k])));
      for (let x = lo[0]; x <= hi[0]; x++) {
        for (let y = lo[1]; y <= hi[1]; y++) {
          for (let z = lo[2]; z <= hi[2]; z++) this.cells[(z * this.dims[1] + y) * this.dims[0] + x].push(t);
        }
      }
    }
  }

  private index(axis: number, value: number): number {
    return Math.min(this.dims[axis] - 1, Math.max(0, Math.floor((value - this.min[axis]) / this.cell)));
  }

  /** Whether the ray from `o` along `d` (unit) hits a triangle within `far`. */
  hits(o: Vector3, d: Vector3, far: number): boolean {
    const origin = [o.x, o.y, o.z];
    const dir = [d.x, d.y, d.z];
    let t0 = 0;
    let t1 = far;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dir[k]) < 1e-12) {
        if (origin[k] < this.min[k] || origin[k] > this.max[k]) return false;
        continue;
      }
      const a = (this.min[k] - origin[k]) / dir[k];
      const b = (this.max[k] - origin[k]) / dir[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return false;
    }
    const cell = [0, 1, 2].map((k) => this.index(k, origin[k] + dir[k] * t0));
    const step = dir.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const next = [0, 1, 2].map((k) => {
      if (step[k] === 0) return Infinity;
      const edge = this.min[k] + (cell[k] + (step[k] > 0 ? 1 : 0)) * this.cell;
      return (edge - origin[k]) / dir[k];
    });
    const delta = dir.map((v) => (v === 0 ? Infinity : this.cell / Math.abs(v)));
    for (;;) {
      for (const t of this.cells[(cell[2] * this.dims[1] + cell[1]) * this.dims[0] + cell[0]]) {
        const hit = this.rayTriangle(origin, dir, t);
        if (hit > 1e-6 && hit <= far) return true;
      }
      const k = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
      if (next[k] > t1) return false;
      cell[k] += step[k];
      if (cell[k] < 0 || cell[k] >= this.dims[k]) return false;
      next[k] += delta[k];
    }
  }

  /** Distance along the ray to triangle `t` (Möller-Trumbore, both sides), -1 without a hit. */
  private rayTriangle(o: number[], d: number[], t: number): number {
    const p = this.tri;
    const i = 9 * t;
    const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
    const e2 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const s = [o[0] - p[i], o[1] - p[i + 1], o[2] - p[i + 2]];
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) * inv;
    if (u < 0 || u > 1) return -1;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  }
}

let frame: BufferGeometry;

beforeAll(async () => {
  frame = await loadFrameGeometry();
});

describe('Spawn-Portal-Rahmen (GLB)', () => {
  it('bleibt in den Maßen, mit denen Intro und Totale rechnen', () => {
    const position = frame.getAttribute('position');
    let top = -Infinity;
    let radius = 0;
    for (let i = 0; i < position.count; i++) {
      top = Math.max(top, position.getY(i));
      radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
    }
    expect(top).toBeCloseTo(PORTAL_FRAME_TOP, 5);
    expect(radius).toBeLessThanOrEqual(PORTAL_RADIUS);
    // Nicht bloß darunter: der Radius liegt dicht an den Plinthen
    expect(radius).toBeGreaterThan(PORTAL_RADIUS - 0.5);
  });

  it('lässt die Öffnung frei: kein Rahmenteil zwischen den Pfeilern unterhalb des Sturzes', () => {
    const position = frame.getAttribute('position');
    const centroid = new Vector3();
    const corner = new Vector3();
    const inOpening: string[] = [];
    for (const triangle of triangles(frame)) {
      centroid.set(0, 0, 0);
      for (const i of triangle) centroid.add(corner.fromBufferAttribute(position, i));
      centroid.divideScalar(3);
      if (Math.abs(centroid.x) < PORTAL_OPENING_WIDTH / 2 - 0.2 && centroid.y > 1.5 && centroid.y < PORTAL_OPENING_HEIGHT - 0.1) {
        inOpening.push(centroid.toArray().map((v) => v.toFixed(2)).join(', '));
      }
    }
    expect(inOpening).toEqual([]);
  });

  it('macht Pfeiler und Sturz tiefer als das Volumen: sie stehen vor und hinter den Flächen', () => {
    const position = frame.getAttribute('position');
    let minZ = 0;
    let maxZ = 0;
    for (let i = 0; i < position.count; i++) {
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
    expect(maxZ).toBeGreaterThan(PORTAL_DEPTH / 2 + 0.2);
    expect(minZ).toBeLessThan(-PORTAL_DEPTH / 2 - 0.2);
  });

  it('dreht die Flächen nach außen und trägt Tangenten für die Normal-Map', () => {
    const position = frame.getAttribute('position');
    const normal = frame.getAttribute('normal');
    const tangent = frame.getAttribute('tangent');
    expect(tangent.itemSize).toBe(4);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const m = new Vector3();
    let inward = 0;
    for (const [i, j, k] of triangles(frame)) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, j).sub(a);
      c.fromBufferAttribute(position, k).sub(a);
      const face = b.cross(c);
      if (face.lengthSq() < 1e-12) continue;
      n.fromBufferAttribute(normal, i).add(m.fromBufferAttribute(normal, j)).add(m.fromBufferAttribute(normal, k));
      if (face.dot(n) <= 0) inward++;
    }
    expect(inward).toBe(0);
    let skewed = 0;
    for (let i = 0; i < tangent.count; i++) {
      a.fromBufferAttribute(tangent, i);
      n.fromBufferAttribute(normal, i);
      if (Math.abs(a.length() - 1) > 1e-3 || Math.abs(a.dot(n)) > 0.05 || Math.abs(tangent.getW(i)) !== 1) skewed++;
    }
    expect(skewed).toBe(0);
  });

  it('bringt seine vier Texturen mit, schlank genug für den Download', () => {
    const json = glbJson(GLB);
    const material = json.materials[0];
    const source = (ref?: TextureRef) => (ref ? json.textures![ref.index].source : undefined);
    const maps = [
      source(material.pbrMetallicRoughness?.baseColorTexture),
      source(material.normalTexture),
      source(material.occlusionTexture),
      source(material.emissiveTexture),
    ];
    expect(maps.every((image) => image !== undefined)).toBe(true);
    expect(new Set(maps).size).toBe(4);
    // Verdeckung, Rauheit und Metall in einem Bild
    expect(source(material.pbrMetallicRoughness?.metallicRoughnessTexture)).toBe(source(material.occlusionTexture));
    // Die Emissive-Karte trägt Daten (Glühmaske der Sigillen, Strichfolge, Risse): verlustfrei
    expect(json.images![source(material.emissiveTexture)!].mimeType).toBe('image/png');
    expect(GLB.byteLength).toBeLessThan(3 * 1024 * 1024);
  });

  it('setzt jede Sigille ganz auf die Stirnseite eines Steins, vorn und hinten, ohne Fuge hindurch', () => {
    const stone = stones(frame);
    const mesh = new Mesh(frame, new MeshBasicMaterial({ side: DoubleSide }));
    const raycaster = new Raycaster();
    const half = 0.46 * SIGIL_LAYOUT.size;
    for (const { x, y } of frameSigilCells()) {
      for (const side of [1, -1]) {
        const hit = new Set<number>();
        for (const [dx, dy] of [[-half, -half], [half, -half], [-half, half], [half, half], [0, 0]]) {
          raycaster.set(new Vector3(x + dx, y + dy, 30 * side), new Vector3(0, 0, -side));
          const first = raycaster.intersectObject(mesh)[0];
          expect(first, `Zelle bei (${x}, ${y})`).toBeDefined();
          expect(first.face!.normal.z * side).toBeGreaterThan(0.6);
          hit.add(stone[first.face!.a]);
        }
        expect(hit.size, `Fuge durch die Sigille bei (${x}, ${y}), Seite ${side}`).toBe(1);
      }
    }
  });
});

/**
 * Bodies of the ground enemies at their config scale (m): width across,
 * height, length along the way they walk (+z of the model). Bounding boxes
 * of their GLBs times `scale` in enemy-types.config.ts, measured
 * 2026-09-13, the tank 2026-09-15 (new model, rounded up). The air units (bat, dragon, hornet) come through the middle
 * of the opening and climb away (utils/air-portal-exit.ts); the dragon is
 * wider than even the largest opening and, up to scale 1, taller.
 */
const GROUND_BODIES: Record<string, readonly [number, number, number]> = {
  zombie: [2.2, 4.2, 1.9],
  'zombie-v2': [3.6, 4.1, 0.8],
  tank: [4.8, 3.1, 6.7],
  wallsmasher: [11.0, 5.8, 2.4],
  'stone-golem': [12.6, 12.4, 7.1],
  penguin: [1.9, 2.3, 1.3],
  herbert: [2.4, 4.4, 1.2],
  'zombie-soldier': [2.4, 4.6, 0.9],
  rat: [1.9, 0.6, 0.4],
  skeleton: [3.0, 2.8, 1.3],
  'skeleton-minion': [1.8, 1.7, 0.8],
  spider: [3.7, 4.2, 0.9],
  mammoth: [9.9, 6.4, 3.3],
  bear: [5.8, 3.7, 2.6],
  ghost: [2.3, 3.7, 2.6],
  mech: [7.6, 11.7, 9.3],
  wraith: [1.5, 3.4, 1.3],
};

describe('Spawn-Portal: Gegner stehen im Volumen, bis sie vorn heraustreten', () => {
  /** Das Tor aus Rahmen und Leere wie im Spiel: auf der Pose, die Tiefe nicht unter Skala 1. */
  function gate(scale: number): TriangleGrid {
    const geometry = createPortalGateGeometry(frame).toNonIndexed();
    const position = geometry.getAttribute('position');
    const soup = new Float32Array(position.count * 3);
    const depth = portalDepthScale(scale);
    for (let i = 0; i < position.count; i++) {
      soup[3 * i] = position.getX(i) * scale;
      soup[3 * i + 1] = position.getY(i) * scale;
      soup[3 * i + 2] = position.getZ(i) * depth;
    }
    return new TriangleGrid(soup);
  }

  /**
   * Punkte eines Körpers am Spawn, der Mitte des Portals: seine Box um die
   * Spur `lane` quer zur Öffnung, vom Boden bis zu seiner Höhe, über seine
   * Länge vor und hinter der Mitte.
   */
  function bodyPoints([width, height, length]: readonly [number, number, number], lane: number): Vector3[] {
    const points: Vector3[] = [];
    for (const x of [lane - width / 2, lane, lane + width / 2]) {
      for (const y of [0.2, height / 2, height]) {
        for (const z of [-length / 2, 0, length / 2]) points.push(new Vector3(x, y, z));
      }
    }
    return points;
  }

  /** Blickrichtungen rundum: vorn, seitlich, hinten, flach bis steil von oben. */
  function allAround(): Vector3[] {
    const dirs: Vector3[] = [];
    for (let azimuth = 0; azimuth < 360; azimuth += 45) {
      for (const elevation of [5, 30, 60, 85]) {
        const a = (azimuth * Math.PI) / 180;
        const e = (elevation * Math.PI) / 180;
        dirs.push(new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)));
      }
    }
    dirs.push(new Vector3(0, 1, 0));
    return dirs;
  }

  /** Gegner, die von irgendwo zu sehen wären, bevor sie vorn heraustreten. */
  function seen(scale: number): string[] {
    const grid = gate(scale);
    // Spuren wie EnemyManager und MovementComponent sie legen: bis zur
    // seitlichen Grenze des Korridors, dessen Breite die Skala gab
    const lane = lateralLimit((PORTAL_OPENING_WIDTH / 2) * scale);
    const out = new Set<string>();
    for (const [type, body] of Object.entries(GROUND_BODIES)) {
      // Breite Körper gehen mittig heraus, schmale auf jeder Spur
      const lanes = body[0] / 2 + lane <= (PORTAL_OPENING_WIDTH / 2) * scale ? [-lane, 0, lane] : [0];
      for (const x of lanes) {
        for (const point of bodyPoints(body, x)) {
          for (const dir of allAround()) {
            if (!grid.hits(point, dir, 300)) out.add(type);
          }
        }
      }
    }
    return [...out].sort();
  }

  it('prüft mit dem Gitter dasselbe wie three: Treffer und Fehlschüsse am Tor', () => {
    const geometry = createPortalGateGeometry(frame);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const grid = gate(1);
    const raycaster = new Raycaster();
    raycaster.far = 300;
    let hits = 0;
    let misses = 0;
    for (const origin of [new Vector3(0, 3, 0), new Vector3(9, 2, 9), new Vector3(-3, 12, -8), new Vector3(0, 25, 0)]) {
      for (const dir of allAround()) {
        raycaster.set(origin, dir);
        const three = raycaster.intersectObject(mesh).length > 0;
        expect(grid.hits(origin, dir, 300), `${origin.toArray()} -> ${dir.toArray()}`).toBe(three);
        if (three) hits++;
        else misses++;
      }
    }
    expect(hits).toBeGreaterThan(20);
    expect(misses).toBeGreaterThan(20);
  });

  it('verbirgt jeden Bodengegner von allen Seiten, auch von hinten (Skala 1)', () => {
    expect(seen(1)).toEqual([]);
  });

  it('verbirgt jeden Bodengegner von allen Seiten, auch von hinten (größtes Portal)', () => {
    expect(seen(PORTAL_MAX_SCALE)).toEqual([]);
  });

  it('verbirgt im kleinsten Portal alle bis auf die, die breiter oder höher sind als das Tor', () => {
    // Skala 0,75 (Gasse): Öffnung 6 × 8,25 m, Sturzoberkante 10,5 m; die
    // Tiefe bleibt die von Skala 1
    expect(seen(PORTAL_MIN_SCALE)).toEqual(['mammoth', 'mech', 'stone-golem', 'wallsmasher']);
  });
});
