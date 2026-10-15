/**
 * Archipelago: five islands in a clear sea, joined by wooden bridges and a
 * ford over a sandbar. The HQ stands on the main island above a harbour with
 * a quay, a crane, fishers' huts and boats; a lighthouse on the eastern
 * rock. Enemies cross from the west and the north over two chains of
 * bridges; the bridgeheads on the islands are the places to build.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

export function buildArchipelago(): CustomMapDocument {
  const k = new LevelKit({
    id: 'archipelago',
    name: 'Archipelago',
    description: 'Five islands in a clear sea, linked by wooden bridges and a ford. A harbour with a quay, crane and lighthouse below the HQ.',
    size: 512,
    base: 'grass',
    seed: 5505,
  });
  for (const m of ['grass', 'grass-lush', 'sand-coast', 'sand', 'rocky-ground', 'pebbles', 'cobblestone-grey', 'grass-dry']) k.layer(m);
  // Rock on the cliffs, grey with lichen as the coast's cliff rocks (tidal gravel read as earth on a wall)
  k.cliffs('rock-mossy', 36);

  // ---- Sea floor and islands
  for (let y = -300; y <= 300; y += 110) for (let x = -300; x <= 300; x += 110) k.level({ x, y }, { radius: 130, falloff: 0.4 }, -7);
  const islands: { at: MapPoint; r: number; h: number }[] = [
    { at: { x: 55, y: -60 }, r: 100, h: 5 },
    { at: { x: -200, y: 70 }, r: 56, h: 4 },
    { at: { x: -105, y: 10 }, r: 42, h: 3.5 },
    { at: { x: -50, y: 210 }, r: 50, h: 4 },
    { at: { x: 50, y: 120 }, r: 40, h: 3.5 },
    { at: { x: 205, y: 85 }, r: 38, h: 9 },
    { at: { x: -200, y: -180 }, r: 34, h: 3 },
  ];
  for (const [n, isl] of islands.entries()) {
    k.raise(isl.at, { radius: isl.r * 0.9, falloff: 0.45 }, isl.h + 7);
    for (let l = 0; l < 4; l++) {
      const a = k.noise.hash(n, l, 5) * Math.PI * 2;
      const d = isl.r * (0.45 + 0.3 * k.noise.hash(n, l, 6));
      k.plateau({ x: isl.at.x + Math.cos(a) * d, y: isl.at.y + Math.sin(a) * d }, { radius: isl.r * 0.45, falloff: 0.8 }, isl.h * (0.6 + 0.4 * k.noise.hash(n, l, 7)), 0.5);
    }
    k.roughen(isl.at, { radius: isl.r * 1.1, falloff: 0.8 }, 1.2, 50 + n);
  }
  // Rocky crown of the lighthouse island, a cove for the harbour on the main island's south side
  k.form('mountain', islands[5].at, { radius: 34, strength: 0.6 }, 2);
  // The harbour: deep water dredged right up to the south shore of the main island
  let shoreY = -60;
  while (k.h(70, shoreY) > 0.3) shoreY -= 1;
  const harbour = { x: 70, y: shoreY - 28 };
  k.level(harbour, { radius: 30, falloff: 0.5 }, -4);
  // The sandbar of the ford between the north islands
  k.level([{ x: -18, y: 165 }, { x: 30, y: 135 }], { radius: 9, falloff: 0.6 }, -0.25);
  const sea = k.water(0, 'sea', '#1d5a72');
  k.sea(sea);

  // ---- Walks: bridges over the sound, the ford, paths over the islands
  const hq = { x: 70, y: -75 };
  const west = { x: -238, y: 72 };
  const north = { x: -60, y: 238 };
  k.walk([west, { x: -200, y: 95 }, { x: -165, y: 75 }, { x: -95, y: 22 }, { x: -20, y: -10 }, { x: 30, y: -50 }, hq], { width: 6, bridgeWidth: 5, wetBelow: 0.6 });
  k.walk([north, { x: -35, y: 195 }, { x: -18, y: 165 }], { width: 6, bridgeWidth: 5, wetBelow: 0.6 });
  k.path([{ x: -18, y: 165 }, { x: 30, y: 135 }], 6, 'path', 3);
  k.walk([{ x: 30, y: 135 }, { x: 55, y: 110 }, { x: 70, y: 50 }, { x: 72, y: -10 }, hq], { width: 6, bridgeWidth: 5, wetBelow: 0.6 });
  k.spawn('West Isle', west.x, west.y);
  k.spawn('North Isle', north.x, north.y);
  k.hq(hq.x, hq.y);

  // ---- Rocky coasts on the weather sides, away from the bridges, beaches and the harbour: cliffs over the sea,
  // cliff rocks on their faces, stones in the surf. The lighthouse rock all round but for a landing to the west
  const deg = Math.PI / 180;
  // Small islands take smaller cliff pieces: the long coastal wall drew their round shores as polygons. One look
  // a coast: the grey pieces beside the mossy coastal cliff read as rocks thrown together
  const small = ['cliff-wall-b', 'cliff-wall', 'cliff-face', 'cliff-face-b'];
  const coasts: { at: MapPoint; from: number; to: number; top: number; rocks?: string[] }[] = [
    { at: islands[0].at, from: -35, to: 55, top: 7 },
    { at: islands[1].at, from: 45, to: 140, top: 6, rocks: small },
    { at: islands[2].at, from: 205, to: 330, top: 5, rocks: small },
    { at: islands[3].at, from: 120, to: 235, top: 6, rocks: small },
    { at: islands[4].at, from: -70, to: 45, top: 5, rocks: small },
    { at: islands[5].at, from: -160, to: 160, top: 12, rocks: small },
    { at: islands[6].at, from: 190, to: 345, top: 5, rocks: small },
  ];
  const coastLines = coasts.map((c) => k.shoreAround(c.at, c.from * deg, c.to * deg));
  for (const [n, c] of coasts.entries()) k.rockyCoast(coastLines[n], { land: 'left', top: c.top, bed: -4, rocks: c.rocks });
  // The lighthouse rock's crown: rock walls on its steep flanks, not a painted slope
  k.cliffRocks(islands[5].at, { radius: 30 });
  // Sea stacks out at the edges of the sound: towers of rock standing in the open water, alone or in twos and threes,
  // their sides in the coast's cliff rocks; depth before the horizon, away from the walks, the boats and the ships
  for (const [n, [x, y, h]] of ([[215, 205, 24], [236, 178, 14], [232, -140, 20], [-236, -62, 22], [-222, -42, 12], [140, -232, 18], [-60, -236, 15]] as const).entries()) {
    const at = { x, y };
    // Raised from the sea floor (-7 m) to a ragged top, narrowing as it rises
    k.raise(at, { radius: 9 + h * 0.35, falloff: 0.75 }, h + 7);
    k.roughen(at, { radius: 14, falloff: 0.7 }, 3, 90 + n);
    k.cliffRocks(at, { radius: 14 }, 'cliff-coast');
  }
  // A sandbank in the open water south of the middle isle, a wreck stranded on it
  const bank = { x: -140, y: -95 };
  k.level([bank, { x: bank.x + 22, y: bank.y - 8 }], { radius: 22, falloff: 0.4 }, 0.6);
  k.roughen(bank, { radius: 24, falloff: 0.8 }, 0.5, 77);
  k.sea(sea);

  // ---- Ground: beaches below 1.5 m, rock on the steep shores, grass above
  k.autoPaint([
    { material: 'grass', minSlope: 0, maxSlope: 90, minHeight: -Infinity, maxHeight: Infinity, blend: 2 },
    { material: 'grass-lush', minSlope: 0, maxSlope: 25, minHeight: 6, maxHeight: Infinity, blend: 2 },
    { material: 'sand-coast', minSlope: 0, maxSlope: 30, minHeight: -Infinity, maxHeight: 1.8, blend: 0.8 },
    { material: 'sand', minSlope: 0, maxSlope: 30, minHeight: 0.4, maxHeight: 1.4, blend: 0.6 },
    { material: 'pebbles', minSlope: 0, maxSlope: 60, minHeight: -Infinity, maxHeight: -0.6, blend: 0.6 },
    { material: 'rocky-ground', minSlope: 26, maxSlope: 90, minHeight: -Infinity, maxHeight: Infinity, blend: 5 },
  ]);
  k.biome('meadow', [{ x: 80, y: -20 }, { x: 0, y: -60 }, { x: -90, y: 20 }, { x: -190, y: 60 }, { x: 55, y: 115 }, { x: -40, y: 205 }], { radius: 45, strength: 0.7 });
  k.biome('forest', [{ x: 110, y: 0 }, { x: 120, y: -60 }], { radius: 32, strength: 0.8 });
  k.biome('conifer', [{ x: -205, y: 85 }, { x: -60, y: 225 }], { radius: 26, strength: 0.7 });
  // Beaches on the sheltered shores, after the other biomes (they would paint over them): the main island's west side toward the sound, the west isle's south, the
  // small south-west isle (sand down to the water, the wet strip, driftwood, dune grass, shore pines)
  k.biome('beach', [{ x: 12, y: -110 }, { x: 8, y: -85 }, { x: 8, y: -60 }], { radius: 44, strength: 1 }, 1);
  k.biome('beach', { x: -200, y: 16 }, { radius: 22, strength: 1 }, 1);
  k.biome('beach', { x: -200, y: -150 }, { radius: 20, strength: 1 }, 1);
  // The meadow's flowers and tufts, painted before, stay off the new strands (up to 2.2 m over the sea)
  const meadowPlants = new Set(['flowers', 'flowers-blue', 'flowers-yellow', 'periwinkle', 'grass-green', 'grass-clump', 'bush', 'shrub', 'shrub-wide']);
  for (const [at, r] of [[{ x: 12, y: -110 }, 44], [{ x: 8, y: -85 }, 44], [{ x: 8, y: -60 }, 44], [{ x: -200, y: 16 }, 22], [{ x: -200, y: -150 }, 20]] as const) {
    k.erase(at, r, (o) => !meadowPlants.has(o.asset) || k.h(o.x, o.y) > 2.2);
  }
  // The biomes' relief sank some of the shore under the sea's level beside its mask: the sea runs in there again
  k.sea(sea);
  k.scatter(['tree-oak', 'tree-birch', 'tree-maple', 'shrub-wide'], [{ x: 0, y: -100 }, { x: 120, y: -90 }, { x: 15, y: 0 }, { x: 125, y: 20 }], { radius: 26, strength: 0.8 }, { density: 3.5, minDistance: 5 });
  k.scatter(['tree-pine', 'tree-fir'], [{ x: -230, y: 50 }, { x: -120, y: -5 }, { x: 30, y: 135 }], { radius: 20, strength: 0.8 }, { density: 4, minDistance: 4.5 });
  k.scatter(['flowers', 'flowers-yellow', 'flowers-blue', 'grass-clump'], [{ x: 60, y: -40 }, { x: -200, y: 60 }, { x: -50, y: 205 }, { x: -105, y: 15 }], { radius: 40, strength: 1 }, { density: 12, minDistance: 1.5 });
  k.scatter(['tree-pine', 'tree-oak', 'shrub-wide', 'shrub'], [{ x: -95, y: 35 }, { x: 65, y: 125 }, { x: -200, y: -180 }, { x: -20, y: 210 }], { radius: 22, strength: 0.7 }, { density: 3, minDistance: 5 });
  // Round stones and boulders only: the flat coastal slab (rock-coast, up to 24 m across) stuck out level from the
  // steep flanks as plates over the water
  k.scatter(['rock-round', 'boulder'], [{ x: 235, y: 70 }, { x: 180, y: 110 }, { x: -235, y: -170 }, { x: 140, y: -110 }], { radius: 20, strength: 0.8 }, { density: 0.8, minDistance: 10, scaleMin: 0.4, scaleMax: 0.9 }, false);
  k.scatter(['grass-tall-dry', 'iceplant', 'flowers-yellow'], [{ x: -10, y: -130 }, { x: -140, y: 40 }, { x: 10, y: 160 }], { radius: 30, strength: 0.8 }, { density: 8, minDistance: 2 });

  // ---- Harbour: quay along the cove, crane, huts, boats; lighthouse on the east rock
  const quayLine: MapPoint[] = [{ x: 50, y: shoreY + 1 }, { x: 90, y: shoreY + 1 }];
  for (const q of k.row('harbor-quay', quayLine, 8, { turn: Math.PI / 2 })) q.rotation = Math.round((q.rotation + Math.PI) * 1000) / 1000;
  k.place('harbor-crane', 66, shoreY + 6, { rotation: Math.PI });
  for (const [x, y] of [[36, shoreY + 10], [104, shoreY + 10]] as const) k.place('fisher-hut', x, y, { rotation: facing({ x, y }, harbour) });
  for (const [x, y, a] of [[54, 6, 'crate'], [82, 6, 'barrel-small'], [86, 5, 'crate-long'], [48, 9, 'trade-goods'], [76, 8, 'barrels-broken']] as const) k.place(a, x, shoreY + y, { rotation: x });
  // Boats and buoys float: their z counts from the waterline, not from the sea floor
  k.place('fishing-boat', 72, shoreY - 16, { rotation: 1.4, z: -0.4 });
  for (const [x, y, r] of [[52, shoreY - 10, 0.3], [92, shoreY - 12, 2.4]] as const) k.place('rowboat', x, y, { rotation: r });
  for (const [x, y, a] of [[48, shoreY - 50, 'buoy-red'], [96, shoreY - 50, 'buoy-green']] as const) k.place(a, x, y);
  k.place('jetty', -150, 30, { rotation: 0.4, z: 0 });
  // The wreck on the sandbank, heeled over, its cargo strewn on the sand
  k.erase({ x: bank.x + 11, y: bank.y - 4 }, 28);
  k.place('shipwreck', bank.x + 11, bank.y - 4, { rotation: 1.9 });
  for (const [dx, dy, a] of [[-4, 4, 'barrels-broken'], [3, 6, 'crate'], [16, -6, 'barrel-old'], [-6, -2, 'crate-flat']] as const) k.place(a, bank.x + dx, bank.y + dy, { rotation: dx });
  // Ships out at sea as a backdrop
  k.place('ship', 175, -215, { rotation: 1.1 });
  k.place('ship', -215, 215, { rotation: -0.6, scale: 0.8 });
  k.row('wall-dry-stone', [{ x: 20, y: -20 }, { x: 40, y: 5 }, { x: 80, y: 15 }], 5.4, { turn: Math.PI / 2 });
  k.row('fence-rail', [{ x: 100, y: -55 }, { x: 125, y: -60 }, { x: 140, y: -40 }], 3.8, { turn: Math.PI / 2 });
  const light = islands[5].at;
  k.place('lighthouse', light.x + 6, light.y - 4, { rotation: 0 });
  // The keeper's house on a terrace of its own: on the crown's slope it stood half sunk into the hill
  const keeper = { x: light.x - 12, y: light.y - 14 };
  k.level(keeper, { radius: 9, falloff: 0.5 }, k.h(keeper.x, keeper.y));
  k.place('house-stone', keeper.x, keeper.y, { rotation: facing(keeper, hq) });
  // A small village round the HQ
  for (const [x, y, a] of [[30, -40, 'cottage'], [104, -78, 'house'], [36, -96, 'cottage'], [108, -40, 'house-stone']] as const) {
    k.chimney(k.place(a, x, y, { rotation: facing({ x, y }, hq) }));
  }
  // The windmill on the east rise (it stood off the shore in the sea before), the wood cleared round it
  k.erase({ x: 96, y: -14 }, 9);
  k.place('windmill', 96, -14, { rotation: 0.7 });
  k.place('well', 52, -62);

  // ---- Life: gulls round the lighthouse rock, over the harbour and the wreck; rowing boats drifting in the harbour,
  // a fishing boat going out round the main island and back; the surf on the rocky coasts, birdsong on the islands
  // TODO(E190): surf spray on the rocks
  const ring = (at: MapPoint, r: number): MapPoint[] => Array.from({ length: 8 }, (_, i) => ({ x: at.x + Math.cos((i / 8) * Math.PI * 2) * r, y: at.y + Math.sin((i / 8) * Math.PI * 2) * r }));
  k.lifeArea('birds', ring(islands[5].at, 60), { species: 'gulls', height: 30, density: 1.2 });
  k.lifeArea('birds', ring(harbour, 45), { species: 'gulls', height: 22 });
  k.lifeArea('birds', ring({ x: bank.x + 11, y: bank.y - 4 }, 40), { species: 'gulls', height: 20, density: 0.6 });
  k.lifeArea('boats', ring(harbour, 18), { density: 0.5 });
  k.lifeRoute('boats', [{ x: harbour.x + 20, y: harbour.y - 14 }, { x: 160, y: -150 }, { x: 175, y: -60 }, { x: 255, y: -10 }], { asset: 'fishing-boat' });
  for (const n of [0, 1, 5, 6]) k.lifeRoute('sound', coastLines[n], { sound: 'surf', volume: n === 5 ? 0.8 : 0.6 });
  // Gull calls where the gulls wheel: the lighthouse rock and the harbour
  k.lifeArea('sound', ring(islands[5].at, 50), { sound: 'gulls', volume: 0.5 });
  k.lifeArea('sound', ring(harbour, 35), { sound: 'gulls', volume: 0.45 });
  k.lifeSettings({ ambience: { sound: 'biome', volume: 0.45 } });

  k.clearRoads();
  k.environment({ biome: 'temperate', sky: 'day', sunAzimuth: 150, sunElevation: 50, fogDensity: 0.0004, tint: '#fbfdff' });
  return k.finish();
}
