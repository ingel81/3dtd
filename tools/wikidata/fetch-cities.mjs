#!/usr/bin/env node
/**
 * Builds public/assets/data/cities.json, the pool the World Dice rolls from.
 *
 * The game used to ask the Wikidata Query Service live on every first roll.
 * That endpoint answers in 13 s on a good day and not at all on a bad one
 * (measured 2026-09-20), so the dialog closed after the timeout with nothing
 * to show. The list changes a few times a year at most, so it is fetched here
 * and shipped with the game.
 *
 * Two passes, because one query with all the fields runs into the endpoint's
 * 60 s limit:
 *   1. Every city (Q515 and its subclasses) over MIN_POPULATION, with its
 *      coordinates, population and country. One query, about 30 s.
 *   2. Names and extras for those cities, in chunks of CHUNK_SIZE through a
 *      VALUES clause: labels, ISO country code, continent, area, elevation
 *      and whether it is its country's capital.
 *
 * Usage: node tools/wikidata/fetch-cities.mjs [--min 100000] [--out path]
 * It prints what it writes; rerun it when the list should be refreshed. The
 * `google3d` answers of the list it overwrites are carried over by their
 * Wikidata id (tools/google3d), so only new cities come out unchecked;
 * `--fresh-3d` drops them instead.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ENDPOINT = 'https://query.wikidata.org/sparql';
// Wikidata asks for a descriptive agent; a browser cannot set one, a script can
const USER_AGENT = '3dtd-city-pool/1.0 (https://github.com/ingel81/3dtd)';
const CHUNK_SIZE = 300;
const TIMEOUT_MS = 120000;
const RETRIES = 4;
/** The endpoint throttles bursts, so the passes wait between requests */
const PAUSE_MS = 1500;

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MIN_POPULATION = Number(argValue('--min', '100000'));
const OUT = resolve(argValue('--out', 'public/assets/data/cities.json'));
const KEEP_3D = !args.includes('--fresh-3d');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One SPARQL query against the endpoint, with retries: it fails often under load. */
async function query(sparql, label) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(sparql)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rows = data.results.bindings;
      console.log(`  ${label}: ${rows.length} rows in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return rows;
    } catch (err) {
      if (attempt > RETRIES) throw new Error(`${label} failed after ${RETRIES} retries: ${err.message}`);
      const wait = attempt * 5000;
      console.log(`  ${label}: ${err.message} after ${((Date.now() - started) / 1000).toFixed(1)} s, retry ${attempt} in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

const qid = (uri) => uri.slice(uri.lastIndexOf("/") + 1);
const round = (value, digits) => Number(value.toFixed(digits));

/** "Point(lon lat)" as [lat, lon] with five decimals, about a metre. */
function pointToLatLon(point) {
  const match = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(point);
  if (!match) return null;
  return [round(Number(match[2]), 5), round(Number(match[1]), 5)];
}

/** Pass 1: id, coordinates, population and country of every city over the minimum. */
async function fetchCities() {
  const rows = await query(`
    SELECT ?city ?coord ?pop ?country WHERE {
      ?city wdt:P31/wdt:P279* wd:Q515;
            wdt:P625 ?coord;
            wdt:P1082 ?pop;
            wdt:P17 ?country.
      FILTER(?pop > ${MIN_POPULATION})
    }
  `, 'cities');

  // A city can carry several population statements (censuses); the highest wins
  const cities = new Map();
  for (const row of rows) {
    const id = qid(row.city.value);
    const population = Math.round(Number(row.pop.value));
    const coord = pointToLatLon(row.coord.value);
    if (!coord) continue;
    const known = cities.get(id);
    if (known && known.population >= population) continue;
    cities.set(id, { id, lat: coord[0], lon: coord[1], population, country: qid(row.country.value) });
  }
  return cities;
}

/** Pass 2: names and extras for `ids`, in chunks. */
async function fetchDetails(ids) {
  const details = new Map();
  for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
    const chunk = ids.slice(start, start + CHUNK_SIZE);
    const values = chunk.map((id) => `wd:${id}`).join(' ');
    const rows = await query(`
      SELECT ?city ?cityLabel ?countryLabel ?iso ?continentLabel ?area ?elevation ?capital WHERE {
        VALUES ?city { ${values} }
        ?city wdt:P17 ?country.
        OPTIONAL { ?city wdt:P2046 ?area. }
        OPTIONAL { ?city wdt:P2044 ?elevation. }
        OPTIONAL { ?country wdt:P297 ?iso. }
        OPTIONAL { ?country wdt:P30 ?continent. }
        BIND(EXISTS { ?country wdt:P36 ?city. } AS ?capital)
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    `, `details ${start + 1} to ${Math.min(start + CHUNK_SIZE, ids.length)}`);

    for (const row of rows) {
      const id = qid(row.city.value);
      // Several statements (two continents, two areas) give a city several rows
      const known = details.get(id) ?? {};
      details.set(id, {
        name: row.cityLabel?.value ?? known.name,
        country: row.countryLabel?.value ?? known.country,
        countryCode: row.iso?.value ?? known.countryCode,
        continent: known.continent ?? row.continentLabel?.value,
        area: known.area ?? (row.area ? round(Number(row.area.value), 1) : undefined),
        elevation: known.elevation ?? (row.elevation ? Math.round(Number(row.elevation.value)) : undefined),
        capital: known.capital || row.capital?.value === 'true',
      });
    }
    await sleep(PAUSE_MS);
  }
  return details;
}

