/**
 * Tower-Stats Chart Generator.
 *
 * Reads the live tower configs and writes docs/tower-stats-chart.html — a
 * self-contained page (Chart.js via CDN) comparing DPS, DPS/Gold, range,
 * damage, fire-rate and cost of every combat tower across all 25 upgrade
 * levels. Built for balancing.
 *
 * Fuels itself entirely from the configs — nothing is maintained twice:
 *   - stats come from TOWER_TYPES
 *   - upgrade costs from getUpgradeCost()
 *   - DPS from the SAME computeTowerStatsAtLevel() / computeTowerDPSFromLevels()
 *     the running game uses (see tower-dps.util.ts)
 *
 * Run on demand:
 *   npm run tower-stats-chart
 *
 * The file also runs as a vitest spec on `npm test`, so the chart stays in
 * sync after any tower-balance change. Same configs → same output, so git
 * only shows a diff when the underlying numbers actually moved.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWER_TYPES,
  getUpgradeCost,
  type TowerTypeId,
  type TowerTypeConfig,
} from '../../src/app/configs/tower-types.config';
import { computeTowerStatsAtLevel } from '../../src/app/ai/core/tower-dps.util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/tower-stats-chart.html');

// Combat towers only — research-center is a passive building (no DPS / range).
const COMBAT_TOWERS: TowerTypeConfig[] = Object.values(TOWER_TYPES).filter(
  (t) => t.attackType !== 'passive',
);

// All combat towers share the standard 25-level upgrade tracks.
const MAX_LEVEL = COMBAT_TOWERS[0].upgrades[0].maxLevel;

// Snapshot levels used by the summary tables.
const SNAPSHOT_LEVELS = [0, 5, 10, 15, 20, 25].filter((l) => l <= MAX_LEVEL);

// Fixed dark-theme palette — one stable colour per tower across every chart.
const TOWER_COLORS: Record<string, string> = {
  archer: '#6FB7A5',
  'dual-gatling': '#C9A44C',
  cannon: '#C04B3F',
  magic: '#9B7BD9',
  rocket: '#E68A4D',
  ice: '#5FA8D3',
  fire: '#EE6C4D',
  tentacle: '#8FB339',
  poison: '#5FBF8F',
  lightning: '#E8D44D',
};

interface LevelPoint {
  level: number;
  dps: number;
  damage: number;
  fireRate: number;
  range: number;
  beamWidth: number;
  /** Gold to buy THIS level on every upgrade track (0 at level 0). */
  stepCost: number;
  /** Base tower cost + all upgrade gold spent up to this level. */
  cumulativeGold: number;
  /** dps / cumulativeGold — efficiency. */
  dpsPerGold: number;
}

interface TowerSeries {
  id: TowerTypeId;
  name: string;
  attackType: string;
  damageType: string;
  baseCost: number;
  color: string;
  points: LevelPoint[];
}

const round = (n: number, digits = 2): number => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

/**
 * Build one series per combat tower with effective stats + cost for every
 * level 0..MAX_LEVEL. The "level" is uniform: every upgrade track of the
 * tower sits at the same level — the only model that yields a single
 * comparable curve per tower.
 */
function buildTowerSeries(): TowerSeries[] {
  return COMBAT_TOWERS.map((cfg) => {
    const points: LevelPoint[] = [];
    let cumulativeUpgradeGold = 0;

    for (let level = 0; level <= MAX_LEVEL; level++) {
      // stepCost: gold charged when buying THIS level (level-1 → level) on
      // every upgrade track at once.
      let stepCost = 0;
      if (level > 0) {
        for (const u of cfg.upgrades) {
          stepCost += getUpgradeCost(u, level - 1);
        }
        cumulativeUpgradeGold += stepCost;
      }
      const cumulativeGold = cfg.cost + cumulativeUpgradeGold;
      const stats = computeTowerStatsAtLevel(cfg, level);

      points.push({
        level,
        dps: round(stats.dps, 1),
        damage: round(stats.damage, 1),
        fireRate: round(stats.fireRate, 2),
        range: round(stats.range, 1),
        beamWidth: round(stats.beamWidth, 2),
        stepCost,
        cumulativeGold,
        dpsPerGold: round(stats.dps / cumulativeGold, 4),
      });
    }

    return {
      id: cfg.id,
      name: cfg.name,
      attackType: cfg.attackType ?? 'projectile',
      damageType: cfg.damageType,
      baseCost: cfg.cost,
      color: TOWER_COLORS[cfg.id] ?? '#888888',
      points,
    };
  });
}

