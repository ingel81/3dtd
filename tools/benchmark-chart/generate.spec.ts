/**
 * Benchmark chart generator.
 *
 * Reads the copied benchmark tables in docs/BENCHMARKS.md (one fenced block per
 * "### <date>, Rechner <id>" section) and the machine table, and writes two SVG
 * line charts with a legend: FPS and main-thread apply time per packet over the
 * enemy count, tempo 1. docs/BENCHMARKS.md embeds them as images.
 *
 * Run on demand:
 *   npm run benchmark-chart
 *
 * It also runs on `npm test`; same input, same output, so git only shows a diff
 * when a measurement was added or changed.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGeneratedFile } from '../generated-file';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(__dirname, '../../docs/BENCHMARKS.md');
const OUT_DIR = resolve(__dirname, '../../docs/images');

/** The enemy counts of the benchmark plan; measured counts snap to the nearest. */
const STEPS = [2000, 5000, 10000, 15000, 20000, 25000];
const PALETTE = ['#2f63b0', '#d9772b', '#2f9150', '#a23b9a', '#c0392b', '#5b6770'];

interface Row {
  enemies: number;
  speed: string;
  fps: number;
  p05: number;
  apply: number;
}

export interface Run {
  machine: string;
  date: string;
  version: string;
  label: string;
  /** Refresh rate of the machine's monitor (caps the FPS), when the machine table names one */
  hz?: number;
  rows: Row[];
}

/** Splits a copied benchmark line into columns (two or more spaces apart). */
const columns = (line: string): string[] => line.trim().split(/\s{2,}/);

export function parseRuns(markdown: string): Run[] {
  const text = markdown.replace(/\r\n/g, '\n');
  const machines = new Map<string, string>();
  const refresh = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = /^\| ([A-Z]\d?)(?: \([^)]*\))? \| ([^|]+) \| [^|]+ \| ([^|]+) \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const cpu = m[2].split(',')[0].trim();
    const gpu = m[3].split(/[,;]/)[0].trim();
    machines.set(m[1], `${cpu}, ${gpu}`);
    const hz = /(\d+) Hz/.exec(m[4]);
    if (hz) refresh.set(m[1], Number(hz[1]));
  }
  const runs: Run[] = [];
  const section = /^### (\d{4}-\d{2}-\d{2}), Rechner ([A-Z]\d?)\n[\s\S]*?```\n([\s\S]*?)```/gm;
  for (let m = section.exec(text); m; m = section.exec(text)) {
    const [, date, machine, block] = m;
    const lines = block.split('\n').filter((l) => l.trim());
    const head = columns(lines[0]);
    const col = (name: string): number => {
      const i = head.indexOf(name);
      if (i < 0) throw new Error(`BENCHMARKS.md ${date} ${machine}: column "${name}" missing`);
      return i;
    };
    const [ver, enemies, speed, fps, p05, apply] = ['Version', 'Enemies', 'Speed', 'FPS', 'p05', 'Apply/packet'].map(col);
    const rows = lines.slice(1).map((l) => {
      const c = columns(l);
      return {
        enemies: Number(c[enemies]),
        speed: c[speed],
        fps: Number(c[fps]),
        p05: Number(c[p05]),
        apply: Number.parseFloat(c[apply]),
      };
    });
    const version = columns(lines[1])[ver];
    runs.push({ machine, date, version, label: `${machine}: ${machines.get(machine) ?? '?'} (${version}, ${date})`, hz: refresh.get(machine), rows });
  }
  return runs;
}

const snap = (n: number): number => STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best));

