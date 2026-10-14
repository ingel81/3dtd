/**
 * Red canyon: a high desert plain cut by a branching canyon with stepped
 * red walls. The roads run on the canyon floor; towers stand on the mesas
 * above and look down. The HQ is a temple ruin in a wide basin with an
 * oasis, palms and a caravan camp. Two spawns, west and north, meet where
 * the canyons join.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

export function buildRedCanyon(): CustomMapDocument {
  const k = new LevelKit({
    id: 'red-canyon',
    name: 'Red Canyon',
    description: 'A branching canyon through a red desert plain. Enemies walk the canyon floor, towers stand on the mesas; the HQ is a temple ruin by an oasis.',
    size: 512,
    base: 'desert-stony',
    seed: 4404,
  });
  for (const m of ['desert-stony', 'sand-dunes', 'red-earth', 'sand-red', 'desert-cracked-red', 'riverbed-dry', 'sandstone-paving', 'grass-dry']) k.layer(m);
  k.cliffs('cliff-sandstone', 40);

  // ---- The plain: lifted to 30 m, a little rolling
  const plain = 30;
  for (let y = -300; y <= 300; y += 110) for (let x = -300; x <= 300; x += 110) k.level({ x, y }, { radius: 130, falloff: 0.4 }, plain);
  k.form('dunes', [{ x: -200, y: 190 }, { x: -60, y: 210 }], { radius: 70, strength: 0.6 }, 1);
  // Table mountains rising over the plain: each from a few lobes, so the rims wander, then rain breaks them up
  for (const [n, [x, y, r, h]] of ([[-170, 130, 42, 16], [170, 120, 50, 12], [-150, -160, 46, 14], [200, -30, 34, 18], [-30, 170, 30, 10]] as const).entries()) {
    k.plateau({ x, y }, { radius: r, falloff: 0.45 }, plain + h);
    for (let l = 0; l < 3; l++) {
      const a = k.noise.hash(n, l, 11) * Math.PI * 2;
      const d = r * (0.4 + 0.3 * k.noise.hash(n, l, 12));
      k.plateau({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }, { radius: r * 0.55, falloff: 0.45 }, plain + h - 1 - 3 * k.noise.hash(n, l, 13));
    }
    k.erode({ x, y }, { radius: r * 1.3, strength: 1 }, 10);
  }

  // ---- The canyons: a flat floor cut along each line; the walls roughened and cut by rain into gullies
  // with scree fans at their feet, a few ledges left as strata
  const west = { x: -252, y: -40 };
  const north = { x: 70, y: 252 };
  const j = { x: 10, y: -20 };
  const hq = { x: 150, y: -175 };
  const westCanyon: MapPoint[] = [west, { x: -200, y: -10 }, { x: -150, y: -60 }, { x: -95, y: -20 }, { x: -50, y: 10 }, j];
  const northCanyon: MapPoint[] = [north, { x: 40, y: 200 }, { x: 80, y: 140 }, { x: 30, y: 90 }, { x: -10, y: 40 }, j];
  const southCanyon: MapPoint[] = [j, { x: 40, y: -70 }, { x: 100, y: -100 }, { x: 125, y: -140 }, hq];
  // Dead-end side canyons branching off the main ones
  const sideCanyons: MapPoint[][] = [
    [{ x: -150, y: -60 }, { x: -170, y: -110 }, { x: -205, y: -135 }],
    [{ x: 80, y: 140 }, { x: 130, y: 160 }, { x: 175, y: 200 }],
    [{ x: 100, y: -100 }, { x: 150, y: -80 }, { x: 190, y: -95 }],
    [{ x: -50, y: 10 }, { x: -70, y: 60 }, { x: -110, y: 85 }],
  ];
  const carve = (line: MapPoint[], floor: number, radius: number) => {
    k.terrace(line, { radius: radius * 1.9, falloff: 0.5 }, 6, floor, 0.35);
    k.level(line, { radius, falloff: 0.35 }, floor);
    k.roughen(line, { radius: radius * 1.6, falloff: 0.6 }, 2.5, 4404 + line.length);
  };
  carve(westCanyon, 2, 24);
  carve(northCanyon, 2, 22);
  carve(southCanyon, 1.5, 26);
  for (const side of sideCanyons) carve(side, 4, 13);
  // The basins: where the canyons join, and the temple basin with the oasis, wider in some directions than others
  k.level(j, { radius: 46, falloff: 0.4 }, 2);
  for (const [dx, dy, r] of [[0, 0, 70], [35, -30, 50], [-30, -35, 45], [45, 35, 40]] as const) k.level({ x: hq.x + dx, y: hq.y + dy }, { radius: r, falloff: 0.45 }, 1.5);
  for (const line of [westCanyon, northCanyon, southCanyon, ...sideCanyons]) k.erode(line, { radius: 34, strength: 1 }, 5);
  k.erode(hq, { radius: 110, strength: 1 }, 12);
  // Mesas left standing inside the basins, a ramp up to one of them
  k.plateau({ x: 5, y: -25 }, { radius: 16, falloff: 0.3 }, 16);
  k.plateau({ x: 200, y: -200 }, { radius: 18, falloff: 0.3 }, 22);
  k.ramp({ x: 172, y: -186, h: 1.5 }, { x: 192, y: -196, h: 21 }, 7);

  // ---- Roads on the canyon floor
  const road = { width: 8, surface: [] as string[], lamps: false, adapt: false };
  k.road([west, { x: -200, y: -12 }, { x: -150, y: -58 }, { x: -95, y: -22 }, { x: -50, y: 6 }, { x: -22, y: -6 }, { x: -18, y: -38 }, { x: 22, y: -56 }], road);
  k.road([north, { x: 42, y: 200 }, { x: 80, y: 140 }, { x: 30, y: 90 }, { x: -12, y: 40 }, { x: -24, y: 2 }], road);
  k.road([{ x: 22, y: -56 }, { x: 42, y: -72 }, { x: 100, y: -100 }, { x: 125, y: -140 }, hq], road);
  k.spawn('West Canyon', west.x, west.y);
  k.spawn('North Canyon', north.x, north.y);
  k.hq(hq.x, hq.y);

  // ---- Oasis: a pool by the temple with palms round it
  const oasis = { x: 112, y: -200 };
  const pool = k.body(0.6, 'water', '#2d6b6a');
  k.lake(oasis, { radius: 16, falloff: 0.8 }, 2, pool);
  k.paint('grass-dry', oasis, { radius: 24, falloff: 0.8 }, 0.8);

  // ---- Ground: dunes and stony red earth on the plain, sand and dry wash on the canyon floors
  k.biome('desert', [{ x: -200, y: 200 }, { x: 0, y: 220 }, { x: 200, y: 220 }], { radius: 70, strength: 0.6 });
  k.biome('desert', [{ x: -200, y: -200 }, { x: -60, y: -160 }, { x: 0, y: -230 }], { radius: 60, strength: 0.6 });
  k.biome('desert', [{ x: 200, y: 50 }, { x: 140, y: 0 }, { x: -150, y: 100 }, { x: -60, y: 120 }], { radius: 55, strength: 0.5 });
  k.biome('desert', [{ x: -240, y: -110 }, { x: -120, y: -110 }, { x: 60, y: -150 }, { x: 230, y: -150 }, { x: 240, y: 90 }, { x: 120, y: 210 }], { radius: 50, strength: 0.45 });
  for (const [x, y] of [[-230, 60], [-90, 90], [120, 70], [230, -90], [-40, -110], [60, 200]] as const) k.paint('red-earth', { x, y }, { radius: 38, falloff: 1 }, 0.45);
  for (const line of [westCanyon, northCanyon, southCanyon]) {
    k.paint('sand-red', line, { radius: 20, falloff: 0.8 }, 0.8);
    k.paint('riverbed-dry', line, { radius: 6, falloff: 0.8 }, 0.5);
  }
  k.paint('sandstone-paving', hq, { radius: 16, falloff: 0.5 }, 0.9);

  // ---- The temple, the camp, palms at the oasis
  k.place('temple-ruin', hq.x + 16, hq.y - 14, { rotation: facing({ x: hq.x + 16, y: hq.y - 14 }, j) });
  k.place('desert-temple', hq.x + 34, hq.y + 22, { rotation: facing({ x: hq.x + 34, y: hq.y + 22 }, hq) });
  for (const [x, y, r] of [[hq.x - 26, hq.y + 4, 0], [hq.x + 14, hq.y + 22, 0.2], [hq.x - 24, hq.y - 6, 0.5]] as const) k.place('ruin-columns', x, y, { rotation: r });
  k.place('obelisk', hq.x - 6, hq.y + 34, { rotation: 0.3 });
  k.place('obelisk', hq.x + 30, hq.y + 30, { rotation: 0.3 });
  k.scatter(['tree-palm', 'tree-palm-tall', 'tree-palm-dry'], oasis, { radius: 26, strength: 1, falloff: 0.4 }, { density: 6, minDistance: 5, scaleMin: 0.85, scaleMax: 1.2 }, false);
  k.doc.objects = k.doc.objects.filter((o) => !o.asset.startsWith('tree-palm') || Math.hypot(o.x - oasis.x, o.y - oasis.y) > 15);
  k.scatter(['grass-tall-dry', 'iceplant', 'flower-gazania', 'desert-shrub'], oasis, { radius: 30, strength: 1 }, { density: 10, minDistance: 2 });
  const camp = { x: 128, y: -230 };
  for (const [dx, dy, a] of [[0, 0, 'caravan-tent'], [14, 8, 'tent-nomad'], [-10, 14, 'tent-nomad'], [8, -12, 'trade-goods'], [-6, -8, 'camel-saddle'], [20, -4, 'campfire'], [-16, -4, 'trade-goods']] as const) {
    k.place(a, camp.x + dx, camp.y + dy, { rotation: facing({ x: camp.x + dx, y: camp.y + dy }, oasis) });
  }
  // Rock towers, arches and lone mesas on the plain; boulders fallen into the canyon
  for (const [x, y, a, s] of [
    [-170, 140, 'mesa', 1],
    [180, 140, 'mesa', 0.8],
    [-60, -150, 'sandstone-pillar-tall', 1],
    [230, -120, 'sandstone-pillar', 1.2],
    [-230, -170, 'rock-arch', 1.3],
    [-110, 200, 'sandstone-pillar', 1],
    [130, 40, 'rock-arch', 1],
  ] as const) {
    k.place(a, x, y, { scale: s, rotation: x * 0.01 });
  }
  // Rock needles and an arch standing in the canyons and the basin
  for (const [x, y, a, sc] of [[-120, -45, 'sandstone-pillar-tall', 1], [60, 120, 'sandstone-pillar', 1.3], [-175, -25, 'sandstone-pillar', 1.1], [175, -140, 'sandstone-pillar-tall', 0.9], [65, -86, 'rock-arch', 1.1], [-15, 70, 'sandstone-pillar', 0.9]] as const) {
    if (k.free(x, y, 4)) k.place(a, x, y, { scale: sc, rotation: x * 0.02 });
  }
  for (const line of [westCanyon, northCanyon, southCanyon]) {
    k.scatter(['rock-sandstone', 'rock-desert', 'rock-desert-large', 'stones'], line, { radius: 30, strength: 0.6, falloff: 0.3 }, { density: 1.2, minDistance: 7, scaleMin: 0.7, scaleMax: 1.5 });
  }
  // The plain: dune fields, scrub and cactus groves, stone litter, more rock towers on the horizon
  k.form('dunes', [{ x: 120, y: 230 }, { x: 230, y: 180 }], { radius: 60, strength: 0.7 }, 1);
  k.form('dunes', [{ x: -240, y: -110 }, { x: -200, y: -230 }], { radius: 55, strength: 0.7 }, 1);
  for (const [x, y] of [[-230, 120], [-60, 150], [130, 190], [230, -100], [-90, -200], [40, -230], [-240, -10], [200, 0]] as const) {
    k.paint('desert-cracked-red', { x, y }, { radius: 30, falloff: 1 }, 0.5);
    k.scatter(['desert-shrub', 'grass-tall-dry', 'succulent', 'cactus', 'cactus-tall', 'cactus-barrel', 'stones-desert-scatter'], { x: x + 20, y: y - 15 }, { radius: 34, strength: 1 }, { density: 5, minDistance: 3 });
  }
  for (const [x, y, a, sc] of [[-250, 230, 'sandstone-pillar-tall', 1.3], [250, 230, 'mesa', 0.9], [245, -240, 'sandstone-pillar-tall', 1.1], [-120, -240, 'rock-arch', 1.4], [60, 250, 'sandstone-pillar', 1.4], [-250, -250, 'mesa', 0.8]] as const) {
    k.place(a, x, y, { scale: sc, rotation: y * 0.01 });
  }
  k.scatter(['bones', 'bone-pile', 'cactus', 'tree-dead-pale'], [{ x: -120, y: -100 }, { x: 60, y: 60 }, { x: -40, y: 160 }], { radius: 50, strength: 0.6 }, { density: 0.6, minDistance: 12 });

  // Seven ground materials: the least used goes (each one is 8 MB of pixels to load)
  k.trimLayers(7);
  k.environment({ biome: 'desert', sky: 'day', sunAzimuth: 170, sunElevation: 68, fogDensity: 0.0006, tint: '#fff0dc' });
  return k.finish();
}
