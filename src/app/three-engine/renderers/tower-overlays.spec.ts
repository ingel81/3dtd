import { describe, it, expect } from 'vitest';
import { createLosRing, createTipMarker } from './tower-overlays';

describe('tower debug markers', () => {
  it('puts the tip marker and the LOS ring at the shoot height, drawn on top', () => {
    const tip = createTipMarker(1, 12, 3, true);
    const ring = createLosRing(1, 12, 3, 2.4, false);

    expect(tip.position.toArray()).toEqual([1, 12, 3]);
    expect(tip.visible).toBe(true);
    expect(ring.position.toArray()).toEqual([1, 12, 3]);
    expect(ring.visible).toBe(false);
    expect([tip.renderOrder, ring.renderOrder]).toEqual([999, 999]);
    expect(ring.geometry.getAttribute('position').getX(0)).toBeCloseTo(2.4, 6);
  });
});
