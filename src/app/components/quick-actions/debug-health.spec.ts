import { describe, it, expect } from 'vitest';
import { debugHealthAmount } from './debug-health';

describe('debugHealthAmount', () => {
  const click = (type: string, shiftKey = false) => debugHealthAmount({ type, shiftKey } as MouseEvent);

  it('gives 1000 HP on a click and 100k with Shift', () => {
    expect(click('click')).toBe(1000);
    expect(click('click', true)).toBe(100000);
  });

  it('takes 10 HP on a right click and 1000 with Shift', () => {
    expect(click('contextmenu')).toBe(-10);
    expect(click('contextmenu', true)).toBe(-1000);
  });

  it('dials 100 HP per wheel notch over the button, 1000 with Shift', () => {
    const wheel = (deltaY: number, shiftKey = false) =>
      debugHealthAmount({ type: 'wheel', shiftKey, deltaY } as WheelEvent);
    expect(wheel(-120)).toBe(100);
    expect(wheel(120)).toBe(-100);
    expect(wheel(-120, true)).toBe(1000);
    expect(wheel(120, true)).toBe(-1000);
  });
});
