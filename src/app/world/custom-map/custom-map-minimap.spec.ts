import { BoxGeometry, Group, Mesh, PointLight, Scene, type WebGLRenderer } from 'three';
import { minimapPictureSize, renderMinimapPicture } from './custom-map-minimap';

describe('custom map minimap picture', () => {
  it('sizes the picture by the area, the longer side 512 px', () => {
    expect(minimapPictureSize({ left: 100, right: -100, top: 50, bottom: -50 })).toEqual({ width: 512, height: 256 });
    expect(minimapPictureSize({ left: 0, right: -10, top: 400, bottom: 0 })).toEqual({ width: 13, height: 512 });
  });

  it("draws the map's own children only, keeps every light and puts the scene back", () => {
    const scene = new Scene();
    const map = new Mesh(new BoxGeometry());
    const tower = new Mesh(new BoxGeometry());
    const towers = new Group().add(tower, new PointLight());
    const hiddenBefore = new Mesh(new BoxGeometry());
    hiddenBefore.visible = false;
    scene.add(map, towers, hiddenBefore);
    const all = () => [map, towers, ...towers.children, hiddenBefore].map((o) => o.visible);
    const seen: boolean[][] = [];
    const before = { name: 'before' };
    let target: unknown = before;
    const targets: unknown[] = [];
    const renderer = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => targets.push((target = t)),
      clear: vi.fn(),
      render: () => seen.push(all()),
      readRenderTargetPixels: vi.fn(),
    } as unknown as WebGLRenderer;
    renderMinimapPicture(renderer, scene, new Set([map]), { left: 50, right: -50, top: 20, bottom: -20 }, 10);
    // map, tower group, tower, light, the one hidden before
    expect(seen).toEqual([[true, true, false, true, false]]);
    expect(all()).toEqual([true, true, true, true, false]);
    expect(target).toBe(before);
    // Drawn as the screen would be: the programs the map compiled
    expect(targets[0]).toMatchObject({ isXRRenderTarget: true });
  });
});
