import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SPAWN_PORTAL_FRAME_URL } from './spawn-portal-frame';
import { SIGIL_LAYOUT, frameSigilCells } from './spawn-portal-sigils';
import { createPortalClipUniforms, setPortalClips } from '../portal-clip';
import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
} from '../../../configs/marker-geometry.config';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
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

  it('ist ein Bogen mittig um die Ebene, vor dem Routenstart: nichts reicht tiefer zurück', () => {
    const position = frame.getAttribute('position');
    const plane = PORTAL_DEPTH / 2;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
    expect(minZ).toBeGreaterThan(0);
    expect(Math.abs((minZ + maxZ) / 2 - plane)).toBeLessThan(0.3);
    // Die Stirnseiten mit den Sigillen: vorn so weit vor der Ebene wie hinten dahinter
    const mesh = new Mesh(frame, new MeshBasicMaterial({ side: DoubleSide }));
    const raycaster = new Raycaster();
    let middle = 0;
    const cells = frameSigilCells();
    for (const { x, y } of cells) {
      const [front, back] = [1, -1].map((side) => {
        raycaster.set(new Vector3(x, y, plane + 30 * side), new Vector3(0, 0, -side));
        return raycaster.intersectObject(mesh)[0].point.z;
      });
      expect(front - plane).toBeGreaterThan(1);
      middle += (front + back) / 2 / cells.length;
    }
    expect(middle).toBeCloseTo(plane, 1);
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
 * height, length along the way they walk (+z of the model), taken as
 * centred on their origin. Bounding boxes of their GLBs times `scale` in
 * enemy-types.config.ts, measured 2026-09-13, the tank 2026-09-15 (new
 * model, rounded up). The air units (bat, dragon, hornet) come through the
 * middle of the opening and climb away (utils/air-portal-exit.ts); the
 * dragon is wider than even the largest opening and, up to scale 1, taller.
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

describe('Spawn-Portal: Gegner stecken beim Start ganz hinter der Ebene, in der Clip-Box', () => {
  it.each([PORTAL_MIN_SCALE, 1, PORTAL_MAX_SCALE])('Skala %s: jeder Bodengegner mit Healthbar, auf jeder Spur seines Typs', (scale) => {
    // Das Portal auf dem Routenstart im Ursprung, nach +z gewandt
    const clip = createPortalClipUniforms();
    setPortalClips(clip, [{ x: 0, y: 0, z: 0, heading: 0, scale }]);
    const plane = clip.uPortalClipPlane.value[0].y;
    const [halfWidth, depth, bottom, top] = clip.uPortalClipBox.value[0].toArray();
    // Spuren wie EnemyManager und MovementComponent sie legen: bis zur
    // seitlichen Grenze des Korridors, dessen Breite die Skala gab, so weit
    // der Typ streut
    const room = lateralLimit((PORTAL_OPENING_WIDTH / 2) * scale);
    const outside: string[] = [];
    for (const [type, [width, height, length]] of Object.entries(GROUND_BODIES)) {
      const config = ENEMY_TYPES[type];
      const lane = room * (config.lateralSpread ?? 0);
      const lift = config.heightOffset;
      const inside = lane + width / 2 <= halfWidth
        && -length / 2 >= plane - depth && length / 2 <= plane
        && lift >= bottom && lift + Math.max(height, config.healthBarOffset) <= top;
      if (!inside) outside.push(type);
    }
    expect(outside).toEqual([]);
  });
});
