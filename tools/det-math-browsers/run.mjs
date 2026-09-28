// Cross-engine check of the deterministic math (TODO E28): runs DetMath over fixed inputs and the
// simulation of the re-simulation spec in Node and in Playwright's Chromium, Firefox and WebKit,
// then compares the result bits. The native functions run alongside to show where engines differ.
//
//   node tools/det-math-browsers/run.mjs [out.json] [inputs per function]
//
// With DET_MATH_BUNDLE=<file> it runs that bundle instead of building one.
//
// Playwright comes from e2e/node_modules (npm install in e2e/; browsers: npx playwright install
// chromium firefox webkit). E2E_DIR points elsewhere, e.g. at the main checkout from a worktree.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(tmpdir(), 'det-math-result.json');
const n = Number(process.argv[3] ?? 1_000_000);
const e2e = process.env.E2E_DIR ?? path.join(here, '../../e2e');
const { chromium, firefox, webkit } = createRequire(path.join(e2e, 'package.json'))('playwright');

// DET_MATH_BUNDLE: a bundle built before (build.mjs), e.g. of an older state of the code
const file = process.env.DET_MATH_BUNDLE ?? path.join(mkdtempSync(path.join(tmpdir(), 'det-math-')), 'sim-run.mjs');
if (!process.env.DET_MATH_BUNDLE) await bundle(file);

const results = {};

// Node: what the specs see. The music fades on requestAnimationFrame, which Node lacks
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
const mod = await import(pathToFileURL(file).href);
results[`node ${process.versions.node} (V8 ${process.versions.v8})`] = mod.run(n);
console.log('node done');

const server = createServer((req, res) => {
  if (req.url === '/sim-run.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(file));
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>det-math</title>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async (count) => (await import('/sim-run.mjs')).run(count), n);
    results[`${name} ${browser.version()}`] = result;
    console.log(`${name} done`);
  } catch (error) {
    results[name] = { error: String(error).slice(0, 500) };
    console.log(`${name} failed: ${String(error).slice(0, 200)}`);
  } finally {
    await browser?.close();
  }
}
server.close();

// Compare every engine with the first: DetMath and the simulation must match, native may not
const names = Object.keys(results).filter((k) => !results[k].error);
const ref = results[names[0]];
const summary = { inputsPerFunction: n, engines: names, detSame: {}, simSame: {}, nativeDiffers: {} };
for (const k of names.slice(1)) {
  const r = results[k];
  summary.detSame[k] = Object.keys(ref.det).filter((f) => r.det[f] !== ref.det[f]).length === 0
    ? 'all equal' : Object.keys(ref.det).filter((f) => r.det[f] !== ref.det[f]);
  summary.simSame[k] = Object.fromEntries(Object.keys(ref.sim).map((w) => [w, JSON.stringify(r.sim[w]) === JSON.stringify(ref.sim[w])]));
  summary.nativeDiffers[k] = Object.keys(ref.native).filter((f) => r.native[f] !== ref.native[f]);
}
writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
// The music's timers of the Node run would keep the process alive
process.exit(0);