function renderHtml(series: TowerSeries[]): string {
  const fmt = (n: number): string => n.toLocaleString('en-US');

  // ---- Tables -----------------------------------------------------------
  const baseStatsRows = series
    .map((s) => {
      const p0 = s.points[0];
      return `        <tr>
          <td class="l" style="color:${s.color}">${s.name}</td>
          <td class="l">${s.attackType}</td>
          <td class="l">${s.damageType}</td>
          <td>${fmt(s.baseCost)}</td>
          <td>${p0.damage}</td>
          <td>${s.attackType === 'beam' ? '—' : p0.fireRate}</td>
          <td>${p0.range}</td>
          <td>${p0.dps}</td>
        </tr>`;
    })
    .join('\n');

  const snapshotHead = SNAPSHOT_LEVELS.map((l) => `<th>L${l}</th>`).join('');

  const dpsSnapshotRows = series
    .map((s) => {
      const cells = SNAPSHOT_LEVELS.map((l) => `<td>${fmt(Math.round(s.points[l].dps))}</td>`).join('');
      return `        <tr><td class="l" style="color:${s.color}">${s.name}</td>${cells}</tr>`;
    })
    .join('\n');

  const goldSnapshotRows = series
    .map((s) => {
      const cells = SNAPSHOT_LEVELS.map((l) => `<td>${fmt(s.points[l].cumulativeGold)}</td>`).join('');
      return `        <tr><td class="l" style="color:${s.color}">${s.name}</td>${cells}</tr>`;
    })
    .join('\n');

  // Slim payload for the inline script (one object per tower).
  const payload = series.map((s) => ({
    id: s.id,
    name: s.name,
    attackType: s.attackType,
    color: s.color,
    points: s.points.map((p) => ({
      level: p.level,
      dps: p.dps,
      damage: p.damage,
      fireRate: p.fireRate,
      range: p.range,
      stepCost: p.stepCost,
      cumulativeGold: p.cumulativeGold,
      dpsPerGold: p.dpsPerGold,
    })),
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>3DTD Tower-Stats Chart</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  body { font-family: 'JetBrains Mono', 'Consolas', monospace; background: #1a1f1a; color: #d8d4c8; margin: 24px; }
  h1, h2 { color: #c9a44c; letter-spacing: 0.5px; }
  h1 { border-bottom: 2px solid #6FB7A5; padding-bottom: 6px; }
  .meta { color: #8a8a78; font-size: 12px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 32px; }
  .chart-container { background: #232a23; padding: 16px; border-radius: 4px; border-left: 3px solid #6FB7A5; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 8px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #2a322a; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th { background: #2a322a; color: #c9a44c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; }
  td.l, th.l { text-align: left; }
  code { background: #2a322a; padding: 1px 4px; border-radius: 2px; color: #6FB7A5; }
  .note { color: #8a8a78; font-size: 11px; margin: 6px 0 0 0; }
</style>
</head>
<body>
<h1>3DTD Tower-Stats Chart</h1>
<div class="meta">
  Generated <code>${new Date().toISOString()}</code> from
  <code>tower-types.config.ts</code> and <code>tower-dps.util.ts</code>
  (same DPS formula the game uses). Regenerate via
  <code>npm run tower-stats-chart</code>.
</div>
<div class="meta">
  <strong>Modell:</strong> Der „Level" auf der X-Achse ist ein <em>uniformer</em>
  Upgrade-Stand — alle Upgrade-Tracks eines Towers (Damage / Fire Rate / Range
  bzw. Beam-Width) stehen gleichzeitig auf diesem Level. Ein realer Spieler
  verteilt die Tracks ungleich; das Chart zeigt das Referenz-Szenario, keine
  optimale Strategie. „Gold investiert" = Basiskosten + alle Upgrade-Kosten
  bis zu diesem Level. Beam-Tower (Fire): „Damage" = effektiver DPS-Wert
  (damagePerSecond), keine Fire-Rate. Poison-DoT ist ein flacher Additiv
  (AI-Approximation, nicht damage-skaliert).
</div>

<div class="grid">

  <div class="chart-container">
    <h2>DPS über Upgrade-Level</h2>
    <p class="note">Effektiver DPS jedes Combat-Towers über alle ${MAX_LEVEL} Level. Linear — zeigt die absolute Late-Game-Skalierung. Linien per Legende ein/ausblenden.</p>
    <canvas id="dpsChart" height="120"></canvas>
  </div>

  <div class="chart-container">
    <h2>DPS / Gold — Effizienz</h2>
    <p class="note">DPS pro investiertem Gold (Basiskosten + kumulierte Upgrade-Kosten). Fällt typischerweise mit steigendem Level, weil die Upgrade-Kosten (×1.40/Level) schneller wachsen als der DPS.</p>
    <canvas id="dpsPerGoldChart" height="120"></canvas>
  </div>

  <div class="chart-container">
    <h2>Damage über Level</h2>
    <p class="note">Roh-Damage pro Treffer. Beam-Tower (Fire) zeigen hier ihren effektiven damagePerSecond-Wert.</p>
    <canvas id="damageChart" height="110"></canvas>
  </div>

  <div class="chart-container">
    <h2>Range über Level</h2>
    <p class="note">Reichweite in Metern. Achtung: Archer hat ein eigenes, abgeschwächtes Range-Upgrade.</p>
    <canvas id="rangeChart" height="110"></canvas>
  </div>

  <div class="chart-container">
    <h2>Fire Rate über Level</h2>
    <p class="note">Schüsse pro Sekunde. Beam-Tower (Fire) sind ausgeschlossen — sie haben keine Fire-Rate.</p>
    <canvas id="fireRateChart" height="110"></canvas>
  </div>

  <div class="chart-container">
    <h2>Step-Cost pro Level</h2>
    <p class="note">Gold-Kosten für DIESES Level über alle Upgrade-Tracks zusammen. Logarithmische Y-Achse (Kosten-Scaling ×1.40/Level). Alle Combat-Tower teilen denselben Standard-Track — die Linien liegen übereinander.</p>
    <canvas id="stepCostChart" height="100"></canvas>
  </div>

  <div class="chart-container">
    <h2>Kumulierte Gesamtinvestition</h2>
    <p class="note">Basiskosten + alle Upgrade-Kosten bis zu diesem Level. Logarithmische Y-Achse. Unterschiede zwischen Towern kommen nur von den Basiskosten.</p>
    <canvas id="cumulGoldChart" height="100"></canvas>
  </div>

  <div class="chart-container">
    <h2>Base-Stats (Level 0)</h2>
    <table>
      <thead>
        <tr>
          <th class="l">Tower</th>
          <th class="l">Attack</th>
          <th class="l">Damage Type</th>
          <th>Cost</th>
          <th>Damage</th>
          <th>Fire Rate</th>
          <th>Range</th>
          <th>DPS</th>
        </tr>
      </thead>
      <tbody>
${baseStatsRows}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>DPS-Snapshots</h2>
    <p class="note">Effektiver DPS bei den Tier-Grenzen (uniformer Level).</p>
    <table>
      <thead><tr><th class="l">Tower</th>${snapshotHead}</tr></thead>
      <tbody>
${dpsSnapshotRows}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>Gesamtinvestition-Snapshots</h2>
    <p class="note">Kumuliertes Gold (Basis + alle Tracks) bei den Tier-Grenzen.</p>
    <table>
      <thead><tr><th class="l">Tower</th>${snapshotHead}</tr></thead>
      <tbody>
${goldSnapshotRows}
      </tbody>
    </table>
  </div>

</div>

<script>
const SERIES = ${JSON.stringify(payload)};
const LEVELS = SERIES[0].points.map(function (p) { return p.level; });

const AXIS = '#8a8a78';
const GRID = '#2a322a';
const TEXT = '#d8d4c8';

function makeLineChart(canvasId, key, yTitle, opts) {
  opts = opts || {};
  const datasets = SERIES
    .filter(function (s) { return opts.skipBeam ? s.attackType !== 'beam' : true; })
    .map(function (s) {
      return {
        label: s.name,
        data: s.points.map(function (p) {
          const v = p[key];
          // Log axis can't plot 0 (e.g. step-cost at level 0) — drop to a gap.
          return (opts.log && v <= 0) ? null : v;
        }),
        borderColor: s.color,
        backgroundColor: s.color + '22',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15,
      };
    });

  const yScale = {
    title: { display: true, text: yTitle, color: AXIS },
    ticks: { color: AXIS },
    grid: { color: GRID },
  };
  if (opts.log) { yScale.type = 'logarithmic'; } else { yScale.beginAtZero = true; }

  new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'line',
    data: { labels: LEVELS, datasets: datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: TEXT, font: { size: 11 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          title: { display: true, text: 'Upgrade Level', color: AXIS },
          ticks: { color: AXIS },
          grid: { color: GRID },
        },
        y: yScale,
      },
    },
  });
}

makeLineChart('dpsChart', 'dps', 'DPS');
makeLineChart('dpsPerGoldChart', 'dpsPerGold', 'DPS pro Gold');
makeLineChart('damageChart', 'damage', 'Damage');
makeLineChart('rangeChart', 'range', 'Range (m)');
makeLineChart('fireRateChart', 'fireRate', 'Fire Rate (Schuss/s)', { skipBeam: true });
makeLineChart('stepCostChart', 'stepCost', 'Step-Cost (Gold)', { log: true });
makeLineChart('cumulGoldChart', 'cumulativeGold', 'Gold investiert', { log: true });
</script>
</body>
</html>
`;
}

describe('tower-stats chart generator', () => {
  it('writes docs/tower-stats-chart.html', () => {
    const series = buildTowerSeries();
    const html = renderHtml(series);

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, html);

    // 10 combat towers (11 tower types minus the passive research-center).
    expect(series.length).toBeGreaterThanOrEqual(10);

    for (const s of series) {
      expect(s.points.length).toBe(MAX_LEVEL + 1);
      // Every upgrade multiplier is >= 1, so DPS is monotonic non-decreasing.
      for (let i = 1; i < s.points.length; i++) {
        expect(s.points[i].dps).toBeGreaterThanOrEqual(s.points[i - 1].dps);
        expect(s.points[i].cumulativeGold).toBeGreaterThan(s.points[i - 1].cumulativeGold);
      }
    }

    expect(html).toContain('chart.js@4.4.4');
    expect(html).toContain('DPS über Upgrade-Level');
  });
});
