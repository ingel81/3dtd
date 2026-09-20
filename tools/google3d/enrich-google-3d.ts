/**
 * Marks the cities of the World Dice list that Google covers with
 * photorealistic 3D data, so a roll can prefer a place that has buildings.
 *
 * It drives Google's own coverage sample
 * (https://maps-docs-team.web.app/samples/3d-coverage-map/dist/) with
 * Playwright: no key of ours, no Maps client of ours, no tiles pulled. The
 * sample draws the covered areas blue over a grey basemap, so the check is a
 * screenshot of a few pixels in the middle of the map.
 *
 * What does not work, tried on 2026-09-20: asking the DatasetFeatureLayer for
 * the features under the pointer. The sample runs the map in raster mode
 * (`<gmp-map rendering-type="raster">`), where there is no client-side feature
 * hit testing, and calling `map.getDatasetFeatureLayer()` ourselves takes the
 * app's own styling off the layer: the map then stays grey everywhere and
 * every city looks uncovered. So this script only reads the map, it never
 * touches the layer.
 *
 * Before the first city it checks itself against two known points (a covered
 * one and one in the middle of the Sahara). If those two do not come out as
 * expected, nothing is written.
 *
 * Run it from tools/google3d:
 *   npm install && npm run setup
 *   npx tsx enrich-google-3d.ts --headed --only "Frankfurt,Tokyo"
 *
 * Nothing of this goes into the game; it writes the list and stops.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COVERAGE_APP = 'https://maps-docs-team.web.app/samples/3d-coverage-map/dist/';
/** Zoom where a covered city fills the middle of the view but a small patch still shows */
const ZOOM = 11;
/** After the map says idle, its tiles still need a moment */
const SETTLE_MS = 700;
/** The middle is read again until two reads in a row match, so a half-loaded view never counts */
const STABLE_TRIES = 12;
const STABLE_WAIT_MS = 400;
/**
 * Square of pixels read around the middle of the map. It has to be wide: the
 * city's own label sits in the very middle, and a few pixels of dark text
 * read as "no coverage" (London, Paris and New York came out uncovered that
 * way on 2026-09-20).
 */
const PATCH = 320;
/** Share of the square that has to be coverage blue. Labels, roads and parks take their part. */
const BLUE_SHARE = 0.4;
/** Written after every SAVE_EVERY cities, so a broken run keeps its work */
const SAVE_EVERY = 10;

/** Two points the check has to get right before the run starts. */
const SELF_TEST = [
  { name: 'Frankfurt am Main', lat: 50.1109, lon: 8.6821, expected: true },
  { name: 'Sahara', lat: 23.0, lon: 12.0, expected: false },
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** The shipped list: read, marked and written back, so a new run carries on where the last stopped */
const IN = resolve(HERE, value('--in', '../../public/assets/data/cities.json'));
const OUT = resolve(HERE, value('--out', value('--in', '../../public/assets/data/cities.json')));
const LIMIT = Number(value('--limit', '0'));
/** Only cities of at least this many inhabitants: the big ones first, in batches */
const MIN_POPULATION = Number(value('--min-population', '0'));
/** Cities by name, comma separated: the proof of concept runs a handful */
const ONLY = value('--only', '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
const HEADED = flag('--headed');
const RECHECK = flag('--recheck');
/** Directory for one screenshot per city, to check the answers by eye */
const SHOTS = value('--shots', '');

interface CityPool {
  fields: string[];
  cities: (string | number | null)[][];
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Blue share of the last read, for the log */
let lastShare = 0;
/** The pool as it stands, so a Ctrl+C still writes what is done */
let openPool: CityPool | null = null;

/**
 * The blue of the coverage polygons (about 150,180,225 over land) against the
 * grey basemap (238,238,238) and its water (a grey blue with little spread).
 */
export function isCoverageBlue(r: number, g: number, b: number): boolean {
  return b > 120 && b - r > 25 && b - g > 12;
}

/**
 * Moves the map to a point and reads the middle once its tiles stand still.
 * `idle` fires before the tiles of the new place are painted, so the answer
 * is taken only after two reads in a row agree; a jump across the world that
 * never settles counts as unknown and throws.
 */
async function coverageAt(page: Page, centre: { x: number; y: number }, lat: number, lon: number): Promise<boolean> {
  await page.evaluate(
    ([latitude, longitude, zoom]) =>
      new Promise<void>((done) => {
        const map = (window as unknown as { __tdMap: google.maps.Map }).__tdMap;
        map.setZoom(zoom as number);
        map.setCenter({ lat: latitude as number, lng: longitude as number });
        google.maps.event.addListenerOnce(map, 'idle', () => done());
      }),
    [lat, lon, ZOOM],
  );
  await sleep(SETTLE_MS);

  let previous = await patch(page, centre);
  for (let tries = 0; tries < STABLE_TRIES; tries++) {
    await sleep(STABLE_WAIT_MS);
    const current = await patch(page, centre);
    if (sameEnough(previous, current)) {
      lastShare = blueShare(current);
      return isBluePatch(current);
    }
    previous = current;
  }
  throw new Error('the view never settled');
}

/** The pixels in the middle of the map. */
async function patch(page: Page, centre: { x: number; y: number }): Promise<Uint8Array> {
  const half = Math.floor(PATCH / 2);
  const shot = await page.screenshot({
    clip: { x: centre.x - half, y: centre.y - half, width: PATCH, height: PATCH },
    type: 'png',
  });
  return decodePng(shot);
}

/** Two reads of the same still view: a few pixels differ from label anti-aliasing. */
function sameEnough(a: Uint8Array, b: Uint8Array): boolean {
  let apart = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) apart++;
  }
  return apart <= (a.length / 4) * 0.01;
}

/** Enough blue in the square around the middle means coverage. */
function isBluePatch(pixels: Uint8Array): boolean {
  return blueShare(pixels) >= BLUE_SHARE;
}

function blueShare(pixels: Uint8Array): number {
  let blue = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (isCoverageBlue(pixels[i], pixels[i + 1], pixels[i + 2])) blue++;
  }
  return blue / (pixels.length / 4);
}

