// The heavy run of sim-run.ts (heavy()) in Node, Chromium and Firefox: the state hash at every
// sub-step boundary, and the first sub-step where an engine parts from Node (TODO E64).
//
//   node tools/det-math-browsers/run-heavy.mjs [out.json] [waves]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(tmpdir(), 'det-heavy-result.json');
const waves = Number(process.argv[3] ?? 6);
const e2e = process.env.E2E_DIR ?? path.join(here, '../../e2e');
const { chromium, firefox } = createRequire(path.join(e2e, 'package.json'))('playwright');

const file = path.join(mkdtempSync(path.join(tmpdir(), 'det-heavy-')), 'sim-run.mjs');
await bundle(file);

const results = {};
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
const mod = await import(pathToFileURL(file).href);
results.node = mod.heavy(waves);
console.log(`node: ${results.node.waves} waves, ${results.node.subSteps} sub-steps, ${results.node.kills} kills`);

const server = createServer((req, res) => {
  if (req.url === '/sim-run.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(file));
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>det-heavy</title>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  let browser;
  try {
    browser = await type.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin);
    results[name] = await page.evaluate(async (w) => (await import('/sim-run.mjs')).heavy(w), waves);
    results[name].version = browser.version();
    console.log(`${name} ${browser.version()}: ${results[name].waves} waves, ${results[name].subSteps} sub-steps, ${results[name].kills} kills`);
  } catch (error) {
    results[name] = { error: String(error).slice(0, 500) };
    console.log(`${name} failed: ${String(error).slice(0, 300)}`);
  } finally {
    await browser?.close();
  }
}
server.close();

const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : n;
};
const summary = {};
for (const name of ['chromium', 'firefox']) {
  const r = results[name];
  summary[name] = r.error ? r.error : { firstDiffFromNode: firstDiff(results.node.hashes, r.hashes), subSteps: r.subSteps, kills: r.kills };
}
summary.firefoxVsChromium = results.chromium.hashes && results.firefox.hashes ? firstDiff(results.chromium.hashes, results.firefox.hashes) : null;
writeFileSync(out, JSON.stringify({ summary, node: { waves: results.node.waves, subSteps: results.node.subSteps, kills: results.node.kills } }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
