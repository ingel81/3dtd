import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { AssetManagerService, MODEL_RETRY_DELAYS_MS } from './asset-manager.service';

/** The service with its GLTFLoader answering as `answers` says, one call each */
function withLoader(answers: ('ok' | 'fail')[]) {
  const assets = new AssetManagerService();
  const loadAsync = vi.fn(async () => {
    if (answers.shift() === 'fail') throw new Error('network');
    return { scene: new Group(), animations: [] };
  });
  (assets as unknown as { gltfLoader: { loadAsync: typeof loadAsync } }).gltfLoader = { loadAsync };
  return { assets, loadAsync };
}

const waits = MODEL_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

describe('AssetManagerService tries a model again before it fails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads on the second try after a hiccup, and nothing counts as failed', async () => {
    const { assets, loadAsync } = withLoader(['fail', 'ok']);
    const loaded = assets.loadModel('assets/models/tank.glb');
    await vi.advanceTimersByTimeAsync(MODEL_RETRY_DELAYS_MS[0]);
    await expect(loaded).resolves.toMatchObject({ url: 'assets/models/tank.glb' });
    expect(loadAsync).toHaveBeenCalledTimes(2);
    expect(assets.failedModels()).toEqual([]);
  });

  it('fails after every try and lists the model once', async () => {
    const { assets, loadAsync } = withLoader(['fail', 'fail', 'fail', 'fail', 'fail', 'fail']);
    for (let i = 0; i < 2; i++) {
      const failed = expect(assets.loadModel('assets/models/tank.glb')).rejects.toThrow('network');
      await vi.advanceTimersByTimeAsync(waits);
      await failed;
    }
    expect(loadAsync).toHaveBeenCalledTimes(2 * (MODEL_RETRY_DELAYS_MS.length + 1));
    expect(assets.failedModels()).toEqual(['assets/models/tank.glb']);
  });

  it('takes a model off the list once a later load works', async () => {
    const { assets } = withLoader(['fail', 'fail', 'fail', 'ok']);
    const failed = expect(assets.loadModel('/a.glb')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(waits);
    await failed;
    expect(assets.failedModels()).toEqual(['/a.glb']);
    await assets.loadModel('/a.glb');
    expect(assets.failedModels()).toEqual([]);
  });
});
