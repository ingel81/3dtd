import { TOOL_GROUPS } from '../../tools/tool';
import { TOUR_STEPS, markTourDone, tourAdvance, tourPending, tourResumeAt } from './tour';

function memory() {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}

describe('editor tour', () => {
  it('goes on when the player does what a step asks, and is remembered once done', () => {
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
    const storage = memory();
    expect(tourPending(storage)).toBe(true);
    markTourDone(storage);
    expect(tourPending(storage)).toBe(false);
    expect(tourResumeAt(storage)).toBeNull();
  });

  it('explains every tool of the column, in its order, and ends with the check, the trial and the test', () => {
    const tools = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
    // A new tool needs its entry in TOOL_TOUR
    expect(TOUR_STEPS.filter((s) => s.tool).map((s) => s.tool)).toEqual(tools);
    expect(TOUR_STEPS.slice(-3).map((s) => s.id)).toEqual(['check', 'trial', 'test']);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      // Short: a step is read in passing
      expect(s.message.length, s.id).toBeLessThanOrEqual(260);
      expect(s.hints.length, s.id).toBeGreaterThan(0);
    }
  });

  it('resumes a skipped tour at its step, but does not start it by itself', () => {
    const storage = memory();
    const trial = TOUR_STEPS.findIndex((s) => s.id === 'trial');
    markTourDone(storage, trial);
    expect(tourPending(storage)).toBe(false);
    expect(tourResumeAt(storage)).toBe(trial);
    // Skipped at the first step there is nothing to resume
    markTourDone(storage, 0);
    expect(tourResumeAt(storage)).toBeNull();
    // A step that no longer exists: nothing to resume, and still not by itself
    storage.setItem('3dtd-editor-tour', 'skipped:gone');
    expect(tourResumeAt(storage)).toBeNull();
    expect(tourPending(storage)).toBe(false);
  });
});
