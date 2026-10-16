import { HeightUpdateService } from './height-update.service';

/** The overlay's height cycles: four updates while the ground streams, one where it stands at once */
describe('HeightUpdateService', () => {
  let service: HeightUpdateService;
  let renders: number;

  const engine = (streaming: boolean) =>
    ({ world: { capabilities: { streaming } }, terrain: { clearHeightCache: () => undefined } }) as never;

  beforeEach(() => {
    vi.useFakeTimers();
    renders = 0;
    service = new HeightUpdateService();
  });
  afterEach(() => vi.useRealTimers());

  const init = (streaming: boolean) =>
    service.initialize(engine(streaming), () => undefined, () => renders++, () => undefined, () => undefined, () => undefined);

  it('takes one update where the ground stands at once, on a timeout, and leaves no timer behind', async () => {
    init(false);
    const done = service.scheduleOverlayHeightUpdate();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(renders).toBe(1);
    expect(service.heightsLoading()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a running cycle give way to a new one: its waiter goes on, no lost timer runs on', async () => {
    init(true);
    let first = false;
    void service.scheduleOverlayHeightUpdate().then(() => (first = true));
    await vi.advanceTimersByTimeAsync(500);
    expect(renders).toBe(1);
    const second = service.scheduleOverlayHeightUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toBe(true);
    await vi.advanceTimersByTimeAsync(4 * 500);
    await second;
    // One update of the first cycle, four of the second; nothing after
    expect(renders).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(renders).toBe(5);
  });

  it('stops with its world: no timer runs on, and the end of the cycle reaches none of its callbacks', async () => {
    let ends = 0;
    service.initialize(engine(true), () => undefined, () => renders++, () => ends++, () => undefined, () => ends++, () => ends++);
    let waited = false;
    void service.scheduleOverlayHeightUpdate().then(() => (waited = true));
    await vi.advanceTimersByTimeAsync(500);
    service.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect([renders, ends, waited]).toEqual([1, 0, false]);
  });
});
