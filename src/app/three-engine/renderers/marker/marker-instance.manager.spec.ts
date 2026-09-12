import { describe, it, expect } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { MarkerInstanceManager } from './marker-instance.manager';

describe('MarkerInstanceManager', () => {
  it('führt die Position je Marker und vergisst entfernte', () => {
    const markers = new MarkerInstanceManager(new Group());
    markers.add('hq', new Vector3(10, 30, 0), 0x22c55e, 1.2, 0.001);
    markers.add('hq-old', new Vector3(0, 30, 0), 0x22c55e, 1.2, 0.001);

    markers.updatePosition('hq', new Vector3(10, 45, 0));
    markers.update(new PerspectiveCamera());
    expect(markers.getPosition('hq')!.y).toBe(45);

    markers.remove('hq-old');
    expect(markers.getPosition('hq-old')).toBeNull();
    expect(markers.getPosition('hq')!.x).toBe(10);
  });

  it('ersetzt einen Marker unter derselben Id, statt Ringe zu verbrauchen', () => {
    // Zwei Ringe je HQ, acht Plätze: ohne Ersetzen wäre beim fünften Mal Schluss.
    const markers = new MarkerInstanceManager(new Group());
    for (let i = 0; i < 10; i++) {
      markers.add('hq', new Vector3(i, 30, 0), 0x22c55e, 1.2, 0.001);
    }
    expect(markers.getPosition('hq')!.x).toBe(9);
  });
});
