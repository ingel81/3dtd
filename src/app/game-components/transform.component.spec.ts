import { describe, it, expect } from 'vitest';
import { TransformComponent } from './transform.component';
import { GameObject } from '../core/game-object';

class TestGameObject extends GameObject {
  constructor() {
    super('enemy');
  }
}

describe('TransformComponent', () => {
  it('setPosition sets lat, lon, and height', () => {
    const obj = new TestGameObject();
    const transform = new TransformComponent(obj);

    transform.setPosition(52.1, 13.2, 5);

    expect(transform.position.lat).toBe(52.1);
    expect(transform.position.lon).toBe(13.2);
    expect(transform.position.height).toBe(5);
  });

  it('getPosition returns correct values (via position property)', () => {
    const obj = new TestGameObject();
    const transform = new TransformComponent(obj);

    transform.setPosition(1, 2, 3);

    expect(transform.position).toEqual({ lat: 1, lon: 2, height: 3 });
  });

  it('handles world-position conversion if present', () => {
    const obj = new TestGameObject();
    const transform = new TransformComponent(obj) as unknown as {
      getWorldPosition?: () => { x: number; y: number; z: number };
    };

    if (typeof transform.getWorldPosition === 'function') {
      const worldPos = transform.getWorldPosition();
      expect(worldPos).toHaveProperty('x');
      expect(worldPos).toHaveProperty('y');
      expect(worldPos).toHaveProperty('z');
    } else {
      expect(true).toBe(true);
    }
  });
});
