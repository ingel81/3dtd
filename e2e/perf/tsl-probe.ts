// The TSL probe (docs/RENDER_DENSITY_PLAN.md, "Umzug auf WebGPU"): one medium shader of the game (a ruin's
// damage, simplified) written once in TSL (e2e/perf/tsl-probe/index.html), drawn by three's WebGPURenderer on
// WebGPU and on its WebGL 2 backend in the same Chromium. Prints per backend whether it ran, the time to build the
// pipelines or programs, the first frame and the median CPU and GPU time per frame, saves a picture of each and
// how far the two pictures differ (share of pixels off by more than 8 of 255 in any channel).
//
//   node e2e/perf/tsl-probe.ts [--port 4442] [--count 2000] [--out tmp/tsl-probe]
//
// Needs no build: the page loads three from node_modules (served under /__three/). Port 4440-4449, frames uncapped,
// a visible window, ANGLE D3D11 on Windows (WebGPU there runs on D3D12 through Dawn).
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { vsyncArgs } from './perf-run.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = Number(argument('port', '4442'));
const COUNT = Number(argument('count', '2000'));
const OUT = resolve(ROOT, argument('out', 'tmp/tsl-probe'));
if (PORT < 4440 || PORT > 4449) throw new Error('--port must lie in 4440-4449');
mkdirSync(OUT, { recursive: true });

const PAGE = join(import.meta.dirname, 'tsl-probe');
const THREE_BUILD = join(ROOT, 'node_modules/three/build');
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const base = path.startsWith('/__three/') ? THREE_BUILD : PAGE;
  const rel = path.startsWith('/__three/') ? path.slice('/__three/'.length) : path === '/' ? 'index.html' : path.slice(1);
  const file = normalize(join(base, rel));
  try {
    if (!file.startsWith(normalize(base))) throw new Error('outside');
    const body = readFileSync(file);
    res.setHeader('Content-Type', extname(file) === '.html' ? 'text/html' : 'text/javascript');
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));

const GPU_ARGS = process.platform === 'win32'
  ? ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']
  : ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
const browser = await chromium.launch({ headless: false, ...(process.argv.includes('--chrome') ? { channel: 'chrome' } : {}), args: ['--window-size=1300,820', ...vsyncArgs(false), ...GPU_ARGS] });
const results: Record<string, unknown>[] = [];
const shots: Record<string, Buffer> = {};
for (const backend of ['webgpu', 'webgl']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push(e.message.slice(0, 300)));
  await page.goto(`http://127.0.0.1:${PORT}/?backend=${backend}&count=${COUNT}`);
  const result = await page.waitForFunction(() => (globalThis as { __tsl?: unknown }).__tsl ?? null, null, { timeout: 180_000 })
    .then((h) => h.jsonValue() as Promise<Record<string, unknown>>);
  shots[backend] = await page.screenshot({ path: join(OUT, `ruin-${backend}.png`) });
  results.push({ ...result, logs: logs.slice(0, 8) });
  console.log(backend, JSON.stringify(result), logs.length ? `\n  ${logs.slice(0, 4).join('\n  ')}` : '');
  await page.close();
}

// The two pictures against each other, decoded in the page
const page = await browser.newPage();
const diff = await page.evaluate(async ([a, b]) => {
  const load = async (b64: string) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const x = await load(a);
  const y = await load(b);
  let off = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (Math.abs(x[i] - y[i]) > 8 || Math.abs(x[i + 1] - y[i + 1]) > 8 || Math.abs(x[i + 2] - y[i + 2]) > 8) off++;
  }
  return off / (x.length / 4);
}, [shots['webgpu'].toString('base64'), shots['webgl'].toString('base64')]);
console.log(`pixels differing by more than 8/255: ${(diff * 100).toFixed(2)} %`);
writeFileSync(join(OUT, 'tsl-probe.json'), JSON.stringify({ date: new Date().toISOString(), count: COUNT, results, pixelsDiffering: diff }, null, 1));
await browser.close();
server.close();
