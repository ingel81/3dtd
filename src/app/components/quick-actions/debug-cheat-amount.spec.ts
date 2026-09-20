import { describe, it, expect } from 'vitest';
import { DEBUG_CREDITS_STEPS, DEBUG_HEALTH_STEPS, debugCheatAmount } from './debug-cheat-amount';

describe('debugCheatAmount', () => {
  const click = (type: string, shiftKey = false) =>
    debugCheatAmount({ type, shiftKey } as MouseEvent, DEBUG_HEALTH_STEPS);
  const wheel = (deltaY: number, shiftKey = false) =>
    debugCheatAmount({ type: 'wheel', shiftKey, deltaY } as WheelEvent, DEBUG_HEALTH_STEPS);

  it('gives 1000 on a click and 100k with Shift', () => {
    expect(click('click')).toBe(1000);
    expect(click('click', true)).toBe(100000);
  });

  it('takes 10 on a right click and 1000 with Shift', () => {
    expect(click('contextmenu')).toBe(-10);
    expect(click('contextmenu', true)).toBe(-1000);
  });

  it('dials 100 per wheel notch over the tile, 1000 with Shift', () => {
    expect(wheel(-120)).toBe(100);
    expect(wheel(120)).toBe(-100);
    expect(wheel(-120, true)).toBe(1000);
    expect(wheel(120, true)).toBe(-1000);
  });

  it('gives the credits tile the same steps as the HP tile', () => {
    expect(DEBUG_CREDITS_STEPS).toEqual(DEBUG_HEALTH_STEPS);
  });
});
