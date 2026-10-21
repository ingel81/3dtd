import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../world/custom-map/map-create';
import type { MapRiver, MapRiverPoint, MapTerrain } from '../world/custom-map/map-document';
import { joinRiverLevels, riverCover, riverNetwork, type CoverAt } from './river-network';

function terrain(): MapTerrain {
  return createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 2, starter: false, now: new Date(0) }).terrain;
}

/** A straight river from a to b, points every 8 m, the level falling from `top` by `fall` per metre */
function river(id: string, a: [number, number], b: [number, number], top: number, fall = 0.01, width = 12, kind: MapRiver['kind'] = 'water'): MapRiver {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(length / 8));
  const points: MapRiverPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    points.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, width, height: top - fall * length * f });
  }
  return { id, kind, points };
}

/** A hairpin: down one leg, round a bend, back up the other `gap` metres beside it */
function hairpin(gap: number, top = 10, fall = 0.01): MapRiver {
  const points: MapRiverPoint[] = [];
  let s = 0;
  let last: [number, number] | null = null;
  const push = (x: number, y: number) => {
    if (last) s += Math.hypot(x - last[0], y - last[1]);
    last = [x, y];
    points.push({ x, y, width: 12, height: top - fall * s });
  };
  for (let y = -120; y <= 0; y += 8) push(0, y);
  for (let k = 1; k < 8; k++) push((gap / 2) * (1 - Math.cos((Math.PI * k) / 8)), (gap / 2) * Math.sin((Math.PI * k) / 8));
  for (let y = 0; y >= -120; y -= 8) push(gap, y);
  return { id: 'r1', kind: 'water', points };
}

const levels = (r: MapRiver) => r.points.map((p) => p.height);

describe('riverNetwork', () => {
  it('finds no junction between rivers apart', () => {
    const t = terrain();
    t.rivers = [river('a', [-100, -150], [-100, 150], 10), river('b', [100, -150], [100, 150], 10)];
    expect(riverNetwork(t).junctions).toEqual([]);
    expect(joinRiverLevels(t)).toBe(false);
  });

  it('a river ending in another is a mouth: the other runs through', () => {
    const t = terrain();
    t.rivers = [river('main', [0, -150], [0, 150], 10), river('trib', [-150, 40], [0, 40], 12)];
    const net = riverNetwork(t);
    expect(net.junctions).toHaveLength(1);
    const roles = net.junctions[0].runs.map((q) => `${q.river}:${q.role}`).sort();
    expect(roles).toEqual(['0:through', '1:end']);
  });
});

