import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LaserBeamRenderer } from './laser-beam.renderer';

describe('LaserBeamRenderer', () => {
  const a = new Vector3(0, 5, 0);

  it('keeps one slot per beam and moves the last one into a freed slot', () => {
    const renderer = new LaserBeamRenderer(new Scene());
    renderer.startBeam('t1', a, new Vector3(10, 0, 0), 0);
    renderer.startBeam('t2', a, new Vector3(20, 0, 0), 1);
    renderer.startBeam('t1', a, new Vector3(11, 0, 0), 0.5);
    expect(renderer.count).toBe(2);
    renderer.stopBeam('t1');
    expect(renderer.count).toBe(1);
    const geometry = (renderer as unknown as { end: { getX(i: number): number }; heat: { getX(i: number): number } });
    expect(geometry.end.getX(0)).toBe(20);
    expect(geometry.heat.getX(0)).toBe(1);
    renderer.stopBeam('t1');
    renderer.clear();
    expect(renderer.count).toBe(0);
    renderer.dispose();
  });

  it('shows the beams of the frame once updated and hides the mesh without any', () => {
    const scene = new Scene();
    const renderer = new LaserBeamRenderer(scene);
    const mesh = (renderer as unknown as { mesh: { visible: boolean } }).mesh;
    renderer.startBeam('t1', a, new Vector3(10, 0, 0), 0);
    renderer.update(1);
    expect(mesh.visible).toBe(true);
    renderer.stopBeam('t1');
    renderer.update(2);
    expect(mesh.visible).toBe(false);
    renderer.dispose();
  });
});
