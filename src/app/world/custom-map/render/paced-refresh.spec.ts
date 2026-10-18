import { PacedRefresh } from './paced-refresh';

describe('PacedRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** An editor drag of thousands of objects rebuilt every fire and lamp and the contact shadows each frame */
  it('runs at once after a rest, then at most once per interval with what came meanwhile, and once after the last', () => {
    let now = 0;
    const runs: (number[] | null)[] = [];
    const paced = new PacedRefresh<number>(100, (items) => runs.push(items), () => now);
    paced.request([1]);
    expect(runs).toEqual([[1]]);
    // A drag: a request each frame
    for (let k = 2; k <= 6; k++) {
      now += 16;
      vi.advanceTimersByTime(16);
      paced.request([k]);
    }
    expect(runs).toEqual([[1]]);
    now = 100;
    vi.advanceTimersByTime(100 - 80);
    expect(runs).toEqual([[1], [2, 3, 4, 5, 6]]);
    // One asking for everything wins over the items
    paced.request([7]);
    paced.request();
    now = 200;
    vi.advanceTimersByTime(100);
    expect(runs.at(-1)).toBeNull();
    expect(runs).toHaveLength(3);
  });

  it('forgets what waits when cancelled', () => {
    let now = 0;
    const runs: unknown[] = [];
    const paced = new PacedRefresh<number>(100, (items) => runs.push(items), () => now);
    paced.request([1]);
    paced.request([2]);
    paced.cancel();
    now = 500;
    vi.advanceTimersByTime(500);
    expect(runs).toEqual([[1]]);
  });
});
