import { TOUR_STEPS, markTourDone, tourAdvance, tourPending } from './tour';

describe('editor tour', () => {
  it('goes on when the player does what a step asks, and is remembered once done', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(7);
    const land = TOUR_STEPS.findIndex((s) => s.id === 'land');
    expect(tourAdvance(land, 'change', { paths: true })).toBe(land);
    expect(tourAdvance(land, 'change', { heights: { i0: 0, j0: 0, i1: 1, j1: 1 } })).toBe(land + 1);
    const road = TOUR_STEPS.findIndex((s) => s.id === 'road');
    expect(tourAdvance(road, 'change', { paths: true })).toBe(road + 1);
    const check = TOUR_STEPS.findIndex((s) => s.id === 'check');
    expect(tourAdvance(check, 'trial', null)).toBe(check);
    expect(tourAdvance(check, 'check', null)).toBe(check + 1);
    // The first step waits for Next
    expect(tourAdvance(0, 'change', { heights: { i0: 0, j0: 0, i1: 1, j1: 1 } })).toBe(0);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(tourPending(storage)).toBe(true);
    markTourDone(storage);
    expect(tourPending(storage)).toBe(false);
  });
});
