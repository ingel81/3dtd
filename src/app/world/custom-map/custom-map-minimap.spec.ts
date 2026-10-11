import { Group, Scene, type WebGLRenderer } from 'three';
import { linearToSrgb, minimapPictureSize, renderMinimapPicture } from './custom-map-minimap';

describe('custom map minimap picture', () => {
  it('sizes the picture by the area, the longer side 512 px', () => {
    expect(minimapPictureSize({ left: 100, right: -100, top: 50, bottom: -50 })).toEqual({ width: 512, height: 256 });
    expect(minimapPictureSize({ left: 0, right: -10, top: 400, bottom: 0 })).toEqual({ width: 13, height: 512 });
  });

  it('turns linear bytes into sRGB and leaves alpha alone', () => {
    const px = new Uint8Array([0, 255, 55, 77]);
    linearToSrgb(px);
    expect(px[0]).toBe(0);
    expect(px[1]).toBe(255);
    // Linear 55/255 is about 128 in sRGB
    expect(px[2]).toBeGreaterThan(125);
    expect(px[2]).toBeLessThan(131);
    expect(px[3]).toBe(77);
  });

  it("renders the map's own children only and puts the scene back", () => {
    const scene = new Scene();
    const map = new Group();
    const towers = new Group();
    const hiddenBefore = new Group();
    hiddenBefore.visible = false;
    scene.add(map, towers, hiddenBefore);
    const seen: boolean[][] = [];
    const before = { name: 'before' };
    let target: unknown = before;
    const renderer = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => (target = t),
      clear: vi.fn(),
      render: (s: Scene) => seen.push(s.children.map((c) => c.visible)),
      readRenderTargetPixels: vi.fn(),
    } as unknown as WebGLRenderer;
    renderMinimapPicture(renderer, scene, new Set([map]), { left: 50, right: -50, top: 20, bottom: -20 }, 10);
    expect(seen).toEqual([[true, false, false]]);
    expect(scene.children.map((c) => c.visible)).toEqual([true, true, false]);
    expect(target).toBe(before);
  });
});
