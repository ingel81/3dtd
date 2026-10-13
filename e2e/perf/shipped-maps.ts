// Every map the game ships (public/maps/index.json) on a production build: load time cold (a fresh browser, no shader
// cache) and warm (the same browser again), frames per second in the game view, and the map trial (the expert bot
// plays `?bot=trial&trialWaves=N` at high speed). Prints a Markdown table for docs/SHOWCASE_LEVELS.md ("Messung").
//
//   npm run build
//   node e2e/perf/serve.mjs dist/3DTD/browser 4227 --isolate
//   node e2e/perf/shipped-maps.ts --url http://localhost:4227 [--maps a,b] [--waves 10] [--seconds 5] [--no-trial] [--json out.json]
//
// Headed Chromium without the frame rate cap: the GPU the player has, the real headroom instead of a flat 60.
//
// Each load also says where its map files came from (the `map-data <source> <path>` measures of
// src/app/world/custom-map/map-data.ts): files, MB and summed ms per source, and the slowest files, so a slow
// load names its cause.
import { chromium, type Browser, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4227');
const WAVES = Number(argument('waves', '10'));
const SECONDS = Number(argument('seconds', '5'));
const TRIAL = !process.argv.includes('--no-trial');
const JSON_OUT = argument('json', '');
const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps/index.json');
const listed = (JSON.parse(readFileSync(INDEX, 'utf8')) as { maps: { id: string; name: string; spawns: number }[] }).maps;
const only = argument('maps', '').split(',').filter(Boolean);
const MAPS = only.length ? listed.filter((m) => only.includes(m.id)) : listed;
/** A trial longer than this (wall clock) counts as not finished */
const TRIAL_TIMEOUT_MS = 12 * 60_000;

const LAUNCH = {
  headless: false,
  args: ['--window-size=1600,900', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
};

interface Row {
  id: string;
  name: string;
  coldMs: number | null;
  warmMs: number | null;
  fps: number | null;
  trial: { outcome: string; wavesHeld: number; waves: number; hqStart: number; hqEnd: number; towers: number } | null;
  /** The map files of each load, by source */
  files: { cold: FileLoads | null; warm: FileLoads | null };
  problems: string[];
}

interface FileLoads {
  bySource: Record<string, { files: number; mb: number; ms: number }>;
  /** The slowest files: "<ms> ms <source> <path>" */
  slowest: string[];
}

/** The map files the page loaded so far, from their performance measures */
async function fileLoads(page: Page): Promise<FileLoads> {
  return page.evaluate(() => {
    const loads = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('map-data ')) as PerformanceMeasure[];
    const bySource: Record<string, { files: number; mb: number; ms: number }> = {};
    for (const m of loads) {
      const [, source] = m.name.split(' ');
      const s = (bySource[source] ??= { files: 0, mb: 0, ms: 0 });
      s.files++;
      s.mb += ((m.detail as { bytes: number | null } | null)?.bytes ?? 0) / 2 ** 20;
      s.ms += m.duration;
    }
    for (const s of Object.values(bySource)) {
      s.mb = Math.round(s.mb * 10) / 10;
      s.ms = Math.round(s.ms);
    }
    const slowest = [...loads].sort((a, b) => b.duration - a.duration).slice(0, 3)
      .map((m) => `${Math.round(m.duration)} ms ${m.name.slice('map-data '.length)}`);
    return { bySource, slowest };
  });
}

async function newPage(browser: Browser, problems: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('td_globe_quality_v1', '"off"');
  });
  return page;
}

/** Milliseconds from navigation to `load:ready` through the start menu (Play pressed as soon as it shows), null if never */
async function load(page: Page, id: string): Promise<number | null> {
  await page.goto(`${URL_BASE}/?world=map:${id}`);
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    const ready = await page.evaluate(() => performance.getEntriesByName('load:ready')[0]?.startTime ?? null);
    if (ready !== null) return Math.round(ready);
    await page.locator('.mm-start [data-entry="play"]').first().click({ timeout: 50 }).catch(() => undefined);
    await page.waitForTimeout(100);
  }
  return null;
}

/** Frames per second over `seconds`, counted with requestAnimationFrame, after the intro and the hints settled */
async function fps(page: Page): Promise<number> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  return page.evaluate(
    (seconds) =>
      new Promise<number>((done) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = (): void => {
          frames++;
          if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick);
          else done(Math.round((frames / (performance.now() - t0)) * 1000));
        };
        requestAnimationFrame(tick);
      }),
    SECONDS,
  );
}

async function trial(browser: Browser, id: string, problems: string[]): Promise<Row['trial']> {
  const page = await newPage(browser, problems);
  await page.goto(`${URL_BASE}/?world=map:${id}&bot=trial&trialWaves=${WAVES}`);
  const result = await page
    .waitForFunction(() => (window as { __mapTrial?: unknown }).__mapTrial ?? null, null, { timeout: TRIAL_TIMEOUT_MS, polling: 1000 })
    .then((h) => h.jsonValue() as Promise<NonNullable<Row['trial']>>)
    .catch(() => null);
  await page.context().close();
  return result;
}

const rows: Row[] = [];
for (const map of MAPS) {
  const row: Row = { id: map.id, name: map.name, coldMs: null, warmMs: null, fps: null, trial: null, files: { cold: null, warm: null }, problems: [] };
  // A browser of its own per map: its first load compiles every shader (cold), the second finds them cached (warm)
  const browser = await chromium.launch(LAUNCH);
  for (const run of ['cold', 'warm'] as const) {
    const page = await newPage(browser, row.problems);
    const ms = await load(page, map.id);
    row.files[run] = await fileLoads(page);
    if (run === 'cold') row.coldMs = ms;
    else {
      row.warmMs = ms;
      if (ms !== null) row.fps = await fps(page);
    }
    await page.context().close();
  }
  if (TRIAL) row.trial = await trial(browser, map.id, row.problems);
  await browser.close();
  rows.push(row);
  console.log(JSON.stringify(row));
}

const s = (ms: number | null): string => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const trialCell = (t: Row['trial']): string =>
  !TRIAL ? '' : t ? `${t.outcome === 'passed' ? 'bestanden' : t.outcome}, ${t.wavesHeld}/${t.waves} Wellen, HQ ${Math.round(t.hqEnd)}/${t.hqStart}, ${t.towers} Tower` : 'nicht fertig';
console.log('\n| Karte | Laden kalt | Laden warm | Spielansicht | Kartenprobe |');
console.log('|-------|-----------|-----------|--------------|-------------|');
for (const r of rows) {
  console.log(`| ${r.name} (\`${r.id}\`) | ${s(r.coldMs)} | ${s(r.warmMs)} | ${r.fps ?? 'n/a'} fps | ${trialCell(r.trial)} |`);
}
console.log('\nMap files per load (source: files, MB, summed ms; slowest files)');
for (const r of rows) {
  for (const run of ['cold', 'warm'] as const) {
    const f = r.files[run];
    if (!f) continue;
    const sources = Object.entries(f.bySource).map(([source, s]) => `${source} ${s.files} files ${s.mb} MB ${s.ms} ms`).join(', ');
    console.log(`  ${r.id} ${run}: ${sources}; slowest ${f.slowest.join(' | ')}`);
  }
}
if (rows.some((r) => r.problems.length)) {
  console.log('\nProblems:');
  for (const r of rows) for (const p of r.problems) console.log(`  ${r.id}: ${p}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
