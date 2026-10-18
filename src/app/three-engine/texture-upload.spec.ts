import { DataTexture, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { boundTexturesOf, uploadTextures } from './texture-upload';

describe('texture upload ahead', () => {
  it('finds the materials\' own textures and those their compiled programs bind, hidden meshes too', () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const heights = new DataTexture(new Uint8Array(4), 1, 1);
    const layers = [new DataTexture(new Uint8Array(4), 1, 1), new DataTexture(new Uint8Array(4), 1, 1)];
    const standard = new MeshStandardMaterial({ map });
    const shader = new ShaderMaterial();
    const hidden = new Mesh(new PlaneGeometry(), shader);
    hidden.visible = false;
    const root = new Mesh(new PlaneGeometry(), standard).add(hidden);
    // What onBeforeCompile handed the program lives in the renderer's properties of the material
    const props = new Map<object, object>([[shader, { uniforms: { uHeights: { value: heights }, uLayers: { value: layers }, uScale: { value: 2 } } }]]);
    const renderer = { properties: { get: (o: object) => props.get(o) ?? {} } } as unknown as WebGLRenderer;
    expect([...boundTexturesOf(renderer, root)]).toEqual([map, heights, ...layers]);
  });

  it('uploads each once through initTexture, leaving render targets to themselves', async () => {
    const uploaded: unknown[] = [];
    const renderer = { initTexture: (t: unknown) => uploaded.push(t) } as unknown as WebGLRenderer;
    const plain = new DataTexture(new Uint8Array(4), 1, 1);
    const target = new WebGLRenderTarget(1, 1);
    await uploadTextures(renderer, [plain, target.texture]);
    expect(uploaded).toEqual([plain]);
  });
});
