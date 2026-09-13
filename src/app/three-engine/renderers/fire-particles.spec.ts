import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color, Vector3 } from 'three';
import type { Particle } from './particle-pool-manager';
import { igniteFireParticle, setFireColor } from './fire-particles';

const particle = (): Particle => ({
  position: new Vector3(),
  velocity: new Vector3(),
  life: 0,
  maxLife: 1,
  size: 1,
  color: new Color(),
  frameIndex: -1,
  totalFrames: 0,
  sizeStart: 1,
  sizeEnd: 0,
});

describe('fire particles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lights a particle within the radius, rising, alive, with the size bonus on top', () => {
    const center = new Vector3(10, 5, -3);
    for (let i = 0; i < 50; i++) {
      const p = particle();
      igniteFireParticle(p, center, 4, 1.5);
      expect(Math.hypot(p.position.x - 10, p.position.z + 3)).toBeLessThanOrEqual(4);
      expect(p.position.y).toBe(5);
      expect(p.velocity.y).toBeGreaterThanOrEqual(6);
      expect(p.life).toBe(1);
      expect(p.maxLife).toBeGreaterThanOrEqual(0.2);
      expect(p.size).toBeGreaterThanOrEqual(3);
      expect(p.size).toBeLessThanOrEqual(5.5);
    }
  });

  it('draws the random numbers in a fixed order', () => {
    // angle, distance, three velocities, life, size, colour: eight draws
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    igniteFireParticle(particle(), new Vector3(), 4);
    expect(random).toHaveBeenCalledTimes(8);
  });

  it('colours a fire yellow, orange or red', () => {
    const p = particle();
    const random = vi.spyOn(Math, 'random');
    for (const [t, hex] of [[0.1, new Color(1, 0.9, 0.3)], [0.5, new Color(1, 0.5, 0.1)], [0.9, new Color(1, 0.2, 0.05)]] as const) {
      random.mockReturnValueOnce(t);
      setFireColor(p);
      expect(p.color.getHex()).toBe(hex.getHex());
    }
  });
});
