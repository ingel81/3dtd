import { describe, it, expect } from 'vitest';

describe('Screen Shake Logic', () => {
  it('should calculate correct decay rate', () => {
    const intensity = 0.5;
    const duration = 200;
    const frameTime = 16.67; // ~60fps
    const decay = intensity / (duration / frameTime);

    // After duration ms, intensity should reach ~0
    const frames = Math.ceil(duration / frameTime);
    let currentIntensity = intensity;
    for (let i = 0; i < frames; i++) {
      currentIntensity = Math.max(0, currentIntensity - decay);
    }
    expect(currentIntensity).toBe(0);
  });

  it('should generate random offsets within intensity bounds', () => {
    const intensity = 1.0;
    for (let i = 0; i < 100; i++) {
      const offset = (Math.random() - 0.5) * 2 * intensity;
      expect(Math.abs(offset)).toBeLessThanOrEqual(intensity);
    }
  });
});
