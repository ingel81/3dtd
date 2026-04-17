/**
 * 3DTD Training Dashboard - Professional Client
 *
 * Features:
 * - Multi-chart real-time visualization (Chart.js)
 * - WebSocket live updates
 * - Model metrics (policy loss, entropy, grad norm)
 * - Progress distribution histogram
 * - Near-miss tracking
 * - Per-client DPS profiles
 * - Wave & Training logs
 */

// === State ===
const state = {
  rewards: [],
  progress: [],
  nearMiss: [],
  maxPoints: 500,
  distribution: { boring: 0, low: 0, moderate: 0, sweet: 0, danger: 0, gameover: 0 },
  distHistory: [],  // sweet spot % over time
  modelUpdates: 0,
  startTime: Date.now(),
  config: {
    progressCenter: 0.55,
    progressSigma: 0.15,
    sweetLower: 0.40,
    sweetUpper: 0.70,
    overflowThreshold: 0.85,
    boringThreshold: 0.20,
  },
  // AI parameter history
  killTimeHistory: [],
  enemyHpHistory: [],
  dpsHistory: [],
};

// === Chart Setup ===
const FONT_COLOR = '#8b949e';
const GRID_COLOR = 'rgba(48, 54, 61, 0.6)';
const SWEET_ZONE_COLOR = 'rgba(63, 185, 80, 0.15)';

function createChartOptions(yMin, yMax, opts = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        display: false,
      },
      y: {
        min: yMin,
        max: yMax,
        grid: { color: GRID_COLOR },
        ticks: { color: FONT_COLOR, font: { size: 10 } },
        ...opts.yScale,
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: FONT_COLOR,
          font: { size: 10 },
          boxWidth: 12,
          padding: 8,
          usePointStyle: true,
        },
      },
      ...(opts.plugins || {}),
    },
    elements: {
      point: { radius: 0, hitRadius: 8 },
      line: { borderWidth: 1.5, tension: 0.2 },
    },
  };
}

let rewardChart, progressChart, nearMissChart, distChart;
let killTimeChart, enemyHpChart, dpsChart;  // AI parameter charts

function calcRollingAvg(data, window) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

