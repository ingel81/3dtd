import { BoxGeometry, DataTexture, type BufferGeometry, type Texture, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { createMockContext } from '../../test/mock-webgl';
import { DrawLedger } from './draw-ledger';
import { RendererHost } from './renderer-host';
import { isSharedGpu, shareGpu, unshareGpu } from './shared-gpu';
import { scaffoldWarmUp } from './renderers/tower-scaffold';
import { foamNoiseTexture } from '../world/custom-map/render/water/foam-noise';

/** three's own renderer over a context that draws nothing (test/mock-webgl.ts): it counts what it keeps */
function renderer(): WebGLRenderer {
  return new WebGLRenderer({ canvas: document.createElement('canvas'), context: createMockContext() });
}

/** As three does for every material, texture and geometry a renderer drew: a dispose listener that holds it */
function heldBy(target: Material | Texture | BufferGeometry): () => boolean {
  let held = true;
  const onDispose = (): void => {
    held = false;
    target.removeEventListener('dispose', onDispose);
  };
  target.addEventListener('dispose', onDispose);
  return () => held;
}

const camera = new PerspectiveCamera(60, 1, 0.1, 100);

/** A 1 x 1 texture with its pixels to upload */
function texture(): DataTexture {
  const t = new DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** A view's scene: `n` meshes of its own, a texture of its own, and the page's mesh (a cached model's) */
function view(n: number, page: Mesh): { scene: Scene; own: Mesh[] } {
  const scene = new Scene();
  const own: Mesh[] = [];
  for (let k = 0; k < n; k++) {
    // Each a program of its own (the define), as a world's materials have
    const material = new MeshStandardMaterial({ map: texture() });
    material.defines = { VIEW_PART: k };
    const mesh = new Mesh(new SphereGeometry(1, 4, 2), material);
    own.push(mesh);
    scene.add(mesh);
  }
  scene.add(page);
  return { scene, own };
}

describe('DrawLedger and the page\'s renderer', () => {
  /** V11: editor -> test -> editor on one renderer: what each view drew goes with its lease, the page's stays */
  it('leaves nothing of a view behind after editor -> test -> editor, the page\'s model stays uploaded', () => {
    const host = new RendererHost(() => renderer());
    const pageMesh = new Mesh(shareGpu(new BoxGeometry()), shareGpu(new MeshBasicMaterial()));
    const counts: { geometries: number; textures: number; programs: number }[] = [];
    for (const [name, n] of [['editor', 6], ['test', 9], ['editor', 6], ['test', 9], ['editor', 6]] as const) {
      const lease = host.acquire(document.createElement('div'), true);
      const r = lease.renderer;
      const { scene, own } = view(n, pageMesh);
      lease.renderer.render(scene, camera);
      // The stand-in context binds no uniform: the views' textures go up as a draw would put them up
      for (const mesh of own) lease.renderer.initTexture((mesh.material as MeshStandardMaterial).map!);
      expect(lease.renderer.info.memory.textures).toBe(n);
      // A view that lets meshes go without disposing them (a pool emptied): the lease's end frees them
      scene.remove(own[0]);
      lease.release();
      const memory = r.info.memory;
      counts.push({ geometries: memory.geometries, textures: memory.textures, programs: r.info.programs?.length ?? 0 });
      expect(name).toBeTruthy();
    }
    // Only the page's box stays, with its one program; the views' geometries, textures and programs are all gone
    expect(counts.every((c) => c.geometries === 1 && c.textures === 0 && c.programs === 1)).toBe(true);
    unshareGpu(pageMesh.geometry);
    unshareGpu(pageMesh.material as Material);
  });

  it('gives back everything a renderer that goes drew, the page\'s too, so three\'s listeners hold it no more', () => {
    const r = renderer();
    const ledger = new DrawLedger(r, isSharedGpu);
    const own = new MeshStandardMaterial({ map: texture() });
    const page = shareGpu(new MeshStandardMaterial());
    const geometry = new BoxGeometry();
    const scene = new Scene().add(new Mesh(geometry, own), new Mesh(new BoxGeometry(), page));
    r.render(scene, camera);
    r.initTexture(own.map!);
    const holds = [heldBy(own), heldBy(own.map!), heldBy(geometry), heldBy(page)];
    ledger.free();
    // The view's own go, the page's stays for the next view
    expect(holds.map((h) => h())).toEqual([false, false, false, true]);
    ledger.freeAll();
    expect(holds[3]()).toBe(false);
    unshareGpu(page);
  });

  it('marks the module-level resources as the page\'s: the scaffold materials and the foam on water', () => {
    const { scaffold } = scaffoldWarmUp();
    const materials = scaffold.map((m) => (m as Mesh).material as MeshStandardMaterial);
    expect([...materials, foamNoiseTexture()].every(isSharedGpu)).toBe(true);
    // The same objects for the next view: nothing made or baked again
    expect(scaffoldWarmUp().scaffold.map((m) => (m as Mesh).material)).toEqual(materials);
  });
});
