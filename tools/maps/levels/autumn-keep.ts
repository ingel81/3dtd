/**
 * Autumn keep: a ruined castle on a hill above autumn woods. Three roads
 * come out of the forest and meet on the green before the gatehouse; the
 * HQ stands in the bailey between broken curtain walls and the keep. Leaf
 * piles, ivy and morning fog in the hollows.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { LevelKit } from './kit';

export function buildAutumnKeep(): CustomMapDocument {
  const k = new LevelKit({
    id: 'autumn-keep',
    name: 'Autumn Keep',
    description: 'A ruined castle on a hill above red and golden woods. Three roads meet before the gatehouse; the HQ stands in the bailey.',
    size: 512,
    base: 'grass',
    seed: 3303,
  });
  for (const m of ['grass', 'leaves-autumn', 'forest-floor', 'grass-withered', 'leaves-scattered', 'dirt', 'cobblestone-mossy', 'rocky-ground']) k.layer(m);
  k.cliffs('rock-mossy', 38);

  // ---- Ground: rolling hills, the castle hill with a level top, hollows for the fog
  k.generate('hills', 33, 0.45);
  const c = { x: 0, y: 62 };
  k.raise(c, { radius: 130, falloff: 1 }, 16);
  k.raise(c, { radius: 80, falloff: 0.8 }, 8);
  const top = k.h(c.x, c.y);
  k.plateau(c, { radius: 84, falloff: 0.5 }, top);
  k.smooth(c, { radius: 100, falloff: 0.5 }, 5);
  k.level(c, { radius: 64, falloff: 0.3 }, top);
  for (const p of [{ x: -130, y: -150 }, { x: 140, y: -160 }, { x: -170, y: 110 }, { x: 170, y: 120 }]) k.form('valley', p, { radius: 60, strength: 0.6 }, 3);

  // ---- Roads out of the woods to the green before the gate, then up through the gate to the bailey
  const green = { x: 0, y: -28 };
  const gate = { x: 0, y: 32 };
  const hq = { x: 0, y: 58 };
  const road = { width: 7, surface: [] as string[], lamps: false };
  k.road([green, { x: 0, y: 0 }, gate, hq], { ...road, width: 8 });
  k.road([{ x: -250, y: -40 }, { x: -185, y: -88 }, { x: -115, y: -64 }, { x: -55, y: -44 }, green], road);
  k.road([{ x: 42, y: -250 }, { x: 82, y: -200 }, { x: 30, y: -150 }, { x: -40, y: -122 }, { x: -22, y: -72 }, green], road);
  k.road([{ x: 250, y: -18 }, { x: 192, y: -80 }, { x: 122, y: -62 }, { x: 60, y: -50 }, green], road);
  k.spawn('West Wood', -250, -40);
  k.spawn('South Wood', 42, -250);
  k.spawn('East Wood', 250, -18);
  k.hq(hq.x, hq.y);

  // ---- Woods: autumn oaks, maples and birches round the hill, the green and the bailey kept open
  k.biome('meadow', [{ x: -80, y: -40 }, { x: 0, y: -20 }, { x: 80, y: -40 }], { radius: 60, strength: 0.6 });
  k.biome('meadow', c, { radius: 60, strength: 0.5 });
  k.biome('forest', [{ x: -230, y: -200 }, { x: -120, y: -200 }, { x: -200, y: -120 }, { x: -230, y: 40 }, { x: -170, y: 200 }, { x: -60, y: 220 }], { radius: 75, strength: 0.9 });
  k.biome('forest', [{ x: 230, y: -210 }, { x: 150, y: -230 }, { x: 210, y: -130 }, { x: 230, y: 60 }, { x: 170, y: 210 }, { x: 60, y: 225 }], { radius: 75, strength: 0.9 });
  k.biome('forest', [{ x: -100, y: -230 }, { x: 150, y: -110 }], { radius: 45, strength: 0.6 });
  // Autumn: the forest's summer trees turn (the Objects tool: select the kind, swap the asset)
  const turn: Record<string, string[]> = {
    'tree-oak': ['tree-oak-autumn', 'tree-oak-autumn', 'tree-maple-red'],
    'tree-maple': ['tree-maple-autumn', 'tree-maple-red'],
    'tree-birch': ['tree-birch-autumn'],
    'tree-oak-young': ['tree-maple-red', 'tree-oak-autumn'],
    bush: ['bush-maple-autumn', 'bush'],
    shrub: ['bush-maple-autumn', 'shrub'],
    'grass-green': ['grass-autumn'],
    'grass-clump': ['grass-autumn'],
  };
  for (const o of k.doc.objects) {
    const to = turn[o.asset];
    if (to) o.asset = to[Math.floor(k.noise.hash(Math.round(o.x), Math.round(o.y), 9) * to.length)];
  }
  k.paint('leaves-autumn', [{ x: -200, y: -150 }, { x: -200, y: 100 }, { x: -60, y: 220 }], { radius: 70, falloff: 1 }, 0.5);
  k.paint('leaves-autumn', [{ x: 200, y: -150 }, { x: 200, y: 100 }, { x: 60, y: 220 }], { radius: 70, falloff: 1 }, 0.5);
  k.paint('grass-withered', [{ x: -60, y: -60 }, { x: 60, y: -60 }], { radius: 50, falloff: 1 }, 0.15);
  k.paint('cobblestone-mossy', c, { radius: 30, falloff: 0.7 }, 0.6);
  k.paint('leaves-scattered', green, { radius: 22, falloff: 0.8 }, 0.35);
  k.scatter(['leaf-pile', 'leaf-pile', 'branches', 'mushrooms-red'], [{ x: -160, y: -60 }, { x: -60, y: -90 }, { x: 60, y: -120 }, { x: 140, y: -20 }, { x: -120, y: 50 }, { x: 110, y: 60 }], { radius: 45, strength: 1 }, { density: 4, minDistance: 3 });
  // Lone trees on the green and the slopes
  k.scatter(['tree-maple-red', 'tree-oak-autumn', 'tree-birch-autumn', 'tree-maple-autumn'], [{ x: -110, y: -20 }, { x: -70, y: 10 }, { x: 70, y: 0 }, { x: 110, y: -10 }, { x: -60, y: 115 }, { x: 60, y: 115 }, { x: -90, y: 70 }, { x: 95, y: 60 }], { radius: 32, strength: 0.8 }, { density: 1.6, minDistance: 11 });

  // ---- The castle: curtain walls broken in places, corners, the gatehouse, the keep
  const walls = (from: MapPoint, to: MapPoint, rotation: number, skip: number[]) => {
    const n = Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 8);
    for (let i = 0; i < n; i++) {
      if (skip.includes(i)) continue;
      const f = (i + 0.5) / n;
      const asset = i % 2 ? 'castle-wall-ruined-b' : 'castle-wall-ruined';
      k.place(asset, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, { rotation, scale: 1.2 });
    }
  };
  const [x0, x1, y0, y1] = [-42, 42, 32, 108];
  k.place('castle-ruin-corner', x1, y1, { rotation: 0, scale: 1.2 });
  k.place('castle-ruin-corner', x0, y1, { rotation: Math.PI / 2, scale: 1.2 });
  k.place('castle-ruin-corner', x0, y0, { rotation: Math.PI, scale: 1.2 });
  k.place('castle-ruin-corner', x1, y0, { rotation: -Math.PI / 2, scale: 1.2 });
  walls({ x: x0 + 8, y: y1 }, { x: x1 - 8, y: y1 }, 0, [3, 6]);
  walls({ x: x1, y: y0 + 8 }, { x: x1, y: y1 - 8 }, -Math.PI / 2, [1]);
  walls({ x: x0, y: y0 + 8 }, { x: x0, y: y1 - 8 }, Math.PI / 2, [4]);
  walls({ x: x0 + 8, y: y0 }, { x: -8, y: y0 }, Math.PI, []);
  walls({ x: 8, y: y0 }, { x: x1 - 8, y: y0 }, Math.PI, []);
  k.place('gate-ruin', gate.x, gate.y, { rotation: Math.PI, scale: 1.25 });
  // The keep high in the north-east of the bailey, towers on the corners and in the long walls
  k.place('keep-ruin', 20, 88, { rotation: 0.12, scale: 1.5 });
  for (const [x, y, a] of [[x0 - 2, y1 + 2, 'castle-tower-ruined'], [x1 + 2, y1 + 2, 'castle-tower-ruined'], [x0 - 2, y0 - 2, 'castle-tower-ruined'], [x1 + 2, y0 - 2, 'castle-tower-ruined'], [x0 - 1, 70, 'castle-tower-ruined'], [x1 + 1, 72, 'castle-tower-ruined']] as const) {
    k.place(a, x, y, { rotation: x * 0.07, scale: 1.25 });
  }
  for (const [x, y, a, r] of [
    [-18, 78, 'well', 0],
    [-20, 44, 'leaf-pile', 1],
    [22, 46, 'barrels-broken', 2],
    [-24, 86, 'graves', 0.3],
    [6, 88, 'torch', 0],
    [-8, 40, 'torch', 0],
    [8, 40, 'torch', 0],
    [-26, 60, 'tree-maple-red', 0.5],
    [26, 62, 'bush-ivy', 1.5],
  ] as const) {
    k.place(a, x, y, { rotation: r });
  }
  // Older walls and an arch down the slopes, autumn bushes between them
  for (const [x, y, a, r] of [
    [-70, 40, 'ruin-arch', 0.6],
    [75, 70, 'ruin-wall', -1.1],
    [-60, 120, 'wall-dry-stone-ruined', 0.3],
    [62, 125, 'wall-dry-stone-ruined', -0.4],
    [-95, -10, 'ruin-wall', 2.2],
  ] as const) {
    k.place(a, x, y, { rotation: r });
  }
  k.scatter(['bush-maple-autumn', 'bush-maple-autumn', 'shrub', 'rock-mossy-flat'], [{ x: -80, y: 70 }, { x: 80, y: 30 }, { x: -40, y: 140 }, { x: 40, y: 150 }, { x: -110, y: 20 }], { radius: 35, strength: 0.7 }, { density: 2, minDistance: 6 });
  // The hill: rock outcrops, ivy and autumn scrub round the crown instead of a bare dome
  const ring: MapPoint[] = [];
  for (let a = 0; a <= 360; a += 20) ring.push({ x: c.x + Math.cos((a * Math.PI) / 180) * 88, y: c.y + Math.sin((a * Math.PI) / 180) * 88 });
  k.scatter(['rock-mossy-a', 'rock-mossy-b', 'rock-mossy-c', 'rock-large', 'stones-mossy-scatter'], ring, { radius: 18, strength: 0.8 }, { density: 3, minDistance: 5, scaleMin: 0.9, scaleMax: 2 });
  k.scatter(['bush-maple-autumn', 'bush-ivy', 'shrub', 'grass-autumn', 'grass-autumn'], ring, { radius: 22, strength: 1 }, { density: 8, minDistance: 2.5 });
  // Leaves and autumn grass on the green, the colours patchy
  for (const [x, y] of [[-90, -30], [-30, -60], [40, -40], [100, -50], [-60, 20], [70, 20]] as const) {
    k.paint('leaves-scattered', { x, y }, { radius: 26, falloff: 1 }, 0.45);
    k.paint('grass-withered', { x: x + 15, y: y + 18 }, { radius: 18, falloff: 1 }, 0.3);
  }
  k.scatter(['grass-autumn', 'leaf-pile', 'flowers-yellow'], [{ x: -80, y: -40 }, { x: 0, y: -60 }, { x: 80, y: -40 }, { x: -40, y: 10 }, { x: 40, y: 10 }], { radius: 35, strength: 1 }, { density: 10, minDistance: 1.8 });
  // A few fallen blocks down the hill
  k.scatter(['rock-mossy-a', 'rock-mossy-b', 'rock-mossy-c'], [{ x: -45, y: 15 }, { x: 45, y: 15 }, { x: -50, y: 100 }, { x: 50, y: 105 }], { radius: 16, strength: 0.8 }, { density: 2.5, minDistance: 5 });

  // ---- Morning fog in the hollows, leaves on the wind
  for (const [x, y] of [[-130, -150], [140, -160], [-170, 110], [170, 120]] as const) k.place('fx-fog', x, y, { scale: 0.7 });
  for (const [x, y] of [[-150, -100], [150, -90], [-120, 150], [130, 150], [0, -120]] as const) k.place('fx-leaves', x, y, { scale: 1.3 });

  k.environment({ biome: 'temperate', sky: 'day', sunAzimuth: 115, sunElevation: 20, fogDensity: 0.0007, tint: '#ffe6c4' });
  return k.finish();
}
