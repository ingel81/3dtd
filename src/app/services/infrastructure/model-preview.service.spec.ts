import { describe, it, expect, vi, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnimationClip, Group, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ModelPreviewService, PLAYBACK_FPS, TURN_FRAMES, bakeSize, measurePreviewModel, turnFrameAt } from './model-preview.service';
import { AssetManagerService } from './asset-manager.service';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

describe('ModelPreviewService baked turns (TODO E73)', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The service with a renderer that counts its work instead of drawing (jsdom has no WebGL) */
  function setup() {
    const raf: { callback: FrameRequestCallback | null } = { callback: null };
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      raf.callback = cb;
      return 1;
    });
    const injector = Injector.create({ providers: [{ provide: AssetManagerService, useValue: {} }] });
    const service = runInInjectionContext(injector, () => new ModelPreviewService());
    const renderer = {
      render: vi.fn(), setSize: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(),
      domElement: {},
    };
    const internals = service as unknown as {
      renderer: unknown;
      turns: Map<string, unknown>;
      previews: Map<string, unknown>;
      startAnimationLoop(): void;
    };
    internals.renderer = renderer;
    const pivot = new Group();
    const mixer = { update: vi.fn(), stopAllAction: vi.fn() };
    const sheetDraws = vi.fn();
    const turn = {
      sheet: { getContext: () => ({ drawImage: sheetDraws }) },
      width: 60, height: 40, baked: 0,
      job: { scene: { remove: vi.fn(), traverse: vi.fn() }, camera: {}, pivot, mixer, loaded: true },
    };
    internals.turns.set('t', turn);
    const canvasDraws = vi.fn();
    const canvas = { isConnected: true, width: 60, height: 40, getContext: () => ({ clearRect: vi.fn(), drawImage: canvasDraws }) };
    internals.previews.set('p', { canvas, turn, config: { modelUrl: 'test.glb' }, shown: -1 });
    internals.startAnimationLoop();
    const frames = (from: number, count: number, hz = 60) => {
      for (let i = 0; i < count; i++) raf.callback?.(from + (i * 1000) / hz);
    };
    return { renderer, turn, mixer, pivot, sheetDraws, canvasDraws, frames };
  }

  it('bakes a full turn in a few display frames, then renders no more', () => {
    const { renderer, turn, mixer, sheetDraws, frames } = setup();

    frames(1000, Math.ceil(TURN_FRAMES / 6));
    expect(turn.baked).toBe(TURN_FRAMES);
    expect(turn.job).toBeNull();
    expect(renderer.render).toHaveBeenCalledTimes(TURN_FRAMES);
    expect(sheetDraws).toHaveBeenCalledTimes(TURN_FRAMES);
    // The clip steps one playback frame per baked frame after the first
    expect(mixer.update).toHaveBeenCalledTimes(TURN_FRAMES - 1);
    expect(mixer.update).toHaveBeenCalledWith(1 / PLAYBACK_FPS);

    frames(5000, 120);
    expect(renderer.render).toHaveBeenCalledTimes(TURN_FRAMES);
  });

  it('turns the model by one frame of a full turn per baked frame', () => {
    const { pivot, frames } = setup();
    frames(1000, 1);
    // Six frames baked in the first display frame, the last at frame 5
    expect(pivot.rotation.y).toBeCloseTo((5 / TURN_FRAMES) * Math.PI * 2, 6);
  });

  it('plays the turn at the playback rate on a 60 Hz display, one copy per new frame', () => {
    const { canvasDraws, frames } = setup();
    frames(1000, 20);
    canvasDraws.mockClear();

    // One second at 60 Hz shows PLAYBACK_FPS frames
    frames(2000, 60);
    expect(canvasDraws).toHaveBeenCalledTimes(PLAYBACK_FPS);
  });

  it('picks the frame by time, looping, within the frames baked so far', () => {
    expect(turnFrameAt(0, TURN_FRAMES)).toBe(0);
    expect(turnFrameAt(1000, TURN_FRAMES)).toBe(PLAYBACK_FPS);
    expect(turnFrameAt((TURN_FRAMES / PLAYBACK_FPS) * 1000, TURN_FRAMES)).toBe(0);
    expect(turnFrameAt(1000, 5)).toBe(4);
    expect(turnFrameAt(1000, 0)).toBe(-1);
  });

  it('bakes at most 1.25 pixels per CSS pixel', () => {
    expect(bakeSize(240, 160, 120)).toEqual({ width: 150, height: 100 });
    expect(bakeSize(64, 64, 64)).toEqual({ width: 64, height: 64 });
    expect(bakeSize(64, 64, 0)).toEqual({ width: 64, height: 64 });
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
