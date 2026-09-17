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
});
