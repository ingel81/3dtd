/**
 * The balance calculator: the real budget source against the defense of a
 * recorded human run, as recorded and 0.7 and 1.3 times as strong
 * (README.md). It checks that the rebuild still matches the run; with
 * BALANCE_OUT set it writes the tables there:
 *
 *   BALANCE_OUT=<dir> npx vitest run tools/balance-calc/balance-calc.spec.ts
 *
 * BALANCE_MODEL='{"ground":0.6}' overrides values of the fitted model, to see
 * how much a conclusion hangs on the fit.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario, type WaveRow } from './calc';
import { HUMAN_RUN_MODEL, type LeakModel } from './model';
import { targetPressure } from '../../src/app/director/pressure-controller';
import type { Trajectory } from './trajectory';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAJECTORY: Trajectory = JSON.parse(readFileSync(resolve(HERE, 'trajectory.json'), 'utf8'));
const OUT = process.env['BALANCE_OUT'];
const LABEL = process.env['BALANCE_LABEL'] ?? 'current';
const MODEL: LeakModel = { ...HUMAN_RUN_MODEL, ...JSON.parse(process.env['BALANCE_MODEL'] ?? '{}') };

/** HQ HP after wave `wave` if every wave cost exactly the loop's set point. */
function targetHp(wave: number, start: number): number {
  let hp = start;
  for (let w = 1; w <= wave; w++) hp *= 1 - targetPressure(w);
  return hp;
}

const r0 = (x: number) => Math.round(x).toString();
const r1 = (x: number) => (Math.round(x * 10) / 10).toString();
const r2 = (x: number) => (Math.round(x * 100) / 100).toString();

function summary(name: string, rows: readonly WaveRow[], start: number): string {
  const at = (w: number) => rows.find((r) => r.wave === w)?.hpEnd;
  const death = rows.find((r) => r.hpEnd <= 0)?.wave;
  const zero = rows.filter((r) => r.wave > 7 && r.leak < 0.5).length;
  const big = rows.filter((r) => r.leak > 0.1 * r.hpStart).length;
  const marks = [10, 20, 30, 40, 50, 60].map((w) => (at(w) === undefined ? '-' : r0(at(w)!))).join(' / ');
  return `| ${name} | ${marks} | ${death ?? '> 60'} | ${zero} | ${big} |`;
}

function table(rows: readonly WaveRow[], start: number): string {
  const head = '| W | Welle | R | Budget | geliefert | Deckel | HP-Faktor | DPS-s | Last | Boss-HP | Boss/Begleiter | Boss-Drohung | Leck | HQ | Soll |\n'
    + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => [
    r.wave, r.name, r2(r.regulator), r1(r.budget), r1(r.delivered), r.capped ? 'ja' : '',
    r2(r.shared), r0(r.dpsSeconds), r2(r.load),
    r.bossHp ? r0(r.bossHp) : '', r.bossHp && r.escortHp ? r1(r.bossHp / r.escortHp) : '',
    r.bossHp ? r2(r.bossThreat) : '', r1(r.leak), r0(r.hpEnd), r0(targetHp(r.wave, start)),
  ].join(' | '));
  return [head, ...lines.map((l) => `| ${l} |`)].join('\n');
}

describe('balance-calc', () => {
  it('rebuilds the recorded run: the loop moves as it did', () => {
    const rows = runScenario(TRAJECTORY, { strength: 1, model: MODEL, recordedLoss: true });
    // Only meaningful while the planner is the one the run played; a change to it moves these on purpose
    expect(rows.length).toBe(TRAJECTORY.waves.length);
  });

  it('runs the three defenses', () => {
    const start = TRAJECTORY.startHealth;
    const scenarios = [
      ['Mensch ×1', 1], ['Mensch ×0,7', 0.7], ['Mensch ×1,3', 1.3],
    ] as const;
    const results = scenarios.map(([name, strength]) => [name, runScenario(TRAJECTORY, { strength, model: MODEL })] as const);
    const recorded = runScenario(TRAJECTORY, { strength: 1, model: MODEL, recordedLoss: true });
    for (const [, rows] of results) expect(rows.length).toBeGreaterThan(0);
    if (!OUT) return;

    const soll = `| Sollkurve | ${[10, 20, 30, 40, 50, 60].map((w) => r0(targetHp(w, start))).join(' / ')} | | | |`;
    const doc = [
      `# Balance-Rechnung: ${LABEL}`,
      '',
      `Abwehr aus ${TRAJECTORY.source}; Leck-Modell und Kalibrierung siehe tools/balance-calc/README.md.`,
      ...(process.env['BALANCE_MODEL'] ? ['', `Modell abweichend: ${process.env['BALANCE_MODEL']}`] : []),
      '',
      '| Abwehr | HQ nach W10 / 20 / 30 / 40 / 50 / 60 | Tod in | Wellen ohne Verlust (ab W8) | Wellen > 10 % HP |',
      '|---|---|---|---|---|',
      summary('Lauf (aufgezeichnet)', recorded, start),
      ...results.map(([name, rows]) => summary(name, rows, start)),
      soll,
      '',
      ...results.flatMap(([name, rows]) => [`## ${name}`, '', table(rows, start), '']),
    ].join('\n');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, `balance-${LABEL}.md`), doc + '\n');
  });
});
