import { describe, expect, it } from 'vitest';
import { NEXT_WAVE_MARKS, markShape, peekUpcomingWaves } from './upcoming-waves';
import { BudgetWaveSource } from '../../../director/sources/budget/budget-source';

/**
 * Playtest 516 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: after a jump to
 * wave 20 the NEXT line starts at W21. The template signs the mark by
 * markShape (a chevron for `air`) and draws the moon above for `bloodMoon`.
 */
describe('NEXT mark of W21, playtest 516 replayed', () => {
  it('signs it air and keeps the moon with the blood moon look on', () => {
    const facts = new BudgetWaveSource()
      .peek({ fromWave: 21, count: NEXT_WAVE_MARKS });
    const w21 = peekUpcomingWaves(facts).find((p) => p.wave === 21)!;
    expect(w21).toMatchObject({ boss: false, air: true, bloodMoon: true });
    expect(markShape(w21)).toBe('air');
  });
});

describe('NEXT mark of W22 (TODO E140)', () => {
  it('signs the Armored Push camouflaged: its zombie soldiers come hidden', () => {
    const facts = new BudgetWaveSource().peek({ fromWave: 22, count: 1 });
    const [w22] = peekUpcomingWaves(facts);
    expect(w22).toMatchObject({ wave: 22, camo: true, air: false, boss: false });
    expect(markShape(w22)).toBe('camo');
  });
});