function initCharts() {
  // Reward Chart
  rewardChart = new Chart(document.getElementById('reward-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Reward',
          data: [],
          borderColor: 'rgba(63, 185, 80, 0.15)',
          backgroundColor: 'rgba(63, 185, 80, 0.02)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Rolling Avg (50)',
          data: [],
          borderColor: 'rgba(188, 140, 255, 0.9)',
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0,
        },
        {
          label: 'Zero Line',
          data: [],
          borderColor: 'rgba(248, 81, 73, 0.6)',
          borderDash: [2, 4],
          borderWidth: 1.5,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(-0.8, 1.5),
  });

  // Progress Chart with sweet spot zone
  progressChart = new Chart(document.getElementById('progress-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Avg Progress',
          data: [],
          borderColor: 'rgba(88, 166, 255, 0.3)',
          backgroundColor: 'rgba(88, 166, 255, 0.04)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: `Sweet Zone (${(state.config.sweetLower * 100).toFixed(0)}%)`,
          data: [],
          borderColor: 'rgba(63, 185, 80, 0.7)',
          borderDash: [3, 3],
          borderWidth: 1.5,
          fill: false,
          pointRadius: 0,
        },
        {
          label: `Sweet Zone (${(state.config.sweetUpper * 100).toFixed(0)}%)`,
          data: [],
          borderColor: 'rgba(63, 185, 80, 0.7)',
          borderDash: [3, 3],
          borderWidth: 1.5,
          fill: '-1',
          backgroundColor: SWEET_ZONE_COLOR,
          pointRadius: 0,
        },
        {
          label: 'Trend (30)',
          data: [],
          borderColor: 'rgba(188, 140, 255, 0.9)',
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(0, 1.0),
  });

  // Near-Miss Chart
  nearMissChart = new Chart(document.getElementById('near-miss-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Near-Miss Ratio',
          data: [],
          borderColor: 'rgba(210, 153, 34, 0.15)',
          backgroundColor: 'rgba(210, 153, 34, 0.02)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Target (50%)',
          data: [],
          borderColor: 'rgba(63, 185, 80, 0.9)',
          borderDash: [3, 3],
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
        },
        {
          label: 'Trend (30)',
          data: [],
          borderColor: 'rgba(188, 140, 255, 0.9)',
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(0, 1.0),
  });

  // Distribution over time (stacked area)
  distChart = new Chart(document.getElementById('dist-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Sweet %', data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.3)', fill: true, borderWidth: 1 },
      ],
    },
    options: {
      ...createChartOptions(0, 100),
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          grid: { color: GRID_COLOR },
          ticks: { color: FONT_COLOR, font: { size: 9 }, callback: v => v + '%' },
        },
      },
    },
  });

  // === AI Parameter Charts ===

  // Kill Time Chart (1.5s - 4.0s)
  killTimeChart = new Chart(document.getElementById('kill-time-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Kill Time (s)',
          data: [],
          borderColor: 'rgba(57, 211, 83, 0.3)',
          backgroundColor: 'rgba(57, 211, 83, 0.05)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Trend (30)',
          data: [],
          borderColor: 'rgba(188, 140, 255, 0.9)',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
        },
        {
          label: 'Min (1.5s)',
          data: [],
          borderColor: 'rgba(248, 81, 73, 0.5)',
          borderDash: [3, 3],
          borderWidth: 1,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(1.0, 4.5),
  });

  // Enemy HP Chart
  enemyHpChart = new Chart(document.getElementById('enemy-hp-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Enemy HP',
          data: [],
          borderColor: 'rgba(188, 140, 255, 0.3)',
          backgroundColor: 'rgba(188, 140, 255, 0.05)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Trend (30)',
          data: [],
          borderColor: 'rgba(63, 185, 80, 0.9)',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(0, null, {
      yScale: { suggestedMax: 1000 }
    }),
  });

  // Effective DPS Chart
  dpsChart = new Chart(document.getElementById('dps-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Effective DPS',
          data: [],
          borderColor: 'rgba(210, 153, 34, 0.3)',
          backgroundColor: 'rgba(210, 153, 34, 0.05)',
          borderWidth: 1,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Trend (30)',
          data: [],
          borderColor: 'rgba(88, 166, 255, 0.9)',
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: createChartOptions(0, null, {
      yScale: { suggestedMax: 500 }
    }),
  });
}

function updateCharts() {
  const labels = state.rewards.map((_, i) => i);
  const len = state.rewards.length;

  // Reward chart
  rewardChart.data.labels = labels;
  rewardChart.data.datasets[0].data = state.rewards;

  // Rolling average (window 50)
  const rollingAvg = calcRollingAvg(state.rewards, 50);
  rewardChart.data.datasets[1].data = rollingAvg;
  rewardChart.data.datasets[2].data = labels.map(() => 0); // zero line
  rewardChart.update('none');

  // Update reward badge
  if (len > 0) {
    const lastAvg = rollingAvg[rollingAvg.length - 1];
    const badge = document.getElementById('reward-badge');
    badge.textContent = lastAvg.toFixed(3);
    badge.className = 'card-badge ' + (lastAvg > 0.2 ? 'green' : lastAvg < -0.1 ? 'red' : 'orange');
  }

  // Progress chart
  const { sweetLower, sweetUpper } = state.config;
  progressChart.data.labels = labels;
  progressChart.data.datasets[0].data = state.progress;
  progressChart.data.datasets[1].data = labels.map(() => sweetLower);
  progressChart.data.datasets[2].data = labels.map(() => sweetUpper);
  progressChart.data.datasets[3].data = calcRollingAvg(state.progress, 30);
  progressChart.update('none');

  // Progress badge
  if (state.progress.length > 0) {
    const lastP = state.progress[state.progress.length - 1];
    const pBadge = document.getElementById('progress-badge');
    pBadge.textContent = (lastP * 100).toFixed(0) + '%';
    pBadge.className = 'card-badge ' + (lastP >= sweetLower && lastP <= sweetUpper ? 'green' : lastP > state.config.overflowThreshold ? 'red' : 'orange');
  }

  // Near-miss chart
  nearMissChart.data.labels = labels.slice(0, state.nearMiss.length);
  nearMissChart.data.datasets[0].data = state.nearMiss;
  nearMissChart.data.datasets[1].data = state.nearMiss.map(() => 0.5); // target
  nearMissChart.data.datasets[2].data = calcRollingAvg(state.nearMiss, 30);
  nearMissChart.update('none');

  // NM badge
  if (state.nearMiss.length > 0) {
    const lastNM = state.nearMiss[state.nearMiss.length - 1];
    const nmBadge = document.getElementById('nm-badge');
    nmBadge.textContent = (lastNM * 100).toFixed(0) + '%';
    nmBadge.className = 'card-badge ' + (lastNM > 0.5 ? 'green' : lastNM > 0.2 ? 'orange' : 'red');
  }
}

