import { describe, it, expect, vi, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Group } from 'three';
import { ModelPreviewService } from './model-preview.service';
import { AssetManagerService } from './asset-manager.service';

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
