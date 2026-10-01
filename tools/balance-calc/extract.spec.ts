/**
 * Builds trajectory.json from a run log and its replay. On demand only:
 *
 *   BALANCE_RUN_LOG=<run log .jsonl> BALANCE_REPLAY=<replay .json> npx vitest run tools/balance-calc/extract.spec.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTrajectory } from './trajectory';

const LOG = process.env['BALANCE_RUN_LOG'];
const REPLAY = process.env['BALANCE_REPLAY'];
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'trajectory.json');

describe.skipIf(!LOG || !REPLAY)('balance-calc: extract a trajectory', () => {
  it('writes trajectory.json', () => {
    const lines = readFileSync(LOG!, 'utf8').split('\n');
    const replay = JSON.parse(readFileSync(REPLAY!, 'utf8'));
    const trajectory = extractTrajectory(basename(LOG!).replace(/-world\.jsonl$|\.jsonl$/, ''), lines, replay);
    expect(trajectory.waves.length).toBeGreaterThan(0);
    writeFileSync(OUT, JSON.stringify(trajectory, null, 1) + '\n');
  });
});
