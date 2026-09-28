#!/usr/bin/env node
// One line per wave from exported run logs (docs/RUN_LOG.md): what the wave source planned and what it cost.
//
//   node tools/wave-report/wave-report.mjs <run.jsonl> [more.jsonl ...]
//
// Marks the waves that cost at least a tenth of the HP the wave started with. For the budget source the
// planning numbers come from `diagnostics` (budget, delivered, window, capped, clamped); other sources show
// what they log.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/wave-report/wave-report.mjs <run.jsonl> [more.jsonl ...]');
  process.exit(1);
}

const fmt = (v, d = 1) => (v === undefined || v === null || Number.isNaN(v) ? '' : typeof v === 'number' ? v.toFixed(d) : String(v));

for (const file of files) {
  const records = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const head = records.find((r) => r.kind === 'head') ?? {};
  const end = records.find((r) => r.kind === 'end');
  const waves = records.filter((r) => r.kind === 'wave').sort((a, b) => a.wave - b.wave);
  console.log(`\n## ${basename(file)}`);
  console.log(`source ${head.waveSource ?? 'adaptive'}, commit ${head.commit ?? '?'}, map ${head.map ?? '?'}, player ${head.player ?? '?'}` +
    (end ? `, ended at wave ${end.wave ?? end.waves ?? '?'} (${end.reason ?? '?'})` : ''));
  console.log('| W | wave | enemies | leaked | HP start | lost | loop R | budget | sent | window | capped | at limit | enemies, HP each |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  let heavy = 0;
  for (const w of waves) {
    const d = w.diagnostics ?? {};
    const lost = (w.healthStart ?? 0) - (w.healthEnd ?? 0) + (w.healthCheat ?? 0);
    const mark = w.healthStart > 0 && lost >= w.healthStart * 0.1 ? ' **!**' : '';
    if (mark) heavy++;
    const mult = (w.composition ?? []).map((c) => `${c.count}× ${c.type} ${fmt(c.hp, 0)} HP`).join(', ');
    console.log(`| ${w.wave}${mark} | ${w.template ?? ''} | ${w.enemiesSpawned ?? ''} | ${w.leaked ?? ''} | ${fmt(w.healthStart, 0)} | ${fmt(lost, 0)} | ` +
      `${fmt(w.pressureMultiplier, 2)} | ${fmt(d.budget)} | ${fmt(d.delivered)} | ${fmt(d.window)} | ${d.capped ?? ''} | ${d.clamped ?? ''} | ${mult} |`);
  }
  console.log(`\n${waves.length} waves, ${heavy} cost a tenth of the HP or more.`);
}
