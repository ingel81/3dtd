/**
 * Economy Chart Generator (Phase 5.16).
 *
 * Reads the live configs and writes docs/economy-chart.html — a self-contained
 * page (Chart.js via CDN) showing the wave-by-wave income progression vs. all
 * tower / research / research-center costs.
 *
 * Run on demand:
 *   npm run economy-chart
 *
 * The file also runs as a vitest spec on `npm test` so the chart automatically
 * stays in sync after any balance change. It writes the same HTML each time
 * (same configs → same output), so git only shows a diff when the underlying
 * numbers actually moved.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WAVE_CURRICULUM,
  goldBudgetForWave,
  endgameHpMultiplier,
  enemyBaseDamageForWave,
} from '../../src/app/ai/core/wave-curriculum';
import { TOWER_TYPES, type TowerTypeId } from '../../src/app/configs/tower-types.config';
import { RESEARCH_TREE } from '../../src/app/configs/research/research-tree.config';
import {
  RESEARCH_CENTER_LEVELS,
  RESEARCH_CENTER_CONFIG,
} from '../../src/app/configs/research/research-center.config';
import { GAME_BALANCE } from '../../src/app/configs/game-balance.config';
import type { ResearchId } from '../../src/app/configs/research/research.types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/economy-chart.html');
const CURRICULUM_LEN = WAVE_CURRICULUM.length; // 30 explicit entries
const NUM_WAVES = 50; // extend visualisation past curriculum to show extrapolation + difficulty ramp

interface WaveRow {
  wave: number;
  template: string;
  kill: number;
  complete: number;
  milestone: number;
  total: number;
  cumul: number;
  perfect: number; // cumul if every wave were Perfect (skill bonus + combo)
}

interface TowerRow {
  id: TowerTypeId;
  name: string;
  cost: number;
}

interface ResearchRow {
  id: ResearchId;
  name: string;
  cost: number;
  duration: number;
  prerequisites: ResearchId[];
  cumulativeCostToUnlock: number;
  cumulativeDurationToUnlock: number;
}

function buildWaveRows(): WaveRow[] {
  const milestones = GAME_BALANCE.economy.milestoneBonuses;
  const cfg = GAME_BALANCE.economy;

  let cumul = GAME_BALANCE.player.startCredits;
  let cumulPerfect = GAME_BALANCE.player.startCredits;
  let streak = 0;

  const rows: WaveRow[] = [];
  for (let w = 1; w <= NUM_WAVES; w++) {
    const { kill, complete } = goldBudgetForWave(w);
    const milestone = milestones[w] ?? 0;
    const total = kill + complete + milestone;
    cumul += total;

    // Hypothetical "perfect run": every wave Perfect → +35% on completion
    // plus combo (+5% per streak, capped at +30%).
    streak += 1;
    const combo = Math.min(cfg.comboBonusMax, streak * cfg.comboBonusPerStreak);
    const perfectBonus = Math.round(complete * cfg.perfectBonusRatio);
    const comboBonus = Math.round(complete * combo);
    cumulPerfect += kill + complete + milestone + perfectBonus + comboBonus;

    rows.push({
      wave: w,
      // Past curriculum length the template loops back (W31 = W1's template etc.)
      template: WAVE_CURRICULUM[(w - 1) % CURRICULUM_LEN].template,
      kill,
      complete,
      milestone,
      total,
      cumul,
      perfect: cumulPerfect,
    });
  }
  return rows;
}

function buildTowerRows(): TowerRow[] {
  return Object.values(TOWER_TYPES).map((t) => ({
    id: t.id,
    name: t.name,
    cost: t.cost,
  }));
}

function buildResearchRows(): ResearchRow[] {
  // DFS through prereqs to get total cost+duration to unlock each research
  // (sums the research itself + all transitive prereqs, deduplicated).
  const rows: ResearchRow[] = [];
  for (const r of Object.values(RESEARCH_TREE)) {
    const seen = new Set<ResearchId>();
    let cumCost = 0;
    let cumDuration = 0;
    const visit = (id: ResearchId): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = RESEARCH_TREE[id];
      for (const p of node.prerequisites) visit(p);
      cumCost += node.cost;
      cumDuration += node.duration;
    };
    visit(r.id);
    rows.push({
      id: r.id,
      name: r.name,
      cost: r.cost,
      duration: r.duration,
      prerequisites: r.prerequisites,
      cumulativeCostToUnlock: cumCost,
      cumulativeDurationToUnlock: cumDuration,
    });
  }
  return rows;
}

function renderHtml(
  waveRows: WaveRow[],
  towerRows: TowerRow[],
  researchRows: ResearchRow[],
): string {
  const startCredits = GAME_BALANCE.player.startCredits;
  const balance = GAME_BALANCE.economy;

  // Cost milestones to overlay on the cumulative-income chart. Each one is the
  // *total* gold a player needs to have spent to reach that state (cumulative
  // cost from game start, including prereq research where applicable).
  const rcBaseCost = RESEARCH_CENTER_CONFIG.baseCost;
  const rcLvl2 = RESEARCH_CENTER_LEVELS.find((l) => l.level === 2)?.upgradeCost ?? 0;
  const rcLvl3 = RESEARCH_CENTER_LEVELS.find((l) => l.level === 3)?.upgradeCost ?? 0;
  const find = (id: ResearchId) => researchRows.find((r) => r.id === id)!;

  const milestones: { label: string; cost: number; color: string }[] = [
    { label: 'Research Center placed', cost: rcBaseCost, color: '#6FB7A5' },
    { label: 'First Archer (45)', cost: 45, color: '#888' },
    {
      label: 'Anti-Air ready (Rocketry+AA-Retrofit + Rocket tower)',
      cost: rcBaseCost + find('rocketry').cumulativeCostToUnlock + find('aa-retrofit').cost + TOWER_TYPES['rocket'].cost,
      color: '#E2A53D',
    },
    {
      label: 'Cannon unlocked + built (Siege-Eng + Cannon)',
      cost: rcBaseCost + find('siege-engineering').cumulativeCostToUnlock + TOWER_TYPES['cannon'].cost,
      color: '#C04B3F',
    },
    {
      label: 'Magic unlocked + built (Ice-Magic + Arcane + Magic)',
      cost: rcBaseCost + find('arcane-studies').cumulativeCostToUnlock + TOWER_TYPES['magic'].cost,
      color: '#7B6BD9',
    },
    {
      label: 'Research Center → Lv2',
      cost: rcBaseCost + rcLvl2,
      color: '#6FB7A5',
    },
    {
      label: 'T2 upgrades available (Advanced Weaponry path)',
      cost: rcBaseCost + rcLvl2 + find('advanced-weaponry').cumulativeCostToUnlock,
      color: '#9B7BC2',
    },
    {
      label: 'Research Center → Lv3',
      cost: rcBaseCost + rcLvl2 + rcLvl3,
      color: '#6FB7A5',
    },
    {
      label: 'T3 upgrades available (Master Engineering full chain)',
      cost: rcBaseCost + rcLvl2 + rcLvl3 + find('master-engineering').cumulativeCostToUnlock,
      color: '#D6A23A',
    },
    {
      label: 'T4 upgrades available (Advanced Engineering chain)',
      cost: rcBaseCost + rcLvl2 + rcLvl3 + find('advanced-engineering').cumulativeCostToUnlock,
      color: '#E68A4D',
    },
    {
      label: 'T5 upgrades available (Transcendent Tech chain)',
      cost: rcBaseCost + rcLvl2 + rcLvl3 + find('transcendent-tech').cumulativeCostToUnlock,
      color: '#F2D17A',
    },
  ].sort((a, b) => a.cost - b.cost);

  // Upgrade-track cost snapshots: cumulative cost to bring ONE stat from L0
  // to a given level (sum of getUpgradeCost(L) for L in 0..maxLevel-1).
  // Uses a representative tower (cannon) — all combat towers use the same
  // standard upgrade base cost & scaling under Phase 5.16.
  const sampleUpgrade = TOWER_TYPES['cannon'].upgrades.find((u) => u.id === 'damage')!;
  const upgradeMilestones: { level: number; cumulCost: number; tier: string }[] = [];
  let upgradeCum = 0;
  for (let lvl = 0; lvl < sampleUpgrade.maxLevel; lvl++) {
    const cost = Math.round(sampleUpgrade.cost * Math.pow(sampleUpgrade.costScaling ?? 1, lvl));
    upgradeCum += cost;
    const targetLevel = lvl + 1;
    const tier =
      targetLevel <= 5 ? 'T1' :
      targetLevel <= 10 ? 'T2' :
      targetLevel <= 15 ? 'T3' :
      targetLevel <= 20 ? 'T4' : 'T5';
    upgradeMilestones.push({ level: targetLevel, cumulCost: upgradeCum, tier });
  }

  // Format helper for tables
  const fmt = (n: number) => n.toLocaleString('en-US');

  const waveLabels = waveRows.map((r) => `W${r.wave}`);
  const cumulData = waveRows.map((r) => r.cumul);
  const cumulPerfectData = waveRows.map((r) => r.perfect);
  const killData = waveRows.map((r) => r.kill);
  const completeData = waveRows.map((r) => r.complete);
  const milestoneData = waveRows.map((r) => r.milestone);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>3DTD Economy Chart — Phase 5.16</title>
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
  td.l { text-align: left; }
  tr.boss td { background: rgba(192,75,63,0.08); }
  tr.milestone td { color: #c9a44c; font-weight: 600; }
  .legend-row { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; margin-top: 6px; }
  .legend-row span { display: inline-flex; align-items: center; gap: 4px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
  code { background: #2a322a; padding: 1px 4px; border-radius: 2px; color: #6FB7A5; }
  .note { color: #8a8a78; font-size: 11px; margin: 6px 0 0 0; }
</style>
</head>
<body>
<h1>3DTD Economy Chart — Phase 5.16 (Wave-Curriculum Budget)</h1>
<div class="meta">
  Generated <code>${new Date().toISOString()}</code> from
  <code>wave-curriculum.ts</code>, <code>tower-types.config.ts</code>,
  <code>research-tree.config.ts</code>, <code>research-center.config.ts</code>,
  <code>game-balance.config.ts</code>.
  Regenerate via <code>npm run economy-chart</code>.
</div>

<div class="grid">

  <div class="chart-container">
    <h2>Early-Game Zoom (W1–W12) — Milestone Visibility</h2>
    <p class="note">
      Same data as the full chart below but Y-axis capped so the early
      milestone thresholds (Archer, Research-Center, Anti-Air, Cannon, Magic,
      RC-Lv2) sit at readable heights. This is the chart you want when tuning
      W1–W12 balance — late-game milestones are off-screen here on purpose.
    </p>
    <canvas id="earlyChart" height="110"></canvas>
  </div>

  <div class="chart-container">
    <h2>Full Progression (W1–W30) — Cumulative Player Gold vs. Cost Milestones</h2>
    <p class="note">
      Lower line = baseline run (no skill bonuses). Upper line = "perfect run"
      (every wave 0 HP loss → Perfect-Bonus +${(balance.perfectBonusRatio * 100).toFixed(0)}%
      and Combo up to +${(balance.comboBonusMax * 100).toFixed(0)}% on completion budget).
      Dashed lines = costs the player has to clear to reach key gameplay states
      (cumulative spending from game start, including prereq research).
      The milestones look bunched at the bottom because cumulative income at W30
      (~13k) dwarfs even the largest single-state cost (~1.2k); use the
      early-game zoom above for readable W1–W12 inspection.
    </p>
    <canvas id="cumulChart" height="120"></canvas>
  </div>

  <div class="chart-container">
    <h2>Milestone Affordability — When Does The Player First Cross Each Threshold?</h2>
    <p class="note">
      Wave at which the baseline cumulative gold first equals or exceeds each
      milestone cost. Tells you immediately whether a wave that <em>requires</em>
      a capability is reachable in time (e.g. W7 needs Anti-Air → must cross
      that milestone by W6 at the latest).
    </p>
    <canvas id="milestoneChart" height="90"></canvas>
  </div>

  <div class="chart-container">
    <h2>Per-Wave Income Breakdown</h2>
    <p class="note">Stacked: kill-budget (split equally per spawned enemy) + completion-base + milestone-bonus.</p>
    <canvas id="perWaveChart" height="100"></canvas>
  </div>

  <div class="chart-container">
    <h2>Difficulty Curve (Phase 5.16) — Endgame Pressure Multipliers</h2>
    <p class="note">
      Structural difficulty knobs that compound on top of the NN's continuous
      factors. <strong>HP multiplier</strong> kicks in at W20 (+5%/wave, cap 4×) — applied
      AFTER the NN's hp_mult so a strong checkpoint pushing 3× still gets the
      ramp on top. <strong>Leak damage</strong> scales every 10 waves so late-game leaks
      drain the base much faster (W11→2 HP, W21→3 HP, W31→4 HP per leak).
    </p>
    <canvas id="difficultyChart" height="90"></canvas>
  </div>

  <div class="chart-container">
    <h2>Wave-by-Wave Table</h2>
    <table>
      <thead>
        <tr>
          <th>Wave</th>
          <th class="l">Template</th>
          <th>Kill</th>
          <th>Complete</th>
          <th>Milestone</th>
          <th>Total</th>
          <th>Cumul (baseline)</th>
          <th>Cumul (perfect)</th>
        </tr>
      </thead>
      <tbody>
${waveRows
  .map((r) => {
    const isBoss = r.template === 'boss_herbert';
    const isMilestone = r.milestone > 0;
    const cls = [isBoss ? 'boss' : '', isMilestone ? 'milestone' : '']
      .filter(Boolean)
      .join(' ');
    return `        <tr${cls ? ` class="${cls}"` : ''}>
          <td>${r.wave}</td>
          <td class="l">${r.template}</td>
          <td>${fmt(r.kill)}</td>
          <td>${fmt(r.complete)}</td>
          <td>${r.milestone ? fmt(r.milestone) : '—'}</td>
          <td>${fmt(r.total)}</td>
          <td>${fmt(r.cumul)}</td>
          <td>${fmt(r.perfect)}</td>
        </tr>`;
  })
  .join('\n')}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>Tower Costs</h2>
    <table>
      <thead>
        <tr><th class="l">Tower</th><th>Cost</th></tr>
      </thead>
      <tbody>
${towerRows
  .sort((a, b) => a.cost - b.cost)
  .map((t) => `        <tr><td class="l">${t.name}</td><td>${fmt(t.cost)}</td></tr>`)
  .join('\n')}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>Upgrade-Track Cost Curve (per stat, per tower)</h2>
    <p class="note">
      Cumulative cost to bring ONE stat (e.g. damage) on ONE tower from L0 to
      the listed level. All combat towers use the same standard track:
      base ${sampleUpgrade.cost}g, scaling ×${(sampleUpgrade.costScaling ?? 1).toFixed(2)} per level,
      maxLevel ${sampleUpgrade.maxLevel}. Tier-Gating: T1=L1-5 (free), T2=L6-10
      (Advanced Weaponry), T3=L11-15 (Master Engineering), T4=L16-20 (Advanced
      Engineering), T5=L21-25 (Transcendent Tech). Note that the late tiers
      cost more than a Wave-30 cumulative income, so players can never max
      everything — that's the design.
    </p>
    <table>
      <thead>
        <tr>
          <th>Level</th>
          <th>Tier</th>
          <th>Step Cost</th>
          <th>Cumul (one stat)</th>
          <th>Cumul × 3 stats</th>
        </tr>
      </thead>
      <tbody>
${upgradeMilestones
  .filter((m) => m.level === 1 || m.level === 5 || m.level === 10 || m.level === 15 || m.level === 20 || m.level === 25)
  .map((m) => {
    const stepCost = Math.round(sampleUpgrade.cost * Math.pow(sampleUpgrade.costScaling ?? 1, m.level - 1));
    return `        <tr>
          <td>L${m.level}</td>
          <td>${m.tier}</td>
          <td>${fmt(stepCost)}</td>
          <td>${fmt(m.cumulCost)}</td>
          <td>${fmt(m.cumulCost * 3)}</td>
        </tr>`;
  })
  .join('\n')}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>Research Tree (with cumulative cost-to-unlock)</h2>
    <p class="note">
      Cumul = cost to research <em>this node + all prereqs</em> from scratch.
      Cumul-Time = same for duration. Both are minimums (no parallel-slot
      speedup or research center upgrades factored in).
    </p>
    <table>
      <thead>
        <tr>
          <th class="l">Research</th>
          <th>Cost</th>
          <th>Duration</th>
          <th class="l">Prerequisites</th>
          <th>Cumul Cost</th>
          <th>Cumul Time</th>
        </tr>
      </thead>
      <tbody>
${researchRows
  .sort((a, b) => a.cumulativeCostToUnlock - b.cumulativeCostToUnlock)
  .map(
    (r) => `        <tr>
          <td class="l">${r.name}</td>
          <td>${fmt(r.cost)}</td>
          <td>${r.duration}s</td>
          <td class="l">${r.prerequisites.join(', ') || '—'}</td>
          <td>${fmt(r.cumulativeCostToUnlock)}</td>
          <td>${r.cumulativeDurationToUnlock}s</td>
        </tr>`,
  )
  .join('\n')}
      </tbody>
    </table>
  </div>

  <div class="chart-container">
    <h2>Research Center</h2>
    <table>
      <thead>
        <tr><th class="l">State</th><th>Cost</th><th>Slots</th></tr>
      </thead>
      <tbody>
        <tr><td class="l">Place (Level 1)</td><td>${rcBaseCost}</td><td>${RESEARCH_CENTER_LEVELS[0].researchSlots}</td></tr>
${RESEARCH_CENTER_LEVELS.slice(1)
  .map(
    (l) =>
      `        <tr><td class="l">Upgrade to Level ${l.level}</td><td>${fmt(l.upgradeCost)}</td><td>${l.researchSlots}</td></tr>`,
  )
  .join('\n')}
      </tbody>
    </table>
  </div>

</div>

<script>
const milestoneLines = ${JSON.stringify(milestones)};
const startCredits = ${startCredits};
const numWaves = ${NUM_WAVES};
const cumulData = ${JSON.stringify(cumulData)};
const cumulPerfectData = ${JSON.stringify(cumulPerfectData)};
const waveLabels = ${JSON.stringify(waveLabels)};
const hpMultData = ${JSON.stringify(waveRows.map((r) => endgameHpMultiplier(r.wave)))};
const leakDamageData = ${JSON.stringify(waveRows.map((r) => enemyBaseDamageForWave(r.wave)))};

// Wave at which baseline cumul first reaches each milestone (1-indexed; null = never)
function waveAffordable(cost) {
  for (let i = 0; i < cumulData.length; i++) {
    if (cumulData[i] >= cost) return i + 1;
  }
  return null;
}

const earlyWaves = 12;
const earlyChartCtx = document.getElementById('earlyChart').getContext('2d');
new Chart(earlyChartCtx, {
  type: 'line',
  data: {
    labels: waveLabels.slice(0, earlyWaves),
    datasets: [
      {
        label: 'Cumulative Gold (baseline)',
        data: cumulData.slice(0, earlyWaves),
        borderColor: '#6FB7A5',
        backgroundColor: 'rgba(111,183,165,0.12)',
        fill: true,
        tension: 0.2,
        pointRadius: 3,
      },
      {
        label: 'Cumulative Gold (perfect run)',
        data: cumulPerfectData.slice(0, earlyWaves),
        borderColor: '#c9a44c',
        fill: false,
        tension: 0.2,
        pointRadius: 2,
        borderDash: [4, 3],
      },
      ...milestoneLines
        .filter(m => m.cost <= 1500)
        .map(m => ({
          label: m.label + ' (' + m.cost + 'g)',
          data: new Array(earlyWaves).fill(m.cost),
          borderColor: m.color,
          borderWidth: 1.5,
          borderDash: [2, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        })),
    ],
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#d8d4c8', font: { size: 11 } } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { ticks: { color: '#8a8a78' }, grid: { color: '#2a322a' } },
      y: {
        max: 1500,
        ticks: { color: '#8a8a78', callback: (v) => v.toLocaleString('en-US') + 'g' },
        grid: { color: '#2a322a' },
        beginAtZero: true,
      },
    },
  },
});

const cumulChartCtx = document.getElementById('cumulChart').getContext('2d');
new Chart(cumulChartCtx, {
  type: 'line',
  data: {
    labels: waveLabels,
    datasets: [
      {
        label: 'Cumulative Gold (baseline)',
        data: cumulData,
        borderColor: '#6FB7A5',
        backgroundColor: 'rgba(111,183,165,0.12)',
        fill: true,
        tension: 0.2,
        pointRadius: 3,
      },
      {
        label: 'Cumulative Gold (perfect run)',
        data: cumulPerfectData,
        borderColor: '#c9a44c',
        fill: false,
        tension: 0.2,
        pointRadius: 2,
        borderDash: [4, 3],
      },
      ...milestoneLines.map(m => ({
        label: m.label + ' (' + m.cost + 'g)',
        data: new Array(numWaves).fill(m.cost),
        borderColor: m.color,
        borderWidth: 1,
        borderDash: [2, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
      })),
    ],
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#d8d4c8', font: { size: 11 } } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { ticks: { color: '#8a8a78' }, grid: { color: '#2a322a' } },
      y: {
        ticks: { color: '#8a8a78', callback: (v) => v.toLocaleString('en-US') + 'g' },
        grid: { color: '#2a322a' },
        beginAtZero: true,
      },
    },
  },
});

const difficultyChartCtx = document.getElementById('difficultyChart').getContext('2d');
new Chart(difficultyChartCtx, {
  type: 'line',
  data: {
    labels: waveLabels,
    datasets: [
      {
        label: 'HP multiplier (post-NN)',
        data: hpMultData,
        borderColor: '#C04B3F',
        backgroundColor: 'rgba(192,75,63,0.10)',
        fill: true,
        tension: 0.0,
        pointRadius: 2,
        yAxisID: 'y',
      },
      {
        label: 'Leak damage (HP per enemy reaching base)',
        data: leakDamageData,
        borderColor: '#E68A4D',
        fill: false,
        stepped: true,
        pointRadius: 2,
        yAxisID: 'y1',
      },
    ],
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#d8d4c8', font: { size: 11 } } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { ticks: { color: '#8a8a78' }, grid: { color: '#2a322a' } },
      y: {
        type: 'linear',
        position: 'left',
        ticks: { color: '#C04B3F', callback: (v) => v.toFixed(1) + '×' },
        grid: { color: '#2a322a' },
        title: { display: true, text: 'HP multiplier', color: '#C04B3F' },
        beginAtZero: true,
      },
      y1: {
        type: 'linear',
        position: 'right',
        ticks: { color: '#E68A4D', callback: (v) => v + ' HP' },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Leak damage', color: '#E68A4D' },
        beginAtZero: true,
      },
    },
  },
});

const milestoneChartCtx = document.getElementById('milestoneChart').getContext('2d');
const milestoneAffordability = milestoneLines.map(m => ({
  label: m.label,
  cost: m.cost,
  wave: waveAffordable(m.cost),
  color: m.color,
}));
new Chart(milestoneChartCtx, {
  type: 'bar',
  data: {
    labels: milestoneAffordability.map(m => m.label),
    datasets: [{
      label: 'Wave when first affordable',
      data: milestoneAffordability.map(m => m.wave ?? 0),
      backgroundColor: milestoneAffordability.map(m => m.color),
    }],
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const m = milestoneAffordability[ctx.dataIndex];
            return 'Affordable at W' + (m.wave ?? '∞') + ' (cost: ' + m.cost + 'g)';
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#8a8a78', callback: (v) => 'W' + v },
        grid: { color: '#2a322a' },
        beginAtZero: true,
        max: numWaves,
      },
      y: { ticks: { color: '#d8d4c8', font: { size: 10 } }, grid: { color: '#2a322a' } },
    },
  },
});

const perWaveCtx = document.getElementById('perWaveChart').getContext('2d');
new Chart(perWaveCtx, {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(waveLabels)},
    datasets: [
      { label: 'Kill budget', data: ${JSON.stringify(killData)}, backgroundColor: '#6FB7A5' },
      { label: 'Completion base', data: ${JSON.stringify(completeData)}, backgroundColor: '#c9a44c' },
      { label: 'Milestone bonus', data: ${JSON.stringify(milestoneData)}, backgroundColor: '#C04B3F' },
    ],
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#d8d4c8', font: { size: 11 } } } },
    scales: {
      x: { stacked: true, ticks: { color: '#8a8a78' }, grid: { color: '#2a322a' } },
      y: { stacked: true, ticks: { color: '#8a8a78', callback: (v) => v + 'g' }, grid: { color: '#2a322a' } },
    },
  },
});
</script>
</body>
</html>
`;
}

describe('economy chart generator', () => {
  it('writes docs/economy-chart.html', () => {
    const waveRows = buildWaveRows();
    const towerRows = buildTowerRows();
    const researchRows = buildResearchRows();

    const html = renderHtml(waveRows, towerRows, researchRows);

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, html);

    expect(html).toContain('Cumulative Player Gold');
    expect(waveRows.length).toBe(NUM_WAVES);
    expect(towerRows.length).toBeGreaterThan(0);
    expect(researchRows.length).toBeGreaterThan(0);
  });
});