async function main() {
  const pool = JSON.parse(readFileSync(IN, 'utf8')) as CityPool;
  openPool = pool;
  console.log(`[3d] ${IN} -> ${OUT}`);
  const nameAt = pool.fields.indexOf('name');
  const latAt = pool.fields.indexOf('lat');
  const lonAt = pool.fields.indexOf('lon');
  if (nameAt < 0 || latAt < 0 || lonAt < 0) throw new Error(`${IN} has no name/lat/lon fields`);

  if (!pool.fields.includes('google3d')) pool.fields.push('google3d');
  const coverageAtIndex = pool.fields.indexOf('google3d');
  const populationAt = pool.fields.indexOf('population');
  // Every row carries every field, so a city that was never checked reads as null
  for (const row of pool.cities) while (row.length < pool.fields.length) row.push(null);

  // The biggest cities first, and they are the ones a run that stops early has done
  let todo = [...pool.cities].sort((a, b) => Number(b[populationAt]) - Number(a[populationAt]));
  if (ONLY.length > 0) {
    todo = todo.filter((row) => ONLY.includes(String(row[nameAt]).toLowerCase()));
  } else if (!RECHECK) {
    todo = todo.filter((row) => row[coverageAtIndex] === null);
  }
  if (MIN_POPULATION > 0) todo = todo.filter((row) => Number(row[populationAt]) >= MIN_POPULATION);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  const checked = pool.cities.filter((row) => row[coverageAtIndex] !== null).length;
  console.log(`[3d] ${todo.length} to check, ${checked} of ${pool.cities.length} already done, ${HEADED ? 'headed' : 'headless'}`);
  if (todo.length === 0) return;

  const browser: Browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(COVERAGE_APP, { waitUntil: 'domcontentloaded' });

  // The sample is a <gmp-map> web component; its innerMap is the Map object
  await page.waitForFunction(
    () => {
      const element = document.querySelector('gmp-map') as (HTMLElement & { innerMap?: google.maps.Map }) | null;
      if (!element?.innerMap) return false;
      (window as unknown as { __tdMap: google.maps.Map }).__tdMap = element.innerMap;
      return true;
    },
    null,
    { timeout: 60000 },
  );
  await sleep(4000);
  const centre = { x: 600, y: 400 };

  for (const point of SELF_TEST) {
    const answer = await coverageAt(page, centre, point.lat, point.lon);
    console.log(`[3d] self test ${point.name}: ${answer ? '3D' : 'no 3D'} (expected ${point.expected ? '3D' : 'no 3D'})`);
    if (answer !== point.expected) {
      await browser.close();
      throw new Error('self test failed, nothing written');
    }
  }

  const counts = { yes: 0, no: 0, errors: 0 };
  let done = 0;
  const started = Date.now();
  for (const row of todo) {
    const name = String(row[nameAt]);
    try {
      const answer = await coverageAt(page, centre, Number(row[latAt]), Number(row[lonAt]));
      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/${name.replace(/[^\w-]/g, '_')}-${answer ? '3d' : 'no3d'}.png` });
      }
      while (row.length <= coverageAtIndex) row.push(null);
      row[coverageAtIndex] = answer ? 1 : 0;
      counts[answer ? 'yes' : 'no']++;
      console.log(`  ${name}: ${answer ? '3D' : 'no 3D'} (${Math.round(lastShare * 100)} % blue)`);
    } catch (err) {
      // An error stays unknown (null), never a no
      counts.errors++;
      console.log(`  ${name}: error ${(err as Error).message.split('\n')[0]}`);
    }
    if (++done % SAVE_EVERY === 0) {
      write(pool);
      const perCity = (Date.now() - started) / done;
      const left = Math.round(((todo.length - done) * perCity) / 60000);
      console.log(`[3d] ${done} of ${todo.length} done, saved, about ${left} min left`);
    }
  }

  await browser.close();
  write(pool);
  console.log(`[3d] processed ${done}, 3D ${counts.yes}, no 3D ${counts.no}, errors ${counts.errors}`);
}

/** Writes the pool back in the shape the generator uses: one line per city. */
function write(pool: CityPool): void {
  const { cities, ...head } = pool;
  const body = cities.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  const json = `{\n${Object.entries(head)
    .map(([key, entry]) => `  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`)
    .join(',\n')},\n  "cities": [\n${body}\n  ]\n}\n`;
  writeFileSync(OUT, json);
}

// Ctrl+C keeps what is done: the next run picks up where this one stopped
process.on('SIGINT', () => {
  if (openPool) {
    write(openPool);
    console.log('[3d] stopped, what was checked is saved');
  }
  process.exit(0);
});

main().catch((err) => {
  if (openPool) write(openPool);
  console.error(`[3d] ${(err as Error).message}`);
  process.exit(1);
});
