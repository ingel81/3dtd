/**
 * 3DTD Ultra-Dashboard — Client
 *
 * Structure:
 *   1. Constants & config
 *   2. Global state (rewards, progress, per-client mirror)
 *   3. WebSocket live updates
 *   4. Tab navigation
 *   5. Chart factory (line, bar, sparkline)
 *   6. Global charts (Tab 1 Training + Policy Output, Tab 3 NN Internals)
 *   7. Per-client cards (Tab 2): breakdown, sparklines, state-signals, damage-zones
 *   8. Wave log (Tab 4) with mixed-wave support + filters
 *   9. Help-tooltip portal
 *  10. DOMContentLoaded init
 */

// ═══════════════════════════════════════════════════════════════════
// 1. CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════════
const ENEMY_TYPE_ORDER = [
  'zombie', 'rat', 'penguin',
  'wallsmasher', 'bat', 'hornet', 'spider',
  'zombie-soldier', 'tank', 'bear', 'dragon', 'mech',
  'mammoth', 'herbert',
  'ghost', 'wraith',
];
const ENEMY_ARMOR_MAP = {
  zombie: 'unarmored', rat: 'unarmored', penguin: 'unarmored',
  wallsmasher: 'light', bat: 'light', hornet: 'light', spider: 'light',
  'zombie-soldier': 'heavy', tank: 'heavy', bear: 'heavy', dragon: 'heavy', mech: 'heavy',
  mammoth: 'fortified', herbert: 'fortified',
  ghost: 'ethereal', wraith: 'ethereal',
};
const ENEMY_ARMOR_GROUPS = [
  { label: 'Unarmored', armor: 'unarmored', types: ['zombie', 'rat', 'penguin'] },
  { label: 'Light',     armor: 'light',     types: ['wallsmasher', 'bat', 'hornet', 'spider'] },
  { label: 'Heavy',     armor: 'heavy',     types: ['zombie-soldier', 'tank', 'bear', 'dragon', 'mech'] },
  { label: 'Fortified', armor: 'fortified', types: ['mammoth', 'herbert'] },
  { label: 'Ethereal',  armor: 'ethereal',  types: ['ghost', 'wraith'] },
];
const DAMAGE_TYPES = ['physical', 'pierce', 'siege', 'magic', 'fire', 'ice', 'poison'];
const ARMOR_TYPES = ['unarmored', 'light', 'heavy', 'fortified', 'ethereal'];
const DAMAGE_TYPE_COLORS = {
  physical: '#B0B0B0', pierce: '#FFD700', siege: '#FF6600',
  magic: '#9B59B6', fire: '#FF4400', ice: '#00BFFF', poison: '#44CC22',
};
const ARMOR_TYPE_COLORS = {
  unarmored: '#4CAF50', light: '#2196F3', heavy: '#FF9800',
  fortified: '#F44336', ethereal: '#9C27B0',
};
const BREAKDOWN_KEY_LABELS = {
  damage_zone: 'Damage Zone',
  near_miss: 'Near-Miss',
  overflow: 'Overflow',
  boring: 'Boring',
  survival: 'Survival',
  game_over: 'Game Over',
  variety: 'Variety',
  monotony: 'Monotony',
  armor_monotony: 'Armor Monotony',
  armor_variety: 'Armor Variety',
  mixed: 'Mixed',
  swarm_count: 'Swarm Count',
  episode_length: 'Episode Length',
  type_diversity: 'Type Diversity',
  armor_match: 'Armor Match',
  perfect_penalty: 'Perfect Penalty',
  close_call: 'Close Call',
};
// Breakdown values are expected in ~[-2.5, +1.0] range. We scale visual width
// relative to BREAKDOWN_MAX_VALUE so 2.5 maps to ~full bar.
const BREAKDOWN_MAX_VALUE = 1.5;

const FONT_COLOR = '#8b949e';
const GRID_COLOR = 'rgba(48, 54, 61, 0.4)';

// ═══════════════════════════════════════════════════════════════════
// 2. STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
  rewards: [],
  progress: [],
  nearMiss: [],
  distribution: { boring: 0, low: 0, moderate: 0, sweet: 0, danger: 0, gameover: 0 },
  distHistory: [],

  // Policy-output globals
  enemyTypeCounts: {},
  waveSizeHistogram: { labels: [], counts: [] },
  mixedWaveRate: { raw: [], rolling50: [] },

  // NN-Internals mini-histories (build up live from training_update events)
  nnHistory: {
    policyLoss: [],
    entropy: [],
    gradNorm: [],
    batchReward: [],
  },

  // Per-client mirrors — charts & cards read from here
  byClient: {},      // { [id]: { rewards, progress, nearMiss, damagePct, killTime, enemyHp, dps, totalCount, numGroups, damageZones, dist, lastBreakdown, signals, charts } }
  availableClients: [],

  // UI state
  activeTab: 'training',
  expandedClients: new Set(),  // which client cards are currently expanded
  waveLogClientFilter: 'all',
  waveLogTypeFilter: 'all',

  // Config (sweet zones from /api/config)
  config: {
    progressCenter: 0.55, progressSigma: 0.15,
    sweetLower: 0.40, sweetUpper: 0.70,
    overflowThreshold: 0.85, boringThreshold: 0.20,
  },

  maxPoints: 500,
  startTime: Date.now(),
  modelUpdates: 0,
};

function ensureClientState(id) {
  if (id === undefined || id === null) return null;
  if (!state.byClient[id]) {
    state.byClient[id] = {
      rewards: [], progress: [], nearMiss: [],
      damagePct: [], killTime: [], enemyHp: [], dps: [],
      totalCount: [], numGroups: [],
      damageZones: { zero: 0, sweet: 0, neutral: 0, hard: 0, overwhelm: 0 },
      dist: { boring: 0, low: 0, moderate: 0, sweet: 0, danger: 0, gameover: 0 },
      totalWaves: 0,
      gameOverCount: 0,
      lastBreakdown: null,
      signals: {
        dpsByType: null, armorDist: null,
        research: null, towerCounts: null, towerAvgLevels: null,
        playerCredits: null, playerHealth: null, towerCountTotal: null,
      },
      charts: {},   // key -> Chart instance (sparklines for this client)
      // First 2 clients auto-expand; rest collapsed by default
    };
    if (!state.availableClients.includes(id)) {
      state.availableClients.push(id);
      state.availableClients.sort((a, b) => a - b);
      if (state.expandedClients.size < 2) state.expandedClients.add(id);
      updateWaveLogClientFilter();
    }
  }
  return state.byClient[id];
}

