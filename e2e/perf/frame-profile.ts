// Where a long frame's main-thread time went (Chromium only): a CPU profile of the page while the page itself records
// each frame over a threshold, then per long frame the functions by inclusive time. For the hitch probes
// (hitch-probe.ts, editor-stroke-probe.ts).
//   const profiler = await FrameProfiler.attach(page, 100); await profiler.start(); ...; console.log(await profiler.stop(18));
import type { CDPSession, Page } from '@playwright/test';
import type { CpuProfile } from './cdp-profile.ts';

export class FrameProfiler {
  private startMs = 0;
  private readonly page: Page;
  private readonly cdp: CDPSession;
  private readonly longMs: number;

  // Node strips the types only: no parameter properties
  private constructor(page: Page, cdp: CDPSession, longMs: number) {
    this.page = page;
    this.cdp = cdp;
    this.longMs = longMs;
  }

  static async attach(page: Page, longMs: number): Promise<FrameProfiler> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    return new FrameProfiler(page, cdp, longMs);
  }

  /** Profiles from now on; the page records its frames over the threshold, each with its start and end */
  async start(): Promise<void> {
    await this.cdp.send('Profiler.start');
    this.startMs = await this.page.evaluate((longMs) => {
      const long: [number, number][] = [];
      (globalThis as { __longFrames?: [number, number][] }).__longFrames = long;
      let last = performance.now();
      const frame = () => {
        const now = performance.now();
        if (now - last > longMs) long.push([last, now]);
        last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      return performance.now();
    }, this.longMs);
  }

  /**
   * Ends the profile: per long frame its length, when it came and the top `lines` functions by inclusive time;
   * with `total`, first the same over the whole profile (where a held brush's frames go on average)
   */
  async stop(lines: number, total = false): Promise<string> {
    const long = await this.page.evaluate(() => (globalThis as { __longFrames?: [number, number][] }).__longFrames ?? []);
    const { profile } = (await this.cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
    // The page's clock to the profile's: both start together, near enough for frames of 100 ms and more
    const toUs = (ms: number) => profile.startTime + (ms - this.startMs) * 1000;
    const head = total ? `TOTAL ${((profile.endTime - profile.startTime) / 1000).toFixed(0)} ms
${inclusive(profile, profile.startTime, profile.endTime, lines)}
` : '';
    return head + long
      .map(([from, to]) => `FRAME ${Math.round(to - from)} ms at ${((from - this.startMs) / 1000).toFixed(1)} s\n${inclusive(profile, toUs(from), toUs(to), lines)}`)
      .join('\n');
  }
}

/** Inclusive main-thread time per function between `fromUs` and `toUs` (the profile's clock), the top `limit` */
function inclusive(profile: CpuProfile, fromUs: number, toUs: number, limit: number): string {
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const total = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let t = profile.startTime;
  for (let i = 0; i < samples.length; i++) {
    t += deltas[i] ?? 0;
    if (t < fromUs || t > toUs) continue;
    const us = deltas[i + 1] ?? 0;
    const seen = new Set<string>();
    for (let id: number | undefined = samples[i]; id !== undefined; id = parent.get(id)) {
      const f = byId.get(id)!.callFrame;
      if (!f.url || /zone|polyfills/.test(f.url)) continue;
      const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()?.split('?')[0]}:${f.lineNumber + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) ?? 0) + us);
    }
  }
  return [...total.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`)
    .join('\n');
}
