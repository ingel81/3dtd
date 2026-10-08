// The sidebar's preview turns rendered ahead (TODO E76, src/app/services/infrastructure/preview-sheets.ts): a build of
// the game in DevWorld bakes every tower's and enemy type's turn with the game's own preview code, this script writes
// each as a WebP sheet into public/assets/previews with a manifest. Run it after a model or a preview view changed;
// preview-sheets.spec.ts names the stale sheets.
//   npm run build && npm run previews [-- --dist dist/3DTD/browser] [--port 4251] [--quality 0.9] [--only tower-archer]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argument = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, argument('dist', 'dist/3DTD/browser'));
const PORT = Number(argument('port', '4251'));
const QUALITY = Number(argument('quality', '0.9'));
const ONLY = argument('only', '');
const OUT = join(ROOT, 'public/assets/previews');
// Must match model-preview.service.ts (TURN_FRAMES, PLAYBACK_FPS, SHEET_COLUMNS); the service ignores another manifest
const FRAMES = 144;
const FPS = 24;
const COLUMNS = 12;

interface Job { name: string; modelUrl: string; view: string; size: { width: number; height: number } }
interface Entry { file: string; width: number; height: number; view: string; model: string }
interface Hook { jobs(): Job[]; bake(name: string, quality: number): Promise<string> }

const server = spawn(process.execPath, [join(ROOT, 'e2e/perf/serve.mjs'), DIST, String(PORT)], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 1500));
// WebGL on the machine's GPU where there is one, as the game renders
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  });
  await page.goto(`http://localhost:${PORT}/?devworld&bot=manual&menu=skip&previewsheets`);
  await page.waitForFunction(() => '__previewSheets' in globalThis, null, { timeout: 120_000 });
  const jobs = await page.evaluate(() => (globalThis as unknown as { __previewSheets: Hook }).__previewSheets.jobs());

  mkdirSync(OUT, { recursive: true });
  const manifestPath = join(OUT, 'manifest.json');
  const old = ONLY ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { sheets: Record<string, Entry> }).sheets : {};
  const sheets: Record<string, Entry> = { ...old };
  let bytes = 0;
  for (const job of jobs) {
    if (ONLY && job.name !== ONLY) continue;
    const url = await page.evaluate(([name, quality]) =>
      (globalThis as unknown as { __previewSheets: Hook }).__previewSheets.bake(name as string, quality as number), [job.name, QUALITY]);
    if (!url.startsWith('data:image/webp')) throw new Error(`${job.name}: the browser gave no WebP`);
    const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    const file = `${job.name}.webp`;
    writeFileSync(join(OUT, file), data);
    bytes += data.length;
    sheets[job.name] = { file, ...job.size, view: job.view, model: modelHash(job.modelUrl) };
    console.log(`${job.name}: ${Math.round(data.length / 1024)} kB`);
  }
  // Sheets of views the game no longer has go
  const names = new Set(jobs.map((job) => job.name));
  for (const name of Object.keys(sheets)) if (!names.has(name)) delete sheets[name];
  for (const file of readdirSync(OUT)) {
    if (file.endsWith('.webp') && !names.has(file.slice(0, -5))) rmSync(join(OUT, file));
  }
  const sorted = Object.fromEntries(Object.entries(sheets).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, `${JSON.stringify({ frames: FRAMES, fps: FPS, columns: COLUMNS, sheets: sorted }, null, 2)}\n`);
  console.log(`${Object.keys(sorted).length} sheets, ${Math.round(bytes / 1024)} kB written`);
} finally {
  await browser.close();
  server.kill();
}

/** SHA-256 of a model file under public/, hex */
function modelHash(modelUrl: string): string {
  return createHash('sha256').update(readFileSync(join(ROOT, 'public', modelUrl))).digest('hex');
}
