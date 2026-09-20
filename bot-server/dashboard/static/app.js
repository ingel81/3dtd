/**
 * Bot dashboard: poll the status once a second, draw the table, send commands.
 * Deliberately small — the numbers that matter live in the JSONL log.
 */

const POLL_MS = 1000;

const $ = (id) => document.getElementById(id);

async function poll() {
  try {
    const status = await (await fetch('/api/status')).json();
    render(status);
  } catch {
    $('run-state').textContent = 'server offline';
    $('run-state').className = 'pill offline';
  }
}

function render(s) {
  const state = $('run-state');
  state.textContent = s.runState ?? '—';
  state.className = `pill ${s.runState === 'running' ? 'running' : 'paused'}`;
  $('uptime').textContent = s.uptimeS ? `up ${formatDuration(s.uptimeS)}` : '';

  $('client-count').textContent = s.clientCount ?? 0;
  $('runs-finished').textContent = s.runsFinished ?? 0;
  $('runs-per-hour').textContent = s.runsPerHour ?? 0;
  $('waves-per-hour').textContent = s.wavesPerHour ?? 0;
  $('logfile').textContent = s.logfile ?? '';

  const rows = (s.clients ?? []).map((c) => `
    <tr class="${c.stale ? 'stale' : ''}">
      <td>#${c.id}</td>
      <td>${c.bot ?? '—'}</td>
      <td>${c.wave ?? 0}</td>
      <td>${c.enemiesAlive ?? 0}</td>
      <td>${c.phase ?? '—'}</td>
      <td>${c.runs ?? 0}</td>
      <td>${c.bestWave ?? 0}</td>
    </tr>`).join('');
  document.querySelector('#clients tbody').innerHTML =
    rows || '<tr><td colspan="7" class="muted">no client connected</td></tr>';

  const errors = s.errors ?? [];
  $('error-list').innerHTML = errors.length
    ? errors.slice().reverse().map((e) => `<li>${new Date(e.ts * 1000).toLocaleTimeString()} ${escapeHtml(e.message)}</li>`).join('')
    : '<li class="muted">none</li>';
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function send(cmd, value) {
  await fetch(`/api/control/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  poll();
}

for (const button of document.querySelectorAll('button[data-cmd]')) {
  button.addEventListener('click', () => {
    const from = button.dataset.from;
    send(button.dataset.cmd, from ? Number($(from).value) : undefined);
  });
}

$('rendering').addEventListener('change', (e) => send('set_rendering', e.target.checked));

poll();
setInterval(poll, POLL_MS);
