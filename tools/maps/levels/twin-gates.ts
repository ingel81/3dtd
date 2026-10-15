/**
 * Twin gates: a strictly mirrored coop map at dusk, built with the
 * editor's Mirror X symmetry. Each player holds a castle with two lanes
 * that meet in its bailey and leave through the east or west gate to the
 * shared HQ in the middle. Everything left of the axis is painted once and
 * lands mirrored on the right, so both players get the same ground, the
 * same lanes and the same build places.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { edgePolyline, pointAt, polylineLength } from '../../../src/app/editor/ops/path-graph';
import { facing, LevelKit } from './kit';

export function buildTwinGates(): CustomMapDocument {
  const k = new LevelKit({
    id: 'twin-gates',
    name: 'Twin Gates',
    description: 'A mirrored coop map at dusk: two castles, two lanes each through the bailey, one shared HQ in the middle. Four spawns.',
    size: 512,
    base: 'grass',
    seed: 8808,
  });
  for (const m of ['grass', 'grass-lush', 'meadow', 'forest-floor', 'cobblestone-grey', 'castle-floor', 'dirt', 'rocky-ground']) k.layer(m);
  k.cliffs('cliff', 40);
  k.symmetry = 'x';

  // ---- Ground: rolling land, the west half copied to the east; castle mounds and the HQ mound
  k.generate('hills', 88, 0.6);
  k.mirrorFrom({ x: -1, y: 0 });
  const castle = { x: -118, y: 0 };
  // The castle on a rock plateau: sheer sides, its rim broken, a dry ditch at the foot
  k.plateau(castle, { radius: 58, falloff: 0.15 }, k.h(castle.x, castle.y) + 10);
  k.level(castle, { radius: 48, falloff: 0.3 }, k.h(castle.x, castle.y));
  const ringAt = (r: number): MapPoint[] => Array.from({ length: 33 }, (_, i) => ({ x: castle.x + Math.cos((i / 32) * Math.PI * 2) * r, y: Math.sin((i / 32) * Math.PI * 2) * r }));
  k.roughen(ringAt(58), { radius: 7, falloff: 0.7 }, 2, 8808);
  k.raise(ringAt(66), { radius: 6, falloff: 0.8 }, -1.6);
  const hq = { x: 0, y: 0 };
  k.level(hq, { radius: 34, falloff: 0.6 }, k.h(0, 0) + 2);

  // ---- Lanes: from the north-west and south-west corners into the bailey, out of the east gate to the HQ
  const road = { width: 8, surface: [] as string[], lamps: false };
  const bailey = { x: castle.x, y: 0 };
  const eastGate = { x: castle.x + 36, y: 0 };
  k.road([{ x: -244, y: 214 }, { x: -160, y: 216 }, { x: -96, y: 172 }, { x: -92, y: 100 }, { x: castle.x, y: 60 }, { x: castle.x, y: 36 }, bailey], road);
  k.road([{ x: -244, y: -214 }, { x: -160, y: -216 }, { x: -96, y: -172 }, { x: -92, y: -100 }, { x: castle.x, y: -60 }, { x: castle.x, y: -36 }, bailey], road);
  k.road([bailey, eastGate, { x: -55, y: 10 }, { x: -25, y: 4 }, hq], road);
  // Spawns are set one by one (a mirrored map names its own)
  k.spawn('North-West', -244, 214);
  k.spawn('South-West', -244, -214);
  k.spawn('North-East', 244, 214);
  k.spawn('South-East', 244, -214);
  k.hq(hq.x, hq.y);
  // A river in two arms round the middle, crossed by the lanes to the HQ on bridges, the HQ between them
  k.river([{ x: -6, y: 256 }, { x: -20, y: 160 }, { x: -42, y: 70 }, { x: -42, y: -70 }, { x: -20, y: -160 }, { x: -6, y: -256 }], { width: 9, depth: 1.8, bank: 6 });
  k.bridgeStyle('stone');

  // ---- Land: woods along the outer edges, meadows between, the baileys and the HQ paved
  // Woods in the outer corners and on the axis ends (each spot a dab of its own, not a line)
  for (const at of [{ x: -236, y: 70 }, { x: -236, y: -70 }, { x: -40, y: 236 }, { x: -40, y: -236 }, { x: -200, y: 236 }, { x: -200, y: -236 }]) {
    k.biome('forest', at, { radius: 34, strength: 0.9 });
  }
  for (const at of [{ x: -200, y: 160 }, { x: -60, y: 120 }, { x: -60, y: -120 }, { x: -200, y: -160 }, { x: -60, y: 0 }]) k.biome('meadow', at, { radius: 60, strength: 0.7 });
  k.paint('castle-floor', castle, { radius: 36, falloff: 0.5 }, 0.9);
  k.paint('cobblestone-grey', hq, { radius: 22, falloff: 0.6 }, 0.9);
  k.paint('rocky-ground', castle, { radius: 70, falloff: 0.2 }, 0.3);

  // ---- The west castle (mirrored east): curtain walls, corner towers, three gates
  const [x0, x1, y0, y1] = [castle.x - 36, castle.x + 36, -36, 36];
  const wall = (from: MapPoint, to: MapPoint, rotation: number, gap?: MapPoint) => {
    const n = Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 9.6);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const p = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
      if (gap && Math.hypot(p.x - gap.x, p.y - gap.y) < 9) continue;
      k.place('castle-wall', p.x, p.y, { rotation, scale: 1.2 });
    }
  };
  wall({ x: x0 + 4, y: y1 }, { x: x1 - 4, y: y1 }, 0, { x: castle.x, y: y1 });
  wall({ x: x0 + 4, y: y0 }, { x: x1 - 4, y: y0 }, Math.PI, { x: castle.x, y: y0 });
  wall({ x: x0, y: y0 + 4 }, { x: x0, y: y1 - 4 }, Math.PI / 2);
  wall({ x: x1, y: y0 + 4 }, { x: x1, y: y1 - 4 }, -Math.PI / 2, { x: x1, y: 0 });
  for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]] as const) k.place('castle-tower-roof', x, y, { scale: 1.3 });
  k.place('castle-gate', castle.x, y1, { rotation: 0, scale: 1.25 });
  k.place('castle-gate', castle.x, y0, { rotation: Math.PI, scale: 1.25 });
  k.place('castle-gate', x1, 0, { rotation: -Math.PI / 2, scale: 1.25 });
  for (const [x, y, a, r] of [
    [castle.x - 18, 16, 'tent-large', 0.4],
    [castle.x - 18, -16, 'weapon-rack', 1.57],
    [castle.x - 22, 0, 'well', 0],
    [castle.x + 18, 18, 'banner-red', 0],
    [castle.x + 18, -18, 'banner-red', 0],
    [castle.x + 12, 22, 'brazier', 0],
    [castle.x + 12, -22, 'brazier', 0],
    [castle.x - 8, 22, 'barrel', 0.3],
    [castle.x - 6, -22, 'crate', 0.6],
  ] as const) {
    k.place(a, x, y, { rotation: r });
  }
  // Groves and lone oaks between the lanes, hedges along the avenue, field walls
  for (const at of [{ x: -60, y: 70 }, { x: -60, y: -70 }, { x: -190, y: 110 }, { x: -190, y: -110 }, { x: -110, y: 200 }, { x: -110, y: -200 }]) {
    k.scatter(['tree-oak', 'tree-maple', 'tree-birch', 'bush', 'shrub-wide'], at, { radius: 24, strength: 1 }, { density: 12, minDistance: 5 });
  }
  k.row('hedge-long', [{ x: -100, y: 26 }, { x: -40, y: 22 }], 6, { turn: Math.PI / 2 });
  k.row('hedge-long', [{ x: -100, y: -22 }, { x: -40, y: -18 }], 6, { turn: Math.PI / 2 });
  k.row('wall-dry-stone', [{ x: -230, y: 30 }, { x: -200, y: 60 }, { x: -180, y: 110 }], 5.4, { turn: Math.PI / 2 });
  k.row('wall-dry-stone', [{ x: -230, y: -30 }, { x: -200, y: -60 }, { x: -180, y: -110 }], 5.4, { turn: Math.PI / 2 });
  // Torches along every lane, alternating sides, every 22 m
  for (const e of k.doc.paths.edges.filter((ed) => k.doc.paths.nodes.find((n) => n.id === ed.a)!.x < 0)) {
    const line = edgePolyline(k.doc.paths, e);
    const len = polylineLength(line);
    for (let d = 11, n = 0; d < len - 6; d += 22, n++) {
      const p = pointAt(line, d);
      const q = pointAt(line, Math.min(len, d + 1));
      const dl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const side = n % 2 ? 1 : -1;
      const t = { x: p.x - ((q.y - p.y) / dl) * 6 * side, y: p.y + ((q.x - p.x) / dl) * 6 * side };
      if (t.x < -2 && Math.abs(t.x - castle.x) + Math.abs(t.y) > 45 && k.free(t.x, t.y, 0.5)) k.place('torch', t.x, t.y);
    }
  }

  // Rock on the plateaus' faces, once the brushes shaped the ground: what grew on them makes room
  for (const p of ringAt(58)) k.erase(p, 5, (o) => o.asset.startsWith('castle') || o.asset.startsWith('fx'));
  k.cliffRocks(ringAt(58), { radius: 10 });
  // A watermill on each arm of the river
  const mill = { x: -64, y: 118 };
  k.erase(mill, 8);
  if (k.free(mill.x, mill.y, 4)) k.place('watermill', mill.x, mill.y, { rotation: facing(mill, { x: -40, y: 118 }) });
  // Siege works before the north and south gates: guns, gabions and a camp (TODO(E179): trebuchet, siege tower)
  for (const sy of [1, -1]) {
    for (const [x, y, a, r] of [
      [castle.x - 26, 92, 'cannon', 0],
      [castle.x + 22, 94, 'cannon', 0.3],
      [castle.x - 34, 104, 'tent', 0.4],
      [castle.x + 34, 108, 'tent-large', -0.3],
      [castle.x - 18, 104, 'barricade', 0],
      [castle.x + 14, 100, 'supply-crates', 0.5],
      [castle.x + 28, 118, 'weapon-rack', 0],
      [castle.x - 30, 118, 'campfire', 0],
      [castle.x + 40, 96, 'campfire', 0],
    ] as const) {
      const p = { x, y: y * sy };
      if (k.free(p.x, p.y, 2)) k.place(a, p.x, p.y, { rotation: sy > 0 ? Math.PI + r : r });
    }
  }
  // Banners and torches at every gate, watch fires before the walls
  for (const [x, y, a] of [
    [castle.x - 7, y1 + 3, 'banner-red'],
    [castle.x + 7, y1 + 3, 'banner-red'],
    [castle.x - 7, y0 - 3, 'banner-red'],
    [castle.x + 7, y0 - 3, 'banner-red'],
    [x1 + 3, 8, 'torch'],
    [x1 + 3, -8, 'torch'],
    [castle.x - 6, y1 + 6, 'torch'],
    [castle.x + 6, y0 - 6, 'torch'],
    [x0 - 10, 20, 'brazier'],
    [x0 - 10, -20, 'brazier'],
  ] as const) {
    if (k.free(x, y, 0.6)) k.place(a, x, y, { rotation: y > 0 ? 0 : Math.PI });
  }
  // Denser, darker woods along the outer edges, birds over the hills
  k.biome('forest', [{ x: -240, y: 150 }, { x: -240, y: -150 }], { radius: 22, strength: 1 });
  k.biome('forest', [{ x: -150, y: 244 }, { x: -60, y: 244 }], { radius: 18, strength: 1 });
  k.biome('forest', [{ x: -150, y: -244 }, { x: -60, y: -244 }], { radius: 18, strength: 1 });
  k.place('fx-birds', -170, 150, { scale: 0.8 });

  // ---- The middle (on the axis, once): the keep behind the HQ, banners, statues
  k.symmetry = 'none';
  k.place('castle-keep', 0, 42, { rotation: facing({ x: 0, y: 42 }, hq) });
  for (const [x, y, a] of [[-12, -20, 'statue-knight'], [12, -20, 'statue-knight'], [-16, 26, 'banner-blue'], [16, 26, 'banner-blue']] as const) {
    k.place(a, x, y, { rotation: Math.PI });
  }

  // Four lanes split the first waves four ways: a little more money per lane to open with
  k.gameplay({ startCredits: 250 });
  // Seven ground materials: the least used goes (each one is 8 MB of pixels to load)
  k.trimLayers(7);
  k.environment({ biome: 'temperate', sky: 'day', sunAzimuth: 255, sunElevation: 20, fogDensity: 0.0005, tint: '#ffd6aa' });
  return k.finish();
}