function classifyProgress(p) {
  const { sweetLower, sweetUpper, overflowThreshold, boringThreshold } = state.config;
  if (p < boringThreshold) return 'boring';
  if (p < sweetLower) return 'low';
  if (p <= sweetUpper) return 'sweet';
  if (p <= overflowThreshold) return 'moderate';
  if (p < 1.0) return 'danger';
  return 'gameover';
}

function hashColor(id) {
  // Deterministic per-client accent color (HSL-based)
  const h = (id * 137.508) % 360;
  return {
    base: `hsl(${h}, 55%, 55%)`,
    bright: `hsl(${h}, 70%, 65%)`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. WEBSOCKET
// ═══════════════════════════════════════════════════════════════════
let ws = null;
let reconnectTimer = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/live`);

  ws.onopen = () => {
    const badge = document.getElementById('ws-badge');
    if (badge) badge.className = 'connection-badge connected';
    const status = document.getElementById('ws-status');
    if (status) status.textContent = 'Live';
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleEvent(msg);
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    const badge = document.getElementById('ws-badge');
    if (badge) badge.className = 'connection-badge disconnected';
    const status = document.getElementById('ws-status');
    if (status) status.textContent = 'Disconnected';
    reconnectTimer = setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws && ws.close();
}

function handleEvent(msg) {
  const d = msg.data;
  if (msg.type === 'episode') {
    state.rewards.push(d.reward);
    state.progress.push(d.progress);
    if (d.nearMiss !== undefined) state.nearMiss.push(d.nearMiss);
    const bucket = classifyProgress(d.progress);
    state.distribution[bucket] = (state.distribution[bucket] || 0) + 1;
    trimArray(state.rewards); trimArray(state.progress); trimArray(state.nearMiss);

    const c = ensureClientState(d.clientId);
    if (c) {
      c.rewards.push(d.reward);
      c.progress.push(d.progress);
      if (d.nearMiss !== undefined) c.nearMiss.push(d.nearMiss);
      c.dist[bucket] = (c.dist[bucket] || 0) + 1;
      c.totalWaves++;
      if (d.breakdown) c.lastBreakdown = d.breakdown;
      trimArray(c.rewards); trimArray(c.progress); trimArray(c.nearMiss);

      if (state.activeTab === 'clients') {
        renderClientCard(d.clientId);
      }
    }

    if (state.activeTab === 'training') {
      updateGlobalLineCharts();
      updateProgressDistribution();
    }
  } else if (msg.type === 'wave') {
    addWaveEntry(d);
    // Update per-client wave-specific metrics
    const c = ensureClientState(d.clientId);
    if (c) {
      if (d.killTime !== undefined) c.killTime.push(d.killTime);
      if (d.enemyHp !== undefined) c.enemyHp.push(d.enemyHp);
      if (d.dps !== undefined) c.dps.push(d.dps);
      if (d.count !== undefined) c.totalCount.push(d.count);
      if (d.numGroups !== undefined) c.numGroups.push(d.numGroups);
      ['killTime','enemyHp','dps','totalCount','numGroups'].forEach(k => trimArray(c[k]));
    }
  } else if (msg.type === 'stats') {
    updateHeaderStats(d);
  } else if (msg.type === 'training_update') {
    onTrainingUpdate(d);
  } else if (msg.type === 'ai_params') {
    onAiParams(d);
  }
}

function trimArray(arr) {
  while (arr.length > state.maxPoints) arr.shift();
}

// ═══════════════════════════════════════════════════════════════════
// 4. TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════
function initTabs() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-button').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('is-active', p.dataset.tab === tab);
  });

  // Lazy-render when switching (ensures charts redraw after display:block)
  if (tab === 'training') {
    requestAnimationFrame(() => {
      updateGlobalLineCharts();
      updateProgressDistribution();
      updatePolicyOutputCharts();
    });
  } else if (tab === 'clients') {
    renderAllClientCards();
  } else if (tab === 'nn') {
    requestAnimationFrame(() => updateNNCharts());
  } else if (tab === 'waves') {
    renderWaveLog();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. CHART FACTORY
// ═══════════════════════════════════════════════════════════════════
function baseLineOpts(opts = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { display: false },
      y: {
        grid: { color: GRID_COLOR },
        ticks: { color: FONT_COLOR, font: { size: 10 } },
        ...(opts.yScale || {}),
      },
    },
    plugins: {
      legend: opts.legend !== false ? {
        position: 'top', align: 'end',
        labels: { color: FONT_COLOR, font: { size: 10 }, boxWidth: 10, padding: 6, usePointStyle: true },
      } : { display: false },
    },
    elements: {
      point: { radius: 0, hitRadius: 8 },
      line: { borderWidth: 1.5, tension: 0.15 },
    },
  };
}

function createLineChart(canvasId, datasets, opts) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  return new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets },
    options: baseLineOpts(opts),
  });
}

function createBarChart(canvasId, datasets, opts = {}) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  return new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: opts.labels || [], datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      indexAxis: opts.horizontal ? 'y' : 'x',
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: FONT_COLOR, font: { size: 10 } } },
        y: { grid: { color: GRID_COLOR }, ticks: { color: FONT_COLOR, font: { size: 10 } } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function createSparkline(canvasId, color) {
  const el = document.getElementById(canvasId);
  if (!el) return null;
  return new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{
      data: [],
      borderColor: color,
      backgroundColor: color + '20',
      borderWidth: 1.5,
      fill: true,
      pointRadius: 0,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: { x: { display: false }, y: { display: false } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      elements: { point: { radius: 0 }, line: { tension: 0.15 } },
    },
  });
}

function calcRollingAvg(data, window) {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 6. GLOBAL CHARTS (Tab 1 + Tab 3)
// ═══════════════════════════════════════════════════════════════════
const charts = {};

function initGlobalCharts() {
  // Reward
  charts.reward = createLineChart('reward-chart', [
    { label: 'Reward', data: [], borderColor: 'rgba(63,185,80,0.35)', backgroundColor: 'rgba(63,185,80,0.08)', fill: true, borderWidth: 1 },
    { label: 'Rolling Avg (50)', data: [], borderColor: 'rgba(188,140,255,0.95)', fill: false, borderWidth: 2.2 },
    { label: 'Zero', data: [], borderColor: 'rgba(248,81,73,0.5)', borderDash: [3, 4], fill: false, borderWidth: 1 },
  ], { yScale: { min: -2.5, max: 1.5 } });

  // Progress
  charts.progress = createLineChart('progress-chart', [
    { label: 'Avg Progress', data: [], borderColor: 'rgba(88,166,255,0.45)', backgroundColor: 'rgba(88,166,255,0.08)', fill: true, borderWidth: 1 },
    { label: 'Sweet Low', data: [], borderColor: 'rgba(63,185,80,0.6)', borderDash: [3, 3], fill: false, borderWidth: 1.2 },
    { label: 'Sweet High', data: [], borderColor: 'rgba(63,185,80,0.6)', borderDash: [3, 3], fill: '-1', backgroundColor: 'rgba(63,185,80,0.12)', borderWidth: 1.2 },
    { label: 'Trend (30)', data: [], borderColor: 'rgba(188,140,255,0.95)', fill: false, borderWidth: 2 },
  ], { yScale: { min: 0, max: 1.0 } });

  // Near-Miss
  charts.nearMiss = createLineChart('near-miss-chart', [
    { label: 'Near-Miss', data: [], borderColor: 'rgba(210,153,34,0.45)', backgroundColor: 'rgba(210,153,34,0.08)', fill: true, borderWidth: 1 },
    { label: 'Target 50%', data: [], borderColor: 'rgba(63,185,80,0.75)', borderDash: [3, 3], fill: false, borderWidth: 1.5 },
    { label: 'Trend (30)', data: [], borderColor: 'rgba(188,140,255,0.95)', fill: false, borderWidth: 2 },
  ], { yScale: { min: 0, max: 1.0 } });

  // Sweet-% over time
  charts.dist = createLineChart('dist-chart', [
    { label: 'Sweet %', data: [], borderColor: 'rgba(63,185,80,0.9)', backgroundColor: 'rgba(63,185,80,0.1)', fill: true, borderWidth: 1.5 },
  ], { yScale: { min: 0, max: 100 }, legend: false });

  // Enemy-Type-Frequency (horizontal bar)
  charts.enemyTypeFreq = createBarChart('enemy-type-frequency-chart', [{
    data: new Array(ENEMY_TYPE_ORDER.length).fill(0),
    backgroundColor: ENEMY_TYPE_ORDER.map(t => ARMOR_TYPE_COLORS[ENEMY_ARMOR_MAP[t]] || '#888'),
    borderWidth: 0,
  }], { horizontal: true, labels: ENEMY_TYPE_ORDER });

  // Wave-Size-Histogramm
  charts.waveSizeHist = createBarChart('wave-size-histogram-chart', [{
    data: [0, 0, 0, 0, 0],
    backgroundColor: ['#484f58', '#58a6ff', '#3fb950', '#d29922', '#f85149'],
    borderWidth: 0,
  }], { labels: ['0-20', '20-50', '50-100', '100-500', '500+'] });

  // Mixed-Wave-Rate
  charts.mixedRate = createLineChart('mixed-wave-rate-chart', [
    { label: 'Mixed (raw)', data: [], borderColor: 'rgba(210,153,34,0.3)', fill: false, borderWidth: 0.8, stepped: true },
    { label: 'Rolling 50', data: [], borderColor: 'rgba(210,153,34,0.95)', fill: false, borderWidth: 2 },
  ], { yScale: { min: 0, max: 1 } });

  // NN Sparklines
  charts.nnPolicyLoss  = createSparkline('nn-policy-loss-chart', '#f85149');
  charts.nnEntropy     = createSparkline('nn-entropy-chart', '#bc8cff');
  charts.nnGradNorm    = createSparkline('nn-grad-norm-chart', '#58a6ff');
  charts.nnBatchReward = createSparkline('nn-batch-reward-chart', '#3fb950');
}

function updateGlobalLineCharts() {
  if (!charts.reward) return;
  const r = state.rewards, p = state.progress, nm = state.nearMiss;
  const len = r.length;

  charts.reward.data.labels = Array(len).fill('');
  charts.reward.data.datasets[0].data = r;
  charts.reward.data.datasets[1].data = calcRollingAvg(r, 50);
  charts.reward.data.datasets[2].data = Array(len).fill(0);
  charts.reward.update('none');

  charts.progress.data.labels = Array(p.length).fill('');
  charts.progress.data.datasets[0].data = p;
  charts.progress.data.datasets[1].data = Array(p.length).fill(state.config.sweetLower);
  charts.progress.data.datasets[2].data = Array(p.length).fill(state.config.sweetUpper);
  charts.progress.data.datasets[3].data = calcRollingAvg(p, 30);
  charts.progress.update('none');

  charts.nearMiss.data.labels = Array(nm.length).fill('');
  charts.nearMiss.data.datasets[0].data = nm;
  charts.nearMiss.data.datasets[1].data = Array(nm.length).fill(0.5);
  charts.nearMiss.data.datasets[2].data = calcRollingAvg(nm, 30);
  charts.nearMiss.update('none');

  // Badges
  const lastReward = r[r.length - 1];
  if (lastReward !== undefined) {
    const b = document.getElementById('reward-badge');
    if (b) { b.textContent = (lastReward >= 0 ? '+' : '') + lastReward.toFixed(2); b.className = 'card-badge ' + (lastReward >= 0 ? 'green' : 'red'); }
  }
  const lastProgress = p[p.length - 1];
  if (lastProgress !== undefined) {
    const b = document.getElementById('progress-badge');
    if (b) b.textContent = (lastProgress * 100).toFixed(0) + '%';
  }
  const lastNm = nm[nm.length - 1];
  if (lastNm !== undefined) {
    const b = document.getElementById('nm-badge');
    if (b) b.textContent = (lastNm * 100).toFixed(0) + '%';
  }
}

function updateProgressDistribution() {
  const bar = document.getElementById('dist-bar');
  if (!bar) return;
  const d = state.distribution;
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  if (total === 0) { bar.innerHTML = ''; return; }
  const pct = k => (d[k] / total) * 100;
  bar.innerHTML = `
    <div style="flex:${pct('boring')};background:rgba(88,166,255,0.5);color:#fff;">${pct('boring').toFixed(0)}%</div>
    <div style="flex:${pct('low')};background:var(--text-muted);color:#fff;">${pct('low').toFixed(0)}%</div>
    <div style="flex:${pct('sweet')};background:var(--accent-green);">${pct('sweet').toFixed(0)}%</div>
    <div style="flex:${pct('moderate')};background:var(--accent-orange);">${pct('moderate').toFixed(0)}%</div>
    <div style="flex:${pct('danger') + pct('gameover')};background:var(--accent-red);">${(pct('danger') + pct('gameover')).toFixed(0)}%</div>
  `;
  // Sweet-%-Line-Chart
  if (charts.dist) {
    const sweetPct = total > 0 ? (d.sweet / total) * 100 : 0;
    state.distHistory.push(sweetPct);
    trimArray(state.distHistory);
    charts.dist.data.labels = Array(state.distHistory.length).fill('');
    charts.dist.data.datasets[0].data = state.distHistory;
    charts.dist.update('none');
  }
}

function updatePolicyOutputCharts() {
  // Enemy-Type-Frequency: data in state.enemyTypeCounts (populated from stats)
  if (charts.enemyTypeFreq) {
    const data = ENEMY_TYPE_ORDER.map(t => state.enemyTypeCounts[t] || 0);
    charts.enemyTypeFreq.data.datasets[0].data = data;
    charts.enemyTypeFreq.update('none');
  }
  // Wave-Size-Histogramm
  if (charts.waveSizeHist && state.waveSizeHistogram.counts) {
    charts.waveSizeHist.data.labels = state.waveSizeHistogram.labels || charts.waveSizeHist.data.labels;
    charts.waveSizeHist.data.datasets[0].data = state.waveSizeHistogram.counts;
    charts.waveSizeHist.update('none');
  }
  // Mixed-Wave-Rate
  if (charts.mixedRate && state.mixedWaveRate) {
    const r = state.mixedWaveRate.raw || [];
    const ra = state.mixedWaveRate.rolling50 || [];
    charts.mixedRate.data.labels = Array(Math.max(r.length, ra.length)).fill('');
    charts.mixedRate.data.datasets[0].data = r;
    charts.mixedRate.data.datasets[1].data = ra;
    charts.mixedRate.update('none');
    const lastRa = ra[ra.length - 1];
    const badge = document.getElementById('mixed-rate-badge');
    if (badge && lastRa !== undefined) badge.textContent = (lastRa * 100).toFixed(0) + '%';
  }
}

function onTrainingUpdate(data) {
  state.modelUpdates++;
  const pushTrim = (arr, v) => { if (v !== undefined && v !== null) { arr.push(v); if (arr.length > state.maxPoints) arr.shift(); } };
  pushTrim(state.nnHistory.policyLoss, data.policyLoss);
  pushTrim(state.nnHistory.entropy, data.entropy);
  pushTrim(state.nnHistory.gradNorm, data.gradNorm);
  pushTrim(state.nnHistory.batchReward, data.batchReward);

  // Header KPI chips
  const updatesEl = document.getElementById('model-updates');
  if (updatesEl) updatesEl.textContent = state.modelUpdates;
  const hEntropy = document.getElementById('header-entropy');
  if (hEntropy && data.entropy !== undefined) hEntropy.textContent = data.entropy.toFixed(2);
  const hGrad = document.getElementById('header-grad-norm');
  if (hGrad && data.gradNorm !== undefined) hGrad.textContent = data.gradNorm.toFixed(1);

  if (state.activeTab === 'nn') updateNNCharts();
}

function updateNNCharts() {
  const setup = [
    ['nnPolicyLoss', 'policyLoss', 'nn-policy-loss-badge', v => (v >= 0 ? '+' : '') + v.toFixed(3)],
    ['nnEntropy', 'entropy', 'nn-entropy-badge', v => v.toFixed(2)],
    ['nnGradNorm', 'gradNorm', 'nn-grad-norm-badge', v => v.toFixed(2)],
    ['nnBatchReward', 'batchReward', 'nn-batch-reward-badge', v => (v >= 0 ? '+' : '') + v.toFixed(3)],
  ];
  setup.forEach(([chartKey, histKey, badgeId, fmt]) => {
    const c = charts[chartKey];
    if (!c) return;
    const data = state.nnHistory[histKey];
    c.data.labels = Array(data.length).fill('');
    c.data.datasets[0].data = data;
    c.update('none');
    const last = data[data.length - 1];
    const badge = document.getElementById(badgeId);
    if (badge && last !== undefined) badge.textContent = fmt(last);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 7. PER-CLIENT CARDS (Tab 2)
// ═══════════════════════════════════════════════════════════════════
function onAiParams(d) {
  const c = ensureClientState(d.clientId);
  if (!c) return;
  if (d.damagePct !== undefined && d.damagePct !== null) {
    c.damagePct.push(d.damagePct);
    trimArray(c.damagePct);
  }
  if (d.damageBucket) {
    c.damageZones[d.damageBucket] = (c.damageZones[d.damageBucket] || 0) + 1;
  }
  // State signals (re-filled each wave)
  c.signals = {
    dpsByType: d.dpsByType || c.signals.dpsByType,
    armorDist: d.armorDist || c.signals.armorDist,
    research: d.research || c.signals.research,
    towerCounts: d.towerCounts || c.signals.towerCounts,
    towerAvgLevels: d.towerAvgLevels || c.signals.towerAvgLevels,
    playerCredits: d.playerCredits ?? c.signals.playerCredits,
    playerHealth: d.playerHealth ?? c.signals.playerHealth,
    towerCountTotal: d.towerCountTotal ?? c.signals.towerCountTotal,
  };
  // Type-probs aren't per-client in the display — the global chart reads latest sender's.
  if (d.typeProbs) updateTypeProbs(d.typeProbs, d.cooldownOverride);

  if (state.activeTab === 'clients') renderClientCard(d.clientId);
}

function renderAllClientCards() {
  const holder = document.getElementById('clients-vertical-stack');
  if (!holder) return;
  if (state.availableClients.length === 0) {
    holder.innerHTML = '<div class="clients-empty">Waiting for client data…</div>';
    return;
  }
  // Wipe and rebuild in sorted order
  holder.innerHTML = '';
  state.availableClients.forEach(id => {
    const card = buildClientCard(id);
    holder.appendChild(card);
    renderClientCardContent(id);
  });
  // Update tab counter
  const counter = document.getElementById('tab-clients-counter');
  if (counter) counter.textContent = state.availableClients.length;
}

function buildClientCard(id) {
  const c = state.byClient[id];
  const color = hashColor(id);
  const card = document.createElement('div');
  card.id = `client-card-${id}`;
  card.className = 'client-card';
  card.style.setProperty('--client-accent', color.base);
  card.style.setProperty('--client-accent-bright', color.bright);
  if (!state.expandedClients.has(id)) card.classList.add('is-collapsed');

  card.innerHTML = `
    <div class="client-card__header" data-client-id="${id}">
      <span class="client-card__chevron">▼</span>
      <span class="client-card__id">#${id}</span>
      <div class="client-card__kpis">
        <span class="client-card__kpi"><span class="client-card__kpi-label">Waves</span><span class="client-card__kpi-value" data-role="waves">0</span></span>
        <span class="client-card__kpi"><span class="client-card__kpi-label">avgR50</span><span class="client-card__kpi-value" data-role="avgr50">0.00</span></span>
        <span class="client-card__kpi"><span class="client-card__kpi-label">Progress</span><span class="client-card__kpi-value" data-role="progress">0.00</span></span>
        <span class="client-card__kpi"><span class="client-card__kpi-label">Dmg</span><span class="client-card__kpi-value" data-role="damage">0.0%</span></span>
        <span class="client-card__kpi"><span class="client-card__kpi-label">GO</span><span class="client-card__kpi-value" data-role="go">0</span></span>
      </div>
      <div class="client-card__econ">
        <span class="econ-chip"><span class="econ-chip-icon">💰</span><span data-role="credits">--</span></span>
        <span class="econ-chip"><span class="econ-chip-icon">❤</span><span data-role="health">--</span></span>
        <span class="econ-chip"><span class="econ-chip-icon">🏰</span><span data-role="towers">--</span></span>
      </div>
    </div>
    <div class="client-card__content">
      <div class="client-subcard" data-role="breakdown">
        <div class="client-subcard-title">
          <span>Live Breakdown (last wave)</span>
          <span class="breakdown-net" data-role="net">--</span>
        </div>
        <div class="breakdown-list" data-role="breakdown-list"></div>
      </div>

      <div class="client-subcard">
        <div class="client-subcard-title"><span>Time Series</span></div>
        <div class="sparkline-grid">
          ${['killTime','enemyHp','dps','damagePct','totalCount','numGroups'].map(k => `
            <div class="sparkline-tile" data-spark="${k}">
              <div class="sparkline-tile-header">
                <span class="sparkline-tile-label">${sparkLabel(k)}</span>
                <span class="sparkline-tile-value" data-spark-value="${k}">--</span>
              </div>
              <div class="sparkline-tile-chart">
                <canvas id="spark-${id}-${k}"></canvas>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="client-subcard">
        <div class="client-subcard-title"><span>Damage Zones (${c && c.totalWaves ? c.totalWaves : 0} waves)</span></div>
        <div class="damage-zone-compact">
          <div class="damage-zone-compact-bar" data-role="dz-bar"></div>
          <div class="damage-zone-compact-legend">
            <span class="dz-legend-item"><span class="dz-legend-dot" style="background:var(--text-muted)"></span>Zero 0%</span>
            <span class="dz-legend-item"><span class="dz-legend-dot" style="background:var(--accent-green)"></span>Sweet 1-10%</span>
            <span class="dz-legend-item"><span class="dz-legend-dot" style="background:var(--accent-orange);opacity:0.85"></span>Neutral 10-25%</span>
            <span class="dz-legend-item"><span class="dz-legend-dot" style="background:var(--accent-red);opacity:0.7"></span>Hard 25-50%</span>
            <span class="dz-legend-item"><span class="dz-legend-dot" style="background:var(--accent-red)"></span>Overwhelm &gt;50%</span>
          </div>
        </div>
      </div>

      <div class="client-state-grid">
        <div class="client-subcard">
          <div class="client-subcard-title"><span>DPS by Damage Type</span></div>
          <div class="signal-bars" data-role="dps-by-type"></div>
        </div>
        <div class="client-subcard">
          <div class="client-subcard-title"><span>Armor Distribution (current wave)</span></div>
          <div class="signal-bars" data-role="armor-dist"></div>
        </div>
        <div class="client-subcard">
          <div class="client-subcard-title"><span>Towers</span></div>
          <div class="tower-list" data-role="towers-list"><span style="color:var(--text-muted);font-size:11px">no towers yet</span></div>
        </div>
        <div class="client-subcard">
          <div class="client-subcard-title"><span>Research</span></div>
          <div class="research-info" data-role="research-info"></div>
        </div>
      </div>
    </div>
  `;

  // Attach collapse-toggle
  const header = card.querySelector('.client-card__header');
  header.addEventListener('click', () => {
    card.classList.toggle('is-collapsed');
    if (card.classList.contains('is-collapsed')) {
      state.expandedClients.delete(id);
    } else {
      state.expandedClients.add(id);
      // Re-create sparklines now that canvases are visible (fresh dimensions)
      renderClientSparklines(id);
    }
  });

  return card;
}

function sparkLabel(k) {
  return {
    killTime: 'Kill-Time',
    enemyHp: 'Enemy HP',
    dps: 'DPS',
    damagePct: 'Damage %',
    totalCount: 'Wave Size',
    numGroups: '# Groups',
  }[k] || k;
}

function renderClientCard(id) {
  // Called when a new event arrives for this client. If the card doesn't
  // exist yet, trigger a full re-render of all cards (likely a new client).
  const existing = document.getElementById(`client-card-${id}`);
  if (!existing) {
    renderAllClientCards();
    return;
  }
  renderClientCardContent(id);
}

function renderClientCardContent(id) {
  const c = state.byClient[id];
  if (!c) return;
  const card = document.getElementById(`client-card-${id}`);
  if (!card) return;

  // Header KPIs
  const lastN = c.rewards.slice(-50);
  const avgR50 = lastN.length ? lastN.reduce((a, b) => a + b, 0) / lastN.length : 0;
  const lastProgress = c.progress[c.progress.length - 1] ?? 0;
  const lastDmg = c.damagePct[c.damagePct.length - 1] ?? 0;
  const setKpi = (role, text, cls) => {
    const el = card.querySelector(`[data-role="${role}"]`);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('positive', 'negative');
    if (cls) el.classList.add(cls);
  };
  setKpi('waves', c.totalWaves);
  setKpi('avgr50', (avgR50 >= 0 ? '+' : '') + avgR50.toFixed(2), avgR50 >= 0 ? 'positive' : 'negative');
  setKpi('progress', lastProgress.toFixed(2));
  setKpi('damage', (lastDmg * 100).toFixed(1) + '%');
  setKpi('go', c.gameOverCount);

  // Economy chips
  setKpi('credits', c.signals.playerCredits != null ? Math.round(c.signals.playerCredits) : '--');
  setKpi('health', c.signals.playerHealth != null ? Math.round(c.signals.playerHealth) : '--');
  setKpi('towers', c.signals.towerCountTotal != null ? c.signals.towerCountTotal : '--');

  // Breakdown
  renderBreakdown(card, c.lastBreakdown);

  // Sparklines (create-on-first-render, update after)
  renderClientSparklines(id);

  // Damage-Zones compact
  renderDamageZoneCompact(card, c.damageZones);

  // State-signal bars
  renderSignalBars(card.querySelector('[data-role="dps-by-type"]'), DAMAGE_TYPES, c.signals.dpsByType);
  renderSignalBars(card.querySelector('[data-role="armor-dist"]'), ARMOR_TYPES, c.signals.armorDist);

  // Towers
  renderTowerList(card.querySelector('[data-role="towers-list"]'), c.signals.towerCounts, c.signals.towerAvgLevels);

  // Research
  renderResearchInfo(card.querySelector('[data-role="research-info"]'), c.signals.research);
}

function renderBreakdown(card, breakdown) {
  const list = card.querySelector('[data-role="breakdown-list"]');
  const netEl = card.querySelector('[data-role="net"]');
  if (!list) return;
  if (!breakdown) {
    list.innerHTML = '<span style="color:var(--text-muted);font-size:11px">no breakdown yet</span>';
    if (netEl) { netEl.textContent = '--'; netEl.className = 'breakdown-net'; }
    return;
  }
  // Sort by |value| desc, skip ~zero signals
  const entries = Object.entries(breakdown)
    .filter(([k, v]) => typeof v === 'number' && Math.abs(v) > 0.001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  let net = 0;
  list.innerHTML = entries.map(([k, v]) => {
    net += v;
    const widthPct = Math.min(100, (Math.abs(v) / BREAKDOWN_MAX_VALUE) * 100);
    const pos = v >= 0;
    const fillStyle = pos
      ? `left:50%;width:${widthPct / 2}%`
      : `left:${50 - widthPct / 2}%;width:${widthPct / 2}%`;
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${BREAKDOWN_KEY_LABELS[k] || k}</span>
        <div class="breakdown-bar-track">
          <div class="breakdown-bar-fill ${pos ? 'positive' : 'negative'}" style="${fillStyle}"></div>
        </div>
        <span class="breakdown-value ${pos ? 'positive' : 'negative'}">${(pos ? '+' : '') + v.toFixed(2)}</span>
      </div>
    `;
  }).join('');
  if (netEl) {
    netEl.textContent = 'NET ' + (net >= 0 ? '+' : '') + net.toFixed(2);
    netEl.className = 'breakdown-net ' + (net >= 0 ? 'positive' : 'negative');
  }
}

function renderClientSparklines(id) {
  const c = state.byClient[id];
  if (!c) return;
  const card = document.getElementById(`client-card-${id}`);
  if (!card || card.classList.contains('is-collapsed')) return;

  const defs = [
    { key: 'killTime', color: '#39d353', format: v => v.toFixed(2) },
    { key: 'enemyHp', color: '#bc8cff', format: v => v.toFixed(0) },
    { key: 'dps', color: '#d29922', format: v => v.toFixed(0) },
    { key: 'damagePct', color: '#f85149', format: v => (v * 100).toFixed(1) + '%' },
    { key: 'totalCount', color: '#58a6ff', format: v => v.toFixed(0) },
    { key: 'numGroups', color: '#f778ba', format: v => v.toFixed(0) },
  ];
  defs.forEach(({ key, color, format }) => {
    const canvasId = `spark-${id}-${key}`;
    let chart = c.charts[key];
    if (!chart) {
      chart = createSparkline(canvasId, color);
      if (!chart) return;
      c.charts[key] = chart;
    }
    const data = c[key] || [];
    chart.data.labels = Array(data.length).fill('');
    chart.data.datasets[0].data = data;
    chart.update('none');
    // Update value label
    const last = data[data.length - 1];
    const valEl = card.querySelector(`[data-spark-value="${key}"]`);
    if (valEl) valEl.textContent = last !== undefined ? format(last) : '--';
  });
}

function renderDamageZoneCompact(card, zones) {
  const bar = card.querySelector('[data-role="dz-bar"]');
  if (!bar) return;
  const total = Object.values(zones || {}).reduce((a, b) => a + b, 0);
  if (total === 0) { bar.innerHTML = '<span style="flex:1;color:var(--text-muted);text-align:center;font-size:11px">no data</span>'; return; }
  const pct = k => (zones[k] / total) * 100;
  const seg = (cls, val) => {
    const p = pct(val);
    if (p < 1) return '';
    return `<div class="dz-seg dz-seg--${cls}" style="flex:${p};">${p.toFixed(0)}%</div>`;
  };
  bar.innerHTML = [
    seg('zero', 'zero'),
    seg('sweet', 'sweet'),
    seg('neutral', 'neutral'),
    seg('hard', 'hard'),
    seg('overwhelm', 'overwhelm'),
  ].join('');
}

function renderSignalBars(container, keys, values) {
  if (!container) return;
  if (!values) {
    container.innerHTML = keys.map(k => `
      <div class="signal-row">
        <span class="signal-label">${k}</span>
        <div class="signal-bar-bg"><div class="signal-bar-fill" style="width:0%;background:${getKeyColor(k)}"></div></div>
        <span class="signal-value">--</span>
      </div>
    `).join('');
    return;
  }
  container.innerHTML = keys.map(k => {
    const v = values[k] ?? 0;
    const pct = Math.min(100, v * 100);
    return `
      <div class="signal-row">
        <span class="signal-label">${k}</span>
        <div class="signal-bar-bg"><div class="signal-bar-fill" style="width:${pct}%;background:${getKeyColor(k)}"></div></div>
        <span class="signal-value">${(v * 100).toFixed(1)}%</span>
      </div>
    `;
  }).join('');
}

function getKeyColor(k) {
  return DAMAGE_TYPE_COLORS[k] || ARMOR_TYPE_COLORS[k] || '#888';
}

function renderTowerList(container, counts, avgLevels) {
  if (!container) return;
  const entries = Object.entries(counts || {}).filter(([_, v]) => v > 0);
  if (entries.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:11px">no towers yet</span>';
    return;
  }
  entries.sort((a, b) => b[1] - a[1]);
  container.innerHTML = entries.map(([type, count]) => {
    const lvl = (avgLevels || {})[type] ?? 1;
    const color = lvl >= 2.5 ? 'var(--accent-green)' : lvl >= 1.5 ? 'var(--accent-orange)' : 'var(--text-muted)';
    return `
      <div class="tower-row">
        <span class="tower-row-name">${type}</span>
        <span class="tower-row-meta">×${count} · <span style="color:${color}">T${lvl.toFixed(1)}</span></span>
      </div>
    `;
  }).join('');
}

function renderResearchInfo(container, research) {
  if (!container) return;
  if (!research) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:11px">no data</span>';
    return;
  }
  const ids = (research.completedIds || []);
  container.innerHTML = `
    <div class="research-kv"><span class="research-kv-key">Center</span><span class="research-kv-val">${research.centerLevel}/3</span></div>
    <div class="research-kv"><span class="research-kv-key">Completed</span><span class="research-kv-val">${research.completedCount}/${research.totalCount}</span></div>
    <div class="research-kv"><span class="research-kv-key">Max Tier</span><span class="research-kv-val">T${research.maxUpgradeTier}</span></div>
    <div class="research-kv"><span class="research-kv-key">AA Retrofit</span><span class="research-kv-val">${research.airTargetingUnlocked ? 'yes' : 'no'}</span></div>
    ${ids.length ? `<div class="research-completed-list">${ids.join(', ')}</div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// TYPE PROBABILITIES (Tab 1 bottom, shared NN output)
// ═══════════════════════════════════════════════════════════════════
function ensureTypeProbsDOM() {
  const container = document.getElementById('type-probs-bars');
  if (!container || container.childElementCount > 0) return;
  container.innerHTML = ENEMY_ARMOR_GROUPS.map(g => `
    <div class="type-probs-armor-group">
      <div class="type-probs-armor-label">${g.label}</div>
      ${g.types.map(t => `
        <div class="type-probs-row" data-type="${t}">
          <span class="type-probs-label">${t}</span>
          <div class="type-probs-bar-bg">
            <div class="type-probs-bar-fill" style="width:0%;background:${ARMOR_TYPE_COLORS[g.armor]}"></div>
          </div>
          <span class="type-probs-value">0%</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function updateTypeProbs(probs, cooldownOverride = false) {
  ensureTypeProbsDOM();
  Object.entries(probs || {}).forEach(([type, p]) => {
    const row = document.querySelector(`.type-probs-row[data-type="${type}"]`);
    if (!row) return;
    const pct = (p * 100).toFixed(1);
    const fill = row.querySelector('.type-probs-bar-fill');
    const val = row.querySelector('.type-probs-value');
    if (fill) fill.style.width = pct + '%';
    if (val) val.textContent = pct + '%';
  });
  const ind = document.getElementById('cooldown-indicator');
  if (ind) ind.style.display = cooldownOverride ? 'inline-block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════
// 8. WAVE LOG (Tab 4)
// ═══════════════════════════════════════════════════════════════════
const WAVE_LOG_MAX = 200;
const waveLogBuffer = [];  // newest first, capped to WAVE_LOG_MAX

function addWaveEntry(entry) {
  waveLogBuffer.unshift(entry);
  if (waveLogBuffer.length > WAVE_LOG_MAX) waveLogBuffer.length = WAVE_LOG_MAX;
  // Game-over tracking
  if (entry.progress >= 1.0) {
    const c = ensureClientState(entry.clientId);
    if (c) c.gameOverCount++;
  }
  if (state.activeTab === 'waves') renderWaveLog();
}

function renderWaveLog() {
  const log = document.getElementById('wave-log');
  if (!log) return;
  const filtered = waveLogBuffer.filter(e => {
    if (state.waveLogClientFilter !== 'all' && e.clientId !== state.waveLogClientFilter) return false;
    if (state.waveLogTypeFilter !== 'all') {
      const types = (e.groups && e.groups.length) ? e.groups.map(g => g.type) : [e.type];
      if (!types.includes(state.waveLogTypeFilter)) return false;
    }
    return true;
  });
  const countEl = document.getElementById('wave-log-count');
  if (countEl) countEl.textContent = `${filtered.length} shown`;
  if (filtered.length === 0) {
    log.innerHTML = '<div class="wave-entry wave-entry--placeholder"><span>No waves match filter</span></div>';
    return;
  }
  log.innerHTML = filtered.map(entry => waveEntryHTML(entry)).join('');
}

function waveEntryHTML(entry) {
  const progressPct = (entry.progress * 100).toFixed(0);
  const rewardClass = entry.reward >= 0.2 ? 'reward-positive' : entry.reward <= -0.1 ? 'reward-negative' : 'reward-neutral';
  const { sweetLower: sl, sweetUpper: su, overflowThreshold: ot, boringThreshold: bt } = state.config;
  let barColor = '#d29922';
  if (entry.progress >= sl && entry.progress <= su) barColor = '#3fb950';
  else if (entry.progress > ot) barColor = '#f85149';
  else if (entry.progress < bt) barColor = '#58a6ff';

  const idPrefix = entry.clientId !== undefined && entry.clientId !== null
    ? `<span class="wave-client">#${entry.clientId}</span>`
    : '';

  // Mixed-wave support: show all groups if there are ≥2
  const groups = entry.groups || [];
  const typeLabel = groups.length >= 2
    ? groups.map(g => `${g.type}×${g.count}`).join(' + ')
    : `${entry.type}×${entry.count}`;

  const reward = (entry.reward >= 0 ? '+' : '') + entry.reward.toFixed(3);

  return `
    <div class="wave-entry">
      <span class="type" title="${typeLabel}">${idPrefix}${typeLabel}</span>
      <div class="progress-bar-container">
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${progressPct}%;background:${barColor}"></div>
        </div>
        <span class="progress-text" style="color:${barColor}">${progressPct}%</span>
      </div>
      <span class="reward ${rewardClass}">${reward}</span>
    </div>
  `;
}

function updateWaveLogClientFilter() {
  const sel = document.getElementById('wave-log-client-filter');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="all">All clients</option>' +
    state.availableClients.map(id => `<option value="${id}">#${id}</option>`).join('');
  sel.value = (prev && [...sel.options].some(o => o.value === prev)) ? prev : 'all';
}

function initWaveLogFilters() {
  // Populate type-filter dropdown with all 16 enemies
  const typeSel = document.getElementById('wave-log-type-filter');
  if (typeSel) {
    typeSel.innerHTML = '<option value="all">All types</option>' +
      ENEMY_TYPE_ORDER.map(t => `<option value="${t}">${t}</option>`).join('');
    typeSel.addEventListener('change', () => {
      state.waveLogTypeFilter = typeSel.value;
      renderWaveLog();
    });
  }
  const clientSel = document.getElementById('wave-log-client-filter');
  if (clientSel) {
    clientSel.addEventListener('change', () => {
      const v = clientSel.value;
      state.waveLogClientFilter = v === 'all' ? 'all' : parseInt(v, 10);
      renderWaveLog();
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HEADER STATS
// ═══════════════════════════════════════════════════════════════════
function updateHeaderStats(stats) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.textContent = val; };
  set('episode', stats.episode || 0);
  set('avg-reward', (stats.avgReward || 0).toFixed(3));
  set('best-reward', (stats.bestReward || 0).toFixed(3));
  set('clients', stats.clientCount || 0);
  set('sweet-spot', (stats.sweetSpotPct || 0).toFixed(0) + '%');
  set('game-over-rate', (stats.gameOverRate || 0).toFixed(0) + '%');
  set('model-updates', stats.modelUpdates ?? state.modelUpdates);

  // Model metrics snapshot (from /api/stats — alternative path to training_update)
  if (stats.modelMetrics) {
    const mm = stats.modelMetrics;
    if (mm.entropy != null) set('header-entropy', mm.entropy.toFixed(2));
    if (mm.gradNorm != null) set('header-grad-norm', mm.gradNorm.toFixed(1));
  }

  // Training state → button styling
  if (stats.trainingState) {
    const running = stats.trainingState === 'running';
    document.querySelectorAll('.ctrl-btn').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.ctrl-btn[data-cmd="${running ? 'start' : 'stop'}"]`);
    if (active) active.classList.add('active');
  }

  // Policy-output globals (fresh counts from server)
  if (stats.enemyTypeCounts) state.enemyTypeCounts = stats.enemyTypeCounts;
  if (stats.waveSizeHistogram) state.waveSizeHistogram = stats.waveSizeHistogram;
  if (stats.mixedWaveRate) state.mixedWaveRate = stats.mixedWaveRate;

  // Prune inactive clients (browser reloads leave stale entries)
  if (Array.isArray(stats.activeClientIds)) {
    pruneInactiveClients(stats.activeClientIds);
  }

  if (state.activeTab === 'training') updatePolicyOutputCharts();
}

function pruneInactiveClients(activeIds) {
  const activeSet = new Set(activeIds);
  // Drop per-client state
  Object.keys(state.byClient).map(Number).forEach(id => {
    if (!activeSet.has(id)) {
      // Destroy charts
      const c = state.byClient[id];
      if (c && c.charts) Object.values(c.charts).forEach(ch => { try { ch.destroy(); } catch (_) {} });
      delete state.byClient[id];
      state.expandedClients.delete(id);
      // Remove DOM card
      const card = document.getElementById(`client-card-${id}`);
      if (card) card.remove();
    }
  });
  state.availableClients = state.availableClients.filter(id => activeSet.has(id));
  updateWaveLogClientFilter();

  // Update tab counter
  const counter = document.getElementById('tab-clients-counter');
  if (counter) counter.textContent = state.availableClients.length;

  // Show placeholder if Clients tab empty
  const holder = document.getElementById('clients-vertical-stack');
  if (holder && state.availableClients.length === 0 && !holder.querySelector('.clients-empty')) {
    holder.innerHTML = '<div class="clients-empty">Waiting for client data…</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
// INITIAL LOAD
// ═══════════════════════════════════════════════════════════════════
async function loadInitialData() {
  try {
    const [statsRes, histRes, configRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/history'),
      fetch('/api/config'),
    ]);
    const config = await configRes.json();
    if (config && config.progressCenter != null) state.config = { ...state.config, ...config };

    const stats = await statsRes.json();
    updateHeaderStats(stats);
    if (stats.startTime) state.startTime = stats.startTime;

    const history = await histRes.json();
    state.rewards = (history.rewards || []).slice(-state.maxPoints);
    state.progress = (history.progress || []).slice(-state.maxPoints);
    state.nearMiss = (history.nearMiss || []).slice(-state.maxPoints);
    state.distribution = history.distribution || state.distribution;
    state.distHistory = (history.distHistory || []).slice(-state.maxPoints);
    if (history.enemyTypeCounts) state.enemyTypeCounts = history.enemyTypeCounts;
    if (history.waveSizeHistogram) state.waveSizeHistogram = history.waveSizeHistogram;
    if (history.mixedWaveRate) state.mixedWaveRate = history.mixedWaveRate;
    if (history.availableClients) {
      state.availableClients = history.availableClients.slice();
      history.availableClients.forEach(id => ensureClientState(id));
      updateWaveLogClientFilter();
    }

    updateGlobalLineCharts();
    updateProgressDistribution();
    updatePolicyOutputCharts();

    // Prefetch per-client data so all cards are populated even before live events arrive
    for (const id of state.availableClients) {
      await fetchClientHistory(id);
    }
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
}

async function fetchClientHistory(id) {
  try {
    const res = await fetch(`/api/history?clientId=${id}`);
    const data = await res.json();
    if (data.empty) return;
    const c = ensureClientState(id);
    if (!c) return;
    c.rewards = (data.rewards || []).slice(-state.maxPoints);
    c.progress = (data.progress || []).slice(-state.maxPoints);
    c.nearMiss = (data.nearMiss || []).slice(-state.maxPoints);
    c.damagePct = (data.damagePctHistory || []).slice(-state.maxPoints);
    c.killTime = (data.killTimeHistory || []).slice(-state.maxPoints);
    c.enemyHp = (data.enemyHpHistory || []).slice(-state.maxPoints);
    c.dps = (data.dpsHistory || []).slice(-state.maxPoints);
    c.totalCount = (data.totalCountHistory || []).slice(-state.maxPoints);
    c.numGroups = (data.numGroupsHistory || []).slice(-state.maxPoints);
    c.damageZones = data.damageZones || c.damageZones;
    c.dist = data.distribution || c.dist;
    c.totalWaves = data.totalWaves || 0;
    c.gameOverCount = data.gameOverCount || 0;
    c.lastBreakdown = data.lastBreakdown || c.lastBreakdown;
  } catch (e) {
    console.error('fetchClientHistory failed', id, e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTROL BUTTONS
// ═══════════════════════════════════════════════════════════════════
async function sendControl(cmd) {
  const status = document.getElementById('ctrl-status');
  if (status) status.textContent = `Sending ${cmd}…`;
  try {
    const res = await fetch(`/api/control/${cmd}`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (status) {
      status.textContent = `${cmd}: ${body.clientsNotified}`;
      setTimeout(() => { if (status.textContent.startsWith(cmd)) status.textContent = ''; }, 3000);
    }
  } catch (e) {
    if (status) status.textContent = `${cmd} failed`;
  }
}

function initControls() {
  document.querySelectorAll('.ctrl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'reload' && !confirm('Reload ALL connected clients?')) return;
      sendControl(cmd);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// 9. HELP-TOOLTIP PORTAL (kept from old dashboard)
// ═══════════════════════════════════════════════════════════════════
function initHelpTooltips() {
  // CSS handles tooltip rendering via ::after; on scroll/resize we force
  // an opacity reset because ::after is positioned: fixed and doesn't follow.
  // This keeps the bulk of styling in CSS and the JS minimal.
  // (The old portal-rendering approach is unnecessary with position:fixed).
}

// ═══════════════════════════════════════════════════════════════════
// 10. INIT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initGlobalCharts();
  initTabs();
  initControls();
  initWaveLogFilters();
  initHelpTooltips();
  await loadInitialData();
  connectWS();
  // Refresh per-client DPS profiles every 5s via stats
  setInterval(() => {
    fetch('/api/stats').then(r => r.json()).then(updateHeaderStats).catch(() => {});
  }, 5000);
});
