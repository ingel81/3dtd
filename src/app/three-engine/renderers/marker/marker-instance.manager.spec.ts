import { describe, it, expect } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { MarkerInstanceManager } from './marker-instance.manager';

describe('MarkerInstanceManager', () => {
  it('reports moved proxies in one array reused across frames', () => {
    const markers = new MarkerInstanceManager(new Group());
    const camera = new PerspectiveCamera();

    const idle = markers.update(camera);
    expect(idle).toEqual([]);

    const proxy = markers.add('s1', 'spawn', new Vector3(), 0xff0000, 0.8, 0.001);
    markers.add('hq', 'hq', new Vector3(10, 0, 0), 0x00ff00, 1, 0.001);
    expect(markers.update(camera)).toEqual([]);

    // PathRouteService schiebt den Proxy (Snap-to-Path), das Label muss mit.
    proxy.position.set(5, 0, 0);
    const moved = markers.update(camera);
    expect(moved).toEqual(['s1']);
    expect(moved).toBe(idle);
    expect(markers.getPosition('s1')!.x).toBe(5);

    expect(markers.update(camera)).toEqual([]);
  });
});
