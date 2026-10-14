/**
 * Pictures for the palettes, rendered: objects with their real model seen
 * from above at an angle, ground materials as a lit ball with their
 * texture, biomes as a small patch of their ground with a few of their
 * plants. One small offscreen renderer draws them one after another; the
 * pictures are kept in memory and in IndexedDB (`3dtd-editor-thumbs`), keyed
 * by the asset's files so a new model draws a new picture.
 *
 * Drawing stays off the editor's frames: one picture per idle moment of the
 * page (requestIdleCallback), the programs of a picture compiled ahead
 * without blocking (compileAsync, parallel where the driver can), and the
 * picture taken as an image bitmap and encoded off the main thread
 * (OffscreenCanvas.convertToBlob) instead of a canvas toBlob, which reads the
 * pixels back while the page waits.
 */
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { idle } from './idle';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CatalogIndex, GroundMaterialEntry, ObjectAssetEntry } from '../catalog/asset-catalog';
import type { BiomeDef } from '../ops/landscape/biomes';
import { hashCell } from '../ops/landscape/landscape-noise';

const SIZE = 128;
const DB_NAME = '3dtd-editor-thumbs';
const STORE = 'thumbs';
/** Bump when the pictures should be drawn anew (camera, light) */
const VERSION = 2;

interface Job { key: string; draw: () => Promise<void> }

