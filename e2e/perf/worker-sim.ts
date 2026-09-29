// Worker stage 1 (docs/WORKER_PLAN.md): the real simulation (GameStateManager without a picture,
// tools/worker-sim) on the main thread against a module worker, in Chromium and Firefox. Records a run
// of four waves once, re-simulates it from the replay file on both sides and in both browsers and
// compares every state hash; then times the sub-step at N enemies on both sides.
//
//   node tools/worker-sim/build.mjs
//   node tools/worker-sim/server.mjs                       (:4250, cross-origin isolated)
//   node e2e/perf/worker-sim.ts [enemies=5000] [chromium,firefox] [--no-bench]
import { chromium, firefox, type Page } from '@playwright/test';

const ENEMIES = Number(process.argv[2] ?? 5000);
const ENGINES = (process.argv[3] ?? 'chromium,firefox').split(',');
const BENCH = !process.argv.includes('--no-bench');
const URL = 'http://localhost:4250/';

type Where = 'main' | 'worker';
interface WaveResult { wave: number; steps: number; hashes: number; checked: number; divergedAt: number | null; endHash: number; ms: number }

const run = (page: Page, where: Where, op: string, ...args: unknown[]) =>
  page.evaluate(([w, o, a]) => (window as unknown as { labRun: (...x: unknown[]) => Promise<unknown> }).labRun(w, o, ...(a as unknown[])),
    [where, op, args] as const);

let recorded: { text: string; waves: WaveResult[]; ms: number; by: string } | null = null;
const rows: string[] = [];

for (const [name, engine] of ([['chromium', chromium], ['firefox', firefox]] as const).filter(([n]) => ENGINES.includes(n))) {
  const browser = await engine.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as { labReady?: boolean }).labReady === true);

  for (const where of ['main', 'worker'] as const) {
    console.log(name, where, 'env', JSON.stringify(await run(page, where, 'env')));
  }
  if (!recorded) {
    const r = (await run(page, 'main', 'record')) as { text: string; waves: WaveResult[]; ms: number };
    recorded = { ...r, by: `${name} main` };
    console.log(`recorded (${name} main, ${r.ms.toFixed(0)} ms, ${(r.text.length / 1024).toFixed(0)} kB):`,
      r.waves.map((w) => `W${w.wave} ${w.steps} steps ${w.hashes} hashes end ${w.endHash >>> 0}`).join(' | '));
  }
  for (const where of ['main', 'worker'] as const) {
    const r = (await run(page, where, 'resimulate', recorded.text)) as { waves: WaveResult[]; ms: number };
    for (const w of r.waves) {
      const live = recorded.waves.find((l) => l.wave === w.wave)!;
      const same = w.divergedAt === null && w.checked === live.hashes && w.endHash === live.endHash && w.steps === live.steps;
      rows.push(`| ${name} | ${where} | W${w.wave} | ${w.steps} | ${w.checked}/${live.hashes} | ${w.divergedAt ?? '-'} | ${w.endHash === live.endHash ? 'gleich' : 'ANDERS'} | ${w.ms.toFixed(0)} | ${same ? 'ja' : 'NEIN'} |`);
    }
    console.log(name, where, 'resim', r.ms.toFixed(0), 'ms');
  }
  if (process.argv.includes('--reach')) console.log(name, 'reach (worker)', JSON.stringify(await run(page, 'worker', 'reach')));
  for (const where of ['main', 'worker'] as const) {
    console.log(name, where, 'diagnostics', JSON.stringify(await run(page, where, 'diagnostics'), null, 1));
  }
  if (BENCH) {
    for (const where of ['main', 'worker'] as const) {
      for (const speed of [1, 4]) {
        const s = (await run(page, where, 'bench', ENEMIES, speed)) as Record<string, number>;
        const line = { browser: name, where, enemies: ENEMIES, speed, ...s };
        console.log(JSON.stringify(line));
      }
    }
    console.log(name, 'stubbed services (main):', JSON.stringify(await run(page, 'main', 'stubbedServices')));
  }
  if (errors.length) console.log(name, 'page errors:', errors.join('\n'));
  await browser.close();
}

console.log(`\nre-simulation of the run recorded on ${recorded?.by}:`);
console.log('| Browser | Ort | Welle | Sub-Steps | Prüfsummen | abweichend ab | Ende | ms | bitgleich |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
