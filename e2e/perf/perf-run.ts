// What the perf probes share for a baseline that later runs compare against (docs/E2E.md, "Baseline"):
//   --vsync / --no-vsync   frames at the display's rate or as fast as they go (each probe keeps its own default)
//   --user-data <dir>      a browser profile kept between runs, as a player's (its shader caches warm)
//   --json <file>          the probe's frames as JSON: per window the median, p95 and longest frame interval, the
//                          frames over 33 and 50 ms and the JS heap, with the probe's own numbers beside them
// A probe called without them runs and prints as before.
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

function argument(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : '';
}

/** Whether frames run at the display's rate: --vsync, --no-vsync, else the probe's default */
export function vsyncOn(byDefault: boolean): boolean {
  if (process.argv.includes('--vsync')) return true;
  if (process.argv.includes('--no-vsync')) return false;
  return byDefault;
}

/** Chromium's switches for the frame rate vsyncOn says */
export function vsyncArgs(byDefault: boolean): string[] {
  return vsyncOn(byDefault) ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
}

/** --user-data <dir>, or '' */
export const USER_DATA = argument('user-data');

/** One stretch of frames, summed up */
export interface FrameWindow {
  name: string;
  frames: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  over33: number;
  over50: number;
  /** JS heap over the window, MB (Chromium's performance.memory); null where the probe does not read it */
  heapMB: { start: number; end: number; max: number } | null;
  [more: string]: unknown;
}

const round = (x: number) => Math.round(x * 10) / 10;

/** A window from its frame intervals (ms) and the heap read in its frames (MB) */
export function frameWindow(name: string, gaps: readonly number[], heapMB: readonly number[] = [], more: Record<string, unknown> = {}): FrameWindow {
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
  return {
    name,
    frames: gaps.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
    over33: gaps.filter((g) => g > 33).length,
    over50: gaps.filter((g) => g > 50).length,
    heapMB: heapMB.length ? { start: round(heapMB[0]), end: round(heapMB.at(-1)!), max: round(Math.max(...heapMB)) } : null,
    ...more,
  };
}

/** The windows of a run, written to --json at the end (nothing without it) */
export class FrameReport {
  readonly windows: FrameWindow[] = [];
  private readonly file = argument('json');

  /** Whether --json was given: a probe records what only the report needs then */
  get enabled(): boolean {
    return this.file !== '';
  }

  add(window: FrameWindow): void {
    this.windows.push(window);
  }

  /** Writes the windows with the probe's name, its arguments, the build measured, the frame rate and `extra` */
  async write(probe: string, url: string, vsync: boolean, extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.file) return;
    const build = await fetch(`${url}/build-info.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const out = { probe, args: process.argv.slice(2), at: new Date().toISOString(), build, vsync, windows: this.windows, ...extra };
    writeFileSync(this.file, JSON.stringify(out, null, 1));
  }
}

/** Records every frame's interval and the heap in the page from now on (stopFrames reads and ends it) */
export function startFrames(page: Page): Promise<void> {
  return page.evaluate(() => {
    const heap = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576;
    const rec = { gaps: [] as number[], heap: [] as number[], on: true };
    (globalThis as unknown as { __frames: typeof rec }).__frames = rec;
    let last = performance.now();
    const tick = (now: number) => {
      if (!rec.on) return;
      rec.gaps.push(now - last);
      rec.heap.push(heap());
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(tick);
    });
  });
}

/** The frames since startFrames, and the recording ended */
export function stopFrames(page: Page): Promise<{ gaps: number[]; heap: number[] }> {
  return page.evaluate(() => {
    const rec = (globalThis as unknown as { __frames: { gaps: number[]; heap: number[]; on: boolean } }).__frames;
    rec.on = false;
    return { gaps: rec.gaps, heap: rec.heap };
  });
}

/**
 * An own map into the page's map store (IndexedDB `3dtd-maps`, as IndexedDbMapBackend keeps it): `file` is a
 * .3dtdmap with its .summary.json beside it. The page must be on the game's origin.
 */
export async function seedMap(page: Page, file: string): Promise<void> {
  const bytes = [...readFileSync(file)];
  const summary = JSON.parse(readFileSync(file.replace(/\.3dtdmap$/, '.summary.json'), 'utf8')) as { id: string };
  await page.evaluate(async ({ bytes, summary }) => {
    await new Promise((resolve, reject) => {
      // No version: a kept profile's store is at the app's (MapStore's), a fresh one starts at 1 and the app upgrades it
      const req = indexedDB.open('3dtd-maps');
      req.onupgradeneeded = () => {
        for (const store of ['files', 'summaries']) {
          if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(['files', 'summaries'], 'readwrite');
        tx.objectStore('files').put({ id: summary.id, file: new Uint8Array(bytes), preview: null });
        tx.objectStore('summaries').put(summary);
        tx.oncomplete = () => {
          req.result.close();
          resolve(null);
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, { bytes, summary });
}
