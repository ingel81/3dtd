import { BoxGeometry, DataTexture, Mesh, MeshStandardMaterial, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { releaseSharedGpu, shareGpu, unshareGpu } from './shared-gpu';
import { scaffoldWarmUp } from './renderers/tower-scaffold';
import { foamNoiseTexture } from '../world/custom-map/render/water/foam-noise';

/** As a WebGLRenderer does for every material, texture and geometry it draws: a dispose listener that holds it */
function drawnBy(target: { addEventListener: MeshStandardMaterial['addEventListener']; removeEventListener: MeshStandardMaterial['removeEventListener'] }): () => boolean {
  let held = true;
  const onDispose = () => {
    held = false;
    target.removeEventListener('dispose', onDispose);
  };
  target.addEventListener('dispose', onDispose);
  return () => held;
}

/** A renderer whose drawn materials carry three's uniforms, `lut` as the DFG LUT of a physical one */
function rendererWith(lutOf: Map<object, DataTexture>): WebGLRenderer {
  return {
    properties: { get: (m: object) => (lutOf.has(m) ? { uniforms: { dfgLUT: { value: lutOf.get(m) } } } : {}) },
  } as unknown as WebGLRenderer;
}

describe('shared GPU resources', () => {
  it('drop the listeners of every renderer that drew them when one goes, and stay usable', () => {
    const material = shareGpu(new MeshStandardMaterial());
    const geometry = shareGpu(new BoxGeometry());
    const holds = [drawnBy(material), drawnBy(material), drawnBy(geometry)];

    releaseSharedGpu(rendererWith(new Map()), new Scene());

    expect(holds.map((held) => held())).toEqual([false, false, false]);
    // The next renderer draws the same objects again
    const again = drawnBy(material);
    releaseSharedGpu(rendererWith(new Map()));
    expect(again()).toBe(false);
  });

  it('let go of one its owner freed: a renderer that goes later does not touch it', () => {
    const material = shareGpu(new MeshStandardMaterial());
    unshareGpu(material);
    const held = drawnBy(material);
    releaseSharedGpu(rendererWith(new Map()));
    expect(held()).toBe(true);
  });

  it('release the DFG LUT three hands its physical materials, found on one the renderer drew in its scene', () => {
    const lut = new DataTexture();
    const material = new MeshStandardMaterial();
    const scene = new Scene().add(new Mesh(new BoxGeometry(), material));
    const held = drawnBy(lut);

    releaseSharedGpu(rendererWith(new Map([[material, lut]])), scene);
    expect(held()).toBe(false);

    // Found once, it goes with every later renderer, whether or not its scene shows it
    const later = drawnBy(lut);
    releaseSharedGpu(rendererWith(new Map()));
    expect(later()).toBe(false);
  });

  it('cover the module-level ones: the scaffold materials and the foam on water keep no renderer', () => {
    const { scaffold } = scaffoldWarmUp();
    const materials = scaffold.map((m) => (m as Mesh).material as MeshStandardMaterial);
    const foam = foamNoiseTexture();
    const holds = [...materials, foam].map(drawnBy);

    releaseSharedGpu(rendererWith(new Map()));

    expect(holds.map((held) => held())).toEqual([false, false, false]);
    // Same objects for the next engine: nothing is made or baked again
    expect(scaffoldWarmUp().scaffold.map((m) => (m as Mesh).material)).toEqual(materials);
    expect(foamNoiseTexture()).toBe(foam);
  });
});
