import { describe, it, expect, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, type WebGLProgram, type WebGLRenderer } from 'three';
import { warmUpScene } from './scene-warmup';
import { DrawGate } from './renderers/draw-gate';

type WarmupRenderer = Pick<WebGLRenderer, 'compileAsync' | 'info'>;

/** Stand-in renderer whose compile adds `created` programs and resolves when told. */
function fakeRenderer(created: number) {
  const programs: WebGLProgram[] = [{} as WebGLProgram];
  let finish!: () => void;
  const renderer = {
    info: { programs },
    compileAsync: vi.fn((scene: Scene) => {
      for (let i = 0; i < created; i++) programs.push({} as WebGLProgram);
      return new Promise<Scene>((resolve) => { finish = () => resolve(scene); });
    }),
  };
  return { renderer: renderer as unknown as WarmupRenderer, finish: () => finish() };
}

describe('warmUpScene', () => {
  it('compiles the whole scene, then draws the empty pools for one frame', async () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const pool = new Mesh();
    scene.add(pool);
    const gate = new DrawGate([pool]);
    const { renderer, finish } = fakeRenderer(3);

    let frame!: () => void;
    const renderedFrame = vi.fn(() => new Promise<void>((resolve) => { frame = resolve; }));
    const warmup = warmUpScene(renderer, scene, camera, renderedFrame);

    await Promise.resolve();
    expect(renderer.compileAsync).toHaveBeenCalledWith(scene, camera);
    expect(renderedFrame).not.toHaveBeenCalled();
    expect(pool.visible).toBe(false);

    finish();
    await vi.waitFor(() => expect(renderedFrame).toHaveBeenCalled());
    // The frame the warm-up waits for draws the empty pool.
    expect(pool.visible).toBe(true);

    frame();
    const result = await warmup;
    expect(pool.visible).toBe(false);
    expect(gate.visible).toBe(false);
    expect(result.newPrograms).toBe(3);
    expect(result.pools).toBe(1);
    expect(result.compileMs).toBeGreaterThanOrEqual(result.syncMs);
  });

  it('closes the pools again when the frame wait fails', async () => {
    const scene = new Scene();
    const pool = new Mesh();
    scene.add(pool);
    new DrawGate([pool]);
    const { renderer, finish } = fakeRenderer(0);

    const warmup = warmUpScene(renderer, scene, new PerspectiveCamera(), () => Promise.reject(new Error('gone')));
    finish();
    await expect(warmup).rejects.toThrow('gone');
    expect(pool.visible).toBe(false);
  });
});