// === Distribution ===
function updateDistribution(addNewPoint = true) {
  const total = Object.values(state.distribution).reduce((a, b) => a + b, 0);
  const bar = document.getElementById('dist-bar');

  if (total === 0) {
    bar.innerHTML = '<div class="dist-segment" style="width:100%; background:var(--bg-primary)"></div>';
    return;
  }

  const segments = ['boring', 'low', 'moderate', 'sweet', 'danger', 'gameover'];
  bar.innerHTML = segments.map(s => {
    const pct = (state.distribution[s] || 0) / total * 100;
    return pct > 0 ? `<div class="dist-segment ${s}" style="width:${pct}%" title="${s}: ${pct.toFixed(1)}%"></div>` : '';
  }).join('');

  // Update sweet spot over time chart - only add new point for actual episodes
  if (addNewPoint) {
    const sweetPct = total > 0 ? (state.distribution.sweet / total * 100) : 0;
    state.distHistory.push(sweetPct);
    if (state.distHistory.length > state.maxPoints) state.distHistory.shift();
  }

  distChart.data.labels = state.distHistory.map((_, i) => i);
  distChart.data.datasets[0].data = state.distHistory;
  distChart.update('none');
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

// === AI Parameter Charts ===
function updateAIParamCharts() {
  // Kill Time Chart
  const ktLabels = state.killTimeHistory.map((_, i) => i);
  killTimeChart.data.labels = ktLabels;
  killTimeChart.data.datasets[0].data = state.killTimeHistory;
  killTimeChart.data.datasets[1].data = calcRollingAvg(state.killTimeHistory, 30);
  killTimeChart.data.datasets[2].data = ktLabels.map(() => 1.5); // min line
  killTimeChart.update('none');

  // Update Kill Time badge
  if (state.killTimeHistory.length > 0) {
    const lastKT = state.killTimeHistory[state.killTimeHistory.length - 1];
    const ktBadge = document.getElementById('kill-time-badge');
    ktBadge.textContent = lastKT.toFixed(2) + 's';
    ktBadge.className = 'card-badge ' + (lastKT >= 2.0 ? 'green' : lastKT >= 1.5 ? 'orange' : 'red');
  }

  // Enemy HP Chart
  const hpLabels = state.enemyHpHistory.map((_, i) => i);
  enemyHpChart.data.labels = hpLabels;
  enemyHpChart.data.datasets[0].data = state.enemyHpHistory;
  enemyHpChart.data.datasets[1].data = calcRollingAvg(state.enemyHpHistory, 30);
  enemyHpChart.update('none');

  // Update HP badge
  if (state.enemyHpHistory.length > 0) {
    const lastHP = state.enemyHpHistory[state.enemyHpHistory.length - 1];
    const hpBadge = document.getElementById('enemy-hp-badge');
    hpBadge.textContent = Math.round(lastHP);
  }

  // DPS Chart
  const dpsLabels = state.dpsHistory.map((_, i) => i);
  dpsChart.data.labels = dpsLabels;
  dpsChart.data.datasets[0].data = state.dpsHistory;
  dpsChart.data.datasets[1].data = calcRollingAvg(state.dpsHistory, 30);
  dpsChart.update('none');

  // Update DPS badge
  if (state.dpsHistory.length > 0) {
    const lastDPS = state.dpsHistory[state.dpsHistory.length - 1];
    const dpsBadge = document.getElementById('dps-badge');
    dpsBadge.textContent = Math.round(lastDPS);
  }
}

// === Type Probabilities ===
// Enemy → armor-group mapping (for color-coding and ordered display).
// Must match ENEMY_TYPES order in training-backend/config.py.
const ENEMY_ARMOR_GROUPS = [
  { label: 'Unarmored', armor: 'unarmored', types: ['zombie', 'rat', 'penguin'] },
  { label: 'Light',     armor: 'light',     types: ['wallsmasher', 'bat', 'hornet', 'spider'] },
  { label: 'Heavy',     armor: 'heavy',     types: ['zombie-soldier', 'tank', 'bear', 'dragon', 'mech'] },
  { label: 'Fortified', armor: 'fortified', types: ['mammoth', 'herbert'] },
  { label: 'Ethereal',  armor: 'ethereal',  types: ['ghost', 'wraith'] },
];

// Build the DOM for all 16 enemies, grouped by armor. Called once on first data.
function ensureTypeProbDOM() {
  const container = document.getElementById('type-probs-bars');
  if (!container || container.childElementCount > 0) return;

  for (const group of ENEMY_ARMOR_GROUPS) {
    const header = document.createElement('div');
    header.className = 'type-prob-group-header';
    header.textContent = group.label;
    container.appendChild(header);
    for (const type of group.types) {
      const item = document.createElement('div');
      item.className = 'type-prob-item';
      item.dataset.type = type;
      item.innerHTML = `
        <span class="type-prob-label">${type}</span>
        <div class="type-prob-bar"><div class="type-prob-fill armor-${group.armor}" style="width: 0%"></div></div>
        <span class="type-prob-value">0%</span>
      `;
      container.appendChild(item);
    }
  }
}

function updateTypeProbs(typeProbs, cooldownOverride = false) {
  if (!typeProbs || Object.keys(typeProbs).length === 0) return;

  ensureTypeProbDOM();

  // Update all 16 enemies — any missing from typeProbs display as 0%
  for (const group of ENEMY_ARMOR_GROUPS) {
    for (const type of group.types) {
      const item = document.querySelector(`.type-prob-item[data-type="${type}"]`);
      if (!item) continue;

      const prob = typeProbs[type] || 0;
      const pct = (prob * 100).toFixed(1);

      const fill = item.querySelector('.type-prob-fill');
      const value = item.querySelector('.type-prob-value');

      if (fill) fill.style.width = pct + '%';
      if (value) value.textContent = pct + '%';
    }
  }

  // Show/hide cooldown indicator
  const indicator = document.getElementById('cooldown-indicator');
  if (indicator) {
    indicator.style.display = cooldownOverride ? 'inline-block' : 'none';
  }
}

// === State Signals (Phase 5.5) ===
// Renders DPS-by-damage-type, armor distribution, and research state.
// If any block is entirely 0 or null, the corresponding signal isn't reaching
// the NN — indicates a frontend/backend sync bug.

const DAMAGE_TYPES = ['physical', 'pierce', 'siege', 'magic', 'fire', 'ice', 'poison'];
const DAMAGE_TYPE_COLORS = {
  physical: '#B0B0B0', pierce: '#FFD700', siege: '#FF6600',
  magic: '#9B59B6', fire: '#FF4400', ice: '#00BFFF', poison: '#44CC22',
};
const ARMOR_TYPES = ['unarmored', 'light', 'heavy', 'fortified', 'ethereal'];
const ARMOR_TYPE_COLORS = {
  unarmored: '#4CAF50', light: '#2196F3', heavy: '#FF9800',
  fortified: '#F44336', ethereal: '#9C27B0',
};

function renderSignalBars(containerId, keys, values, colorMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (container.childElementCount === 0) {
    // First render: build static rows
    for (const k of keys) {
      const label = document.createElement('span');
      label.className = 'state-signal-label';
      label.textContent = k;
      container.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'state-signal-bar';
      const fill = document.createElement('div');
      fill.className = 'state-signal-bar-fill';
      fill.style.background = colorMap[k] || '#888';
      fill.dataset.key = k;
      bar.appendChild(fill);
      container.appendChild(bar);

      const val = document.createElement('span');
      val.className = 'state-signal-value';
      val.dataset.key = k;
      val.textContent = '–';
      container.appendChild(val);
    }
  }
  // Update values
  for (const k of keys) {
    const v = (values && typeof values[k] === 'number') ? values[k] : 0;
    const pct = (v * 100).toFixed(1);
    const fill = container.querySelector(`.state-signal-bar-fill[data-key="${k}"]`);
    const val = container.querySelector(`.state-signal-value[data-key="${k}"]`);
    if (fill) fill.style.width = Math.min(100, v * 100) + '%';
    if (val) val.textContent = pct + '%';
  }
}

function updateStateSignals(dpsByType, armorDist, research) {
  renderSignalBars('dps-by-type-bars', DAMAGE_TYPES, dpsByType || {}, DAMAGE_TYPE_COLORS);
  renderSignalBars('armor-dist-bars', ARMOR_TYPES, armorDist || {}, ARMOR_TYPE_COLORS);

  // Research state
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  if (research) {
    setText('rs-center', `${research.centerLevel}/3`);
    setText('rs-completed', `${research.completedCount}/${research.totalCount}`);
    setText('rs-tier', `T${research.maxUpgradeTier}`);
    setText('rs-aa', research.airTargetingUnlocked ? 'YES' : 'no');
    const ids = (research.completedIds || []).join(', ') || '(none)';
    setText('rs-ids', ids);
  } else {
    setText('rs-center', '–');
    setText('rs-completed', '–');
    setText('rs-tier', '–');
    setText('rs-aa', '–');
    setText('rs-ids', '');
  }
}

// === DPS Profiles ===
function updateAllDPSProfiles(clients) {
  const container = document.getElementById('dps-profiles-container');
  document.getElementById('dps-client-count').textContent = clients.length + ' client' + (clients.length !== 1 ? 's' : '');

  if (!clients || clients.length === 0) {
    container.innerHTML = '<div class="dps-empty">No clients connected</div>';
    return;
  }

  container.innerHTML = clients.map(client => `
    <div class="dps-client">
      <div class="dps-client-header">
        <span class="dps-client-id">#${client.id}</span>
        <div class="dps-client-meta">
          <span>Wave ${client.waveNum || 0}</span>
          <span>${client.bot || 'unknown'}</span>
          <span>Streak: ${client.winStreak || 0}</span>
        </div>
      </div>
      <div class="dps-row">
        <span class="dps-label">Ground</span>
        <div class="dps-bars">${createBarsHTML(client.groundDPS, 'ground')}</div>
      </div>
      <div class="dps-row">
        <span class="dps-label">Air</span>
        <div class="dps-bars">${createBarsHTML(client.airDPS, 'air')}</div>
      </div>
    </div>
  `).join('');
}

function createBarsHTML(dpsValues, type) {
  let html = '';
  for (let i = 0; i < 20; i++) {
    const val = (dpsValues && dpsValues[i]) || 0;
    html += `<div class="dps-bar"><div class="dps-bar-fill ${type}" style="height:${val * 100}%"></div></div>`;
  }
  return html;
}

// === Wave Log ===
function addWaveEntry(entry) {
  const log = document.getElementById('wave-log');

  // Remove placeholder
  if (log.children.length === 1 && log.children[0].textContent.includes('Waiting')) {
    log.innerHTML = '';
  }

  const progressPct = (entry.progress * 100).toFixed(0);
  const rewardClass = entry.reward >= 0.2 ? 'reward-positive' : entry.reward <= -0.1 ? 'reward-negative' : 'reward-neutral';

  // Progress bar color (dynamic from config)
  const { sweetLower: sl, sweetUpper: su, overflowThreshold: ot, boringThreshold: bt } = state.config;
  let barColor = '#d29922'; // moderate
  if (entry.progress >= sl && entry.progress <= su) barColor = '#3fb950';  // sweet = green
  else if (entry.progress > ot) barColor = '#f85149';                       // overflow = red
  else if (entry.progress < bt) barColor = '#58a6ff';                       // boring = blue

  const div = document.createElement('div');
  div.className = 'wave-entry';
  div.innerHTML = `
    <span class="type">${entry.type} x${entry.count}</span>
    <div class="progress-bar-container">
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${progressPct}%; background:${barColor}"></div>
      </div>
      <span class="progress-text" style="color:${barColor}">${progressPct}%</span>
    </div>
    <span class="reward ${rewardClass}">${entry.reward >= 0 ? '+' : ''}${entry.reward.toFixed(3)}</span>
  `;

  log.insertBefore(div, log.firstChild);
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

// === Training Log ===
function addTrainingLog(type, msg) {
  const log = document.getElementById('training-log');
  if (log.children.length === 1 && log.children[0].textContent.includes('Waiting')) {
    log.innerHTML = '';
  }

  const now = new Date();
  const time = now.toTimeString().slice(0, 8);

  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-type ${type}">${type.toUpperCase()}</span>
    <span class="log-msg">${msg}</span>
  `;

  log.insertBefore(div, log.firstChild);
  while (log.children.length > 100) log.removeChild(log.lastChild);
}

// === Header Stats ===
function updateHeader(stats) {
  document.getElementById('episode').textContent = stats.episode || 0;
  document.getElementById('avg-reward').textContent = (stats.avgReward || 0).toFixed(3);
  document.getElementById('best-reward').textContent = (stats.bestReward || 0).toFixed(3);
  document.getElementById('clients').textContent = stats.clientCount || 0;
  document.getElementById('sweet-spot').textContent = (stats.sweetSpotPct || 0).toFixed(0) + '%';
  document.getElementById('game-over-rate').textContent = (stats.gameOverRate || 0).toFixed(0) + '%';
  if (stats.modelUpdates !== undefined) {
    state.modelUpdates = stats.modelUpdates;
    // Update header mini stat
    const headerUpdates = document.getElementById('header-updates');
    if (headerUpdates) headerUpdates.textContent = stats.modelUpdates;
    // Update footer
    const footerUpdates = document.getElementById('model-updates');
    if (footerUpdates) footerUpdates.textContent = stats.modelUpdates;
  }
}

// === Model Metrics ===
function updateModelMetrics(data) {
  // Update header mini stats
  if (data.entropy !== undefined) {
    const headerEntropy = document.getElementById('header-entropy');
    if (headerEntropy) headerEntropy.textContent = data.entropy.toFixed(2);
  }
  if (data.gradNorm !== undefined) {
    const headerGrad = document.getElementById('header-grad-norm');
    if (headerGrad) headerGrad.textContent = data.gradNorm.toFixed(1);
  }

  state.modelUpdates++;
  // Update header mini stat
  const headerUpdates = document.getElementById('header-updates');
  if (headerUpdates) headerUpdates.textContent = state.modelUpdates;
  // Update footer
  const footerUpdates = document.getElementById('model-updates');
  if (footerUpdates) footerUpdates.textContent = state.modelUpdates;

  addTrainingLog('upd', `L:${data.policyLoss?.toFixed(4) || '?'} H:${data.entropy?.toFixed(3) || '?'} G:${data.gradNorm?.toFixed(2) || '?'} R:${data.batchReward?.toFixed(3) || '?'}`);
}

// === Config-driven Legend Update ===
function updateLegendLabels() {
  const { sweetLower, sweetUpper, overflowThreshold, boringThreshold } = state.config;
  const fmt = v => (v * 100).toFixed(0);
  const el = id => document.getElementById(id);

  if (el('legend-boring')) el('legend-boring').textContent = `Boring (<${fmt(boringThreshold)}%)`;
  if (el('legend-low')) el('legend-low').textContent = `Low (${fmt(boringThreshold)}-${fmt(sweetLower)}%)`;
  if (el('legend-sweet')) el('legend-sweet').textContent = `Sweet (${fmt(sweetLower)}-${fmt(sweetUpper)}%)`;
  if (el('legend-moderate')) el('legend-moderate').textContent = `Moderate (${fmt(sweetUpper)}-${fmt(overflowThreshold)}%)`;
  if (el('legend-danger')) el('legend-danger').textContent = `Danger/GO (>${fmt(overflowThreshold)}%)`;
}

// === Runtime Timer ===
function updateRuntime() {
  const elapsed = Date.now() - state.startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  document.getElementById('runtime').textContent = `${hours}h ${minutes}m`;
}

// === WebSocket ===
let ws = null;
let reconnectTimer = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/live`);

  ws.onopen = () => {
    const badge = document.getElementById('ws-badge');
    badge.className = 'connection-badge connected';
    document.getElementById('ws-status').textContent = 'Live';
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
    badge.className = 'connection-badge disconnected';
    document.getElementById('ws-status').textContent = 'Disconnected';
    reconnectTimer = setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();
}

function handleEvent(msg) {
  if (msg.type === 'episode') {
    const d = msg.data;
    state.rewards.push(d.reward);
    state.progress.push(d.progress);
    if (d.nearMiss !== undefined) state.nearMiss.push(d.nearMiss);

    // Update distribution
    const bucket = classifyProgress(d.progress);
    state.distribution[bucket] = (state.distribution[bucket] || 0) + 1;

    // Trim to maxPoints
    if (state.rewards.length > state.maxPoints) state.rewards.shift();
    if (state.progress.length > state.maxPoints) state.progress.shift();
    if (state.nearMiss.length > state.maxPoints) state.nearMiss.shift();

    updateCharts();
    updateDistribution();

  } else if (msg.type === 'wave') {
    addWaveEntry(msg.data);

  } else if (msg.type === 'stats') {
    updateHeader(msg.data);

  } else if (msg.type === 'training_update') {
    updateModelMetrics(msg.data);

  } else if (msg.type === 'ai_params') {
    // Live AI parameter updates
    const d = msg.data;
    if (d.killTime !== undefined) {
      state.killTimeHistory.push(d.killTime);
      if (state.killTimeHistory.length > state.maxPoints) state.killTimeHistory.shift();
    }
    if (d.enemyHp !== undefined) {
      state.enemyHpHistory.push(d.enemyHp);
      if (state.enemyHpHistory.length > state.maxPoints) state.enemyHpHistory.shift();
    }
    if (d.dps !== undefined) {
      state.dpsHistory.push(d.dps);
      if (state.dpsHistory.length > state.maxPoints) state.dpsHistory.shift();
    }
    updateAIParamCharts();
    if (d.typeProbs) {
      updateTypeProbs(d.typeProbs, d.cooldownOverride || false);
    }
    // Phase 5.5: state signals — damage/armor/research
    updateStateSignals(d.dpsByType, d.armorDist, d.research);

  } else if (msg.type === 'log') {
    addTrainingLog(msg.data.level || 'ep', msg.data.message || '');
  }
}

// === Initial Data Load ===
async function loadInitialData() {
  try {
    const [statsRes, histRes, clientsRes, configRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/history'),
      fetch('/api/clients'),
      fetch('/api/config'),
    ]);

    // Apply config first (affects classification and charts)
    const config = await configRes.json();
    if (config && config.progressCenter) {
      state.config = config;
      // Update chart labels and legend with actual config values
      progressChart.data.datasets[1].label = `Sweet Zone (${(config.sweetLower * 100).toFixed(0)}%)`;
      progressChart.data.datasets[2].label = `Sweet Zone (${(config.sweetUpper * 100).toFixed(0)}%)`;
      updateLegendLabels();
    }

    const stats = await statsRes.json();
    updateHeader(stats);
    if (stats.startTime) state.startTime = stats.startTime;

    const history = await histRes.json();
    state.rewards = history.rewards || [];
    state.progress = history.progress || [];
    state.nearMiss = history.nearMiss || [];
    state.distribution = history.distribution || state.distribution;
    state.distHistory = history.distHistory || [];

    // AI parameter history
    state.killTimeHistory = history.killTimeHistory || [];
    state.enemyHpHistory = history.enemyHpHistory || [];
    state.dpsHistory = history.dpsHistory || [];

    // Trim all arrays
    if (state.rewards.length > state.maxPoints) state.rewards = state.rewards.slice(-state.maxPoints);
    if (state.progress.length > state.maxPoints) state.progress = state.progress.slice(-state.maxPoints);
    if (state.nearMiss.length > state.maxPoints) state.nearMiss = state.nearMiss.slice(-state.maxPoints);
    if (state.killTimeHistory.length > state.maxPoints) state.killTimeHistory = state.killTimeHistory.slice(-state.maxPoints);
    if (state.enemyHpHistory.length > state.maxPoints) state.enemyHpHistory = state.enemyHpHistory.slice(-state.maxPoints);
    if (state.dpsHistory.length > state.maxPoints) state.dpsHistory = state.dpsHistory.slice(-state.maxPoints);

    updateCharts();
    updateAIParamCharts();
    updateDistribution(false);  // Don't add new point on initial load

    const clients = await clientsRes.json();
    updateAllDPSProfiles(clients);
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
}

// === Polling ===
function startPolling() {
  // DPS profiles every 5s
  setInterval(async () => {
    try {
      const res = await fetch('/api/clients');
      const clients = await res.json();
      updateAllDPSProfiles(clients);
    } catch (e) {}
  }, 5000);

  // Runtime every 10s
  setInterval(updateRuntime, 10000);
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  loadInitialData();
  connectWS();
  startPolling();
  updateRuntime();
});
