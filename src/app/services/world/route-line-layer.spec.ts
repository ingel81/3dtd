import { describe, it, expect, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import { RouteLineLayer } from './route-line-layer';

const points = [new Vector3(0, 1, 0), new Vector3(10, 1, 0), new Vector3(10, 2, 10)];

describe('RouteLineLayer', () => {
  it('draws a line per route in the overlay group, in the spawn colour', () => {
    const overlay = new Group();
    const layer = new RouteLineLayer();
    layer.add(overlay, points, 0xff0000, false);
    layer.add(overlay, points, 0x00ff00, true);

    expect(overlay.children).toEqual(layer.all);
    expect(layer.all.map((line) => line.visible)).toEqual([false, true]);
    expect(layer.all[1].material.color.getHex()).toBe(0x00ff00);
    expect(layer.all[0].frustumCulled).toBe(false);
  });

  it('shows and hides every line', () => {
    const layer = new RouteLineLayer();
    const overlay = new Group();
    layer.add(overlay, points, 0xff0000, false);
    layer.add(overlay, points, 0xff0000, false);
    layer.setVisible(true);
    expect(layer.all.every((line) => line.visible)).toBe(true);
  });

  it('takes the lines out of the group and frees them on clear', () => {
    const overlay = new Group();
    const layer = new RouteLineLayer();
    layer.add(overlay, points, 0xff0000, true);
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
