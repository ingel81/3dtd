/**
 * Frost hamlet: a snowed-in village on the north shore of a frozen lake on
 * a winter evening, lamps lit, light snow falling. The road from the west
 * runs round the lake through the firs; a second way crosses the ice from
 * the south, past the ice fishers' huts. The shore and the village square
 * are the build ground.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { resample } from '../../../src/app/editor/ops/landscape/lines';
import { facing, LevelKit } from './kit';

export function buildFrostHamlet(): CustomMapDocument {
  const k = new LevelKit({
    id: 'frost-hamlet',
    name: 'Frost Hamlet',
    description: 'A snowed-in village by a frozen lake on a winter evening. One road runs round the lake, the other straight over the ice.',
    size: 512,
    base: 'snow-fresh',
    seed: 6606,
  });
  for (const m of ['snow-fresh', 'snow', 'snow-windswept', 'frozen-ground', 'snow-rocky', 'stone-path-grey', 'ice-cracked', 'gravel-light']) k.layer(m);
  k.cliffs('snow-rocky', 40);

  // ---- Ground: snowy hills round a lake basin
  for (let y = -300; y <= 300; y += 110) for (let x = -300; x <= 300; x += 110) k.level({ x, y }, { radius: 130, falloff: 0.4 }, 5);
  k.generate('hills', 66, 0.25, true);
  const lakeAt = { x: 15, y: 5 };
  const iceLevel = -0.5;
  k.level(lakeAt, { radius: 110, falloff: 0.35 }, -2.6);
  k.level({ x: -70, y: 30 }, { radius: 60, falloff: 0.5 }, -2.2);
  k.level({ x: 85, y: -35 }, { radius: 55, falloff: 0.5 }, -2.2);
  k.level({ x: 40, y: 75 }, { radius: 40, falloff: 0.5 }, -1.8);
  k.raise([{ x: -260, y: 200 }, { x: -120, y: 250 }, { x: 260, y: 230 }], { radius: 110, falloff: 1 }, 12);
  k.raise([{ x: 250, y: -200 }, { x: 180, y: -260 }], { radius: 90, falloff: 1 }, 9);
  // A peak over the ridge north of the village, a lower one to the north-west; a glacier in a trough down the high one's
  // south flank
  k.form('mountain', { x: 70, y: 248 }, { radius: 72, strength: 1 }, 3);
  k.form('mountain', { x: -150, y: 246 }, { radius: 60, strength: 0.8 }, 3);
  const glacier: MapPoint[] = [{ x: 72, y: 252 }, { x: 68, y: 226 }, { x: 64, y: 200 }];
  k.form('valley', glacier, { radius: 24, strength: 0.8 }, 2);
  // Rock bands across the long white slopes (south and east of the lake, west of the village)
  k.cliff([{ x: -230, y: -175 }, { x: -170, y: -190 }, { x: -120, y: -215 }], 4, 14);
  k.cliff([{ x: 230, y: -60 }, { x: 215, y: 10 }, { x: 225, y: 70 }], 5, 14);
  k.cliff([{ x: -180, y: 150 }, { x: -125, y: 175 }, { x: -95, y: 215 }], 5, 16);
  // The village terrace on the north shore
  const hq = { x: 20, y: 140 };
  k.level(hq, { radius: 60, falloff: 0.6 }, k.h(hq.x, hq.y));

  // ---- Ways: the road round the lake (lamps), the track over the ice
  const west = { x: -252, y: -60 };
  const south = { x: -10, y: -252 };
  k.road([west, { x: -170, y: -95 }, { x: -90, y: -120 }, { x: 10, y: -128 }, { x: 105, y: -100 }, { x: 150, y: -30 }, { x: 140, y: 60 }, { x: 95, y: 120 }, hq], { width: 8, surface: [], lamps: true });
  // The ice track: a hard-packed ridge just under the ice, so the enemies walk on its surface
  const track: MapPoint[] = [south, { x: -5, y: -170 }, { x: 0, y: -110 }, { x: 10, y: -30 }, { x: 18, y: 50 }, { x: 22, y: 112 }];
  for (const p of resample(track, 3)) if (k.h(p.x, p.y) < iceLevel) k.level(p, { radius: 7, falloff: 0.5 }, iceLevel - 0.04);
  k.path(track, 6, 'path', 6);
  k.path([track[track.length - 1], hq], 6, 'path', 6);
  k.spawn('West Road', west.x, west.y);
  k.spawn('South Ice', south.x, south.y);
  k.hq(hq.x, hq.y);
  const ice = k.water(iceLevel, 'ice');
  k.fill(lakeAt, ice);

  // ---- Snow, firs, rocks; frozen ground and gravel round the village
  k.biome('snow', [{ x: -230, y: 60 }, { x: -200, y: 200 }, { x: -60, y: 230 }], { radius: 70, strength: 0.9 });
  k.biome('snow', [{ x: 230, y: 40 }, { x: 220, y: 200 }, { x: 110, y: 230 }], { radius: 70, strength: 0.9 });
  k.biome('snow', [{ x: -220, y: -200 }, { x: -100, y: -220 }, { x: 120, y: -220 }, { x: 230, y: -150 }], { radius: 55, strength: 0.8 });
  k.biome('snow', [{ x: -150, y: -20 }, { x: 200, y: -60 }], { radius: 40, strength: 0.5 });
  k.paint('snow-windswept', [{ x: -150, y: 180 }, { x: 150, y: 200 }], { radius: 80, falloff: 1 }, 0.4);
  k.paint('frozen-ground', hq, { radius: 30, falloff: 1 }, 0.25);
  k.paint('gravel-light', hq, { radius: 18, falloff: 0.8 }, 0.6);
  k.paint('ice-cracked', lakeAt, { radius: 110, falloff: 0.3 }, 0.3);
  // The glacier's ice in its trough, fresh snow on its flanks
  k.paint('ice-cracked', glacier, { radius: 13, falloff: 0.7 }, 0.9);
  k.paint('snow-fresh', glacier, { radius: 26, falloff: 0.4 }, 0.5);
  // Tracks in the snow between the houses: trodden paths, the sled runs to the woodpiles and down to the ice
  for (const line of [
    [{ x: -22, y: 160 }, { x: 0, y: 150 }, { x: 20, y: 140 }],
    [{ x: -30, y: 128 }, { x: -6, y: 126 }, { x: 20, y: 140 }],
    [{ x: 62, y: 164 }, { x: 46, y: 150 }, { x: 20, y: 140 }],
    [{ x: 20, y: 185 }, { x: 20, y: 160 }],
    [{ x: 100, y: 150 }, { x: 86, y: 112 }, { x: 66, y: 106 }],
    [{ x: -62, y: 150 }, { x: -40, y: 172 }, { x: -22, y: 160 }],
    [{ x: 38, y: 120 }, { x: 30, y: 80 }, { x: 40, y: 30 }],
  ]) {
    k.paint('frozen-ground', line, { radius: 1.6, falloff: 0.6 }, 0.7);
  }

  // ---- The village: snowed houses round the square, chapel, barn, woodpiles, sleds, fences
  const houses: [number, number, string][] = [
    [-22, 160, 'house-snow'],
    [-30, 128, 'house-stone-snow'],
    [62, 164, 'house-snow'],
    [66, 106, 'log-cabin-snow'],
    [20, 185, 'chapel'],
    [-62, 150, 'barn-snow'],
    [100, 150, 'log-cabin-snow'],
    [-55, 110, 'house-stone-snow'],
  ];
  for (const [x, y, a] of houses) {
    const house = k.place(a, x, y, { rotation: facing({ x, y }, hq) });
    if (a !== 'chapel' && a !== 'barn-snow') k.chimney(house);
  }
  for (const [x, y, a, r] of [
    [-6, 126, 'woodpile-snow', 0.3],
    [46, 150, 'woodpile-snow', 1.9],
    [-40, 172, 'sled', 2.2],
    [38, 120, 'sled', 0.6],
    [0, 162, 'well', 0],
    [-10, 110, 'shrine', 3.1],
    [86, 112, 'woodpile-snow', 2.6],
  ] as const) {
    k.place(a, x, y, { rotation: r });
  }
  k.row('fence-picket', [{ x: -90, y: 120 }, { x: -85, y: 170 }, { x: -50, y: 195 }], 3.6, { turn: Math.PI / 2 });
  k.row('fence-picket', [{ x: 120, y: 125 }, { x: 125, y: 170 }, { x: 90, y: 195 }], 3.6, { turn: Math.PI / 2 });
  for (const [x, y] of [[-12, 140], [52, 140], [20, 172], [-40, 140], [80, 130], [-8, 176], [44, 176]] as const) if (k.free(x, y, 1)) k.place('lamp-post', x, y);
  // The square's fire and lanterns by the doors
  k.place('campfire', 34, 128);
  for (const [x, y] of [[-16, 154], [-24, 122], [56, 158], [60, 101], [94, 145]] as const) if (k.free(x, y, 0.5)) k.place('lantern', x, y);
  // TODO(E179): sled dogs beside the sleds

  // ---- On the ice: fishers' huts and holes, a sled, skates of snow
  for (const [x, y, r] of [[-40, 30, 0.4], [60, -20, 2.1], [-20, -40, 1.2], [70, 50, 2.8], [-60, -10, 0.9]] as const) {
    k.place('ice-fishing-hut', x, y, { rotation: r, z: iceLevel - k.h(x, y) });
  }
  for (const [x, y] of [[-34, 26], [66, -16], [-12, -46]] as const) k.place('campfire-out', x, y, { z: iceLevel - k.h(x, y) });
  k.place('sled', 40, 30, { rotation: 1, z: iceLevel - k.h(40, 30) });
  // Fir groves on the shores and behind the village
  k.scatter(['tree-fir-snow', 'tree-pine-snow', 'tree-fir-young-snow'], [{ x: -120, y: 80 }, { x: -110, y: -40 }, { x: 150, y: 110 }, { x: 190, y: -90 }, { x: -190, y: -150 }, { x: -200, y: 120 }, { x: 210, y: 160 }], { radius: 28, strength: 0.9 }, { density: 4, minDistance: 5, scaleMin: 0.8, scaleMax: 1.3 });
  // Snow drifts and icicled rocks along the shore
  k.scatter(['snow-drift-mound', 'rock-snow', 'grass-snow'], [{ x: -90, y: 60 }, { x: -100, y: -50 }, { x: 110, y: 30 }, { x: 90, y: -80 }], { radius: 30, strength: 0.7 }, { density: 2, minDistance: 6 });
  // The long white slopes broken up: spruce groups, drifts and rocks, fences across the fields
  k.scatter(['tree-fir-snow', 'tree-pine-snow', 'tree-fir-young-snow'], [{ x: -200, y: -60 }, { x: -60, y: -205 }, { x: 80, y: -200 }, { x: 205, y: 20 }, { x: -230, y: 200 }, { x: 130, y: -150 }, { x: -150, y: -140 }], { radius: 16, strength: 0.9 }, { density: 5, minDistance: 4.5, scaleMin: 0.7, scaleMax: 1.3 });
  k.scatter(['snow-drift-mound', 'rock-snow', 'boulder'], [{ x: -170, y: -100 }, { x: 160, y: -60 }, { x: -60, y: -160 }, { x: 60, y: -170 }, { x: 180, y: 80 }, { x: -200, y: 100 }], { radius: 26, strength: 0.6 }, { density: 1.5, minDistance: 7 });
  k.row('fence-rail', [{ x: -230, y: 20 }, { x: -180, y: 30 }, { x: -150, y: 60 }], 3.8, { turn: Math.PI / 2 });
  k.row('fence-rail', [{ x: 160, y: -200 }, { x: 200, y: -170 }, { x: 240, y: -160 }], 3.8, { turn: Math.PI / 2 });
  k.row('fence-picket', [{ x: 130, y: 180 }, { x: 170, y: 170 }, { x: 200, y: 140 }], 3.6, { turn: Math.PI / 2 });
  // Rock walls on the peaks' steep flanks and on the rock bands, icicles hanging off the band west of the village
  k.cliffRocks([{ x: 70, y: 230 }, { x: -150, y: 232 }], { radius: 40 });
  k.cliffRocks([{ x: -230, y: -175 }, { x: -170, y: -190 }, { x: -120, y: -215 }], { radius: 10 });
  k.cliffRocks([{ x: 230, y: -60 }, { x: 215, y: 10 }, { x: 225, y: 70 }], { radius: 10 });
  k.cliffRocks([{ x: -180, y: 150 }, { x: -125, y: 175 }, { x: -95, y: 215 }], { radius: 10 });
  for (const p of resample([{ x: -176, y: 152 }, { x: -125, y: 177 }, { x: -97, y: 213 }], 9)) k.place('icicles', p.x, p.y, { rotation: facing(p, hq) });
  // The glacier dressed: seracs where it breaks over the steep part, old snowfields on the peaks' flanks; the trough
  // cleared of trees and rocks first. The glacier model as its tongue stood out of the trough as a pale blob, tilted or
  // sunk: the trough's ice and the seracs carry it
  for (const p of resample(glacier, 6)) k.erase(p, 14);
  for (const [x, y, sc] of [[70, 240, 1], [64, 232, 0.8], [74, 228, 0.9], [69, 221, 0.7]] as const) k.place('seracs', x, y, { rotation: x * 0.3, scale: sc, align: true });
  for (const [x, y, r, sc] of [[30, 232, 0.4, 1], [96, 214, 0.9, 1], [-60, 238, 2.5, 0.8]] as const) k.place('snowfield', x, y, { rotation: r, scale: sc, align: true });
  // The bell tower over the village square, the village's landmark beside the chapel
  if (k.free(-8, 190, 3)) k.place('bell-tower-snow', -8, 190, { rotation: facing({ x: -8, y: 190 }, hq) });
  for (const [x, y] of [[-200, 0], [200, 120], [-120, 210], [150, -180], [0, 230]] as const) k.place('fx-snow', x, y, { scale: 1.3 });

  // ---- Life: ravens over the village and the wood west of it, ice fog drifting low over the lake, smoke from every
  // house (their chimneys); the wind over the snow, the fire crackling on the square
  // TODO(E190): ravens (birds of the crow species), snow flurries along the ridges, the bell at each wave
  k.lifeArea('birds', [{ x: -70, y: 110 }, { x: 110, y: 110 }, { x: 110, y: 200 }, { x: -70, y: 200 }], { height: 22, density: 0.7 });
  k.lifeArea('birds', [{ x: -150, y: 60 }, { x: -90, y: 60 }, { x: -90, y: 110 }, { x: -150, y: 110 }], { height: 18, density: 0.5 });
  k.lifeArea('fog', [{ x: -80, y: -60 }, { x: 60, y: -90 }, { x: 110, y: -30 }, { x: 70, y: 70 }, { x: -60, y: 60 }], { density: 0.6, quality: 'high' });
  k.lifeArea('sound', [{ x: 26, y: 120 }, { x: 42, y: 120 }, { x: 42, y: 136 }, { x: 26, y: 136 }], { sound: 'fire', volume: 0.5 });
  k.lifeSettings({ ambience: { sound: 'biome', volume: 0.5 } });

  // Seven ground materials: the least used goes (each one is 8 MB of pixels to load)
  k.trimLayers(7);
  k.environment({ biome: 'arctic', sky: 'dusk', sunAzimuth: 250, sunElevation: 20, fogDensity: 0.0009, tint: '#e6ecff', weather: 'snow', weatherStrength: 0.25 });
  return k.finish();
}
