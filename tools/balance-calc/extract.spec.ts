/**
 * Builds trajectory.json from a run log and its replay. On demand only:
 *
 *   BALANCE_RUN_LOG=<run log .jsonl> BALANCE_REPLAY=<replay .json> npx vitest run tools/balance-calc/extract.spec.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTrajectory, type Trajectory } from './trajectory';
import { metresPerWave } from './model';

const LOG = process.env['BALANCE_RUN_LOG'];
const REPLAY = process.env['BALANCE_REPLAY'];
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'trajectory.json');

describe.skipIf(!LOG || !REPLAY)('balance-calc: extract a trajectory', () => {
  it('writes trajectory.json', () => {
    const lines = readFileSync(LOG!, 'utf8').split('\n');
    const replay = JSON.parse(readFileSync(REPLAY!, 'utf8'));
    const raw = extractTrajectory(basename(LOG!).replace(/-world\.jsonl$|\.jsonl$/, ''), lines, replay);
    // Read back with the run plan in force now, which has to be the one the run played
    const metres = metresPerWave(raw.waves);
    const trajectory: Trajectory = { ...raw, waves: raw.waves.map((w) => ({ ...w, metres: Math.round(metres.get(w.wave)! * 10) / 10 })) };
    expect(trajectory.waves.length).toBeGreaterThan(0);
    // One wave per line: small, and a diff shows which wave changed
    const waves = trajectory.waves.map((w) => '  ' + JSON.stringify(w)).join(',\n');
    writeFileSync(OUT, `{"source": ${JSON.stringify(trajectory.source)}, "startHealth": ${trajectory.startHealth}, "waves": [\n${waves}\n]}\n`);
  });
});