export class ThumbnailRenderer {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.05, 2000);
  private readonly pictures = new Map<string, string>();
  private readonly queued = new Set<string>();
  private readonly jobs: Job[] = [];
  private running = false;
  private db: Promise<IDBDatabase | null> | null = null;
  private loaded: Promise<void>;
  private readonly loader = new TextureLoader();
  /** The picture being drawn */
  private currentKey = '';
  private readonly encoder = new PngEncoder();
  /**
   * The materials of the ground balls and biome patches, kept and set up for
   * each picture: one disposed after its picture took its program with it,
   * and the next picture linked it again, over half a second on the page
   */
  private readonly swatches = {
    plain: new MeshStandardMaterial(),
    textured: new MeshStandardMaterial({ color: 0xffffff }),
  };

  constructor(
    private readonly onPicture: () => void,
    private readonly library = MapAssetLibrary.shared(),
  ) {
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x4a4030, 2.2), new AmbientLight(0xffffff, 0.5));
    const sun = new DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(-3, 5, 4);
    this.scene.add(sun);
    this.loaded = this.loadStored();
  }

  /** The rendered picture of an object, or undefined while it is drawn */
  object(entry: ObjectAssetEntry): string | undefined {
    const key = `o:${VERSION}:${entry.id}:${entry.model ?? ''}`;
    return this.picture(key, () => this.drawObject(entry));
  }

  material(entry: GroundMaterialEntry): string | undefined {
    const key = `m:${VERSION}:${entry.id}:${entry.thumbnail ?? entry.color}`;
    return this.picture(key, () => this.drawMaterial(entry));
  }

  biome(biome: BiomeDef, catalog: CatalogIndex): string | undefined {
    const ground = biome.ground[0].material.find((m) => catalog.materials.has(m));
    const assets = biome.objects.map((o) => o.assets.find((a) => catalog.objects.has(a)) ?? '').join(',');
    const key = `b:${VERSION}:${biome.id}:${ground}:${assets}`;
    return this.picture(key, () => this.drawBiome(biome, catalog));
  }

  dispose(): void {
    this.encoder.dispose();
    this.swatches.plain.dispose();
    this.swatches.textured.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.jobs.length = 0;
  }

  private picture(key: string, draw: () => Promise<void>): string | undefined {
    const hit = this.pictures.get(key);
    if (hit) return hit;
    if (!this.queued.has(key)) {
      this.queued.add(key);
      this.jobs.push({ key, draw });
      void this.run();
    }
    return undefined;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loaded;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        if (this.pictures.has(job.key)) {
          this.onPicture();
          continue;
        }
        try {
          this.currentKey = job.key;
          await job.draw();
        } catch {
          // A model that does not load keeps its drawn symbol
        }
        // One picture per idle moment: the editor's frames come first
        await idle();
      }
    } finally {
      this.running = false;
    }
  }

  private get gl(): WebGLRenderer {
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(SIZE, SIZE, false);
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    return this.renderer;
  }

  /** Renders `content` from a camera that frames `box`, stores the picture */
  private async shoot(content: Group, box: Box3, elevation = 0.55, azimuth = 0.7): Promise<void> {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const radius = Math.max(0.01, size.length() / 2);
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.92;
    this.camera.position.set(
      center.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      center.y + Math.sin(elevation) * distance,
      center.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    this.camera.near = distance / 50;
    this.camera.far = distance * 4;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.scene.add(content);
    const gl = this.gl;
    const key = this.currentKey;
    try {
      // New programs compile in the background; the render then finds them ready
      await gl.compileAsync(this.scene, this.camera);
      await idle();
      gl.render(this.scene, this.camera);
    } finally {
      this.scene.remove(content);
    }
    const blob = await this.encoder.encode(gl.domElement);
    if (blob) this.store(key, blob);
  }

  private async drawObject(entry: ObjectAssetEntry): Promise<void> {
    const model = await this.library.model(entry.id);
    const group = new Group();
    for (const part of model.parts) group.add(new Mesh(part.geometry, part.material));
    const box = new Box3().setFromObject(group);
    await this.shoot(group, box);
  }

  private async drawMaterial(entry: GroundMaterialEntry): Promise<void> {
    const texture = entry.thumbnail ? await this.texture(entry.thumbnail) : null;
    const ball = new Mesh(new SphereGeometry(1, 48, 32), this.swatch(texture, entry.color, 0.9));
    const group = new Group();
    group.add(ball);
    await this.shoot(group, new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)), 0.35, 0.5);
    ball.geometry.dispose();
    texture?.dispose();
  }

  private async drawBiome(biome: BiomeDef, catalog: CatalogIndex): Promise<void> {
    const groundId = biome.ground[0].material.find((m) => catalog.materials.has(m));
    const ground = groundId ? catalog.material(groundId) : null;
    const texture = ground?.thumbnail ? await this.texture(ground.thumbnail) : null;
    if (texture) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(3, 3);
    }
    const plane = new Mesh(
      new PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
      this.swatch(texture, ground?.color ?? biome.color, 1),
    );
    const group = new Group();
    group.add(plane);
    // A few of its objects, the commonest first, spread by a fixed hash
    const kinds = [...biome.objects].sort((a, b) => b.perHectare - a.perHectare);
    let n = 0;
    for (const o of kinds) {
      const asset = o.assets.find((a) => catalog.objects.has(a));
      if (!asset) continue;
      const model = await this.library.model(asset);
      const count = Math.max(1, Math.min(5, Math.round(o.perHectare / 30)));
      // Small things a little larger, big things smaller, so a forest and a meadow both read
      const scale = Math.min(1.4, 3.2 / Math.max(0.5, model.height));
      for (let k = 0; k < count; k++, n++) {
        const piece = new Group();
        for (const part of model.parts) piece.add(new Mesh(part.geometry, part.material));
        piece.position.set((hashCell(n, 1, 7) - 0.5) * 11, 0, (hashCell(n, 2, 7) - 0.5) * 11);
        piece.rotation.y = hashCell(n, 3, 7) * Math.PI * 2;
        piece.scale.setScalar(scale * (0.8 + hashCell(n, 4, 7) * 0.4));
        group.add(piece);
      }
    }
    await this.shoot(group, new Box3(new Vector3(-4.5, 0, -4.5), new Vector3(4.5, 2, 4.5)), 0.75, 0.6);
    plane.geometry.dispose();
    texture?.dispose();
  }

  /** The kept material for a ground swatch: the texture, or the plain colour without one */
  private swatch(texture: Texture | null, color: string, roughness: number): MeshStandardMaterial {
    const m = texture ? this.swatches.textured : this.swatches.plain;
    if (texture) m.map = texture;
    else m.color.set(color);
    m.roughness = roughness;
    return m;
  }

  private texture(url: string): Promise<Texture> {
    return new Promise((resolve, reject) =>
      this.loader.load(
        url,
        (t) => {
          t.colorSpace = SRGBColorSpace;
          resolve(t);
        },
        undefined,
        reject,
      ),
    );
  }

  private store(key: string, blob: Blob): void {
    this.pictures.set(key, URL.createObjectURL(blob));
    this.onPicture();
    void this.open().then((db) => {
      if (!db) return;
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
    });
  }

  private async loadStored(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (String(cursor.key).includes(`:${VERSION}:`)) {
          // Pictures are kept as PNG blobs; ones kept as data URLs before still read
          const value = cursor.value as Blob | string;
          this.pictures.set(String(cursor.key), typeof value === 'string' ? value : URL.createObjectURL(value));
        }
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
    this.onPicture();
  }

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return this.db;
  }
}

/**
 * Encodes canvases as PNG in a worker: an image bitmap of the canvas (a copy
 * on the GPU) goes there, and the read-back and encoding wait in the worker.
 * Where there is no worker or OffscreenCanvas, the canvas's own toBlob.
 */
class PngEncoder {
  private worker: Worker | null = null;
  private next = 0;
  private readonly waiting = new Map<number, (blob: Blob | null) => void>();
  private failed = false;

  async encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
    const worker = this.start();
    if (!worker) return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bitmap = await createImageBitmap(canvas);
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      worker.postMessage({ id, bitmap }, [bitmap]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }

  private start(): Worker | null {
    if (this.worker) return this.worker;
    if (this.failed || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return null;
    const worker = new Worker(new URL('./thumbnail-encode.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; blob: Blob | null }>) => {
      this.waiting.get(e.data.id)?.(e.data.blob);
      this.waiting.delete(e.data.id);
    };
    // A failed worker: the pictures waiting keep their symbols, the next ones encode on the page
    worker.onerror = () => {
      this.dispose();
      this.failed = true;
    };
    return (this.worker = worker);
  }
}
