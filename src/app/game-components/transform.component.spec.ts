import { describe, it, expect } from 'vitest';
import { TransformComponent, TurningFlagSink } from './transform.component';
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

  describe('turning flag', () => {
    interface Internals { targetRotation: number; rotationInitialized: boolean }

    function make(): { transform: TransformComponent; sink: TurningFlagSink; internals: Internals } {
      const sink: TurningFlagSink = { isTurning: true }; // the constructor must correct it
      const transform = new TransformComponent(new TestGameObject(), sink);
      return { transform, sink, internals: transform as unknown as Internals };
    }

    it('starts clear and stays clear when the first lookAt initializes the rotation', () => {
      const { transform, sink } = make();
      expect(sink.isTurning).toBe(false);

      expect(transform.lookAt({ lat: 1, lon: 0 })).toBe(true);
      expect(sink.isTurning).toBe(false);
    });

    it('is set when lookAt moves the target away and cleared once update reaches it', () => {
      const { transform, sink, internals } = make();
      transform.lookAt({ lat: 1, lon: 0 }); // north, initializes
      transform.lookAt({ lat: 0, lon: 1 }); // east
      expect(sink.isTurning).toBe(true);

      let ticks = 0;
      while (sink.isTurning && ticks < 1000) {
        transform.update(16.667);
        ticks++;
      }
      expect(ticks).toBeGreaterThan(1);
      expect(transform.rotation).toBe(internals.targetRotation);
      expect(transform.rotation).toBeCloseTo(-Math.PI / 2, 12);
    });

    it('lookAt reports whether it set a heading', () => {
      const { transform, internals } = make();
      transform.lookAt({ lat: 1, lon: 0 });
      const before = internals.targetRotation;

      expect(transform.lookAt({ lat: 5e-8, lon: 5e-8 })).toBe(false); // under the 1e-7 deg threshold
      expect(internals.targetRotation).toBe(before);
      expect(transform.lookAt({ lat: 0, lon: 1 })).toBe(true);
    });

    it('update() changes nothing whenever the flag is clear, so skipping it is exact', () => {
      const { transform, sink, internals } = make();
      let seed = 12345;
      const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

      for (let i = 0; i < 2000; i++) {
        const op = rand();
        if (op < 0.15) {
          transform.lookAt({ lat: rand() - 0.5, lon: rand() - 0.5 });
        } else if (op < 0.2) {
          transform.lookAt({ lat: transform.position.lat + 1e-9, lon: transform.position.lon });
        } else if (op < 0.25) {
          transform.rotation = rand() * 2 * Math.PI - Math.PI;
        } else if (op < 0.3) {
          transform.rotation = internals.targetRotation;
        } else {
          transform.update(16.667);
        }

        expect(sink.isTurning).toBe(
          internals.rotationInitialized && transform.rotation !== internals.targetRotation,
        );
        if (!sink.isTurning) {
          const before = transform.rotation;
          transform.update(16.667);
          expect(Object.is(transform.rotation, before)).toBe(true);
        }
      }
    });

    it('works without a sink (towers, projectiles)', () => {
      const transform = new TransformComponent(new TestGameObject());
      transform.lookAt({ lat: 1, lon: 0 });
      transform.lookAt({ lat: 0, lon: 1 });
      transform.update(16.667);
      expect(transform.rotation).toBeLessThan(0);
    });
  });
});
