import { describe, it, expect } from 'vitest';

describe('GameSpeedComponent', () => {
  describe('speed cycling logic', () => {
    const speeds = [1, 2, 4];

    const getNext = (current: number): number => {
      const idx = speeds.indexOf(current);
      return speeds[(idx + 1) % speeds.length];
    };

    it('should cycle through 1 → 2 → 4 → 1', () => {
      expect(getNext(1)).toBe(2);
      expect(getNext(2)).toBe(4);
      expect(getNext(4)).toBe(1);
    });

    it('should handle unknown speed gracefully', () => {
      // indexOf returns -1, (-1+1)%3 = 0, speeds[0] = 1
      expect(getNext(3)).toBe(1);
    });
  });
});
