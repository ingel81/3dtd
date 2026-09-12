import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Scene, type WebGLProgram, type WebGLRenderer } from 'three';
import { warmUpScene } from './scene-warmup';

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
  it('compiles the whole scene with the camera and waits until the programs are ready', async () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const { renderer, finish } = fakeRenderer(3);

    let done = false;
    const warmup = warmUpScene(renderer, scene, camera).then((r) => { done = true; return r; });
    await Promise.resolve();
    expect(renderer.compileAsync).toHaveBeenCalledWith(scene, camera);
    expect(done).toBe(false);

    finish();
    const result = await warmup;
    expect(result.newPrograms).toBe(3);
    expect(result.totalMs).toBeGreaterThanOrEqual(result.syncMs);
  });
});
