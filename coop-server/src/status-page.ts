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
<style>
  :root { --bg: #111418; --panel: #1a1f25; --line: #2c333b; --text: #dde3ea; --dim: #8a95a1; --ok: #4fc3a1; --warn: #e0a84a; --bad: #e0645a; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 13px/1.45 ui-monospace, Consolas, monospace; }
  h1 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
  h2 { font-size: 13px; margin: 20px 0 8px; color: var(--dim); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .figures { display: flex; flex-wrap: wrap; gap: 6px 22px; }
  .figure b { font-size: 16px; }
  .figure span { color: var(--dim); margin-left: 4px; }
  .curves { display: flex; flex-wrap: wrap; gap: 12px; }
  .curve { background: var(--panel); border: 1px solid var(--line); padding: 8px 10px; }
  .curve div { color: var(--dim); }
  svg { display: block; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 400; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .dim { color: var(--dim); }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--line); padding: 2px 8px; font: inherit; cursor: pointer; }
  button:hover { border-color: var(--dim); }
  pre { background: var(--panel); border: 1px solid var(--line); padding: 8px; max-height: 420px; overflow: auto; white-space: pre-wrap; margin: 0; }
  input { background: var(--panel); color: var(--text); border: 1px solid var(--line); padding: 3px 6px; font: inherit; width: 18em; }
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
</style>
</head>
<body>
<h1 id="title">3DTD coop relay</h1>
<div class="figures" id="figures"></div>
<h2>Last hour</h2>
<div class="curves" id="curves"></div>
<h2>Rooms</h2>
<div id="rooms"></div>
<h2>Log</h2>
<pre id="log"></pre>
<div class="bar" id="adminBar" hidden>
  <label for="token" class="dim">Admin token</label>
  <input id="token" type="password" autocomplete="off">
  <span id="adminNote" class="dim"></span>
</div>
<script>
(function () {
  var tokenInput = document.getElementById('token');
  try { tokenInput.value = localStorage.getItem('relay-admin-token') || ''; } catch (e) {}
  tokenInput.addEventListener('change', function () {
    try { localStorage.setItem('relay-admin-token', tokenInput.value); } catch (e) {}
  });
  var actions = false;

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
    var box = el('div', null, 'curve');
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
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#4fc3a1'); line.setAttribute('stroke-width', '1.5');
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
        if (actions) line.appendChild(actionButton('drop', 'Drop ' + p.name + '?', function () { act('/admin/drop-player', { id: p.id }, 'drop ' + p.id); }));
        players.appendChild(line);
      });
      row.appendChild(players);
      var tools = el('td');
      if (actions) tools.appendChild(actionButton('close room', 'Close room ' + room.code + ' for everyone in it?', function () { act('/admin/close-room', { code: room.code }, 'close ' + room.code); }));
      row.appendChild(tools);
      table.appendChild(row);
    });
    box.appendChild(table);
  }

  function renderMetrics(m, status) {
    document.getElementById('title').textContent = '3DTD coop relay ' + status.build + ', protocol ' + status.protocol + ', up ' + span(m.uptimeS);
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
        actions = metrics.actions;
        document.getElementById('adminBar').hidden = !actions;
        renderMetrics(metrics, status);
        renderRooms(status);
        var pre = document.getElementById('log');
        var atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
        pre.textContent = lines.join('\\n');
        if (atEnd) pre.scrollTop = pre.scrollHeight;
      })
      .catch(function () { document.getElementById('title').textContent = '3DTD coop relay: not reachable'; });
  }
  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>
`;
