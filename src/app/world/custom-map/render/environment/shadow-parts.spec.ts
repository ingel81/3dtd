import { BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { SHADOW_PARTS, ShadowParts } from './shadow-parts';

/** The parts of a renderer a build touches: three's shadow pass counted, an empty scene's render running its hook */
function fakeRenderer(): WebGLRenderer & { passes: number } {
  const r = {
    passes: 0,
    shadowMap: { needsUpdate: false, render: () => void r.passes++ },
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    render: (scene?: { onAfterRender?: () => void }) => scene?.onAfterRender?.(),
    clear: () => undefined,
  };
  return r as unknown as WebGLRenderer & { passes: number };
}

describe('shadow parts', () => {
  it('does not swap in a build a caster left meanwhile, but draws it again with the scene as it is', () => {
    const scene = new Scene();
    const material = new MeshStandardMaterial();
    const meshes = Array.from({ length: 8 }, () => new Mesh(new BoxGeometry(), material));
    for (const m of meshes) scene.add(m);
    const sun = new DirectionalLight();
    const camera = new PerspectiveCamera();
    const r = fakeRenderer();
    const parts = new ShadowParts();
    parts.start(sun, scene);
    expect(parts.step(r, camera, sun, 2)).toBe(false);
    // A cell of trees rebuilt for new ones: its old mesh leaves, the new one comes
    meshes[1].removeFromParent();
    scene.add(new Mesh(new BoxGeometry(), material));
    expect(parts.step(r, camera, sun, 2)).toBe(false);
    expect(sun.shadow.map).toBeNull();
    expect(parts.busy).toBe(true);
    // The build again from the first part, then swapped in
    for (let k = 1; k < SHADOW_PARTS; k++) expect(parts.step(r, camera, sun, 1)).toBe(false);
    expect(parts.step(r, camera, sun, 1)).toBe(true);
    expect(sun.shadow.map).not.toBeNull();
    expect(parts.busy).toBe(false);
    parts.dispose();
  });
});
