// How long a custom map takes from the link to a playable game (docs/CUSTOM_MAP_WORLD.md): a production build,
// `?world=map:<id>&menu=skip`, the loading steps' performance marks (`load:<step>:start|done`, `load:ready`,
// EngineInitializationService) per run, optionally the main thread's CPU time over the load by function (from a
// Chromium trace: a profiler session does not survive the navigation into the cross-origin isolated page).
//
//   npm run build
//   node e2e/perf/serve.mjs dist/3DTD/browser 4227 --isolate
//   node e2e/perf/map-load.ts --url http://localhost:4227 --map demo-valley [--runs 3] [--profile [--trace out.json]]
//   An own map (not shipped): --seed tmp/w3x-out/<id>.3dtdmap (with <id>.summary.json beside it, `npm run w3x-import`)
//
// Headed Chromium: the terrain and the models compile their shaders on the GPU the player has, not in SwiftShader.
import { chromium, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4227');
const MAP = argument('map', 'demo-valley');
const SEED = argument('seed', '');
const RUNS = Number(argument('runs', '1'));
const PROFILE = process.argv.includes('--profile');
const TRACE_FILE = argument('trace', '');
const TOP = Number(argument('top', '40'));

interface Mark {
  name: string;
  at: number;
}

interface ProfileNode {
  id: number;
  parent?: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
}

interface TraceEvent {
  name: string;
  pid: number;
  tid: number;
  id?: string;
  ts: number;
  dur?: number;
  args?: { data?: { cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }; timeDeltas?: number[]; url?: string } };
}

/** The own map into the page's map store (IndexedDB `3dtd-maps`, as IndexedDbMapBackend keeps it) */
async function seed(page: Page, file: string): Promise<void> {
  const bytes = [...readFileSync(file)];
  const summary = JSON.parse(readFileSync(file.replace(/\.3dtdmap$/, '.summary.json'), 'utf8')) as { id: string };
  await page.evaluate(async ({ bytes, summary }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('3dtd-maps', 1);
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

async function marks(page: Page): Promise<Mark[]> {
  return page.evaluate(() =>
    performance.getEntriesByType('mark').filter((m) => m.name.startsWith('load:')).map((m) => ({ name: m.name.slice(5), at: Math.round(m.startTime) })),
  );
}

/**
 * Self time per function of the trace's busiest sampled thread (the page's main thread over a load), and the
 * time in GPU and compile work the sampler books as "(program)" split by the timeline's event names
 */
function profileReport(events: TraceEvent[]): string {
  const profiles = new Map<string, { nodes: Map<number, ProfileNode>; samples: number[]; deltas: number[] }>();
  for (const e of events) {
    if (e.name !== 'ProfileChunk') continue;
    const key = `${e.pid}:${e.id}`;
    const p = profiles.get(key) ?? { nodes: new Map(), samples: [], deltas: [] };
    for (const n of e.args?.data?.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
    p.samples.push(...(e.args?.data?.cpuProfile?.samples ?? []));
    p.deltas.push(...(e.args?.data?.timeDeltas ?? []));
    profiles.set(key, p);
  }
  let best: { nodes: Map<number, ProfileNode>; samples: number[]; deltas: number[] } | null = null;
  for (const p of profiles.values()) if (!best || p.samples.length > best.samples.length) best = p;
  if (!best) return 'no CPU profile in the trace';
  const self = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < best.samples.length; i++) {
    const node = best.nodes.get(best.samples[i]);
    const us = best.deltas[i + 1] ?? best.deltas[i] ?? 0;
    if (!node || node.callFrame.functionName === '(idle)') continue;
    const f = node.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${(f.url ?? '').split('/').pop() ?? ''}:${(f.lineNumber ?? -1) + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    total += us;
  }
  const lines = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([key, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${key}`);
  // Long timeline events of the main thread by name (compile, GPU, parse, layout)
  const byName = new Map<string, number>();
  for (const e of events) {
    if (e.dur === undefined || e.dur < 1000) continue;
    if (!/Compile|Parse|GPU|Layout|Paint|Decode|Raster|EvaluateScript|FunctionCall|TimerFire|RunMicrotasks|FireAnimationFrame/.test(e.name)) continue;
    byName.set(e.name, (byName.get(e.name) ?? 0) + e.dur);
  }
  const named = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${n}`);
  return `busy ${(total / 1000).toFixed(0)} ms, by function:\n${lines.join('\n')}\n\ntimeline events (summed, nested ones twice):\n${named.join('\n')}`;
}

// A saved trace only: --analyze trace.json
const ANALYZE = argument('analyze', '');
if (ANALYZE) {
  console.log(profileReport((JSON.parse(readFileSync(ANALYZE, 'utf8')) as { traceEvents: TraceEvent[] }).traceEvents));
  process.exit(0);
}

const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,900'] });
const totals: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
  });
  // On the game's origin first: the map store needs it
  await page.goto(`${URL_BASE}/build-info.json`);
  if (SEED) await seed(page, SEED);
  const tracing = PROFILE && run === 0;
  if (tracing) {
    await browser.startTracing(page, {
      categories: ['devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-devtools.timeline', 'gpu'],
    });
  }
  await page.goto(`${URL_BASE}/?world=map:${MAP}&menu=skip`);
  const end = Date.now() + 180_000;
  let found: Mark[] = [];
  while (Date.now() < end) {
    found = await marks(page);
    if (found.some((m) => m.name === 'ready')) break;
    const alert = page.locator('[role="alert"]');
    if (await alert.count()) problems.push((await alert.first().innerText()).slice(0, 200));
    if (problems.length) break;
    await page.waitForTimeout(100);
  }
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { dom: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
  });
  const ready = found.find((m) => m.name === 'ready')?.at;
  console.log(`\nrun ${run + 1}: ${ready !== undefined ? `ready at ${ready} ms` : 'not ready'} (DOM ${nav.dom} ms, load ${nav.load} ms)`);
  let last = 0;
  for (const m of found.sort((a, b) => a.at - b.at)) {
    console.log(`  ${String(m.at).padStart(6)} ms  +${String(m.at - last).padStart(5)}  ${m.name}`);
    last = m.at;
  }
  if (problems.length) console.log(`  problems: ${problems.join(' | ')}`);
  if (ready !== undefined) totals.push(ready);
  if (tracing) {
    const trace = await browser.stopTracing();
    if (TRACE_FILE) writeFileSync(TRACE_FILE, trace);
    const parsed = JSON.parse(trace.toString('utf8')) as { traceEvents: TraceEvent[] };
    console.log(`\n${profileReport(parsed.traceEvents)}`);
  }
  await context.close();
}
if (totals.length > 1) {
  const sorted = [...totals].sort((a, b) => a - b);
  console.log(`\nready: ${totals.join(', ')} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms`);
}
await browser.close();
