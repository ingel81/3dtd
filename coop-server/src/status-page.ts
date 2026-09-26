import { ICON_PNG, LOGO_PNG } from './status-page-images.ts';

/**
 * The relay's status page (relay review 2026-09-26): one HTML page without
 * external files that reads /status, /metrics.json and /log.json every five
 * seconds. Figures, curves of the last hour, the rooms with their players,
 * the end of the log. With the relay's admin token entered, a room can be
 * closed and a player dropped. Reachable only where the status page is
 * (--status local keeps it off the tunnel); names are set as text, never as
 * HTML.
 */
export function statusPage(): string {
  return PAGE;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3DTD relay</title>
<link rel="icon" type="image/png" href="${ICON_PNG}">
<style>
  /* Tokens from src/app/styles/td-theme.ts; the fonts fall back to the system's, nothing is loaded */
  :root {
    --bg: #111613; --panel: #222A24; --panel-2: #1A1F1B; --sunk: #0B0F0C;
    --frame: #2F3631; --frame-light: #7A8580; --rune: #6B5320;
    --text: #EEF1EB; --text-2: #B6C0B3; --dim: #8E988C;
    --gold: #C2A055; --gold-light: #D9BC68; --gold-dark: #8E7228;
    --ok: #6BB6A4; --warn: #C96A3A; --bad: #E0645A;
    --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
    --body: 'Inter Tight', system-ui, -apple-system, sans-serif;
    --raised: inset 0 1px 0 rgba(122,133,128,0.2), inset 0 -1px 0 var(--sunk);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 13px/1.45 var(--mono); }
  main { max-width: 1100px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--rune); }
  header img { width: 71px; height: 40px; flex: none; }
  h1 { font: 600 16px/1.2 var(--body); margin: 0; letter-spacing: .04em; }
  #meta { color: var(--dim); font-size: 12px; margin-top: 2px; }
  h2 { font-size: 11px; margin: 22px 0 8px; color: var(--gold); font-weight: 700; text-transform: uppercase; letter-spacing: .14em; }
  .panel { background: var(--panel); border: 1px solid var(--frame); box-shadow: var(--raised); }
  .figures { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-top: 14px; }
  .figure b { font-size: 16px; }
  .figure span { color: var(--dim); margin-left: 4px; }
  .curves { display: flex; flex-wrap: wrap; gap: 10px; }
  .curve { padding: 8px 10px; max-width: 100%; }
  .curve div { color: var(--text-2); }
  .curve svg { background: var(--panel-2); max-width: 100%; }
  svg { display: block; }
  .rooms { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--frame); vertical-align: top; }
  th { color: var(--dim); font-weight: 400; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .dim { color: var(--dim); }
  button { background: var(--panel); color: var(--text-2); border: 1px solid var(--frame); box-shadow: var(--raised); padding: 2px 8px; font: inherit; cursor: pointer; }
  button:hover { border-color: var(--frame-light); color: var(--text); }
  button.gold { background: linear-gradient(var(--gold-light), var(--gold) 55%, var(--gold-dark)); color: #1A140A; border-color: #1A140A; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  button.gold:hover { box-shadow: 0 0 14px rgba(194,160,85,0.28); }
  pre { background: var(--sunk); border: 1px solid var(--frame); padding: 8px; max-height: 420px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  input { background: var(--sunk); color: var(--text); border: 1px solid var(--frame); padding: 3px 6px; font: inherit; width: 18em; min-width: 0; max-width: 100%; }
  input:focus { outline: none; border-color: var(--gold-dark); }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
  .hint { margin-top: 4px; }
</style>
</head>
<body>
<main>
<header>
  <img src="${LOGO_PNG}" alt="3DTD">
  <div>
    <h1>Coop relay</h1>
    <div id="meta"></div>
  </div>
</header>
<div class="figures" id="figures"></div>
<h2>Last hour</h2>
<div class="curves" id="curves"></div>
<h2>Rooms</h2>
<div class="rooms" id="rooms"></div>
<div id="adminBar" hidden>
  <div class="bar">
    <label for="token" class="dim">Admin token</label>
    <input id="token" type="password" autocomplete="off">
    <button id="unlock" class="gold">Unlock</button>
    <span id="adminNote" class="dim"></span>
  </div>
  <div class="dim hint">The relay's RELAY_ADMIN_TOKEN. It unlocks the buttons "drop" (a player) and "close room" in the rooms above; without an open room there is nothing to act on.</div>
</div>
<h2>Log</h2>
<pre id="log"></pre>
</main>
<script>
(function () {
  var tokenInput = document.getElementById('token');
  try { tokenInput.value = localStorage.getItem('relay-admin-token') || ''; } catch (e) {}
  var actions = false;
  // The buttons show only once the relay said yes to the token
  var unlocked = false;
  var lastStatus = null;
  function note(text, cls) {
    var n = document.getElementById('adminNote');
    n.textContent = text;
    n.className = cls;
  }
  function check() {
    try { localStorage.setItem('relay-admin-token', tokenInput.value); } catch (e) {}
    if (!tokenInput.value) {
      unlocked = false;
      note('locked', 'dim');
      if (lastStatus) renderRooms(lastStatus);
      return;
    }
    fetch('/admin/check', { method: 'POST', headers: { 'x-admin-token': tokenInput.value } })
      .then(function (r) {
        unlocked = r.status === 200;
        note(unlocked ? 'unlocked: drop and close room are on' : 'wrong token, locked', unlocked ? 'ok' : 'bad');
        if (lastStatus) renderRooms(lastStatus);
      })
      .catch(function () { note('relay not reachable', 'bad'); });
  }
  tokenInput.addEventListener('change', check);
  tokenInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
  document.getElementById('unlock').addEventListener('click', check);

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function kb(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' kB'; }
  function span(s) { var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + ' h ' + m + ' min' : m + ' min ' + (s % 60) + ' s'; }

  function figure(value, label, cls) {
    var box = el('div', null, 'figure');
    box.appendChild(el('b', value, cls));
    box.appendChild(el('span', label));
    return box;
  }

  function curve(label, values, format) {
    var box = el('div', null, 'curve panel');
    var last = values.length ? values[values.length - 1] : 0;
    box.appendChild(el('div', label + ': ' + format(last)));
    var w = 220, h = 40, max = Math.max.apply(null, values.concat([1]));
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    var line = document.createElementNS(ns, 'polyline');
    var points = values.map(function (v, i) {
      var x = values.length > 1 ? (i / (values.length - 1)) * w : 0;
      return x.toFixed(1) + ',' + (h - 2 - (v / max) * (h - 4)).toFixed(1);
    });
    line.setAttribute('points', points.join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#6BB6A4'); line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    box.appendChild(svg);
    return box;
  }

  function act(path, body, note) {
    fetch(path, { method: 'POST', headers: { 'x-admin-token': tokenInput.value, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { document.getElementById('adminNote').textContent = note + ': ' + r.status + ' ' + t.trim(); }); })
      .then(refresh);
  }
  function actionButton(label, confirmText, run) {
    var b = el('button', label);
    b.addEventListener('click', function () { if (window.confirm(confirmText)) run(); });
    return b;
  }

  function renderRooms(status) {
    var box = document.getElementById('rooms');
    box.textContent = '';
    if (!status.rooms.length) { box.appendChild(el('div', 'No rooms.', 'dim')); return; }
    var table = el('table');
    var head = el('tr');
    ['Room', 'State', 'Age', 'Idle', 'Step', 'Players', ''].forEach(function (t) { head.appendChild(el('th', t)); });
    table.appendChild(head);
    status.rooms.forEach(function (room) {
      var row = el('tr');
      row.appendChild(el('td', room.code + (room.locked ? ' (locked)' : '')));
      row.appendChild(el('td', room.started ? 'game, tick ' + room.tick + ', speed ' + room.speed : 'lobby'));
      row.appendChild(el('td', span(Math.round(room.ageMs / 1000))));
      row.appendChild(el('td', span(Math.round(room.idleMs / 1000))));
      row.appendChild(el('td', room.firstDesync === null ? 'in step' : 'DESYNC at ' + room.firstDesync + ' (' + room.desyncs + ')', room.firstDesync === null ? 'ok' : 'bad'));
      var players = el('td');
      room.players.forEach(function (p) {
        var line = el('div');
        var ping = p.rttMs === null ? '?' : p.rttMs;
        line.appendChild(el('span', p.name + ' (' + p.id + (p.id === room.hostId ? ', host' : '') + '), ' + (p.spawnId || 'no lane') + ', ' + ping + ' ms '));
        if (actions && unlocked) line.appendChild(actionButton('drop', 'Drop ' + p.name + '?', function () { act('/admin/drop-player', { id: p.id }, 'drop ' + p.id); }));
        players.appendChild(line);
      });
      row.appendChild(players);
      var tools = el('td');
      if (actions && unlocked) tools.appendChild(actionButton('close room', 'Close room ' + room.code + ' for everyone in it?', function () { act('/admin/close-room', { code: room.code }, 'close ' + room.code); }));
      row.appendChild(tools);
      table.appendChild(row);
    });
    box.appendChild(table);
  }

  function renderMetrics(m, status) {
    var meta = document.getElementById('meta');
    meta.textContent = 'build ' + status.build + ', protocol ' + status.protocol + ', up ' + span(m.uptimeS);
    meta.className = '';
    var f = document.getElementById('figures');
    f.textContent = '';
    var dropped = Object.keys(m.dropped).filter(function (k) { return m.dropped[k] > 0; }).map(function (k) { return k + ' ' + m.dropped[k]; }).join(', ');
    var refused = Object.keys(m.refused).filter(function (k) { return m.refused[k] > 0; }).map(function (k) { return k + ' ' + m.refused[k]; }).join(', ');
    f.appendChild(figure(m.connections, 'connections'));
    f.appendChild(figure(m.lobbies, 'lobbies'));
    f.appendChild(figure(m.games, 'games'));
    f.appendChild(figure(m.rssMb + ' MB', 'memory'));
    f.appendChild(figure(kb(m.bytesIn), 'in'));
    f.appendChild(figure(kb(m.bytesOut), 'out'));
    f.appendChild(figure(dropped || 'none', 'dropped', dropped ? 'warn' : ''));
    f.appendChild(figure(refused || 'none', 'refused', refused ? 'warn' : ''));
    f.appendChild(figure(m.errors, 'errors', m.errors ? 'bad' : ''));
    var c = document.getElementById('curves');
    c.textContent = '';
    var s = m.samples;
    c.appendChild(curve('connections', s.map(function (x) { return x.connections; }), String));
    c.appendChild(curve('games', s.map(function (x) { return x.games; }), String));
    c.appendChild(curve('out per 30 s', s.map(function (x) { return x.bytesOut; }), kb));
    c.appendChild(curve('dropped per 30 s', s.map(function (x) { return x.dropped; }), String));
    c.appendChild(curve('memory MB', s.map(function (x) { return x.rssMb; }), String));
  }

  function refresh() {
    Promise.all([fetch('/status'), fetch('/metrics.json'), fetch('/log.json')].map(function (p) { return p.then(function (r) { return r.json(); }); }))
      .then(function (all) {
        var status = all[0], metrics = all[1], lines = all[2];
        if (metrics.actions && !actions) check();
        actions = metrics.actions;
        lastStatus = status;
        document.getElementById('adminBar').hidden = !actions;
        renderMetrics(metrics, status);
        renderRooms(status);
        var pre = document.getElementById('log');
        var atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
        pre.textContent = lines.join('\\n');
        if (atEnd) pre.scrollTop = pre.scrollHeight;
      })
      .catch(function () { var meta = document.getElementById('meta'); meta.textContent = 'not reachable'; meta.className = 'bad'; });
  }
  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>
`;