describe('joinRiverLevels', () => {
  it('ends a higher tributary on the main river, its drop spread over its course; the main river keeps its levels', () => {
    const t = terrain();
    t.rivers = [river('main', [0, -150], [0, 150], 10), river('trib', [-150, 40], [0, 40], 12)];
    const main = levels(t.rivers[0]);
    expect(joinRiverLevels(t)).toBe(true);
    expect(levels(t.rivers[0])).toEqual(main);
    const trib = t.rivers[1].points;
    // The source stays, the end meets the main river's level where it enters (about 10 - 0.01 * 190)
    expect(trib[0].height).toBe(12);
    // (inside the main river, where it is drawn over, it falls on a little)
    expect(Math.abs(trib[trib.length - 1].height - (10 - 0.01 * 190))).toBeLessThan(0.2);
    for (let k = 1; k < trib.length; k++) expect(trib[k].height).toBeLessThanOrEqual(trib[k - 1].height);
  });

  it('raises a lower tributary flat up to the main river at its end', () => {
    const t = terrain();
    t.rivers = [river('main', [0, -150], [0, 150], 10), river('trib', [-150, 40], [0, 40], 7)];
    joinRiverLevels(t);
    const trib = t.rivers[1].points;
    const end = trib[trib.length - 1].height;
    expect(end).toBeCloseTo(10 - 0.01 * 190, 1);
    // All of it lay under that level: it stands flat on it
    expect(trib.every((p) => p.height === end)).toBe(true);
  });

  it('crossing rivers share the lower level in the crossing: the higher falls into it and keeps its arms, the lower drains it', () => {
    const t = terrain();
    t.rivers = [river('high', [-150, 0], [150, 0], 20, 0.001), river('low', [0, -150], [0, 150], 5, 0.001)];
    joinRiverLevels(t);
    const [high, low] = t.rivers;
    // In the crossing one level; the high river keeps its own on both sides of it
    expect(high.points[0].height).toBe(20);
    const at = (r: MapRiver, x: number, y: number) => r.points.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a)).height;
    expect(at(high, 0, 0)).toBeCloseTo(at(low, 0, 0), 2);
    expect(at(high, 100, 0)).toBeGreaterThan(19.7);
    // The low river drains it: from the crossing on at most its level, never rising
    for (let k = 1; k < low.points.length; k++) expect(low.points[k].height).toBeLessThanOrEqual(low.points[k - 1].height);
    expect(at(low, 0, 100)).toBeLessThanOrEqual(at(low, 0, 0));
  });

  it('a hairpin is one surface where its legs overlap, no seam of two levels', () => {
    const t = terrain();
    t.rivers = [hairpin(10)];
    expect(joinRiverLevels(t)).toBe(true);
    const pts = t.rivers[0].points;
    // Points side by side on the two legs stand on one level near the bend
    const left = pts.find((p) => p.x === 0 && p.y === -16)!;
    const right = pts.find((p) => p.x === 10 && p.y === -16)!;
    expect(left.height).toBe(right.height);
    for (let k = 1; k < pts.length; k++) expect(pts[k].height).toBeLessThanOrEqual(pts[k - 1].height);
  });

  it('a long loop grazing its own neck keeps its levels (drawn as one only)', () => {
    const t = terrain();
    const points: MapRiverPoint[] = [];
    // Down at x = 0, a wide loop of some 600 m, back past the start 9 m off for a moment
    const loop: [number, number][] = [[0, -150], [0, 0], [0, 100], [80, 160], [160, 100], [160, -100], [80, -160], [20, -60], [9, 0], [25, 50], [40, 90]];
    let s = 0;
    loop.forEach(([x, y], k) => {
      if (k) s += Math.hypot(x - loop[k - 1][0], y - loop[k - 1][1]);
      points.push({ x, y, width: 12, height: 20 - 0.01 * s });
    });
    t.rivers = [{ id: 'r1', kind: 'water', points }];
    const net = riverNetwork(t);
    expect(net.junctions.length).toBeGreaterThan(0);
    expect(net.junctions.every((j) => !j.levels)).toBe(true);
    expect(joinRiverLevels(t, net)).toBe(false);
  });

  it('a river running into a lake ends on the lake level', () => {
    const t = terrain();
    const g = t.grid;
    const mask = new Uint8Array(g.columns * g.rows);
    // A lake east of x = 50 at level 3 over flat ground at 0
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (i * g.cellSize - t.width / 2 > 50) mask[j * g.columns + i] = 255;
    t.water = { level: 3, mask, color: '#2d5a5e' };
    t.rivers = [river('r', [-150, 0], [70, 0], 8)];
    joinRiverLevels(t);
    const pts = t.rivers[0].points;
    expect(pts[0].height).toBe(8);
    expect(pts[pts.length - 1].height).toBeLessThanOrEqual(3);
  });

  it('a river lower than the lake it runs into keeps its levels: it ends under the lake surface', () => {
    const t = terrain();
    const g = t.grid;
    const mask = new Uint8Array(g.columns * g.rows);
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (i * g.cellSize - t.width / 2 > 50) mask[j * g.columns + i] = 255;
    t.water = { level: 3, mask, color: '#2d5a5e' };
    t.rivers = [river('r', [-150, 0], [70, 0], 2)];
    expect(joinRiverLevels(t)).toBe(false);
  });

  it('lava and water do not join', () => {
    const t = terrain();
    t.rivers = [river('main', [0, -150], [0, 150], 10), river('lava', [-150, 40], [0, 40], 12, 0.01, 12, 'lava')];
    expect(riverNetwork(t).junctions).toEqual([]);
  });

  it('is settled by its own result: a second pass changes nothing', () => {
    const t = terrain();
    t.rivers = [hairpin(10), river('trib', [-150, -60], [0, -60], 14), river('cross', [-150, -100], [150, -100], 4, 0.002)];
    t.rivers[1].id = 'r2';
    t.rivers[2].id = 'r3';
    joinRiverLevels(t);
    const once = structuredClone(t.rivers);
    expect(joinRiverLevels(t)).toBe(false);
    expect(t.rivers).toEqual(once);
  });
});

describe('riverCover', () => {
  it('hides a tributary inside the main river and mixes its current into the main one', () => {
    const t = terrain();
    t.rivers = [river('main', [0, -150], [0, 150], 10), river('trib', [-150, 40], [0, 40], 12)];
    joinRiverLevels(t);
    const net = riverNetwork(t);
    const flow = (r: number) => (r === 1 ? ([2, 0] as const) : ([0, 1] as const));
    const out: CoverAt = { cover: 0, open: 0, flowX: 0, flowY: 0, mix: 0 };
    // The tributary's last sample, at the main river's middle: covered
    const trib = net.lines[1]!;
    const end = trib.samples.length - 1;
    expect(riverCover(t, net, 1, end, 0, 40, flow, out).cover).toBe(1);
    // Out on its own course: not
    expect(riverCover(t, net, 1, 10, trib.samples[10].x, 40, flow, out).cover).toBe(0);
    // The main river at the mouth draws, with the tributary's current mixed in
    const main = net.lines[0]!;
    const k = main.samples.findIndex((p) => Math.abs(p.y - 40) < 1);
    const at = riverCover(t, net, 0, k, 0, 40, flow, out);
    expect(at.cover).toBe(0);
    expect(at.mix).toBeGreaterThan(0.4);
    expect(at.flowX).toBe(2);
  });

  it('hides the later leg of a hairpin under the earlier one', () => {
    const t = terrain();
    t.rivers = [hairpin(10)];
    joinRiverLevels(t);
    const net = riverNetwork(t);
    const line = net.lines[0]!;
    const out: CoverAt = { cover: 0, open: 0, flowX: 0, flowY: 0, mix: 0 };
    const flow = () => [0, 0] as const;
    const first = line.samples.findIndex((p) => Math.abs(p.y + 20) < 1 && p.x < 1);
    const second = line.samples.findIndex((p) => Math.abs(p.y + 20) < 1 && p.x > 9);
    // Between the legs, where both bands lie: the first leg draws, the second gives way
    expect(riverCover(t, net, 0, first, 4, -20, flow, out).cover).toBe(0);
    expect(riverCover(t, net, 0, second, 4, -20, flow, out).cover).toBeGreaterThan(0.9);
    // The first leg's side over the second leg's water stays open (no fade), its other side not
    expect(riverCover(t, net, 0, first, 6, -20, flow, out).open).toBe(1);
    expect(riverCover(t, net, 0, first, -6, -20, flow, out).open).toBe(0);
  });
});
