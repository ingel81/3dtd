import { describe, it, expect, vi, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnimationClip, Group, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ModelPreviewService, measurePreviewModel } from './model-preview.service';
import { AssetManagerService } from './asset-manager.service';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

describe('ModelPreviewService frame rate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('steps previews at 30 fps on a 60 Hz display and keeps the turn rate', () => {
    const raf: { callback: FrameRequestCallback | null } = { callback: null };
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      raf.callback = cb;
      return 1;
    });

    const injector = Injector.create({
      providers: [{ provide: AssetManagerService, useValue: {} }],
    });
    const service = runInInjectionContext(injector, () => new ModelPreviewService());
    const model = new Group();
    const mixer = { update: vi.fn() };
    // A detached canvas: the loop steps rotation and mixer but skips the
    // render, which would need WebGL.
    const internals = service as unknown as {
      previews: Map<string, unknown>;
      startAnimationLoop(): void;
    };
    internals.previews.set('p', {
      canvas: { isConnected: false },
      model,
      mixer,
      animating: true,
      config: { modelUrl: 'test.glb', rotationSpeed: 0.4 },
    });
    internals.startAnimationLoop();

    // One second of 60 Hz frames.
    for (let i = 0; i <= 60; i++) raf.callback?.(1000 + (i * 1000) / 60);

    expect(mixer.update).toHaveBeenCalledTimes(31);
    expect(model.rotation.y).toBeCloseTo(0.4, 5);
  });
});

describe('measurePreviewModel', () => {
  /** An enemy GLB as the game serves it, cloned like AssetManager.cloneModel for an animated preview. */
  async function loadEnemy(id: 'tank' | 'spider') {
    const config = ENEMY_TYPES[id];
    // A copy made here: GLTFLoader checks `instanceof ArrayBuffer`, and a Node Buffer's is another realm's under jsdom
    const data = new Uint8Array(readFileSync(resolve('public', config.modelUrl))).buffer;
    // Textures never load under jsdom and would stall the parse; the box needs none
    const loader = new GLTFLoader().register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }) as never);
    const gltf = await new Promise<{ scene: Object3D; animations: AnimationClip[] }>((done, fail) => {
      loader.parse(data, '', done as never, fail);
    });
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(config.previewScale!);
    return { model, clips: gltf.animations, animationName: config.walkAnimation };
  }

  it('measures the tank at its own size, centred, so the preview turns it in view', async () => {
    const { model, clips, animationName } = await loadEnemy('tank');
    const { box, mixer } = measurePreviewModel(model, clips, { animationName });

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    // 4.7 m wide at scale 1, previewScale 0.65; the stale bones measured 88 x 194 x 139 m, centre 43 m to the side
    expect(size.x).toBeCloseTo(3.08, 1);
    expect(size.y).toBeCloseTo(1.97, 1);
    expect(size.z).toBeCloseTo(4.31, 1);
    expect(Math.abs(center.x)).toBeLessThan(0.1);
    expect(Math.abs(center.z)).toBeLessThan(0.1);
    expect(mixer).not.toBeNull();
  });

  it('measures the spider in its walk pose, flat, not standing as in its rest pose', async () => {
    const { model, clips, animationName } = await loadEnemy('spider');
    const { box } = measurePreviewModel(model, clips, { animationName });

    // The rest pose stands it 5.3 m tall
    expect(box.getSize(new Vector3()).y).toBeLessThan(1.5);
  });

  it('starts no clip without an animation name', async () => {
    const { model, clips } = await loadEnemy('tank');
    expect(measurePreviewModel(model, clips, {}).mixer).toBeNull();
  });
});
