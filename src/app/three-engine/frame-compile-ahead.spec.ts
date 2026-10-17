import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, PointLight, Scene, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three';
import { FrameAhead, recordDraws } from './frame-compile-ahead';

/** What a fake renderer was asked to compile and draw: the objects, the target, the lights of the scene it got */
interface Call {
  objects: Object3D[];
  target: WebGLRenderTarget | null;
  lights: number;
}

/** `builds`: each compile builds a program (a state not prepared), else every program is there already */
function fakeRenderer(builds = true) {
  let target: WebGLRenderTarget | null = null;
  const compiles: Call[] = [];
  const draws: Call[] = [];
  const clears: (WebGLRenderTarget | null)[] = [];
  const lightsOf = (scene: Object3D) => {
    let n = 0;
    scene.traverseVisible((o) => (n += (o as { isLight?: boolean }).isLight ? 1 : 0));
    return n;
  };
  let signalled = false;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    fenceSync: () => ({}),
    flush: () => undefined,
    getSyncParameter: () => (signalled ? 3 : 0),
    deleteSync: () => undefined,
  };
  const renderer = {
    info: { programs: [] as object[] },
    getContext: () => gl,
    shadowMap: { autoUpdate: true, needsUpdate: false },
    getRenderTarget: () => target,
    setRenderTarget: (t: WebGLRenderTarget | null) => (target = t),
    getScissorTest: () => false,
    setScissorTest: vi.fn(),
    getScissor: (v: unknown) => v,
    setScissor: vi.fn(),
    clear: () => clears.push(target),
    render: (scene: Object3D) => {
      const objects: Object3D[] = [];
      scene.traverse((o) => (o as { isMesh?: boolean }).isMesh && objects.push(o));
      draws.push({ objects, target, lights: lightsOf(scene) });
    },
    compileAsync: (slice: Object3D, _camera: unknown, targetScene: Object3D) => {
      if (builds) renderer.info.programs.push({});
      const objects: Object3D[] = [];
      slice.traverse((o) => objects.push(o));
      compiles.push({ objects, target, lights: lightsOf(targetScene) });
      return Promise.resolve(slice);
    },
  };
  return { renderer: renderer as unknown as WebGLRenderer, compiles, draws, clears, target: () => target, signal: () => (signalled = true) };
}

describe('recordDraws', () => {
  it('notes each draw with its target and material, clears targets only, and puts the renderer back', () => {
    const { renderer, draws, clears } = fakeRenderer();
    const render = renderer.render;
    const quad = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const first = quad.material;
    const second = new MeshBasicMaterial();
    const target = new WebGLRenderTarget(1, 1);
    const camera = new PerspectiveCamera();
    const recorded = recordDraws(renderer, () => {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(quad, camera);
      quad.material = second;
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(quad, camera);
    });
    expect(recorded.map((d) => [d.target, d.material])).toEqual([[target, first], [null, second]]);
    expect(clears).toEqual([target]);
    expect(draws).toEqual([]);
    expect(renderer.render).toBe(render);
  });
});

describe('FrameAhead', () => {
  function world(meshes: number) {
    const scene = new Scene();
    const light = new PointLight();
    scene.add(light);
    const materials = Array.from({ length: 3 }, () => new MeshBasicMaterial());
    for (let k = 0; k < meshes; k++) scene.add(new Mesh(new BoxGeometry(), materials[k % materials.length]));
    // Two light states: the point light on and off
    const lightStates = (run: () => void) => {
      run();
      light.visible = false;
      run();
      light.visible = true;
    };
    return { scene, light, lightStates };
  }

  it('compiles every object of the scene in each light state, with the scene lights, into the recorded target', async () => {
    const { renderer, compiles } = fakeRenderer();
    const { scene, lightStates } = world(5);
    const target = new WebGLRenderTarget(1, 1);
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target }], { scene, lightStates });
    expect(await ahead.compiled).toBe(true);
    const meshes = (lights: number) => compiles.filter((c) => c.lights === lights).flatMap((c) => c.objects).length;
    expect(meshes(1)).toBe(5);
    expect(meshes(0)).toBe(5);
    expect(compiles.every((c) => c.target === target)).toBe(true);
    // The scene keeps its children
    expect(scene.children.length).toBe(6);
  });

  it('draws the objects in later frames, at most the given new materials a frame, and is done once the GPU did them', async () => {
    const { renderer, draws, signal } = fakeRenderer();
    const { scene, lightStates } = world(6);
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target: null }], { scene, lightStates });
    expect(ahead.drawSome(100, 1)).toBe(false);
    expect(draws).toEqual([]);
    await ahead.compiled;
    const frames: number[] = [];
    for (let frame = 0; frame < 3; frame++) {
      const before = draws.length;
      expect(ahead.drawSome(100, 1)).toBe(false);
      frames.push(draws.length - before);
    }
    // Three materials: each frame draws up to the next unseen one, both light states each
    expect(frames.every((n) => n > 0)).toBe(true);
    expect(draws.flatMap((d) => d.objects).length).toBe(12);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    // Drawn, it waits for their fence
    expect(ahead.drawSome(100, 1)).toBe(false);
    signal();
    expect(ahead.drawSome(100, 1)).toBe(true);
    expect(draws.flatMap((d) => d.objects).length).toBe(12);
  });

  it('compiles and draws inside the state it is made ready for, and leaves the one drawn now outside', async () => {
    const { renderer, compiles, draws, signal } = fakeRenderer();
    const { scene, light } = world(2);
    // The state: the light off (as a level with fewer point lights)
    const inState = (run: () => void) => {
      light.visible = false;
      try {
        run();
      } finally {
        light.visible = true;
      }
    };
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target: null }], { scene, inState });
    expect(light.visible).toBe(true);
    await ahead.compiled;
    while (!ahead.drawSome(100, 10)) signal();
    expect(compiles.every((c) => c.lights === 0)).toBe(true);
    expect(draws.every((d) => d.lights === 0)).toBe(true);
    expect(light.visible).toBe(true);
  });

  it('stops when the work is gone', async () => {
    const { renderer } = fakeRenderer();
    const { scene } = world(2);
    let gone = false;
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target: null }], { scene, gone: () => gone });
    gone = true;
    expect(await ahead.compiled).toBe(false);
    expect(ahead.drawSome(100, 10)).toBe(false);
  });

  it('draws nothing when its compile built no program: the state was prepared at load', async () => {
    const { renderer, draws } = fakeRenderer(false);
    const { scene, lightStates } = world(4);
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target: null }], { scene, lightStates });
    await ahead.compiled;
    expect(ahead.drawSome(100, 1)).toBe(true);
    expect(draws).toEqual([]);
  });

  it('compiles only when asked to: no first draws though programs were built (the background)', async () => {
    const { renderer, draws } = fakeRenderer(true);
    const { scene, lightStates } = world(4);
    const ahead = new FrameAhead(renderer, [{ object: scene, camera: new PerspectiveCamera(), target: null }], { scene, lightStates, compileOnly: true });
    expect(await ahead.compiled).toBe(true);
    expect(renderer.info.programs?.length ?? 0).toBeGreaterThan(0);
    expect(ahead.drawSome(100, 1)).toBe(true);
    expect(draws).toEqual([]);
  });
});

