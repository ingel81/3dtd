import { describe, it, expect } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { createMissileModel } from './missile-model';
import { MISSILE_LAUNCH_LOOK } from '../../configs/visual-effects.config';

const { length, radius, span } = MISSILE_LAUNCH_LOOK.missile;

describe('createMissileModel', () => {
  it('stands on its nozzle at the origin, nose up +y, as long and as wide as the silo model\'s missile', () => {
    const model = createMissileModel();
    const position = model.geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    let widest = 0;
    let body = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const out = Math.hypot(position.getX(i), position.getZ(i));
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      widest = Math.max(widest, out);
      // The body above the fins, below the ring
      if (y > length * 0.35 && y < length * 0.5) body = Math.max(body, out);
    }
    expect(minY).toBeCloseTo(0, 6);
    expect(maxY).toBeCloseTo(length, 6);
    expect(widest).toBeCloseTo(span / 2, 2);
    expect(body).toBeCloseTo(radius, 2);
  });

  it('is one mesh with vertex colours that no ray picks', () => {
    const model = createMissileModel();
    expect(model.material.vertexColors).toBe(true);
    expect(model.geometry.getAttribute('color').count).toBe(model.geometry.getAttribute('position').count);
    model.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(0, length / 2, 20), new Vector3(0, 0, -1));
    expect(ray.intersectObject(model)).toEqual([]);
  });
});
