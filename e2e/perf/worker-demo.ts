// The worker demo (docs/archive/WORKER_PLAN.md, TODO E57) in Chromium and Firefox: the simulation's state of
// 5000 enemies each frame, on the main thread against a worker (postMessage with a transferred buffer,
// SharedArrayBuffer), at game speed 1 and 4; and which of the game's foreign sources still answer a
// page under COOP/COEP.
//
//   node tools/worker-demo/server.mjs          (ports 4240 none, 4241 require-corp, 4242 credentialless)
//   node e2e/perf/worker-demo.ts <sim ms per sub-step> <render ms per frame> [chromium,firefox] [--no-coep]
//
// 2.8 and 13 stand in for E57's measurement (5000 enemies, speed 4, 24 FPS on the main thread).
import { chromium, firefox, type Browser } from '@playwright/test';

const BUSY = Number(process.argv[2] ?? 2.8);
const RENDER = Number(process.argv[3] ?? 0);
const ENGINES = (process.argv[4] ?? 'chromium,firefox').split(',');
const COEP = !process.argv.includes('--no-coep');
const out: unknown[] = [];

async function page(browser: Browser, url: string, wait: number): Promise<unknown> {
  const p = await (await browser.newContext()).newPage();
  await p.goto(url);
  await p.waitForFunction(() => (window as unknown as { __result?: unknown }).__result !== undefined, null, { timeout: wait });
  const r = await p.evaluate(() => (window as unknown as { __result: unknown }).__result);
  await p.context().close();
  return r;
}

for (const [name, engine] of ([['chromium', chromium], ['firefox', firefox]] as const).filter(([n]) => ENGINES.includes(n))) {
  const browser = await engine.launch({ headless: true });
  for (const [port, coep] of COEP ? [[4240, 'none'], [4241, 'require-corp'], [4242, 'credentialless']] as const : []) {
    const r = await page(browser, `http://localhost:${port}/coep.html`, 60_000).catch((e) => String(e));
    out.push({ browser: name, check: 'coep', coep, result: r });
    console.log(JSON.stringify(out[out.length - 1]));
  }
  for (const speed of [1, 4]) {
    for (const [mode, port] of [['main', 4240], ['post', 4240], ['sab', 4242]] as const) {
      const r = await page(browser, `http://localhost:${port}/?mode=${mode}&n=5000&speed=${speed}&busy=${BUSY}&render=${RENDER}&seconds=8`, 60_000).catch((e) => String(e));
      out.push({ browser: name, mode, speed, result: r });
      console.log(JSON.stringify(out[out.length - 1]));
    }
  }
  await browser.close();
}
