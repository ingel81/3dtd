import { describe, expect, it } from 'vitest';
import { NEXT_WAVE_MARKS, markIconSize, peekUpcomingWaves } from './upcoming-waves';

/**
 * Playtest 516 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: after a jump to
 * wave 20 the NEXT line starts at W21. The template draws the plane for
 * `air` and the moon for `bloodMoon` in markIconSize px.
 */
describe('NEXT mark of W21, playtest 516 replayed', () => {
  it('shows the plane and the moon at 10 px with the blood moon look on', () => {
    const w21 = peekUpcomingWaves(20, 0, NEXT_WAVE_MARKS).find((p) => p.wave === 21)!;
    expect(w21).toMatchObject({ boss: false, air: true, bloodMoon: true });
    expect(markIconSize(w21)).toBe(10);
  });
});
