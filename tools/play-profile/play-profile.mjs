#!/usr/bin/env node
// How a run was played, wave by wave, next to other runs (docs/BOT_PLAYER_PLAN.md, B5):
// fighting towers standing, upgrades, research and sales so far. The bot's
// profiles are set against human runs with it.
//
//   node tools/play-profile/play-profile.mjs <run> [<run> ...] [--waves 1,2,4,8,12,16,20]
//
// A run is a replay file (.json, the replay bar's export: its commands) or a
// run log (.jsonl, docs/RUN_LOG.md: its events). A command or event belongs to
// the wave the build phase prepares: the one the game counted when it came
// (wave 0 is the build phase before wave 1).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const PASSIVE = new Set(['research-center', 'missile-silo']);

/** Per wave: built, upgraded, researched, sold; types built */
function emptyWave() {
  return { built: 0, upgrades: 0, research: 0, sold: 0, types: {} };
}

function fromReplay(data) {
  const starts = data.waves.map((w) => [w.wave, w.snapshot.clock.subStep]);
  const waveOf = (step) => {
    let wave = 0;
    for (const [w, s] of starts) if (s <= step) wave = w;
    return wave;
  };
  const waves = new Map();
  const at = (w) => waves.get(w) ?? waves.set(w, emptyWave()).get(w);
  // A tower id comes with its placement only in the simulation; a sale names the id, so sales are counted, not typed
  for (const { step, command } of data.log) {
    const row = at(waveOf(step));
    switch (command.type) {
      case 'command:place-tower':
        if (PASSIVE.has(command.typeId)) break;
        row.built++;
        row.types[command.typeId] = (row.types[command.typeId] ?? 0) + 1;
        break;
      case 'command:upgrade-tower': row.upgrades++; break;
      case 'command:start-research': case 'command:queue-research': row.research++; break;
      case 'command:sell-tower': row.sold++; break;
    }
  }
  return { label: 'replay', waves };
}

function fromRunLog(text) {
  const waves = new Map();
  const at = (w) => waves.get(w) ?? waves.set(w, emptyWave()).get(w);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.kind !== 'event') continue;
    const row = at(record.wave ?? 0);
    switch (record.event) {
      case 'tower-built':
        if (PASSIVE.has(record.id)) break;
        row.built++;
        row.types[record.id] = (row.types[record.id] ?? 0) + 1;
        break;
      case 'tower-upgraded': row.upgrades++; break;
      case 'research-started': row.research++; break;
      case 'tower-sold': row.sold++; break;
    }
  }
  return { label: 'run log', waves };
}

/** Totals by the end of each wave's build phase: towers standing, upgrades, research, types */
function cumulative(run, last) {
  const out = [];
  let towers = 0;
  let upgrades = 0;
  let research = 0;
  const types = new Set();
  for (let w = 0; w <= last; w++) {
    const row = run.waves.get(w) ?? emptyWave();
    towers += row.built - row.sold;
    upgrades += row.upgrades;
    research += row.research;
    for (const t of Object.keys(row.types)) types.add(t);
    out.push({ towers, upgrades, research, types: types.size });
  }
  return out;
}

function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--') && !/^\d+(,\d+)*$/.test(a));
  const wavesArg = argv[argv.indexOf('--waves') + 1];
  const shown = argv.includes('--waves') ? wavesArg.split(',').map(Number) : [1, 2, 4, 6, 8, 10, 12, 16, 20, 30];
  if (files.length === 0) {
    console.error('usage: play-profile.mjs <run.json|run.jsonl> [...] [--waves 1,2,4]');
    process.exit(1);
  }
  const runs = files.map((file) => {
    const text = readFileSync(file, 'utf8');
    const run = file.endsWith('.jsonl') ? fromRunLog(text) : fromReplay(JSON.parse(text));
    return { ...run, label: basename(file).replace(/\.jsonl?$/, '').slice(0, 32) };
  });
  const last = Math.max(...shown);
  const totals = runs.map((run) => cumulative(run, last));
  const lastPlayed = runs.map((run) => Math.max(0, ...run.waves.keys()));

  console.log(['wave', ...runs.map((r) => r.label)].join(' | '));
  console.log('     ' + runs.map(() => 'towers upgrades research types').join(' | '));
  for (const w of shown) {
    const cells = totals.map((t, i) => (w > lastPlayed[i] ? '-' : `${t[w].towers} ${t[w].upgrades} ${t[w].research} ${t[w].types}`));
    console.log([`W${w}`, ...cells].join(' | '));
  }
  // How far each run is from the first in towers standing, over the waves both played
  for (let i = 1; i < runs.length; i++) {
    const common = Math.min(lastPlayed[0], lastPlayed[i], last);
    let diff = 0;
    for (let w = 1; w <= common; w++) diff += Math.abs(totals[i][w].towers - totals[0][w].towers);
    console.log(`${runs[i].label}: towers off the first run by ${(diff / Math.max(1, common)).toFixed(1)} per wave over W1-W${common}`);
  }
}

main(process.argv.slice(2));