interface ChartSpec {
  title: string;
  yLabel: string;
  yMax: number;
  yStep: number;
  value: (r: Row) => number;
  guide?: { y: number; label: string };
  note: string;
  /** Adds the monitor refresh rate to each legend entry */
  showHz?: boolean;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');

export function renderChart(runs: Run[], spec: ChartSpec): string {
  const W = 820;
  const left = 64, right = 24, top = 64, plotH = 300;
  const legendTop = top + plotH + 62;
  const legendRow = 22;
  const H = legendTop + runs.length * legendRow + 34;
  const plotW = W - left - right;
  const x = (enemies: number): number => left + (STEPS.indexOf(enemies) / (STEPS.length - 1)) * plotW;
  const y = (v: number): number => top + plotH - (Math.min(v, spec.yMax) / spec.yMax) * plotH;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${left}" y="28" font-size="17" font-weight="600" fill="#1d1f1c">${esc(spec.title)}</text>`);
  for (let v = 0; v <= spec.yMax; v += spec.yStep) {
    out.push(`<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e3df"/>`);
    out.push(`<text x="${left - 8}" y="${y(v) + 4}" font-size="12" text-anchor="end" fill="#5c5f58">${fmt(v)}</text>`);
  }
  for (const s of STEPS) {
    out.push(`<text x="${x(s)}" y="${top + plotH + 20}" font-size="12" text-anchor="middle" fill="#5c5f58">${s.toLocaleString('de-DE')}</text>`);
  }
  out.push(`<text x="${left + plotW / 2}" y="${top + plotH + 38}" font-size="12" text-anchor="middle" fill="#5c5f58">Gegner (Tempo 1)</text>`);
  out.push(`<text transform="translate(16 ${top + plotH / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#5c5f58">${esc(spec.yLabel)}</text>`);
  out.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${top + plotH}" stroke="#9a9d95"/>`);
  out.push(`<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" stroke="#9a9d95"/>`);
  if (spec.guide) {
    const gy = y(spec.guide.y);
    out.push(`<line x1="${left}" x2="${W - right}" y1="${gy}" y2="${gy}" stroke="#b03a2e" stroke-dasharray="6 4"/>`);
    out.push(`<text x="${left + 6}" y="${gy - 6}" font-size="12" fill="#b03a2e">${esc(spec.guide.label)}</text>`);
  }
  const series = runs.map((run, i) => ({
    color: PALETTE[i % PALETTE.length],
    pts: run.rows
      .filter((r) => r.speed === '1x')
      .map((r) => ({ s: snap(r.enemies), v: spec.value(r) }))
      .sort((a, b) => a.s - b.s),
  }));
  for (const { color, pts } of series) {
    out.push(`<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${pts.map((p) => `${x(p.s)},${y(p.v)}`).join(' ')}"/>`);
    for (const p of pts) out.push(`<circle cx="${x(p.s)}" cy="${y(p.v)}" r="4" fill="${color}"/>`);
  }
  // Value labels: at each step the highest value sits above its point, the others below; stacked so none overlap
  for (const s of STEPS) {
    const at = series
      .flatMap(({ color, pts }) => pts.filter((p) => p.s === s).map((p) => ({ color, v: p.v, py: y(p.v) })))
      .sort((a, b) => a.py - b.py);
    let floor = -Infinity;
    at.forEach((l, k) => {
      const below = l.py + 17 <= top + plotH - 4;
      const ly = Math.max(k === 0 || !below ? l.py - 9 : l.py + 17, floor + 13);
      floor = ly;
      const anchor = s === STEPS[0] ? 'start' : s === STEPS[STEPS.length - 1] ? 'end' : 'middle';
      const lx = x(s) + (anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0);
      out.push(`<text x="${lx}" y="${ly}" font-size="11" font-weight="600" text-anchor="${anchor}" fill="${l.color}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${fmt(l.v)}</text>`);
    });
  }
  runs.forEach((run, i) => {
    const color = PALETTE[i % PALETTE.length];
    const ly = legendTop + i * legendRow;
    out.push(`<line x1="${left}" x2="${left + 26}" y1="${ly}" y2="${ly}" stroke="${color}" stroke-width="3"/>`);
    out.push(`<circle cx="${left + 13}" cy="${ly}" r="4" fill="${color}"/>`);
    out.push(`<text x="${left + 36}" y="${ly + 4}" font-size="13" fill="#1d1f1c">${esc(run.label + (spec.showHz ? (run.hz ? `, Monitor ${run.hz} Hz` : ', Monitor ?') : ''))}</text>`);
  });
  out.push(`<text x="${left}" y="${H - 12}" font-size="11" fill="#5c5f58">${esc(spec.note)}</text>`);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

describe('benchmark chart generator', () => {
  it('writes docs/images/benchmarks-fps.svg and benchmarks-apply.svg', () => {
    const all = parseRuns(readFileSync(DOC_PATH, 'utf8'));
    // One line per machine: its newest measurement
    const runs = [...new Map([...all].sort((a, b) => a.date.localeCompare(b.date)).map((r) => [r.machine, r])).values()]
      .sort((a, b) => a.machine.localeCompare(b.machine));
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.rows.some((r) => r.speed === '1x')).toBe(true);

    mkdirSync(OUT_DIR, { recursive: true });
    writeGeneratedFile(
      resolve(OUT_DIR, 'benchmarks-fps.svg'),
      renderChart(runs, {
        title: 'FPS je Gegnerzahl, höher ist besser',
        yLabel: 'FPS',
        yMax: 160,
        yStep: 20,
        value: (r) => r.fps,
        showHz: true,
        note: 'FPS sind von der Bildwiederholrate des Monitors gedeckelt; vergleichbar ist nur, wo eine Linie darunter fällt. Aus docs/BENCHMARKS.md.',
      }),
    );
    writeGeneratedFile(
      resolve(OUT_DIR, 'benchmarks-apply.svg'),
      renderChart(runs, {
        title: 'Hauptthread-Zeit je Paket (Apply) in ms, niedriger ist besser',
        yLabel: 'ms',
        yMax: 22,
        yStep: 2,
        value: (r) => r.apply,
        guide: { y: 16.6, label: '16,6 ms = ein Bild bei 60 FPS' },
        note: 'Unabhängig vom Monitor. Aus docs/BENCHMARKS.md, npm run benchmark-chart.',
      }),
    );
  });
});
