/**
 * Wave Planner Generator.
 *
 * Writes docs/wave-planner.html — an interactive single-file balance tool.
 * The designer plans the roster (towers + upgrades + researches + research
 * center) the player should have available at the START of every wave; the
 * tool computes the cost-delta between consecutive waves and turns that into
 * the gold-income each wave must produce. Side-by-side diff against the
 * current `wave-curriculum.config.ts` shows where reality and plan diverge.
 *
 * Knobs (sandbox): upgrade base cost, upgrade scaling, per-stat
 * multipliers, per-tower base cost, per-research cost. Knobs only live in
 * the browser — the actual configs are never written by this tool.
 *
 * The tool feeds itself entirely from the live configs (TOWER_TYPES,
 * RESEARCH_TREE, RESEARCH_CENTER_*, WAVE_CURRICULUM, GAME_BALANCE) — no
 * duplicated values, no duplicated formulas. Persistence is browser
 * localStorage; JSON export/import lets the designer version their plan
 * in git.
 *
 * Run on demand:
 *   npm run wave-planner
 *
 * Also runs as a vitest spec on `npm test` so the empty HTML template
 * stays in sync after any config change. The designer's plan lives in
 * localStorage and is not affected by regenerations.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWER_TYPES,
  type TowerTypeId,
} from '../../src/app/configs/tower-types.config';
import { RESEARCH_TREE } from '../../src/app/configs/research/research-tree.config';
import {
  RESEARCH_CENTER_LEVELS,
  RESEARCH_CENTER_CONFIG,
} from '../../src/app/configs/research/research-center.config';
import {
  WAVE_CURRICULUM,
  goldBudgetForWave,
} from '../../src/app/configs/wave-curriculum.config';
import { GAME_BALANCE } from '../../src/app/configs/game-balance.config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../docs/wave-planner.html');

// =====================================================================
// Wave-Gate metadata. Maps every template that appears in the curriculum
// to its design-intent gate tags. Kept here (not in the curriculum config)
// because gates are designer commentary, not gameplay-load-bearing data.
// =====================================================================
const TEMPLATE_GATES: Record<string, string[]> = {
  zombie_horde: [],
  rat_tide: ['swarm'],
  penguin_rush: ['speed'],
  light_mix: [],
  wallsmasher_crew: [],
  spider_swarm: ['swarm'],
  bat_swarm: ['air'],
  hornet_strike: ['air'],
  tank_column: ['heavy'],
  boss_herbert: ['boss'],
  bear_pack: ['heavy'],
  dragon_elite: ['air', 'heavy'],
  ghost_surge: ['ethereal'],
  mammoth_siege: ['fortified'],
  golem_squad: ['fortified'], // Stone Golem — sehr stark, kein Boss (Template noch nicht im Curriculum, siehe TODO 2.2)
  mech_army: ['heavy'],
  chaos_wave: ['air', 'mixed'],
  wraith_storm: ['ethereal', 'swarm'],
  armor_gauntlet: ['mixed'],
};

// Fixed dark-theme palette per tower — same as tower-stats-chart.
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

// =====================================================================
// PAYLOAD — slim, JSON-safe snapshot of the live configs the inline JS needs.
// =====================================================================
interface PayloadUpgrade {
  id: string;
  name: string;
  stat: string;          // 'damage' | 'fireRate' | 'range' | 'beamWidth' | 'research-slots'
  baseCost: number;
  scaling: number;
  multiplier: number;
  maxLevel: number;
}
interface PayloadTower {
  id: TowerTypeId;
  name: string;
  cost: number;
  attackType: string;
  damageType: string;
  color: string;
  canTargetAir: boolean;
  upgrades: PayloadUpgrade[];
}
interface PayloadResearch {
  id: string;
  name: string;
  cost: number;
  category: string;
  prerequisites: string[];
  effectSummary: string;
}
interface PayloadRcLevel {
  level: number;
  upgradeCost: number;
  slots: number;
}
interface PayloadCurriculumWave {
  wave: number;
  template: string;
  goldKill: number;
  goldComplete: number;
  gates: string[];
}
interface Payload {
  startCredits: number;
  defaults: {
    upgradeBaseCost: number;
    upgradeCostScaling: number;
    upgradeDamageMultiplier: number;
    upgradeSpeedMultiplier: number;
    upgradeRangeMultiplier: number;
    upgradeBeamWidthMultiplier: number;
    archerRangeMultiplier: number;
  };
  towers: PayloadTower[];
  researches: PayloadResearch[];
  rc: { baseCost: number; levels: PayloadRcLevel[] };
  curriculum: PayloadCurriculumWave[];
}

function summariseEffect(effects: { kind: string; towerId?: string; perkId?: string; tier?: number; capability?: string }[]): string {
  return effects
    .map((e) => {
      if (e.kind === 'unlock-tower') return `unlock ${e.towerId}`;
      if (e.kind === 'global-perk') return `perk ${e.perkId}`;
      if (e.kind === 'unlock-upgrade-tier') return `unlock T${e.tier}`;
      if (e.kind === 'enable-targeting') return `enable ${e.capability}`;
      return e.kind;
    })
    .join(', ');
}

function buildPayload(): Payload {
  const towers: PayloadTower[] = Object.values(TOWER_TYPES)
    .filter((t) => t.id !== 'research-center')
    .map((t) => ({
      id: t.id,
      name: t.name,
      cost: t.cost,
      attackType: t.attackType ?? 'projectile',
      damageType: t.damageType,
      color: TOWER_COLORS[t.id] ?? '#888888',
      canTargetAir: t.canTargetAir ?? false,
      upgrades: t.upgrades
        .filter((u) => u.effect.stat !== 'research-slots')
        .map((u) => ({
          id: u.id,
          name: u.name,
          stat: u.effect.stat,
          baseCost: u.cost,
          scaling: u.costScaling ?? 1,
          multiplier: u.effect.multiplier,
          maxLevel: u.maxLevel,
        })),
    }));

  const researches: PayloadResearch[] = Object.values(RESEARCH_TREE).map((r) => ({
    id: r.id,
    name: r.name,
    cost: r.cost,
    category: r.category,
    prerequisites: [...r.prerequisites],
    effectSummary: summariseEffect(r.effects as never),
  }));

  const rc = {
    baseCost: RESEARCH_CENTER_CONFIG.baseCost,
    levels: RESEARCH_CENTER_LEVELS.map((l) => ({
      level: l.level,
      upgradeCost: l.upgradeCost,
      slots: l.researchSlots,
    })),
  };

  const curriculum: PayloadCurriculumWave[] = WAVE_CURRICULUM.map((w, i) => ({
    wave: i + 1,
    template: w.template,
    goldKill: w.goldKill,
    goldComplete: w.goldComplete,
    gates: TEMPLATE_GATES[w.template] ?? [],
  }));

  return {
    startCredits: GAME_BALANCE.player.startCredits,
    defaults: {
      upgradeBaseCost: 50,
      upgradeCostScaling: 1.40,
      upgradeDamageMultiplier: 1.10,
      upgradeSpeedMultiplier: 1.07,
      upgradeRangeMultiplier: 1.04,
      upgradeBeamWidthMultiplier: 1.05,
      archerRangeMultiplier: 1.02,
      rcBaseCost: RESEARCH_CENTER_CONFIG.baseCost,
    },
    towers,
    researches,
    rc,
    curriculum,
  };
}

// =====================================================================
// HTML rendering. Single-file output, Chart.js via CDN, inline JS holds
// state in localStorage. NO config writes from here.
// =====================================================================

function renderHtml(payload: Payload): string {
  const payloadJson = JSON.stringify(payload);
  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>3DTD Wave Planner</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  body { font-family: 'JetBrains Mono', 'Consolas', monospace; background: #1a1f1a; color: #d8d4c8; margin: 24px; }
  h1, h2, h3 { color: #c9a44c; letter-spacing: 0.5px; }
  h1 { border-bottom: 2px solid #6FB7A5; padding-bottom: 6px; margin-bottom: 6px; }
  h2 { margin: 0 0 8px 0; font-size: 16px; }
  h3 { font-size: 14px; color: #d8d4c8; margin: 12px 0 4px; }
  .meta { color: #8a8a78; font-size: 12px; margin-bottom: 12px; }
  .meta code { background: #2a322a; padding: 1px 4px; border-radius: 2px; color: #6FB7A5; }
  .section { background: #232a23; padding: 16px; border-radius: 4px; border-left: 3px solid #6FB7A5; margin: 16px 0; }
  .note { color: #8a8a78; font-size: 11px; margin: 4px 0 10px 0; }
  button { background: #2a322a; border: 1px solid #3a4a3a; color: #d8d4c8; font-family: inherit; padding: 6px 14px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  button:hover { background: #3a4a3a; border-color: #6FB7A5; }
  button.primary { background: #6FB7A5; color: #1a1f1a; border-color: #6FB7A5; font-weight: 600; }
  button.danger { color: #C04B3F; border-color: #C04B3F; }
  button.row-action { background: transparent; border: 1px solid #3a4a3a; padding: 1px 6px; font-size: 12px; margin-right: 6px; min-width: 22px; color: #8a8a78; }
  button.row-action:hover { background: #2a322a; border-color: #6FB7A5; color: #6FB7A5; }
  button.row-action:disabled { opacity: 0.35; cursor: not-allowed; }
  input[type="number"], input[type="text"], select { background: #1a1f1a; color: #d8d4c8; border: 1px solid #3a4a3a; padding: 3px 6px; border-radius: 2px; font-family: inherit; font-size: 12px; }
  input[type="number"] { width: 60px; }
  input:focus, select:focus { outline: none; border-color: #6FB7A5; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #2a322a; text-align: right; vertical-align: top; }
  th:first-child, td:first-child { text-align: left; }
  th { background: #2a322a; color: #c9a44c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
  td.l, th.l { text-align: left; }
  tr.boss td { background: rgba(192,75,63,0.10); }
  tr.air td { background: rgba(95,168,211,0.06); }
  tr.ethereal td { background: rgba(155,123,217,0.08); }
  tr.fortified td { background: rgba(201,164,76,0.06); }
  tr.air.ethereal td, tr.boss.air td { background: rgba(192,75,63,0.10); } /* boss dominates */
  .gate-tag { display: inline-block; padding: 1px 6px; margin: 0 2px; border-radius: 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
  .gate-air       { background: #1e4a66; color: #5FA8D3; }
  .gate-boss      { background: #4a1e1a; color: #E0857C; }
  .gate-ethereal  { background: #3a2e5a; color: #B8A9E8; }
  .gate-fortified { background: #4a3a18; color: #E8C870; }
  .gate-heavy     { background: #3a2e1e; color: #C9A44C; }
  .gate-swarm     { background: #2e3a1e; color: #A8C66A; }
  .gate-speed     { background: #2a3a4a; color: #84D0E8; }
  .gate-mixed     { background: #3a2a3a; color: #C8A0C8; }
  .diff-pos { color: #C04B3F; font-weight: 600; }
  .diff-neg { color: #6FB7A5; }
  .diff-zero { color: #8a8a78; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
  .knob-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 24px; }
  .knob-grid label { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: #d8d4c8; }
  .knob-grid label .help { color: #8a8a78; font-size: 10px; }
  details > summary { cursor: pointer; color: #c9a44c; font-weight: 600; padding: 6px 0; user-select: none; }
  details > summary:hover { color: #6FB7A5; }
  dialog { background: #232a23; color: #d8d4c8; border: 1px solid #6FB7A5; border-radius: 4px; padding: 0; max-width: 1200px; width: 95%; max-height: 90vh; overflow: visible; }
  dialog::backdrop { background: rgba(0,0,0,0.7); }
  dialog .dialog-body { padding: 20px; max-height: 80vh; overflow-y: auto; }
  dialog .dialog-actions { padding: 12px 20px; background: #1a1f1a; border-top: 1px solid #3a4a3a; display: flex; gap: 8px; justify-content: flex-end; }
  .roster-section { margin-bottom: 16px; }
  .roster-section h3 { display: flex; justify-content: space-between; align-items: center; }
  .roster-section h3 .section-cost { font-size: 12px; color: #c9a44c; font-weight: normal; }
  .editor-tower-row { display: grid; grid-template-columns: 110px 75px repeat(4, 1fr) 80px; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid #2a322a; font-size: 12px; }
  .editor-tower-row .tower-name { font-weight: 600; }
  .editor-tower-row .tower-cost { text-align: right; color: #c9a44c; font-size: 11px; }
  .editor-tower-row .upgrade-slot { display: flex; align-items: center; gap: 4px; }
  .editor-tower-row .upgrade-slot .stat-label { color: #8a8a78; font-size: 10px; text-transform: uppercase; }
  .research-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .research-grid label { display: flex; align-items: center; gap: 6px; padding: 3px 6px; background: #1a1f1a; border: 1px solid #2a322a; border-radius: 3px; font-size: 11px; cursor: pointer; }
  .research-grid label.unsatisfied { opacity: 0.55; }
  .research-grid label.checked { border-color: #6FB7A5; background: #1e2a26; }
  .research-grid .r-cost { margin-left: auto; color: #c9a44c; font-size: 10px; }
  .research-grid .r-effect { color: #8a8a78; font-size: 10px; }
  .empty { color: #5a5a48; font-style: italic; }
  .roster-summary { font-size: 11px; line-height: 1.5; }
  .roster-summary .tower-chip { display: inline-block; padding: 0 5px; margin: 1px 2px; border-radius: 2px; background: #1a1f1a; }
</style>
</head>
<body>

<h1>3DTD Wave Planner — Aufstellung → Required Gold</h1>
<div class="meta">
  Generated <code>${generatedAt}</code> from
  <code>tower-types.config.ts</code>, <code>research-tree.config.ts</code>,
  <code>research-center.config.ts</code>, <code>wave-curriculum.config.ts</code>,
  <code>game-balance.config.ts</code>. Regenerate via
  <code>npm run wave-planner</code>.
</div>
<div class="meta">
  <strong>Wie es funktioniert:</strong> Für jede der 30 Wellen pflegst du, welche
  Tower (+ Upgrade-Level) + Forschungen + Research-Center-Stufe der Spieler beim
  <em>Start</em> dieser Welle deployed haben soll. Das Tool rechnet die
  Kostendifferenz zwischen aufeinanderfolgenden Wellen aus — das ist das Gold,
  das die jeweils vorhergehende Welle erwirtschaften muss. Diff zur aktuellen
  <code>wave-curriculum.config.ts</code> in der letzten Spalte. Knöpfe oben
  (Upgrade-Scaling, Tower-Kosten, Forschungskosten) sind eine Sandbox — sie
  ändern nur die Berechnung im Browser, niemals die Configs.
</div>

<div class="controls">
  <button class="primary" id="btnAddEndgame">Endgame-Ziel (W31) bearbeiten</button>
  <button id="btnLoadExample">Beispiel-Plan laden</button>
  <button class="danger" id="btnClear">Plan leeren</button>
  <button id="btnExport">JSON exportieren</button>
  <label class="primary" style="background:#2a322a;color:#d8d4c8;cursor:pointer;padding:6px 14px;border:1px solid #3a4a3a;border-radius:3px;font-size:12px;">JSON importieren<input type="file" id="fileImport" accept="application/json" style="display:none;" /></label>
  <span style="margin-left:auto; color:#8a8a78; font-size:11px;" id="statusBadge"></span>
</div>

<details class="section">
  <summary>Stellschrauben (Sandbox — wirkt nur im Browser)</summary>
  <p class="note">
    Ändert hier die Werte und beobachte, wie sich Cost & Required-Earning pro
    Welle verschieben. Nichts davon wird in die Config geschrieben — übernimm
    deine finalen Werte am Ende manuell in <code>tower-types.config.ts</code>
    bzw. die Forschungs-Configs.
  </p>
  <h3 style="margin-top:8px;">Upgrade-Kurve</h3>
  <div class="knob-grid">
    <label>Base Cost (Upgrade)
      <input type="number" id="knob-upgradeBaseCost" step="1" min="1" />
    </label>
    <label>Cost-Scaling pro Level
      <input type="number" id="knob-upgradeCostScaling" step="0.01" min="1" />
    </label>
    <label>Damage-Mult (DPS-Curve)
      <input type="number" id="knob-upgradeDamageMultiplier" step="0.001" min="1" />
    </label>
    <label>Fire-Rate-Mult
      <input type="number" id="knob-upgradeSpeedMultiplier" step="0.001" min="1" />
    </label>
    <label>Range-Mult
      <input type="number" id="knob-upgradeRangeMultiplier" step="0.001" min="1" />
    </label>
    <label>Beam-Width-Mult
      <input type="number" id="knob-upgradeBeamWidthMultiplier" step="0.001" min="1" />
    </label>
    <label>Archer-Range-Mult (Sonderlocke)
      <input type="number" id="knob-archerRangeMultiplier" step="0.001" min="1" />
    </label>
    <label>Research-Center Basiskosten (Platzierung)
      <input type="number" id="knob-rcBaseCost" step="5" min="0" />
    </label>
    <label>Buffer-Faktor für Required-Earning
      <input type="number" id="knob-bufferFactor" step="0.05" min="1" max="3" />
      <span class="help">×1.0 = exakt, ×1.2 = 20% Reserve</span>
    </label>
  </div>

  <details style="margin-top:12px;">
    <summary>Tower-Basiskosten</summary>
    <div class="knob-grid" id="knobsTowerCosts" style="margin-top:8px;"></div>
  </details>
  <details style="margin-top:8px;">
    <summary>Forschungskosten</summary>
    <div class="knob-grid" id="knobsResearchCosts" style="margin-top:8px;"></div>
  </details>
  <div class="controls" style="margin-top:12px;">
    <button id="btnResetKnobs">Alle Stellschrauben auf Config-Default</button>
  </div>
</details>

<div class="section">
  <h2>Plan pro Welle</h2>
  <p class="note">
    Klicke eine Zeile, um die Aufstellung für diese Welle zu bearbeiten. „Cost" =
    Gold, das der Spieler bis hier ausgegeben hat (Aufstellungs-Wert). „Δ" =
    Differenz zum vorigen Welle (= Gold das ZWISCHEN den Wellen ausgegeben
    wird). „Required" = was die <em>vorige</em> Welle einbringen muss
    (Buffer eingerechnet). „Curriculum" = aktuelle goldKill+goldComplete
    der jeweils vorigen Welle. „Diff" = Required minus Curriculum.
  </p>
  <table>
    <thead>
      <tr>
        <th>W</th>
        <th class="l">Template</th>
        <th class="l">Gates</th>
        <th class="l">Aufstellung (zum Wellenstart)</th>
        <th>Cost</th>
        <th>Δ Vorwelle</th>
        <th>Required<br><span style="font-weight:400;font-size:10px;">(Welle W−1 muss einbringen)</span></th>
        <th>Curriculum<br><span style="font-weight:400;font-size:10px;">(W−1 Gold heute)</span></th>
        <th>Diff</th>
      </tr>
    </thead>
    <tbody id="planRows"></tbody>
  </table>
</div>

<div class="section">
  <h2>Gold-Kurve — Required vs. Curriculum</h2>
  <p class="note">
    <span style="color:#6FB7A5;">●</span> Required-Earning pro Welle (aus deinem Plan)
    &nbsp;&nbsp;
    <span style="color:#c9a44c;">●</span> Aktuelle Curriculum-Werte
    &nbsp;&nbsp;
    <span style="color:#C04B3F;">●</span> Diff (Required − Current)
  </p>
  <canvas id="goldChart" height="110"></canvas>
</div>

<dialog id="rosterEditor">
  <div class="dialog-body">
    <h2>Aufstellung — Welle <span id="editorTitle"></span></h2>
    <p class="note" id="editorMeta"></p>

    <div class="controls">
      <button id="btnCopyPrev">Aus vorheriger Welle übernehmen</button>
      <button id="btnEditorClear">Diese Welle leeren</button>
    </div>

    <div class="roster-section">
      <h3>Tower <span class="section-cost" id="towerSectionCost"></span></h3>
      <div id="editorTowers"></div>
    </div>

    <div class="roster-section">
      <h3>Forschungen <span class="section-cost" id="researchSectionCost"></span></h3>
      <p class="note">Voraussetzungen werden visuell markiert. Du kannst sie ignorieren — der Planner zwingt dich nicht.</p>
      <div class="research-grid" id="editorResearches"></div>
    </div>

    <div class="roster-section">
      <h3>Research Center <span class="section-cost" id="rcSectionCost"></span></h3>
      <label>Stufe:
        <select id="editorRcLevel">
          <option value="0">0 — nicht gebaut</option>
          <option value="1">1 — gebaut (Basiskosten)</option>
          <option value="2">2 — ausgebaut</option>
          <option value="3">3 — voll ausgebaut</option>
        </select>
      </label>
    </div>
  </div>
  <div class="dialog-actions">
    <span style="margin-right:auto; color:#c9a44c; font-weight:600;" id="editorTotalCost"></span>
    <button id="btnEditorCancel">Abbrechen</button>
    <button class="primary" id="btnEditorApply">Übernehmen</button>
  </div>
</dialog>

<script>
'use strict';

// ===== Embedded payload (single source of truth from configs) =====
const PAYLOAD = ${payloadJson};
const TOWER_INDEX = Object.fromEntries(PAYLOAD.towers.map(function (t) { return [t.id, t]; }));
const RESEARCH_INDEX = Object.fromEntries(PAYLOAD.researches.map(function (r) { return [r.id, r]; }));
const NUM_WAVES = 30;
const ENDGAME_INDEX = NUM_WAVES; // plan slot for the W31 endgame target

// Per-stat upgrade multiplier knob keys.
const STAT_KNOB_KEY = {
  damage: 'upgradeDamageMultiplier',
  fireRate: 'upgradeSpeedMultiplier',
  range: 'upgradeRangeMultiplier',
  beamWidth: 'upgradeBeamWidthMultiplier',
};
// Knob keys exposed as global overrides for upgrade economy.
const ECONOMY_KNOBS = [
  'upgradeBaseCost',
  'upgradeCostScaling',
  'upgradeDamageMultiplier',
  'upgradeSpeedMultiplier',
  'upgradeRangeMultiplier',
  'upgradeBeamWidthMultiplier',
  'archerRangeMultiplier',
  'rcBaseCost',
];

// ===== State =====
const STORAGE_KEY = '3dtd-wave-planner-v1';

function emptyRoster() {
  return { towers: {}, researches: [], rcLevel: 0 };
}

function emptyState() {
  const plan = [];
  for (let i = 0; i <= NUM_WAVES; i++) plan.push(emptyRoster()); // index 0 = pre-game, 1..30 = waves, 30 = endgame after W30
  return {
    overrides: { bufferFactor: 1.0 }, // empty == use PAYLOAD.defaults
    plan: plan,
  };
}

let state = loadState() || emptyState();
ensureStateShape(state);

function ensureStateShape(s) {
  if (!s.overrides) s.overrides = {};
  if (typeof s.overrides.bufferFactor !== 'number') s.overrides.bufferFactor = 1.0;
  if (!Array.isArray(s.plan)) s.plan = emptyState().plan;
  while (s.plan.length <= NUM_WAVES) s.plan.push(emptyRoster());
  for (const r of s.plan) {
    if (!r.towers || typeof r.towers !== 'object') r.towers = {};
    if (!Array.isArray(r.researches)) r.researches = [];
    if (typeof r.rcLevel !== 'number') r.rcLevel = 0;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load plan', e);
    return null;
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus('Gespeichert in localStorage.', '#6FB7A5');
  } catch (e) {
    setStatus('Speichern fehlgeschlagen.', '#C04B3F');
  }
}

function setStatus(text, color) {
  const el = document.getElementById('statusBadge');
  el.textContent = text;
  el.style.color = color || '#8a8a78';
  if (text) setTimeout(function () { if (el.textContent === text) el.textContent = ''; }, 2500);
}

// ===== Knob helpers =====
function knob(key) {
  const v = state.overrides[key];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return PAYLOAD.defaults[key];
}
function towerBaseCost(towerId) {
  const ov = state.overrides.towerCosts;
  if (ov && typeof ov[towerId] === 'number') return ov[towerId];
  return TOWER_INDEX[towerId].cost;
}
function researchCost(researchId) {
  const ov = state.overrides.researchCosts;
  if (ov && typeof ov[researchId] === 'number') return ov[researchId];
  return RESEARCH_INDEX[researchId].cost;
}

// ===== Cost computation =====
function getUpgradeStepCost(level) {
  // Cost to buy the level-th upgrade (0-based, so buying L1 from L0 uses level=0).
  return Math.round(knob('upgradeBaseCost') * Math.pow(knob('upgradeCostScaling'), level));
}
function cumulUpgradeCost(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += getUpgradeStepCost(i);
  return total;
}
function rcCumulCost(rcLevel) {
  if (rcLevel <= 0) return 0;
  let total = knob('rcBaseCost'); // level 1 = placement cost (overridable)
  for (let lv = 2; lv <= rcLevel; lv++) {
    const entry = PAYLOAD.rc.levels.find(function (l) { return l.level === lv; });
    if (entry) total += entry.upgradeCost;
  }
  return total;
}

function towerCost(towerId, levels) {
  // Base + cumulative upgrade cost across every track this tower has.
  const cfg = TOWER_INDEX[towerId];
  let total = towerBaseCost(towerId);
  for (const u of cfg.upgrades) {
    const lv = (levels && typeof levels[u.id] === 'number') ? levels[u.id] : 0;
    if (lv > 0) total += cumulUpgradeCost(lv);
  }
  return total;
}

function rosterCost(roster) {
  let total = 0;
  for (const towerId in roster.towers) {
    const entry = roster.towers[towerId];
    if (!entry || !entry.count) continue;
    total += entry.count * towerCost(towerId, entry.levels || {});
  }
  for (const rId of roster.researches) {
    if (RESEARCH_INDEX[rId]) total += researchCost(rId);
  }
  total += rcCumulCost(roster.rcLevel || 0);
  return total;
}

function prereqsSatisfied(roster, researchId) {
  const r = RESEARCH_INDEX[researchId];
  if (!r) return true;
  for (const p of r.prerequisites) {
    if (roster.researches.indexOf(p) === -1) return false;
  }
  return true;
}

// ===== Derived metrics =====
function metrics() {
  // For each wave w in 1..30 we need:
  //   cost[w]      = rosterCost(plan[w])     -- cumulative spent at start of wave w
  //   delta[w]     = cost[w] - cost[w-1]     -- spending between wave w-1 end and wave w start
  //   required[w-1]= delta[w] * bufferFactor -- what the PREVIOUS wave (w-1) must produce in gold
  // For w == 1: delta is funded by startCredits, so "required" doesn't make sense.
  // For w == 30+1 (endgame): plan[NUM_WAVES] is the "after W30" target.
  const costs = new Array(NUM_WAVES + 1);
  for (let i = 0; i <= NUM_WAVES; i++) costs[i] = rosterCost(state.plan[i]);
  const buffer = state.overrides.bufferFactor || 1.0;

  const rows = [];
  for (let w = 1; w <= NUM_WAVES; w++) {
    // The roster of wave w is plan[w-1] (deployed AT START of wave w). Delta from prev = cost[w-1] - cost[w-2]
    // We display required-earning of THIS wave w as "what wave w must produce to fund the buildup to wave w+1".
    // Convention used in the table: each row w shows the roster AT START of wave w + the required income wave (w-1)
    // had to earn to make that roster possible. That keeps the math intuitive: read "row w" = "going into wave w".
    const cost = costs[w - 1]; // roster going into wave w
    const prevCost = (w === 1) ? PAYLOAD.startCredits : costs[w - 2];
    const delta = cost - prevCost;
    const required = Math.max(0, Math.round(delta * buffer));
    // Curriculum income for wave (w-1) -- the wave that had to earn this.
    const curr = (w === 1) ? null : PAYLOAD.curriculum[w - 2];
    const curriculumIncome = curr ? curr.goldKill + curr.goldComplete : null;
    const diff = curriculumIncome === null ? null : required - curriculumIncome;
    rows.push({
      wave: w,
      cost: cost,
      deltaFromPrev: delta,
      requiredFromPrevWave: required,
      curriculumIncome: curriculumIncome,
      diff: diff,
    });
  }
  // Also compute the "extra" required after W30 (endgame target plan[NUM_WAVES]).
  const endCost = costs[NUM_WAVES];
  const endDelta = endCost - costs[NUM_WAVES - 1];
  const endRequired = Math.max(0, Math.round(endDelta * buffer));
  const lastCurriculum = PAYLOAD.curriculum[NUM_WAVES - 1];
  const endgame = {
    cost: endCost,
    deltaFromW30: endDelta,
    requiredFromW30: endRequired,
    w30CurriculumIncome: lastCurriculum.goldKill + lastCurriculum.goldComplete,
    diff: endRequired - (lastCurriculum.goldKill + lastCurriculum.goldComplete),
  };
  return { rows: rows, endgame: endgame };
}

// ===== Rendering — knobs =====
function renderKnobs() {
  for (const k of ECONOMY_KNOBS) {
    const el = document.getElementById('knob-' + k);
    if (!el) continue;
    el.value = knob(k);
  }
  const bf = document.getElementById('knob-bufferFactor');
  if (bf) bf.value = state.overrides.bufferFactor || 1.0;

  // Tower base-cost knobs.
  const tcGrid = document.getElementById('knobsTowerCosts');
  if (tcGrid && tcGrid.childElementCount === 0) {
    for (const t of PAYLOAD.towers) {
      const lab = document.createElement('label');
      lab.innerHTML =
        '<span style="color:' + t.color + '">' + t.name + '</span>' +
        '<input type="number" min="0" step="5" data-tower-cost="' + t.id + '" />';
      tcGrid.appendChild(lab);
    }
  }
  if (tcGrid) {
    tcGrid.querySelectorAll('input[data-tower-cost]').forEach(function (inp) {
      inp.value = towerBaseCost(inp.dataset.towerCost);
    });
  }

  // Research-cost knobs.
  const rcGrid = document.getElementById('knobsResearchCosts');
  if (rcGrid && rcGrid.childElementCount === 0) {
    for (const r of PAYLOAD.researches) {
      const lab = document.createElement('label');
      lab.innerHTML =
        '<span>' + r.name + '</span>' +
        '<input type="number" min="0" step="5" data-research-cost="' + r.id + '" />';
      rcGrid.appendChild(lab);
    }
  }
  if (rcGrid) {
    rcGrid.querySelectorAll('input[data-research-cost]').forEach(function (inp) {
      inp.value = researchCost(inp.dataset.researchCost);
    });
  }
}

function wireKnobEvents() {
  for (const k of ECONOMY_KNOBS) {
    const el = document.getElementById('knob-' + k);
    if (!el) continue;
    el.addEventListener('input', function () {
      const v = parseFloat(el.value);
      if (Number.isNaN(v)) { delete state.overrides[k]; }
      else { state.overrides[k] = v; }
      rerender();
    });
  }
  const bf = document.getElementById('knob-bufferFactor');
  if (bf) bf.addEventListener('input', function () {
    const v = parseFloat(bf.value);
    state.overrides.bufferFactor = Number.isNaN(v) ? 1.0 : v;
    rerender();
  });

  document.body.addEventListener('input', function (e) {
    const el = e.target;
    if (el.dataset && el.dataset.towerCost) {
      const v = parseFloat(el.value);
      if (!state.overrides.towerCosts) state.overrides.towerCosts = {};
      if (Number.isNaN(v)) delete state.overrides.towerCosts[el.dataset.towerCost];
      else state.overrides.towerCosts[el.dataset.towerCost] = v;
      rerender();
    } else if (el.dataset && el.dataset.researchCost) {
      const v = parseFloat(el.value);
      if (!state.overrides.researchCosts) state.overrides.researchCosts = {};
      if (Number.isNaN(v)) delete state.overrides.researchCosts[el.dataset.researchCost];
      else state.overrides.researchCosts[el.dataset.researchCost] = v;
      rerender();
    }
  });

  document.getElementById('btnResetKnobs').addEventListener('click', function () {
    state.overrides = { bufferFactor: state.overrides.bufferFactor || 1.0 };
    rerender();
    setStatus('Stellschrauben auf Config-Default zurückgesetzt.', '#6FB7A5');
  });
}

// ===== Rendering — table =====
function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n).toLocaleString('en-US');
}

function summariseRoster(roster) {
  if (!roster) return '<span class="empty">leer</span>';
  const parts = [];
  for (const towerId in roster.towers) {
    const e = roster.towers[towerId];
    if (!e || !e.count) continue;
    const cfg = TOWER_INDEX[towerId];
    const levels = e.levels || {};
    const lvParts = cfg.upgrades.map(function (u) {
      const lv = levels[u.id] || 0;
      return lv > 0 ? (u.id.charAt(0).toUpperCase() + lv) : '';
    }).filter(Boolean);
    const lvText = lvParts.length ? ' [' + lvParts.join(' ') + ']' : '';
    parts.push('<span class="tower-chip" style="color:' + cfg.color + '">' +
      cfg.name.replace(/ Tower$/,'') + ' ×' + e.count + lvText + '</span>');
  }
  if (roster.researches && roster.researches.length) {
    parts.push('<span class="tower-chip" style="color:#9B7BD9">+' + roster.researches.length + ' Research</span>');
  }
  if (roster.rcLevel > 0) {
    parts.push('<span class="tower-chip" style="color:#6FB7A5">RC L' + roster.rcLevel + '</span>');
  }
  if (parts.length === 0) return '<span class="empty">leer</span>';
  return '<div class="roster-summary">' + parts.join(' ') + '</div>';
}

function gateBadges(gates) {
  if (!gates || !gates.length) return '<span class="empty">—</span>';
  return gates.map(function (g) {
    return '<span class="gate-tag gate-' + g + '">' + g + '</span>';
  }).join('');
}

function diffClass(diff) {
  if (diff === null) return 'diff-zero';
  if (diff > 0) return 'diff-pos';
  if (diff < 0) return 'diff-neg';
  return 'diff-zero';
}
function diffText(diff) {
  if (diff === null) return '—';
  if (diff === 0) return '0';
  return (diff > 0 ? '+' : '') + fmt(diff);
}

function inheritButton(planIdx) {
  if (planIdx <= 0) return ''; // W1 has no previous wave
  return '<button class="row-action" onclick="event.stopPropagation(); inheritFromPrev(' + planIdx + ')" title="Aufstellung aus W' + planIdx + ' übernehmen">↩</button>';
}

function inheritFromPrev(planIdx) {
  if (planIdx <= 0 || planIdx > NUM_WAVES) return;
  const prev = state.plan[planIdx - 1];
  const cur = state.plan[planIdx];
  const isEmpty = !cur || (Object.keys(cur.towers || {}).length === 0 && (cur.researches || []).length === 0 && (cur.rcLevel || 0) === 0);
  const labelCur = planIdx === NUM_WAVES ? 'Endgame' : ('W' + (planIdx + 1));
  if (!isEmpty) {
    if (!confirm(labelCur + ' überschreiben mit Aufstellung aus W' + planIdx + '?')) return;
  }
  state.plan[planIdx] = JSON.parse(JSON.stringify(prev));
  rerender();
  setStatus(labelCur + ' aus W' + planIdx + ' übernommen.', '#6FB7A5');
}

function renderTable() {
  const tbody = document.getElementById('planRows');
  tbody.innerHTML = '';
  const m = metrics();
  for (let i = 0; i < m.rows.length; i++) {
    const r = m.rows[i];
    const cw = PAYLOAD.curriculum[r.wave - 1];
    const tr = document.createElement('tr');
    const rowClasses = (cw.gates || []).slice();
    tr.className = rowClasses.join(' ');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () { openEditor(r.wave - 1); });
    tr.innerHTML =
      '<td><strong>W' + r.wave + '</strong></td>' +
      '<td class="l" style="color:#8a8a78;font-size:11px;">' + cw.template + '</td>' +
      '<td class="l">' + gateBadges(cw.gates) + '</td>' +
      '<td class="l">' + inheritButton(r.wave - 1) + summariseRoster(state.plan[r.wave - 1]) + '</td>' +
      '<td>' + fmt(r.cost) + '</td>' +
      '<td>' + fmt(r.deltaFromPrev) + '</td>' +
      '<td><strong>' + fmt(r.requiredFromPrevWave) + '</strong></td>' +
      '<td>' + fmt(r.curriculumIncome) + '</td>' +
      '<td class="' + diffClass(r.diff) + '">' + diffText(r.diff) + '</td>';
    tbody.appendChild(tr);
  }
  // Endgame row for plan[NUM_WAVES] (after W30).
  const eg = m.endgame;
  const tr = document.createElement('tr');
  tr.style.cursor = 'pointer';
  tr.style.borderTop = '2px solid #6FB7A5';
  tr.addEventListener('click', function () { openEditor(NUM_WAVES); });
  tr.innerHTML =
    '<td><strong>End</strong></td>' +
    '<td class="l" style="color:#8a8a78;font-size:11px;">post-W30 target</td>' +
    '<td class="l"><span class="gate-tag gate-boss">endgame</span></td>' +
    '<td class="l">' + inheritButton(NUM_WAVES) + summariseRoster(state.plan[NUM_WAVES]) + '</td>' +
    '<td>' + fmt(eg.cost) + '</td>' +
    '<td>' + fmt(eg.deltaFromW30) + '</td>' +
    '<td><strong>' + fmt(eg.requiredFromW30) + '</strong></td>' +
    '<td>' + fmt(eg.w30CurriculumIncome) + '</td>' +
    '<td class="' + diffClass(eg.diff) + '">' + diffText(eg.diff) + '</td>';
  tbody.appendChild(tr);
}

// ===== Chart =====
let chartInstance = null;
function renderChart() {
  const m = metrics();
  const labels = m.rows.map(function (r) { return 'W' + r.wave; });
  // shift by 1 — required for wave w is what wave (w-1) must earn; align to (w-1)
  const required = [];
  const current = [];
  const diff = [];
  for (let i = 0; i < m.rows.length; i++) {
    // Show the "required" for wave i+1 paired with wave i (the one that has to earn it).
    if (i === 0) continue;
    required.push(m.rows[i].requiredFromPrevWave);
    current.push(m.rows[i].curriculumIncome);
    diff.push(m.rows[i].diff || 0);
  }
  // Chart labels = wave that MUST earn (so length = m.rows.length - 1).
  const earnLabels = labels.slice(0, -1);

  const ctx = document.getElementById('goldChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: earnLabels,
      datasets: [
        {
          label: 'Required (aus Plan)',
          data: required,
          borderColor: '#6FB7A5',
          backgroundColor: 'rgba(111,183,165,0.10)',
          fill: true,
          tension: 0.15,
          pointRadius: 2,
        },
        {
          label: 'Curriculum (heute)',
          data: current,
          borderColor: '#c9a44c',
          fill: false,
          tension: 0.15,
          pointRadius: 2,
        },
        {
          label: 'Diff (Required − Curriculum)',
          data: diff,
          borderColor: '#C04B3F',
          borderDash: [4, 3],
          fill: false,
          tension: 0,
          pointRadius: 0,
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
        y: { ticks: { color: '#8a8a78', callback: function (v) { return v.toLocaleString('en-US') + 'g'; } }, grid: { color: '#2a322a' }, beginAtZero: true },
      },
    },
  });
}

// ===== Editor dialog =====
let editorIndex = -1; // index into state.plan being edited

function buildEditorTowers() {
  const container = document.getElementById('editorTowers');
  container.innerHTML = '';
  for (const t of PAYLOAD.towers) {
    const row = document.createElement('div');
    row.className = 'editor-tower-row';
    row.dataset.tower = t.id;
    let upgradeCells = '';
    // Always show 4 slots so columns align even when tower has fewer tracks.
    for (let s = 0; s < 4; s++) {
      const u = t.upgrades[s];
      if (u) {
        upgradeCells +=
          '<div class="upgrade-slot">' +
            '<span class="stat-label">' + u.stat + '</span>' +
            '<input type="number" min="0" max="' + u.maxLevel + '" value="0" ' +
              'data-upgrade-id="' + u.id + '" data-tower="' + t.id + '" />' +
          '</div>';
      } else {
        upgradeCells += '<div></div>';
      }
    }
    row.innerHTML =
      '<div class="tower-name" style="color:' + t.color + '">' + t.name.replace(/ Tower$/,'') + (t.canTargetAir ? ' ✈' : '') + '</div>' +
      '<div><input type="number" min="0" value="0" data-tower="' + t.id + '" data-count="1" placeholder="ct" /></div>' +
      upgradeCells +
      '<div class="tower-cost" data-tower-cost-cell="' + t.id + '">0</div>';
    container.appendChild(row);
  }
}

function buildEditorResearches() {
  const container = document.getElementById('editorResearches');
  container.innerHTML = '';
  // Group by category for readability.
  const byCat = {};
  for (const r of PAYLOAD.researches) {
    if (!byCat[r.category]) byCat[r.category] = [];
    byCat[r.category].push(r);
  }
  for (const cat of Object.keys(byCat).sort()) {
    const h = document.createElement('div');
    h.style.gridColumn = '1 / -1';
    h.style.color = '#c9a44c';
    h.style.fontSize = '10px';
    h.style.textTransform = 'uppercase';
    h.style.letterSpacing = '0.5px';
    h.style.padding = '4px 0 2px';
    h.textContent = cat;
    container.appendChild(h);
    for (const r of byCat[cat]) {
      const lab = document.createElement('label');
      lab.dataset.research = r.id;
      lab.innerHTML =
        '<input type="checkbox" data-research="' + r.id + '" />' +
        '<span>' + r.name + '</span>' +
        '<span class="r-effect">' + r.effectSummary + '</span>' +
        '<span class="r-cost" data-research-cost-cell="' + r.id + '">' + researchCost(r.id) + 'g</span>';
      lab.title = r.prerequisites.length ? 'Prereq: ' + r.prerequisites.join(', ') : 'Keine Voraussetzungen';
      container.appendChild(lab);
    }
  }
}

function readEditorRoster() {
  const r = emptyRoster();
  document.querySelectorAll('#editorTowers .editor-tower-row').forEach(function (row) {
    const towerId = row.dataset.tower;
    const countInp = row.querySelector('input[data-count="1"]');
    const count = parseInt(countInp.value, 10) || 0;
    if (count <= 0) return;
    const entry = { count: count, levels: {} };
    row.querySelectorAll('input[data-upgrade-id]').forEach(function (uInp) {
      const lv = parseInt(uInp.value, 10) || 0;
      if (lv > 0) entry.levels[uInp.dataset.upgradeId] = lv;
    });
    r.towers[towerId] = entry;
  });
  document.querySelectorAll('#editorResearches input[data-research]').forEach(function (cb) {
    if (cb.checked) r.researches.push(cb.dataset.research);
  });
  r.rcLevel = parseInt(document.getElementById('editorRcLevel').value, 10) || 0;
  return r;
}

function populateEditor(roster) {
  document.querySelectorAll('#editorTowers .editor-tower-row').forEach(function (row) {
    const towerId = row.dataset.tower;
    const entry = roster.towers[towerId];
    const countInp = row.querySelector('input[data-count="1"]');
    countInp.value = entry ? entry.count : 0;
    row.querySelectorAll('input[data-upgrade-id]').forEach(function (uInp) {
      uInp.value = (entry && entry.levels && entry.levels[uInp.dataset.upgradeId]) || 0;
    });
  });
  document.querySelectorAll('#editorResearches input[data-research]').forEach(function (cb) {
    cb.checked = roster.researches.indexOf(cb.dataset.research) !== -1;
  });
  document.getElementById('editorRcLevel').value = roster.rcLevel || 0;
  refreshEditorCosts();
  refreshResearchPrereqs();
}

function refreshEditorCosts() {
  const draft = readEditorRoster();
  let towerSection = 0;
  // Per-row tower cost.
  document.querySelectorAll('#editorTowers .editor-tower-row').forEach(function (row) {
    const towerId = row.dataset.tower;
    const entry = draft.towers[towerId];
    let cellTotal = 0;
    if (entry && entry.count) cellTotal = entry.count * towerCost(towerId, entry.levels);
    row.querySelector('[data-tower-cost-cell]').textContent = fmt(cellTotal);
    towerSection += cellTotal;
  });
  document.getElementById('towerSectionCost').textContent = fmt(towerSection) + 'g';
  // Research section.
  let researchSection = 0;
  for (const rId of draft.researches) researchSection += researchCost(rId);
  document.getElementById('researchSectionCost').textContent = fmt(researchSection) + 'g';
  // Research-Center section.
  const rcCost = rcCumulCost(draft.rcLevel);
  document.getElementById('rcSectionCost').textContent = fmt(rcCost) + 'g';
  // Refresh per-research cost cells (in case knob changed costs).
  document.querySelectorAll('[data-research-cost-cell]').forEach(function (el) {
    el.textContent = researchCost(el.dataset.researchCostCell) + 'g';
  });
  // Total.
  const total = towerSection + researchSection + rcCost;
  document.getElementById('editorTotalCost').textContent = 'Aufstellungs-Kosten: ' + fmt(total) + 'g';
}

function refreshResearchPrereqs() {
  const draft = readEditorRoster();
  document.querySelectorAll('#editorResearches label[data-research]').forEach(function (lab) {
    const ok = prereqsSatisfied(draft, lab.dataset.research);
    lab.classList.toggle('unsatisfied', !ok);
    const cb = lab.querySelector('input[type="checkbox"]');
    lab.classList.toggle('checked', cb.checked);
  });
}

function openEditor(planIdx) {
  editorIndex = planIdx;
  const isEndgame = planIdx === NUM_WAVES;
  document.getElementById('editorTitle').textContent = isEndgame ? 'Endgame (nach W30)' : ('W' + (planIdx + 1));
  if (isEndgame) {
    document.getElementById('editorMeta').innerHTML = 'Plant das Endspiel-Setup. Die Differenz zum W30-Plan bestimmt, was Welle 30 mindestens an Gold abwerfen muss.';
  } else {
    const cw = PAYLOAD.curriculum[planIdx];
    document.getElementById('editorMeta').innerHTML =
      'Template: <code>' + cw.template + '</code>. Gates: ' + (cw.gates.length ? cw.gates.join(', ') : '—');
  }
  populateEditor(state.plan[planIdx]);
  document.getElementById('rosterEditor').showModal();
}

function applyEditor() {
  state.plan[editorIndex] = readEditorRoster();
  document.getElementById('rosterEditor').close();
  rerender();
  setStatus('Welle übernommen.', '#6FB7A5');
}

function wireEditorEvents() {
  document.getElementById('editorTowers').addEventListener('input', function () {
    refreshEditorCosts();
  });
  document.getElementById('editorResearches').addEventListener('change', function () {
    refreshResearchPrereqs();
    refreshEditorCosts();
  });
  document.getElementById('editorRcLevel').addEventListener('change', refreshEditorCosts);
  document.getElementById('btnEditorApply').addEventListener('click', applyEditor);
  document.getElementById('btnEditorCancel').addEventListener('click', function () {
    document.getElementById('rosterEditor').close();
  });
  document.getElementById('btnCopyPrev').addEventListener('click', function () {
    if (editorIndex <= 0) { setStatus('Keine vorherige Welle.', '#C04B3F'); return; }
    const src = state.plan[editorIndex - 1];
    populateEditor(JSON.parse(JSON.stringify(src)));
  });
  document.getElementById('btnEditorClear').addEventListener('click', function () {
    populateEditor(emptyRoster());
  });
}

// ===== Toolbar =====
function wireToolbar() {
  document.getElementById('btnAddEndgame').addEventListener('click', function () { openEditor(NUM_WAVES); });
  document.getElementById('btnClear').addEventListener('click', function () {
    if (!confirm('Den kompletten Plan leeren (Overrides bleiben)?')) return;
    state.plan = emptyState().plan;
    rerender();
    setStatus('Plan geleert.', '#C04B3F');
  });
  document.getElementById('btnLoadExample').addEventListener('click', function () {
    if (!confirm('Beispiel-Plan laden? Überschreibt deinen aktuellen Plan.')) return;
    state.plan = exampleProgression();
    rerender();
    setStatus('Beispiel-Plan geladen.', '#6FB7A5');
  });
  document.getElementById('btnExport').addEventListener('click', function () {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wave-planner-plan.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Plan exportiert.', '#6FB7A5');
  });
  document.getElementById('fileImport').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const obj = JSON.parse(ev.target.result);
        ensureStateShape(obj);
        state = obj;
        rerender();
        setStatus('Plan importiert.', '#6FB7A5');
      } catch (err) {
        setStatus('Import fehlgeschlagen: ' + err.message, '#C04B3F');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ===== Example progression =====
function exampleProgression() {
  // Designer-curated example reaching the W30 target state:
  // every tower 1× (archer 3×), all upgrade tracks at L20, every research
  // done, RC at Lv 3. Build phase finishes by W12 (all 10 tower types
  // deployed), then a uniform upgrade ramp through W13-W30 aligned with the
  // upgrade-tier research milestones. Air-debut at W7 is covered by archer
  // (canTargetAir) and the ice tower built in W5.
  function lvs(towerId, lv) {
    if (towerId === 'fire') return { damage: lv, range: lv, 'beam-width': lv };
    return { damage: lv, speed: lv, range: lv };
  }
  function allTowersAt(lv) {
    return {
      archer:         { count: 3, levels: lvs('archer', lv) },
      'dual-gatling': { count: 1, levels: lvs('dual-gatling', lv) },
      cannon:         { count: 1, levels: lvs('cannon', lv) },
      magic:          { count: 1, levels: lvs('magic', lv) },
      rocket:         { count: 1, levels: lvs('rocket', lv) },
      ice:            { count: 1, levels: lvs('ice', lv) },
      fire:           { count: 1, levels: lvs('fire', lv) },
      tentacle:       { count: 1, levels: lvs('tentacle', lv) },
      poison:         { count: 1, levels: lvs('poison', lv) },
      lightning:      { count: 1, levels: lvs('lightning', lv) },
    };
  }
  // Roster snapshots for the build phase — each entry is the cumulative roster
  // ENTERING that wave (index 0 = W1, index 11 = W12).
  function t(count) { return { count: count, levels: {} }; }

  const plan = [];

  // ===== W1-W12: build phase — all 10 tower types + every tower-unlock research =====
  // W1: 2 archers (bootstrap)
  plan.push({ towers: { archer: t(2) }, researches: [], rcLevel: 0 });
  // W2: same, place Research Center
  plan.push({ towers: { archer: t(2) }, researches: [], rcLevel: 1 });
  // W3: +1 archer (now 3), +gatling-tech
  plan.push({ towers: { archer: t(3) }, researches: ['gatling-tech'], rcLevel: 1 });
  // W4: +dual-gatling, +ice-magic
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1) },
    researches: ['gatling-tech', 'ice-magic'],
    rcLevel: 1,
  });
  // W5: +ice (= air defense ready), +toxic-compounds
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds'],
    rcLevel: 1,
  });
  // W6: +poison, +tentacle-biology
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology'],
    rcLevel: 1,
  });
  // W7 AIR-DEBUT: +tentacle, +rocketry  (air already covered by archer + ice)
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1), tentacle: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry'],
    rcLevel: 1,
  });
  // W8: +rocket, +siege-engineering
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1), tentacle: t(1), rocket: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry', 'siege-engineering'],
    rcLevel: 1,
  });
  // W9: +cannon, +arcane-studies
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1), tentacle: t(1), rocket: t(1), cannon: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry', 'siege-engineering', 'arcane-studies'],
    rcLevel: 1,
  });
  // W10 BOSS: +magic, +storm-mastery, RC -> Lv 2
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1), tentacle: t(1), rocket: t(1), cannon: t(1), magic: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry', 'siege-engineering', 'arcane-studies', 'storm-mastery'],
    rcLevel: 2,
  });
  // W11: +lightning, +fire-alchemy
  plan.push({
    towers: { archer: t(3), 'dual-gatling': t(1), ice: t(1), poison: t(1), tentacle: t(1), rocket: t(1), cannon: t(1), magic: t(1), lightning: t(1) },
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry', 'siege-engineering', 'arcane-studies', 'storm-mastery', 'fire-alchemy'],
    rcLevel: 2,
  });
  // W12: +fire (now ALL 10 tower types!), +aa-retrofit. Every tower-unlock research is done.
  plan.push({
    towers: allTowersAt(0),
    researches: ['gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry', 'siege-engineering', 'arcane-studies', 'storm-mastery', 'fire-alchemy', 'aa-retrofit'],
    rcLevel: 2,
  });

  // ===== W13-W30: upgrade phase — ramp every track from L0 to L20 =====
  // Tier-research alignment (additions per wave on top of the build-phase research):
  //   W13: +advanced-weaponry    (T2 unlocks L6-10)
  //   W17: +master-engineering   (T3 unlocks L11-15)
  //   W22: +advanced-engineering (T4 unlocks L16-20); RC -> Lv 3
  //   W27: +transcendent-tech    (T5 = completion bonus; we cap at L20)
  const ramp = [1, 2, 3, 5, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20];
  const baseResearches = [
    'gatling-tech', 'ice-magic', 'toxic-compounds', 'tentacle-biology', 'rocketry',
    'siege-engineering', 'arcane-studies', 'storm-mastery', 'fire-alchemy', 'aa-retrofit',
  ];
  for (let i = 0; i < ramp.length; i++) {
    const waveNum = 13 + i;
    const researches = baseResearches.slice();
    if (waveNum >= 13) researches.push('advanced-weaponry');
    if (waveNum >= 17) researches.push('master-engineering');
    if (waveNum >= 22) researches.push('advanced-engineering');
    if (waveNum >= 27) researches.push('transcendent-tech');
    const rcLevel = waveNum >= 22 ? 3 : 2;
    plan.push({ towers: allTowersAt(ramp[i]), researches: researches, rcLevel: rcLevel });
  }

  // ===== Endgame target (plan[30]): steady state after W30 =====
  plan.push({
    towers: allTowersAt(20),
    researches: baseResearches.concat(['advanced-weaponry', 'master-engineering', 'advanced-engineering', 'transcendent-tech']),
    rcLevel: 3,
  });

  return plan;
}

// ===== Main =====
function rerender() {
  renderKnobs();
  renderTable();
  renderChart();
  saveState();
}

function init() {
  renderKnobs();
  buildEditorTowers();
  buildEditorResearches();
  wireKnobEvents();
  wireEditorEvents();
  wireToolbar();
  renderTable();
  renderChart();
}
init();
</script>

</body>
</html>
`;
}

describe('wave planner generator', () => {
  it('writes docs/wave-planner.html', () => {
    const payload = buildPayload();
    const html = renderHtml(payload);

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, html);

    expect(payload.curriculum.length).toBe(30);
    expect(payload.towers.length).toBeGreaterThanOrEqual(10);
    expect(payload.researches.length).toBeGreaterThan(0);
    expect(html).toContain('chart.js@4.4.4');
    expect(html).toContain('Wave Planner');
    expect(html).toContain('PAYLOAD');
  });
});
