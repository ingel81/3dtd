/**
 * The status page of the own Overpass instance, for the LAN: one HTML page
 * without external files that reads /api/summary every ten seconds. Requests
 * over time by what became of them, answer times, the boxes asked on a map of
 * the world, countries, refusals, the last problems, and the host: the date of
 * the data, Overpass's slots, the disk, the memory, a clone under way; the
 * players per day, the kinds of query, the clients, the places asked for by
 * name (the map names them under the pointer). Every value is set as text,
 * never as HTML.
 */
import { WORLD_BORDERS, WORLD_LAND } from './world-land.ts';

export function statusPage(): string {
  return PAGE;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3DTD Overpass</title>
<style>
  /* Tokens from src/app/styles/td-theme.ts, as on the coop relay's page; nothing is loaded */
  :root {
    --bg: #111613; --panel: #222A24; --panel-2: #1A1F1B; --sunk: #0B0F0C;
    --frame: #2F3631; --rune: #6B5320;
    --text: #EEF1EB; --text-2: #B6C0B3; --dim: #8E988C;
    --gold: #C2A055; --ok: #6BB6A4; --warn: #C96A3A; --bad: #E0645A; --limit: #9C8BD0;
    --mono: ui-monospace, Consolas, monospace;
    --body: system-ui, -apple-system, sans-serif;
    --raised: inset 0 1px 0 rgba(122,133,128,0.2), inset 0 -1px 0 var(--sunk);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 13px/1.45 var(--mono); }
  main { max-width: 1100px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; padding-bottom: 10px; border-bottom: 1px solid var(--rune); }
  h1 { font: 600 16px/1.2 var(--body); margin: 0; letter-spacing: .04em; }
  #meta { color: var(--dim); font-size: 12px; }
  h2 { font-size: 11px; margin: 22px 0 8px; color: var(--gold); font-weight: 700; text-transform: uppercase; letter-spacing: .14em; }
  .panel { background: var(--panel); border: 1px solid var(--frame); box-shadow: var(--raised); padding: 8px 10px; }
  .figures { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-top: 14px; }
  .figure b { font-size: 16px; }
  .figure span { color: var(--dim); margin-left: 4px; }
  .host { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 4px 22px; }
  .host div span { color: var(--dim); }
  svg, canvas { display: block; max-width: 100%; }
  .chart { background: var(--panel-2); width: 100%; height: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--text-2); margin-bottom: 4px; }
  .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; vertical-align: -1px; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--frame); vertical-align: top; white-space: nowrap; }
  td.num, th.num { text-align: right; }
  th { color: var(--dim); font-weight: 400; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .dim { color: var(--dim); }
  .ranges { display: flex; gap: 4px; }
  button { background: var(--panel); color: var(--text-2); border: 1px solid var(--frame); box-shadow: var(--raised); padding: 2px 10px; font: inherit; cursor: pointer; }
  button[aria-pressed="true"] { color: var(--bg); background: var(--gold); border-color: var(--gold); }
  #map { width: 100%; background: var(--panel-2); }
  .map-box { position: relative; }
  #tip { position: absolute; pointer-events: none; background: var(--sunk); border: 1px solid var(--frame); padding: 3px 8px; white-space: nowrap; display: none; }
  .tag { color: var(--bg); background: var(--ok); padding: 0 5px; margin-left: 6px; font-size: 11px; }
</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>3DTD Overpass</h1>
    <div id="meta">loading</div>
  </div>
  <div class="ranges" id="ranges"></div>
</header>
<div class="figures" id="figures"></div>
<h2>Host</h2>
<div class="panel host" id="host"></div>
<h2>Requests</h2>
<div class="panel">
  <div class="legend"><span><i style="background:var(--ok)"></i>answered</span><span><i style="background:var(--limit)"></i>rate limit</span><span><i style="background:var(--warn)"></i>refused</span><span><i style="background:var(--bad)"></i>failed, busy, down</span></div>
  <svg class="chart" id="requests" viewBox="0 0 1000 160" preserveAspectRatio="none"></svg>
</div>
<h2>Answer times (answered)</h2>
<div class="panel">
  <div class="legend"><span><i style="background:var(--ok)"></i>median</span><span><i style="background:var(--gold)"></i>95 %</span><span id="latency-top" class="dim"></span></div>
  <svg class="chart" id="latency" viewBox="0 0 1000 120" preserveAspectRatio="none"></svg>
</div>
<h2>Players per day (UTC, about)</h2>
<div class="panel">
  <div class="legend"><span><i style="background:var(--gold)"></i>players</span><span id="players-note" class="dim"></span></div>
  <svg class="chart" id="players" viewBox="0 0 1000 120" preserveAspectRatio="none"></svg>
  <div class="scroll"><table id="days"></table></div>
</div>
<h2>Kinds of query</h2>
<div class="panel scroll"><table id="kinds"></table></div>
<div class="cols">
  <div><h2>Clients</h2><div class="panel scroll"><table id="clients"></table></div></div>
  <div><h2>Desktop versions</h2><div class="panel scroll"><table id="versions"></table></div></div>
</div>
<h2>Boxes asked</h2>
<div class="panel">
  <div class="legend"><span class="ranges" id="views"></span><span class="dim" id="map-note"></span></div>
  <div class="map-box"><canvas id="map" width="1440" height="720"></canvas><div id="tip"></div></div>
</div>
<h2>Places</h2>
<div class="panel">
  <div class="figures" id="place-figures" style="margin: 0 0 6px"></div>
  <div class="scroll"><table id="places"></table></div>
</div>
<div class="cols">
  <div><h2>Countries</h2><div class="panel scroll"><table id="countries"></table></div></div>
  <div><h2>Outcomes</h2><div class="panel scroll"><table id="outcomes"></table></div></div>
  <div><h2>Refusals</h2><div class="panel scroll"><table id="reasons"></table></div></div>
</div>
<h2>Last problems</h2>
<div class="panel scroll"><table id="problems"></table></div>
</main>
<script>
/** world-land.ts: rings in fifths of a degree, a first point and then steps; as degrees */
const decode = (text) => text.split(';').map((ring) => {
  const n = ring.split(',').map(Number);
  const out = new Float32Array(n.length);
  let lon = 0, lat = 0;
  for (let k = 0; k < n.length; k += 2) { lon += n[k]; lat += n[k + 1]; out[k] = lon / 5; out[k + 1] = lat / 5; }
  return out;
});
const LAND = decode(${JSON.stringify(WORLD_LAND)});
const BORDERS = decode(${JSON.stringify(WORLD_BORDERS)});
const RANGES = ['1h', '24h', '7d', '30d'];
let range = '24h';
let view = 'world';
let last = null;
try { range = RANGES.includes(localStorage.getItem('range')) ? localStorage.getItem('range') : range; } catch {}
try { view = localStorage.getItem('view') === 'spots' ? 'spots' : view; } catch {}

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const bytes = (n) => n == null ? '?' : n >= 1e12 ? (n / 1e12).toFixed(2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' kB' : n + ' B';
const ms = (n) => n == null ? '-' : n >= 10000 ? (n / 1000).toFixed(0) + ' s' : n >= 1000 ? (n / 1000).toFixed(1) + ' s' : n + ' ms';
const time = (t) => new Date(t).toLocaleString();
const age = (iso) => { const d = (Date.now() - Date.parse(iso)) / 86400000; return isNaN(d) ? '' : ' (' + (d < 1 ? (d * 24).toFixed(0) + ' h' : d.toFixed(1) + ' days') + ' old)'; };

function rangeButtons() {
  const box = $('ranges');
  box.replaceChildren(...RANGES.map((r) => {
    const b = el('button', r);
    b.setAttribute('aria-pressed', String(r === range));
    b.onclick = () => { range = r; try { localStorage.setItem('range', r); } catch {} rangeButtons(); load(); };
    return b;
  }));
}

function figures(s) {
  const t = s.totals;
  const items = [
    [t.requests, 'requests'],
    [t.requests ? Math.round(100 * t.ok / t.requests) + ' %' : '-', 'answered'],
    [ms(t.p50), 'median'],
    [ms(t.p95), '95 %'],
    [bytes(t.bytes), 'sent'],
    [s.buckets.reduce((a, b) => a + b.limited, 0), 'rate limited'],
    [s.buckets.reduce((a, b) => a + b.refused, 0), 'refused'],
    [s.buckets.reduce((a, b) => a + b.failed, 0), 'failed'],
  ];
  $('figures').replaceChildren(...items.map(([v, label]) => { const d = el('div', undefined, 'figure'); d.append(el('b', String(v)), el('span', label)); return d; }));
}

function host(h) {
  const o = h.overpass;
  const rows = [];
  const row = (label, value, cls) => { const d = el('div'); d.append(el('span', label + ' '), el('b', value, cls)); rows.push(d); };
  row('Overpass', o.reachable ? 'answers' : 'not reachable' + (o.error ? ' (' + o.error + ')' : ''), o.reachable ? 'ok' : 'bad');
  row('Data until', o.dataUntil ? o.dataUntil + age(o.dataUntil) : '?');
  if (o.slotsFree != null) row('Running / free slots', (o.running ?? '?') + ' / ' + o.slotsFree);
  if (h.disk) row('Disk', bytes(h.disk.freeBytes) + ' free of ' + bytes(h.disk.totalBytes), h.disk.freeBytes < 20e9 ? 'warn' : '');
  row('Database', bytes(h.dbBytes));
  const m = h.overpassMemory;
  if (m) row('Overpass memory', bytes(m.anon ?? m.current) + ' own, ' + bytes(m.file) + ' cache' + (m.max ? ', limit ' + bytes(m.max) : '') + (m.ageS > 60 ? ' (' + m.ageS + ' s old)' : ''));
  if (h.hostMemory) row('Machine memory', bytes(h.hostMemory.availableBytes) + ' free of ' + bytes(h.hostMemory.totalBytes));
  const c = h.clone;
  if (c.maintenance) {
    const share = c.totalBytes && h.dbBytes != null ? ' ' + Math.min(100, 100 * h.dbBytes / c.totalBytes).toFixed(1) + ' %' : '';
    row('Clone', 'under way' + share + ' of ' + bytes(c.totalBytes), 'warn');
  } else {
    row('Clone', c.complete ? (c.finished ? 'done ' + c.finished : 'complete') : 'none yet', c.complete ? '' : 'bad');
  }
  if (c.source) row('From', c.source);
  $('host').replaceChildren(...rows);
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function requestsChart(s) {
  const svg = $('requests');
  const max = Math.max(1, ...s.buckets.map((b) => b.ok + b.limited + b.refused + b.failed));
  const w = 1000 / s.buckets.length;
  const parts = [];
  s.buckets.forEach((b, k) => {
    let y = 160;
    for (const [n, color] of [[b.ok, 'var(--ok)'], [b.limited, 'var(--limit)'], [b.refused, 'var(--warn)'], [b.failed, 'var(--bad)']]) {
      if (!n) continue;
      const h = 150 * n / max;
      y -= h;
      const r = svgEl('rect', { x: k * w + 0.5, y, width: Math.max(1, w - 1), height: h, fill: color });
      r.append(svgEl('title', {}));
      r.lastChild.textContent = time(b.t) + ': ' + b.ok + ' answered, ' + b.limited + ' limited, ' + b.refused + ' refused, ' + b.failed + ' failed';
      parts.push(r);
    }
  });
  const label = svgEl('text', { x: 4, y: 12, fill: 'var(--dim)', 'font-size': 11 });
  label.textContent = max + ' per ' + (s.bucketMs >= 3600000 ? s.bucketMs / 3600000 + ' h' : s.bucketMs / 60000 + ' min');
  svg.replaceChildren(...parts, label);
}

function latencyChart(s) {
  const svg = $('latency');
  const max = Math.max(100, ...s.buckets.map((b) => b.p95 ?? 0));
  const w = 1000 / s.buckets.length;
  const parts = [];
  const line = (key, color) => {
    let d = '';
    s.buckets.forEach((b, k) => {
      if (b[key] == null) return;
      const x = k * w + w / 2, y = 115 - 105 * b[key] / max;
      d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      // A mark per bar, so that a lone bar with answers shows too
      parts.push(svgEl('rect', { x: x - 2, y: y - 2, width: 4, height: 4, fill: color }));
    });
    parts.unshift(svgEl('path', { d: d || 'M0,0', fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  };
  line('p95', 'var(--gold)');
  line('p50', 'var(--ok)');
  svg.replaceChildren(...parts);
  $('latency-top').textContent = 'top of the chart ' + ms(max);
}

function viewButtons() {
  $('views').replaceChildren(...[['world', 'World'], ['spots', 'Where asked']].map(([v, label]) => {
    const b = el('button', label);
    b.setAttribute('aria-pressed', String(v === view));
    b.onclick = () => { view = v; try { localStorage.setItem('view', v); } catch {} viewButtons(); if (last) map(last); };
    return b;
  }));
}

/** The part of the world shown: all of it, or the cells asked with a margin, at least 8 degrees high, 2:1 */
function frame(heat) {
  if (view === 'world' || !heat.length) return { w: -180, n: 90, lonSpan: 360, latSpan: 180 };
  let s = 90, n = -90, w = 180, e = -180;
  for (const c of heat) { s = Math.min(s, c.lat); n = Math.max(n, c.lat); w = Math.min(w, c.lon); e = Math.max(e, c.lon); }
  let latSpan = Math.min(180, Math.max(8, (n - s) * 1.3 + 2, ((e - w) * 1.3 + 2) / 2));
  const lonSpan = Math.min(360, latSpan * 2);
  latSpan = lonSpan / 2;
  const midLat = Math.max(-90 + latSpan / 2, Math.min(90 - latSpan / 2, (s + n) / 2));
  const midLon = (w + e) / 2;
  return { w: midLon - lonSpan / 2, n: midLat + latSpan / 2, lonSpan, latSpan };
}

function map(s) {
  last = s;
  const canvas = $('map');
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const f0 = frame(s.heat);
  const px = (lon) => (lon - f0.w) / f0.lonSpan * W, py = (lat) => (f0.n - lat) / f0.latSpan * H;
  mapFrame = { px, py };
  $('map-note').textContent = s.heat.length ? s.heat.length + ' cells of half a degree' : 'nothing asked in this range';
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--panel-2');
  g.fillRect(0, 0, W, H);
  const trace = (ring) => {
    g.beginPath();
    for (let k = 0; k < ring.length; k += 2) {
      const x = px(ring[k]), y = py(ring[k + 1]);
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
  };
  g.fillStyle = css.getPropertyValue('--frame');
  for (const ring of LAND) { trace(ring); g.fill(); }
  g.strokeStyle = css.getPropertyValue('--bg');
  g.lineWidth = view === 'world' ? 1 : 2;
  for (const line of BORDERS) { trace(line); g.stroke(); }
  // Graticule with its degrees: every 30 degrees on the world, every 1 to 5 degrees closer
  const step = f0.lonSpan >= 180 ? 30 : f0.lonSpan >= 40 ? 5 : f0.lonSpan >= 16 ? 2 : 1;
  g.strokeStyle = 'rgba(142, 152, 140, 0.18)';
  g.fillStyle = css.getPropertyValue('--dim');
  g.lineWidth = 1;
  g.font = '20px ui-monospace, Consolas, monospace';
  for (let lon = Math.ceil(f0.w / step) * step; lon <= f0.w + f0.lonSpan; lon += step) {
    g.beginPath(); g.moveTo(px(lon), 0); g.lineTo(px(lon), H); g.stroke();
    g.fillText(lon + '°', px(lon) + 4, H - 8);
  }
  for (let lat = Math.ceil((f0.n - f0.latSpan) / step) * step; lat <= f0.n; lat += step) {
    g.beginPath(); g.moveTo(0, py(lat)); g.lineTo(W, py(lat)); g.stroke();
    g.fillText(lat + '°', 4, py(lat) - 4);
  }
  const top = Math.max(1, ...s.heat.map((c) => c.count));
  g.globalCompositeOperation = 'lighter';
  for (const c of s.heat) {
    const x = px(c.lon), y = py(c.lat);
    const f = Math.log1p(c.count) / Math.log1p(top);
    // A cell's size on the map, at least a few pixels
    const r = Math.max(3 + 9 * f, (0.35 + 0.4 * f) * W / f0.lonSpan);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 196, 92, ' + (0.45 + 0.55 * f) + ')');
    grad.addColorStop(1, 'rgba(224, 100, 90, 0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalCompositeOperation = 'source-over';
}

/** The map's frame and the places drawn, for the tooltip */
let mapFrame = null;

function placeLabel(p) {
  return (p.name || 'unnamed') + (p.country ? ', ' + p.country : '');
}

/** The tooltip over the map: the asked place nearest the pointer, within a few pixels */
function mapTip(event) {
  const tip = $('tip');
  if (!mapFrame || !last) { tip.style.display = 'none'; return; }
  const canvas = $('map');
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * scale, y = (event.clientY - rect.top) * scale;
  let best = null, bestD = 30 * scale;
  for (const p of last.places) {
    const d = Math.hypot(mapFrame.px(p.lon) - x, mapFrame.py(p.lat) - y);
    if (d < bestD) { best = p; bestD = d; }
  }
  if (!best) { tip.style.display = 'none'; return; }
  tip.textContent = placeLabel(best) + ': ' + best.count + (best.count === 1 ? ' request' : ' requests');
  tip.style.display = 'block';
  tip.style.left = Math.min(rect.width - tip.offsetWidth, event.clientX - rect.left + 12) + 'px';
  tip.style.top = (event.clientY - rect.top + 12) + 'px';
}

function playersChart(s) {
  const svg = $('players');
  const days = s.days;
  const max = Math.max(1, ...days.map((d) => d.players || 0));
  const w = 1000 / Math.max(7, days.length);
  const bar = Math.min(w - 2, 40);
  svg.replaceChildren(...days.map((d, k) => {
    const h = 110 * (d.players || 0) / max;
    const r = svgEl('rect', { x: k * w + (w - bar) / 2, y: 118 - h, width: Math.max(1, bar), height: h, fill: 'var(--gold)' });
    r.append(svgEl('title', {}));
    r.lastChild.textContent = d.day + ': ' + (d.players ?? '?') + ' players, ' + d.requests + ' requests';
    return r;
  }));
  const counted = days.filter((d) => d.players);
  const total = counted.reduce((a, d) => a + d.requests, 0), people = counted.reduce((a, d) => a + d.players, 0);
  $('players-note').textContent = people ? (total / people).toFixed(1) + ' requests per player and day' : '';
  table('days', [['day'], ['players', true], ['requests', true], ['per player', true]],
    days.slice().reverse().map((d) => [[d.day], [d.players ?? '?'], [d.requests], [d.players ? (d.requests / d.players).toFixed(1) : '-']]));
}

function kindsTable(s) {
  const all = s.kinds.reduce((a, k) => a + k.count, 0) || 1;
  table('kinds', [['kind'], ['share', true], ['requests', true], ['answered', true], ['size each', true], ['median', true], ['95 %', true]],
    s.kinds.map((k) => [[k.kind], [Math.round(100 * k.count / all) + ' %'], [k.count], [k.ok], [k.ok ? bytes(Math.round(k.bytes / k.ok)) : '-'], [ms(k.p50)], [ms(k.p95)]]));
}

function clientTables(s) {
  const all = s.clients.reduce((a, c) => a + c.count, 0) || 1;
  table('clients', [['client'], ['browser'], ['share', true], ['requests', true]],
    s.clients.map((c) => [[c.client], [c.browser], [Math.round(100 * c.count / all) + ' %'], [c.count]]));
  table('versions', [['version'], ['requests', true]], s.versions.map((v) => [[v.version], [v.count]]));
}

function placesTable(s) {
  const c = s.placeCounts;
  const fig = (v, label) => { const d = el('div', undefined, 'figure'); d.append(el('b', String(v)), el('span', label)); return d; };
  $('place-figures').replaceChildren(fig(c.fresh, 'new in this range'), fig(c.returning, 'asked before'), fig(c.unnamed, 'not named yet'));
  const t = $('places');
  const tr = el('tr');
  [['place'], ['country'], ['requests', true]].forEach(([h, num]) => tr.append(el('th', h, num ? 'num' : '')));
  t.replaceChildren(tr, ...s.places.map((p) => {
    const r = el('tr');
    const name = el('td', p.name || 'unnamed', p.name ? '' : 'dim');
    if (p.isNew) name.append(el('span', 'new', 'tag'));
    r.append(name, el('td', p.country || '', 'dim'), el('td', String(p.count), 'num'));
    return r;
  }));
  if (!s.places.length) { const r = el('tr'); const td = el('td', 'none', 'dim'); td.colSpan = 3; r.append(td); t.append(r); }
}

function table(id, head, rows) {
  const t = $(id);
  const tr = el('tr');
  head.forEach(([h, num]) => tr.append(el('th', h, num ? 'num' : '')));
  t.replaceChildren(tr, ...rows.map((cells) => {
    const r = el('tr');
    cells.forEach(([v, cls], k) => r.append(el('td', String(v ?? ''), (head[k][1] ? 'num ' : '') + (cls || ''))));
    return r;
  }));
  if (!rows.length) { const r = el('tr'); const td = el('td', 'none', 'dim'); td.colSpan = head.length; r.append(td); t.append(r); }
}

const boxText = (b) => b ? [b.s, b.w, b.n, b.e].map((v) => v.toFixed(3)).join(',') : '';

async function load() {
  try {
    const r = await fetch('api/summary?range=' + range, { cache: 'no-store' });
    const { summary: s, host: h, build } = await r.json();
    $('meta').textContent = time(s.from) + ' to ' + time(s.to) + ', read ' + new Date().toLocaleTimeString() + ', build ' + build;
    figures(s);
    host(h);
    requestsChart(s);
    latencyChart(s);
    map(s);
    playersChart(s);
    kindsTable(s);
    clientTables(s);
    placesTable(s);
    table('countries', [['country'], ['requests', true]], s.countries.map((c) => [[c.country], [c.count]]));
    table('outcomes', [['outcome'], ['status', true], ['requests', true]], s.outcomes.map((o) => [[o.outcome, o.outcome === 'ok' ? 'ok' : ''], [o.status], [o.count]]));
    table('reasons', [['reason'], ['requests', true]], s.reasons.map((o) => [[o.reason], [o.count]]));
    table('problems', [['time'], ['status', true], ['outcome'], ['reason'], ['took', true], ['country'], ['box']],
      s.problems.map((p) => [[time(p.t)], [p.status, p.status >= 500 ? 'bad' : 'warn'], [p.outcome], [p.reason], [ms(p.ms)], [p.country], [boxText(p.box), 'dim']]));
  } catch (e) {
    $('meta').textContent = 'cannot read the status: ' + e.message;
  }
}
rangeButtons();
viewButtons();
$('map').addEventListener('mousemove', mapTip);
$('map').addEventListener('mouseleave', () => { $('tip').style.display = 'none'; });
load();
setInterval(load, 10000);
</script>
</body>
</html>`;
