import { describe, it, expect, vi } from 'vitest';
import { Group, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { RouteLineLayer } from './route-line-layer';
import { createPortalClipUniforms } from '../../three-engine/renderers/portal-clip';

const points = [new Vector3(0, 1, 0), new Vector3(10, 1, 0), new Vector3(10, 2, 10)];
const clip = createPortalClipUniforms();

describe('RouteLineLayer', () => {
  it('draws a line per route in the overlay group, in the spawn colour', () => {
    const overlay = new Group();
    const layer = new RouteLineLayer();
    layer.add(overlay, points, 0xff0000, false, clip);
    layer.add(overlay, points, 0x00ff00, true, clip);

    expect(overlay.children).toEqual(layer.all);
    expect(layer.all.map((line) => line.visible)).toEqual([false, true]);
    expect(layer.all[1].material.color.getHex()).toBe(0x00ff00);
    expect(layer.all[0].frustumCulled).toBe(false);
  });

  it("ends the line at the spawn portals' planes: the shared clip uniforms, the fragments behind dropped", () => {
    const layer = new RouteLineLayer();
    layer.add(new Group(), points, 0xff0000, true, clip);
    const material = layer.all[0].material;
    expect(material.uniforms['uPortalClipBox']).toBe(clip.uPortalClipBox);

    const { vertexShader, fragmentShader } = ShaderLib['line'];
    const shader = { vertexShader, fragmentShader, uniforms: material.uniforms } as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('vPortalClipPos = position.y < 0.5 ? instanceStart : instanceEnd;');
    expect(shader.fragmentShader).toContain('if (portalClipAhead(vPortalClipPos) < 0.0) discard;');
  });

  it('shows and hides every line', () => {
    const layer = new RouteLineLayer();
    const overlay = new Group();
    layer.add(overlay, points, 0xff0000, false, clip);
    layer.add(overlay, points, 0xff0000, false, clip);
    layer.setVisible(true);
    expect(layer.all.every((line) => line.visible)).toBe(true);
  });

  it('takes the lines out of the group and frees them on clear', () => {
    const overlay = new Group();
    const layer = new RouteLineLayer();
    layer.add(overlay, points, 0xff0000, true, clip);
    const [line] = layer.all;
    const geometry = vi.spyOn(line.geometry, 'dispose');
    const material = vi.spyOn(line.material, 'dispose');

    layer.clear(overlay);
    expect(overlay.children).toHaveLength(0);
    expect(layer.all).toHaveLength(0);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('stands on the craters under the route, every metre over them, and draws again only the lines that cross a change (E291)', () => {
    const crater = { x: 20, z: 0, r: 3, depth: 2 };
    let stamps: { heightAt(x: number, z: number): number } | null = null;
    const layer = new RouteLineLayer(() => stamps);
    const overlay = new Group();
    const across = [new Vector3(0, 1, 0), new Vector3(40, 1, 0)];
    const beside = [new Vector3(0, 1, 50), new Vector3(40, 1, 50)];
    layer.add(overlay, across, 0xff0000, true, clip);
    layer.add(overlay, beside, 0xff0000, true, clip);
    const ys = (k: number) => {
      const start = layer.all[k].geometry.getAttribute('instanceStart');
      return Array.from({ length: start.count }, (_, i) => [start.getX(i), start.getY(i)]);
    };
    // On the ground as built: its two points
    expect(ys(0)).toEqual([[0, 1]]);
    const besideGeometry = layer.all[1].geometry;

    stamps = { heightAt: (x, z) => (Math.hypot(x - crater.x, z - crater.z) < crater.r ? -crater.depth : 0) };
    layer.restand({ minX: 16, minZ: -4, maxX: 24, maxZ: 4 });
    const pts = ys(0);
    // A metre a step over the 40 m, down into the crater and up again
    expect(pts).toHaveLength(40);
    expect(pts.find(([x]) => x === 20)![1]).toBe(-1);
    expect(pts.find(([x]) => x === 10)![1]).toBe(1);
    // The line 50 m off was not drawn again
    expect(layer.all[1].geometry).toBe(besideGeometry);
    // A new line on a stamped ground stands on it from the start
    layer.add(overlay, across, 0x00ff00, true, clip);
    expect(ys(2)).toEqual(pts);
  });
});
