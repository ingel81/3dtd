/**
 * One player on many lanes (lanes.ts): today's game against the two levers,
 * for 1, 2, 4 and 10 lanes. With BALANCE_OUT set it writes the table there:
 *
 *   BALANCE_OUT=<dir> npx vitest run tools/balance-calc/lanes.spec.ts
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLanes, type LaneOptions, type LaneRow } from './lanes';
import { HUMAN_RUN_MODEL, type LeakModel } from './model';
import type { Trajectory } from './trajectory';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAJECTORY: Trajectory = JSON.parse(readFileSync(resolve(HERE, 'trajectory.json'), 'utf8'));
const OUT = process.env['BALANCE_OUT'];
const MODEL: LeakModel = { ...HUMAN_RUN_MODEL, ...JSON.parse(process.env['BALANCE_MODEL'] ?? '{}') };
const LANES = [1, 2, 4, 10];

/** The variants: today, (a) laneScaling 'sqrt', (b) more gold per lane, (c) a leak's share 1/N */
const VARIANTS: { name: string; options: (n: number) => Omit<LaneOptions, 'lanes' | 'model'> }[] = [
  { name: 'heute (Gold je Spur, volle Welle je Spur)', options: (n) => ({ economy: n, laneScaling: 'none', leakShare: 1 }) },
  { name: '(a) Wellenanteil 1/Wurzel(N) je Spur', options: (n) => ({ economy: n, laneScaling: 'sqrt', leakShare: 1 }) },
  { name: '(b) doppeltes Start- und Kill-Gold je Spur', options: (n) => ({ economy: 2 * n, laneScaling: 'none', leakShare: 1 }) },
  { name: '(c) Leckschaden 1/N', options: (n) => ({ economy: n, laneScaling: 'none', leakShare: 1 / n }) },
];

const r0 = (x: number) => Math.round(x).toString();

function line(rows: readonly LaneRow[]): string {
  const at = (w: number) => rows.find((r) => r.wave === w)?.hpEnd;
  const death = rows.find((r) => r.hpEnd <= 0)?.wave;
  const marks = [3, 5, 10, 20, 30, 40].map((w) => (at(w) === undefined ? '-' : r0(at(w)!))).join(' / ');
  const early = rows.filter((r) => r.wave <= 7).reduce((sum, r) => sum + r.loss, 0);
  return `${marks} | ${death ?? '> 60'} | ${r0(early)}`;
}

describe('balance-calc: many lanes', () => {
  it('plays one player on 1 to 10 lanes', () => {
    const results = VARIANTS.map((v) => ({
      name: v.name,
      rows: LANES.map((n) => [n, runLanes(TRAJECTORY, { lanes: n, model: MODEL, ...v.options(n) })] as const),
    }));
    // One lane is the recorded run in every variant
    const one = results.map((r) => line(r.rows[0][1]));
    expect(new Set(one).size).toBe(1);
    if (!OUT) return;
    const doc = [
      '# Balance-Rechnung: viele Spuren, ein Spieler',
      '',
      `Abwehr aus ${TRAJECTORY.source}, gleichmäßig auf die Spuren verteilt; tools/balance-calc/lanes.ts.`,
      '',
      '| Variante | Spuren | HQ nach W3 / 5 / 10 / 20 / 30 / 40 | Tod in | Verlust W1 bis W7 |',
      '|---|---|---|---|---|',
      ...results.flatMap((r) => r.rows.map(([n, rows]) => `| ${r.name} | ${n} | ${line(rows)} |`)),
      '',
    ].join('\n');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'balance-lanes.md'), doc);
  });
});
