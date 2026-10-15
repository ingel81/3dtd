/**
 * Mountain pass: a road winds in hairpins from a meadow valley up to a pass
 * between two peaks, where the HQ stands in a stone village with a chapel.
 * A waterfall drops from a cliff into a mountain lake; its stream runs down
 * the valley under a stone bridge. A cable car climbs from the valley to
 * the village. Two spawns in the valley meet at the first hairpin.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { pointAt, polylineLength } from '../../../src/app/editor/ops/path-graph';
import { undersideGap } from '../../../src/app/editor/ops/object-ops';
import { facing, LevelKit } from './kit';

export function buildMountainPass(): CustomMapDocument {
  const k = new LevelKit({
    id: 'mountain-pass',
    name: 'Mountain Pass',
    description: 'Hairpins up to a stone village on the pass, a waterfall into a mountain lake, a cable car over the valley. Two spawns meet at the first bend.',
    size: 512,
    base: 'grass',
    seed: 1101,
  });

  // Ground layers first, so every brush paints into this palette
  for (const m of ['grass', 'grass-lush', 'forest-ground', 'rocky-ground', 'scree', 'snow-fresh', 'alpine-meadow-rocks', 'cobblestone']) k.layer(m);
  k.cliffs('limestone', 50);

  // ---- Ground: the valley floor in the south, a steep face to the pass, ridges and two peaks
  k.generate('hills', 11, 0.22);
  k.raise([{ x: -340, y: 175 }, { x: 340, y: 175 }], { radius: 200, falloff: 1 }, 30);
  k.raise([{ x: -340, y: 10 }, { x: 340, y: 10 }], { radius: 170, falloff: 1 }, 14);
  // Ridges toward the saddle, then the two peaks; the mountain brush grows ridged rock, smoothing takes off its crumple
  k.form('mountain', [{ x: -270, y: 80 }, { x: -170, y: 150 }, { x: -90, y: 225 }], { radius: 90, strength: 0.8 }, 2);
  k.form('mountain', [{ x: 270, y: 60 }, { x: 180, y: 140 }, { x: 100, y: 225 }], { radius: 90, strength: 0.8 }, 2);
  k.form('mountain', { x: -175, y: 178 }, { radius: 160, strength: 1 }, 6);
  k.form('mountain', { x: 182, y: 172 }, { radius: 150, strength: 1 }, 6);
  k.smooth([{ x: -175, y: 178 }, { x: 182, y: 172 }], { radius: 170, falloff: 0.7 }, 4);
  // Rain cuts gullies down the flanks; rock bands step the faces below the summits
  k.erode([{ x: -240, y: 70 }, { x: -175, y: 150 }, { x: -110, y: 210 }], { radius: 60, strength: 1 }, 10);
  k.erode([{ x: 240, y: 60 }, { x: 182, y: 140 }, { x: 115, y: 210 }], { radius: 60, strength: 1 }, 10);
  for (const [cx, cy, r0, h] of [[-175, 178, 70, 7], [-175, 178, 110, 6], [182, 172, 65, 7], [182, 172, 105, 6]] as const) {
    // An arc of cliff edge facing the valley: the ground inside (uphill) steps up
    const arc: MapPoint[] = [];
    for (let a = -150; a <= -30; a += 15) arc.push({ x: cx + Math.cos((a * Math.PI) / 180) * r0, y: cy + Math.sin((a * Math.PI) / 180) * r0 });
    k.cliff(arc, h, 9);
  }
  // The cliff the waterfall drops over, north of the lake
  k.cliff([{ x: 95, y: 18 }, { x: 150, y: 8 }, { x: 225, y: 0 }], 16, 26);
  // The pass: a broad level shoulder for the village
  const pass = { x: 10, y: 95 };
  k.level(pass, { radius: 55, falloff: 0.6 }, k.h(pass.x, pass.y));

  // ---- Roads: two valley roads to the first bend, then two hairpins up to the pass
  const arc = (cx: number, cy: number, r: number, from: number, to: number): MapPoint[] =>
    Array.from({ length: 7 }, (_, i) => {
      const a = ((from + ((to - from) * i) / 6) * Math.PI) / 180;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
  const bend = { x: 0, y: -150 };
  const west = { x: -165, y: -228 };
  const east = { x: 175, y: -218 };
  k.road([west, { x: -110, y: -214 }, { x: -50, y: -180 }, bend], { width: 8, surface: [], lamps: false });
  k.road([east, { x: 120, y: -205 }, { x: 55, y: -178 }, bend], { width: 8, surface: [], lamps: false });
  const hairpins: MapPoint[] = [
    bend,
    { x: 40, y: -138 },
    ...arc(85, -105, 22, -90, 90),
    { x: 40, y: -80 },
    { x: -40, y: -60 },
    ...arc(-85, -32, 22, 270, 90),
    { x: -40, y: -8 },
    { x: 20, y: 18 },
    { x: 30, y: 50 },
    pass,
  ];
  k.road(hairpins, { width: 8, surface: [], lamps: false, snap: 4 });
  k.spawn('Valley West', west.x, west.y);
  k.spawn('Valley East', east.x, east.y);
  k.hq(pass.x, pass.y);

  // ---- Water: the stream falls over the cliff into the lake and runs on down the valley, under the east road
  const lakeAt = { x: 158, y: -30 };
  const lakeLevel = Math.round(k.h(lakeAt.x, lakeAt.y - 20) * 10) / 10;
  k.level(lakeAt, { radius: 42, falloff: 0.6 }, lakeLevel + 0.6);
  // A body of its own: the main water's level would lift every bridge deck on the map to it
  const lake = k.body(lakeLevel, 'water', '#2c5a66');
  k.lake(lakeAt, { radius: 30, falloff: 0.8 }, 3.5, lake);
  k.river([{ x: 176, y: 40 }, { x: 166, y: 18 }, { x: 160, y: 2 }, { x: 157, y: -14 }], { width: 7, depth: 1.5, bank: 6 });
  k.river([{ x: 150, y: -60 }, { x: 142, y: -110 }, { x: 125, y: -160 }, { x: 115, y: -205 }, { x: 108, y: -262 }], { width: 9, depth: 2, bank: 8 });
  // The road crosses the stream on a stone bridge
  k.bridgeStyle('stone');


  // ---- Land: meadows in the valley, pine woods on the flanks, scree and bare limestone above
  k.biome('meadow', [{ x: -250, y: -205 }, { x: 0, y: -215 }, { x: 250, y: -205 }], { radius: 70, strength: 0.9 });
  k.biome('meadow', [{ x: -60, y: -120 }, { x: 60, y: -90 }, { x: -50, y: -20 }, { x: 40, y: 40 }], { radius: 55, strength: 1 });
  k.biome('conifer', [{ x: -250, y: -150 }, { x: -200, y: -80 }, { x: -160, y: 0 }, { x: -130, y: 60 }], { radius: 60, strength: 0.9 });
  k.biome('conifer', [{ x: 250, y: -150 }, { x: 220, y: -90 }, { x: 240, y: -20 }], { radius: 50, strength: 0.8 });
  k.biome('mountains', [{ x: -256, y: 60 }, { x: -170, y: 130 }, { x: -110, y: 200 }, { x: -60, y: 256 }], { radius: 80, strength: 0.15 });
  k.biome('mountains', [{ x: 256, y: 50 }, { x: 180, y: 120 }, { x: 110, y: 200 }, { x: 70, y: 256 }], { radius: 80, strength: 0.15 });
  k.paint('rocky-ground', [{ x: -250, y: 120 }, { x: -175, y: 178 }, { x: -100, y: 230 }], { radius: 60, falloff: 0.9 }, 0.5);
  k.paint('rocky-ground', [{ x: 250, y: 110 }, { x: 182, y: 172 }, { x: 100, y: 230 }], { radius: 60, falloff: 0.9 }, 0.5);
  k.paint('scree', [{ x: -250, y: 70 }, { x: -150, y: 95 }, { x: -95, y: 140 }], { radius: 30, falloff: 1 }, 0.6);
  k.paint('scree', [{ x: 245, y: 60 }, { x: 150, y: 90 }, { x: 95, y: 140 }], { radius: 30, falloff: 1 }, 0.6);
  k.paint('cobblestone', pass, { radius: 26, falloff: 0.8 }, 0.7);
  // Alpine meadow strewn with rocks on the high pastures below the peaks
  k.paint('alpine-meadow-rocks', [{ x: -210, y: 30 }, { x: -130, y: 80 }, { x: -70, y: 150 }], { radius: 55, falloff: 1 }, 0.5);
  k.paint('alpine-meadow-rocks', [{ x: 210, y: 25 }, { x: 140, y: 75 }, { x: 80, y: 150 }], { radius: 55, falloff: 1 }, 0.5);
  // Snow on the summits, scree fans at the feet of the faces
  for (const peak of [{ x: -175, y: 178 }, { x: 182, y: 172 }]) {
    k.paint('snow-fresh', peak, { radius: 70, falloff: 0.6 }, 1);
    k.biome('snow', peak, { radius: 45, strength: 0.5 }, 0.3);
  }
  k.scatter(['scree-scatter', 'scree-scatter', 'rock-granite', 'rock-granite-flat'], [{ x: -240, y: 40 }, { x: -160, y: 110 }, { x: -125, y: 175 }, { x: 240, y: 30 }, { x: 160, y: 105 }, { x: 125, y: 180 }], { radius: 30, strength: 1 }, { density: 2.5, minDistance: 6, scaleMin: 0.8, scaleMax: 1.6 });
  // Mountain meadow: blue and white flowers between the bends and in the valley
  k.scatter(['flowers-blue', 'flowers', 'grass-green', 'flowers-yellow'], [{ x: -60, y: -120 }, { x: 60, y: -95 }, { x: -40, y: -30 }, { x: 40, y: 30 }, { x: -150, y: -215 }, { x: 60, y: -225 }], { radius: 40, strength: 1 }, { density: 14, minDistance: 1.4 });
  // Denser woods in the hollows on both sides
  k.biome('conifer', [{ x: -230, y: -40 }, { x: -200, y: 30 }], { radius: 45, strength: 1 });
  k.biome('conifer', [{ x: 215, y: -60 }, { x: 160, y: -170 }], { radius: 40, strength: 1 });

  // ---- The village on the pass: stone houses with balconies, a chapel on the knoll, a cable car down to the valley
  const face = (x: number, y: number) => facing({ x, y }, { x: 0, y: -200 });
  k.place('chapel-mountain', -32, 128, { rotation: face(-32, 128) });
  const houses = [
    [-42, 92, 'house-stone-balcony'],
    [48, 118, 'house-stone-balcony'],
    [-12, 135, 'house-stone'],
    [60, 92, 'alpine-hut'],
    [24, 140, 'house-stone-balcony'],
    [-62, 112, 'alpine-hut'],
  ] as const;
  for (const [x, y, asset] of houses) {
    k.chimney(k.place(asset, x, y, { rotation: face(x, y) + (k.noise.fbm(x, y, 30) * 0.4) }));
  }
  for (const [x, y, asset, r] of [
    [-24, 104, 'well', 0],
    [36, 104, 'woodpile', 1.2],
    [-50, 78, 'woodpile', 0.3],
    [36, 64, 'shrine', 2.6],
    [-6, 148, 'bench', 3.1],
    [40, 132, 'cart', 0.8],
    [-20, 82, 'lamp-post', 0],
    [32, 86, 'lamp-post', 0],
    [-4, 120, 'lamp-post', 0],
    [28, 46, 'signpost', 2.2],
  ] as const) {
    k.place(asset, x, y, { rotation: r });
  }
  k.row('fence-rail', [{ x: -80, y: 70 }, { x: -70, y: 100 }, { x: -78, y: 130 }], 3.8, { turn: Math.PI / 2 });
  // Cable car: top station by the village, valley station by the west road, pylons over the wood
  const top = { x: -78, y: 60 };
  const valley = { x: -200, y: -195 };
  k.place('cablecar-station', top.x, top.y, { rotation: facing(top, valley) });
  k.place('cablecar-station', valley.x, valley.y, { rotation: facing(valley, top) });
  // Supports along the line: the stations' cable exits (4.8 m) and the pylons' sheaves (16.25 m at scale 1, here 1.2)
  const supports: { x: number; y: number; h: number }[] = [{ ...top, h: k.h(top.x, top.y) + 4.8 }];
  for (const f of [0.25, 0.5, 0.75]) {
    const p = { x: top.x + (valley.x - top.x) * f, y: top.y + (valley.y - top.y) * f };
    k.erase(p, 7);
    k.place('cablecar-pylon', p.x, p.y, { rotation: facing(top, valley), scale: 1.2 });
    supports.push({ ...p, h: k.h(p.x, p.y) + 16.25 * 1.2 });
  }
  supports.push({ ...valley, h: k.h(valley.x, valley.y) + 4.8 });
  // The cables: between each pair of supports, pieces of the 40 m span tilted along the slope (pitch)
  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(Math.hypot(run, b.h - a.h) / 40));
    const pitch = -Math.atan2(b.h - a.h, run);
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      const m = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      const h = a.h + (b.h - a.h) * f;
      k.place('cable-span-40', m.x, m.y, { rotation: facing(a, b), pitch, scale: Math.hypot(run, b.h - a.h) / n / 40, z: h - k.h(m.x, m.y) });
    }
    // A gondola on each span, hanging from the cable by its grip (4.4 m above its floor)
    const g = { x: a.x + (b.x - a.x) * 0.4, y: a.y + (b.y - a.y) * 0.4 };
    k.place('cablecar-gondola', g.x + (i % 2 ? 2.6 : -2.6) * Math.cos(facing(a, b)), g.y + (i % 2 ? 2.6 : -2.6) * Math.sin(facing(a, b)), { rotation: facing(a, b), z: a.h + (b.h - a.h) * 0.4 - 4.4 - k.h(g.x, g.y) });
  }
  // Boulders and lone pines on the slopes, kept off the bends
  k.scatter(['rock-granite', 'boulder', 'rock-large', 'rock-granite-flat'], [{ x: -120, y: -80 }, { x: 120, y: -150 }, { x: 130, y: -10 }, { x: -130, y: 20 }, { x: -60, y: 60 }], { radius: 40, strength: 0.7 }, { density: 1.2, minDistance: 9, scaleMin: 0.8, scaleMax: 1.8 });
  k.scatter(['tree-pine', 'tree-fir', 'tree-fir-young'], [{ x: -140, y: -60 }, { x: -120, y: 40 }, { x: 130, y: -60 }, { x: 120, y: -170 }], { radius: 35, strength: 0.8 }, { density: 2.5, minDistance: 6, scaleMin: 0.8, scaleMax: 1.3 });
  k.scatter(['tree-pine', 'boulder', 'rock-small'], [{ x: 105, y: 30 }, { x: 225, y: 25 }], { radius: 22, strength: 0.8 }, { density: 2, minDistance: 5 });
  // ---- High mountain: a glacier under each peak, avalanche barriers above the village, alpine huts on the pastures
  // The ground's fall line at a point: the way downhill
  const downhill = (p: MapPoint): MapPoint => ({ x: p.x - (k.h(p.x + 1, p.y) - k.h(p.x - 1, p.y)), y: p.y - (k.h(p.x, p.y + 1) - k.h(p.x, p.y - 1)) });
  for (const tongue of [
    [{ x: -138, y: 204 }, { x: -105, y: 192 }, { x: -72, y: 172 }],
    [{ x: 148, y: 198 }, { x: 115, y: 190 }, { x: 84, y: 176 }],
  ]) {
    // What grew on the ice goes
    for (const p of tongue) k.erase(p, 20, (o) => o.asset.startsWith('fx'));
    k.glacier(tongue, { width: 40, snow: 'snow-fresh', sink: 2.5, snout: ['ice-blocks', 'ice-blocks', 'snow-drift-mound'], moraine: ['scree-scatter', 'rock-granite', 'rock-granite-flat'] });
    // Seracs where the ice breaks over the steep lower half of the tongue, a few small broken towers across it
    const [head, mid, snout] = tongue;
    for (const [f, side, scale] of [[0.55, -0.35, 0.7], [0.66, 0.3, 0.6], [0.78, -0.1, 0.75]] as const) {
      const a = f < 0.5 ? head : mid;
      const b = f < 0.5 ? mid : snout;
      const t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const q = { x: p.x - ((b.y - a.y) / dl) * 20 * side, y: p.y + ((b.x - a.x) / dl) * 20 * side };
      k.place('seracs', q.x, q.y, { rotation: facing(q, downhill(q)) + side, scale });
    }
    // Wind blows snow off the head of the ice
    k.lifeArea('snow', [{ x: head.x - 18, y: head.y - 12 }, { x: head.x + 18, y: head.y - 12 }, { x: head.x + 18, y: head.y + 12 }, { x: head.x - 18, y: head.y + 12 }], { density: 1.2 });
  }
  // Old snow lying on in the shade of the faces under the summits, tilted with the slope: only where the ground
  // under the sheet is even enough to carry it (a curved face would leave its edge in the air)
  for (const peak of [{ x: -175, y: 178 }, { x: 182, y: 172 }]) {
    const lying: MapPoint[] = [];
    for (let y = peak.y - 80; y <= peak.y + 70 && lying.length < 4; y += 10) {
      for (let x = peak.x - 80; x <= peak.x + 80 && lying.length < 4; x += 10) {
        const p = { x, y };
        if (Math.hypot(x - peak.x, y - peak.y) > 80 || Math.hypot(x - peak.x, y - peak.y) < 25 || !k.free(x, y, 12)) continue;
        if (lying.some((q) => Math.hypot(q.x - x, q.y - y) < 40) || Math.abs(x) < 95 || Math.abs(x) > 245 || y > 240) continue;
        const scale = 0.7;
        const sheet = k.place('snowfield', x, y, { rotation: facing(p, downhill(p)), scale, align: true, z: -0.3 });
        if (undersideGap(k.doc.terrain, sheet, [18, 18, 0]) - 0.55 * scale > 0.2) k.doc.objects = k.doc.objects.filter((o) => o !== sheet);
        else lying.push(p);
      }
    }
  }
  // Rows of avalanche barriers (snow bridges) along the contours of the steep flanks over the pass, short and
  // staggered as they are built; each stands square to the fall line, its back to the slope above
  for (const [a, b] of [
    [{ x: -150, y: 112 }, { x: -92, y: 132 }],
    [{ x: 150, y: 108 }, { x: 96, y: 128 }],
  ] as const) {
    for (const [row, height] of [116, 127, 138].entries()) {
      for (const piece of k.contour(a, b, height, { spacing: 3, reach: 50 })) {
        const length = polylineLength(piece);
        for (let d = (row % 2) * 9; d + 12.6 <= length; d += 21) {
          const run = [2, 6.3, 10.6].map((s) => pointAt(piece, d + s));
          if (!run.every((p) => k.free(p.x, p.y, 2.2))) continue;
          for (const p of run) k.place(row === 2 ? 'avalanche-barrier-snow' : 'avalanche-barrier', p.x, p.y, { rotation: facing(p, downhill(p)) });
        }
      }
    }
  }
  // A herd: `count` animals round a spot, each turned its own way, none on a road
  const herd = (assets: readonly string[], at: MapPoint, count: number, radius: number) => {
    for (let n = 0, tries = 0; n < count && tries < count * 4; tries++) {
      const a = k.noise.hash(Math.round(at.x), tries, 71) * Math.PI * 2;
      const d = radius * Math.sqrt(k.noise.hash(Math.round(at.y), tries, 72));
      const p = { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d };
      if (!k.free(p.x, p.y, 2)) continue;
      k.place(assets[n % assets.length], p.x, p.y, { rotation: k.noise.hash(tries, n, 73) * Math.PI * 2 });
      n++;
    }
  };
  // Alpine huts on the high pastures, each with its woodpile and a pen
  for (const [x, y, r] of [[-206, 34, 0.6], [-140, 66, 0.2], [200, 26, -0.6], [140, 62, -0.2]] as const) {
    k.erase({ x, y }, 9);
    k.place('alpine-hut', x, y, { rotation: r });
    k.place('woodpile', x + Math.cos(r) * 5, y + Math.sin(r) * 5, { rotation: r + Math.PI / 2 });
    const pen = { x: x - Math.sin(r) * 11, y: y + Math.cos(r) * 11 };
    k.row('fence-rail', [{ x: pen.x - Math.cos(r) * 8, y: pen.y - Math.sin(r) * 8 }, { x: pen.x + Math.cos(r) * 8, y: pen.y + Math.sin(r) * 8 }], 2, { turn: Math.PI / 2 });
    // Cows grazing on the pasture beyond the fence
    herd(['cow-grazing', 'cow', 'cow-lying'], { x: x - Math.sin(r) * 20, y: y + Math.cos(r) * 20 }, 3, 8);
  }
  // ---- Life: eagles round the summits, a flock over the valley, wind on the pass, the stream and the waterfall
  const ring = (c: MapPoint, r: number, n = 10): MapPoint[] => Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * Math.PI * 2) * r, y: c.y + Math.sin((i / n) * Math.PI * 2) * r }));
  // Eagles high over each peak, wide slow circles
  for (const peak of [{ x: -170, y: 175 }, { x: 175, y: 170 }]) k.lifeArea('birds', ring(peak, 70), { species: 'raptors', density: 0.8, height: 70 });
  k.lifeArea('birds', [{ x: -200, y: -240 }, { x: 200, y: -240 }, { x: 150, y: -150 }, { x: -150, y: -150 }], { density: 0.8, height: 45 });
  // The wind over the whole map, strongest up on the pass; the stream from the waterfall down the valley
  k.lifeSettings({ ambience: { sound: 'wind', volume: 0.35 } });
  k.lifeArea('sound', ring(pass, 60, 8), { sound: 'wind', volume: 0.9 });
  k.lifeRoute('sound', [{ x: 176, y: 40 }, { x: 160, y: 2 }, { x: 150, y: -60 }, { x: 142, y: -110 }, { x: 125, y: -160 }, { x: 108, y: -262 }], { sound: 'stream', volume: 0.8 });
  k.lifeArea('sound', [{ x: -256, y: -256 }, { x: 256, y: -256 }, { x: 256, y: -150 }, { x: -256, y: -150 }], { sound: 'birdsong', volume: 0.5 });
  // TODO(E190): the gondolas ride the cable; cow bells on the pastures (no such sound yet)
  // Sheep on the meadows at the valley's edge, off the roads
  for (const at of [{ x: -235, y: -170 }, { x: 230, y: -165 }]) herd(['sheep-grazing', 'sheep', 'sheep-grazing', 'sheep-lying'], at, 7, 12);

  // Dry stone walls hold the road where it runs on an embankment
  k.shoulderWalls('retaining-wall', { spacing: 6, minDrop: 2.2 });
  // Hairpin knobs: level ground inside the bends for towers
  k.plateau({ x: 82, y: -105 }, { radius: 11, falloff: 0.3 }, k.h(82, -105));
  k.plateau({ x: -82, y: -32 }, { radius: 11, falloff: 0.3 }, k.h(-82, -32));

  // The lake to its rim once the ground round it is done: the stream out of it cut its south bank, which stood
  // lower than the level the lake was dug at, and the water ended there in the air over the valley
  k.fillToRim(lakeAt, lake);

  // Seven ground materials: the least used goes (each one is 8 MB of pixels to load)
  k.trimLayers(7);
  k.environment({ biome: 'mountain', sky: 'day', sunAzimuth: 235, sunElevation: 28, fogDensity: 0.0005, tint: '#fff4e6' });
  return k.finish();
}