const FIELDS = ['id', 'name', 'country', 'countryCode', 'continent', 'lat', 'lon', 'population', 'area', 'elevation', 'capital', 'google3d'];

/** What the list being overwritten knows about Google's 3D coverage, by city id. */
function knownCoverage() {
  if (!KEEP_3D || !existsSync(OUT)) return new Map();
  try {
    const old = JSON.parse(readFileSync(OUT, 'utf8'));
    const idAt = old.fields?.indexOf('id') ?? -1;
    const coverageAt = old.fields?.indexOf('google3d') ?? -1;
    if (idAt < 0 || coverageAt < 0) return new Map();
    return new Map(old.cities.filter((row) => row[coverageAt] !== null && row[coverageAt] !== undefined).map((row) => [row[idAt], row[coverageAt]]));
  } catch {
    return new Map();
  }
}

async function main() {
  console.log(`[cities] cities over ${MIN_POPULATION.toLocaleString('en-US')} inhabitants`);
  const cities = await fetchCities();
  console.log(`[cities] ${cities.size} cities`);

  const details = await fetchDetails([...cities.keys()]);
  console.log(`[cities] details for ${details.size} of them`);

  const coverage = knownCoverage();
  const rows = [];
  let withoutName = 0;
  for (const city of cities.values()) {
    const detail = details.get(city.id);
    // A label that is still the Q-id says the city has no English name
    if (!detail?.name || /^Q\d+$/.test(detail.name)) {
      withoutName++;
      continue;
    }
    rows.push([
      city.id,
      detail.name,
      detail.country ?? '',
      detail.countryCode ?? '',
      detail.continent ?? '',
      city.lat,
      city.lon,
      city.population,
      detail.area ?? null,
      detail.elevation ?? null,
      detail.capital ? 1 : 0,
      coverage.get(city.id) ?? null,
    ]);
  }
  rows.sort((a, b) => b[7] - a[7]);

  const out = {
    source: 'Wikidata Query Service (SPARQL), CC0',
    query: `cities (Q515 and subclasses) with a population over ${MIN_POPULATION}`,
    generated: new Date().toISOString().slice(0, 10),
    script: 'tools/wikidata/fetch-cities.mjs',
    fields: FIELDS,
    cities: rows,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  // One line per city: a diff shows what changed, and it stays readable
  const body = rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  const json = `{\n${Object.entries(out)
    .filter(([key]) => key !== 'cities')
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(',\n')},\n  "cities": [\n${body}\n  ]\n}\n`;
  writeFileSync(OUT, json);
  const checked = rows.filter((row) => row[11] !== null).length;
  console.log(`[cities] ${rows.length} cities written to ${OUT} (${(json.length / 1024).toFixed(0)} KB), ${withoutName} without an English name left out, ${checked} with a known 3D answer`);
}

main().catch((err) => {
  console.error(`[cities] ${err.message}`);
  process.exit(1);
});
