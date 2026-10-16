// Stillwater (K3, tmp/showreel/DREHBUCH_R4.md 2.4 and 3): the map the build-up story makes, stage by stage, as
// map scripts (the editor agent's run_script, docs/AGENT_MCP.md: the MapKit commands against `map`). Stage n is
// what scene b<n> does with the editor's tools; played on F-B<n-1> it gives F-B<n>, the start of scene b<n+1>.
// So any scene of the story can be taken alone and starts where the one before ended (the strokes of a take
// depend on its frame timing, so the take's own end differs a little; after a stage is accepted, its exported end
// replaces the generated fixture, DREHBUCH 3.2).
//
// The plan (metres round the middle, x east, y north; Medium, 1024 m). The new map's starter road runs from the
// west edge along y = 0 to the HQ at (256, 0):
//
//            N   peaks (-250, 360) (0, 400) (230, 350); a step under the middle peak where the river falls
//   (-150, 505) north spawn, the north road through the pass (-120, 300), round the hill's west side
//        |      \  river from (40, 440) over the step (40, 300), under the starter road at (-70, 0)
//        |       \           hill (150, 190) with the windmill, wood on its north side
//   West ==========bridge(-70,0)=====village(-20..170, 0)=====ramp(186..236, 0)== table (300, -10) with the castle, HQ
//   spawn          \  chapel (60, 32)                                         \
//              lake (-150, -150), beach on its north shore, autumn wood east of it      east road from (505, -80)

/** The new map's form (b0-new): what Create makes, and what the generator starts from */
export const NEW_MAP = { name: 'Stillwater', size: 'Medium', width: 1024, ground: 'flat', material: 'grass' };

/** Places the plan names, shared by the scripts and the scenes */
export const P = {
  hill: { x: 150, y: 190 },
  hollow: { x: -150, y: -150 },
  table: { x: 300, y: -10 },
  rampFoot: { x: 170, y: 0 },
  rampTop: { x: 252, y: 0 },
  peaks: [{ x: -260, y: 350, r: 180 }, { x: 0, y: 390, r: 200 }, { x: 240, y: 345, r: 180 }],
  step: [{ x: -10, y: 300 }, { x: 90, y: 300 }],
  river: [{ x: 40, y: 450 }, { x: 40, y: 330 }, { x: 40, y: 260 }, { x: 10, y: 150 }, { x: -40, y: 60 }, { x: -70, y: 0 }, { x: -105, y: -70 }, { x: -140, y: -130 }],
  bridge: { x: -70, y: 0 },
  // The north road in two lines: through the pass to the bend, then down to the starter road west of the river
  northRoad: [{ x: -150, y: 505 }, { x: -125, y: 300 }, { x: -100, y: 200 }],
  northDown: [{ x: -100, y: 200 }, { x: -140, y: 2 }],
  northBend: { x: -100, y: 200 },
  northBendTo: { x: -40, y: 190 },
  eastRoad: [{ x: 505, y: -80 }, { x: 390, y: -160 }, { x: 260, y: -140 }, { x: 186, y: -8 }],
  village: { x: 80, y: 0 },
  // b5: two conifer strokes on the mountain flanks, a wood on the hill's west flank, autumn east of the lake,
  // a beach on its north shore, a meadow in the west valley
  conifer: [[{ x: -330, y: 250 }, { x: -170, y: 240 }], [{ x: 110, y: 285 }, { x: 340, y: 255 }]],
  forest: [{ x: 70, y: 220 }, { x: 110, y: 285 }],
  autumn: [{ x: -45, y: -185 }, { x: -30, y: -125 }],
  beach: [{ x: -185, y: -78 }, { x: -125, y: -76 }],
  meadow: [{ x: -360, y: 110 }, { x: -230, y: 130 }],
  // b6: the village on the south side of the street, every house's front to it (Place sets turn 0: north, the
  // street), each asset once; the chapel on the square behind two market stalls, the barn at the west end by the
  // bridge
  houses: [
    ['barn', -42, -27], ['house', -22, -19], ['house-stone', -2, -19], ['cottage', 18, -18], ['house-tall', 38, -19],
    ['house-large', 104, -21], ['forge', 128, -19], ['house-stone-balcony', 150, -19],
  ],
  chapel: { x: 70, y: -50 },
  stalls: [['market-stall-red', 62, -17], ['market-stall-blue', 78, -17]],
  windmill: { x: 150, y: 190 },
  ring: { r: 54, from: 194, to: 526 },
  gate: { x: 246, y: 0 },
  lake: [{ x: -190, y: -150 }, { x: -150, y: -110 }, { x: -110, y: -150 }, { x: -150, y: -190 }],
  pasture: [{ x: 290, y: 110 }, { x: 370, y: 105 }, { x: 380, y: 170 }, { x: 300, y: 180 }],
};

/** The castle ring as map points: an arc round the table, open at the west where the ramp comes up */
export function ring(r = P.ring.r, from = P.ring.from, to = P.ring.to, step = 30) {
  const out = [];
  for (let a = from; a <= to + 0.01; a += (to - from) / Math.round((to - from) / step)) {
    out.push({ x: Math.round(P.table.x + Math.cos((a * Math.PI) / 180) * r), y: Math.round(P.table.y + Math.sin((a * Math.PI) / 180) * r) });
  }
  return out;
}

const j = (v) => JSON.stringify(v);

/**
 * Stage scripts in order: STAGES[n] makes F-B<n> from F-B<n-1> (n >= 1). A stage is a script or a list of parts:
 * scripts and `{ erode: rain 0..1, seed }`, the Map panel's Erode the whole map (a terrain job, not a script command)
 */
export const STAGES = [
  null,
  // b1-terrain: the basic tools on the empty meadow, big brushes
  `
  map.environment({ sky: 'day', sunElevation: 25, sunAzimuth: 135, weather: 'clear' });
  map.lifeSettings({ auto: { birds: false } });
  map.raise(${j(P.hill)}, { radius: 141, strength: 1 }, 36);
  map.raise(${j(P.hollow)}, { radius: 90, strength: 1, falloff: 0.4 }, -12);
  map.smooth([{ x: 60, y: 190 }, { x: 240, y: 190 }], { radius: 160, strength: 0.7 }, 3);
  map.plateau(${j(P.table)}, { radius: 100, strength: 1 }, 14);
  map.ramp({ ...${j(P.rampFoot)}, h: 0 }, { ...${j(P.rampTop)}, h: 14 }, 22, 1);
  log('road', [150, 170, 190, 210, 230, 250, 256, 270].map((x) => x + ':' + map.h(x, 0).toFixed(1)).join(' '));
  return { hill: Math.round(map.h(${P.hill.x}, ${P.hill.y})), hollow: Math.round(map.h(${P.hollow.x}, ${P.hollow.y})), table: Math.round(map.h(${P.table.x}, ${P.table.y})) };
  `,
  // b2-mountains: three peaks, a step for the waterfall, the whole map eroded (the Map panel), auto paint with rock
  // and fresh snow, grey granite for the cliffs
  [
    `
    for (const p of ${j(P.peaks)}) map.form('mountain', { x: p.x, y: p.y }, { radius: p.r, strength: 1 }, 4);
    map.smooth(${j(P.peaks)}.map((p) => ({ x: p.x, y: p.y })), { radius: 200, strength: 1, falloff: 0.7 }, 4);
    map.cliff(${j(P.step)}, 24, 40);
    `,
    { erode: 0.2, seed: 11 },
    `
    map.smooth(${j(P.hill)}, { radius: 170, strength: 1, falloff: 0.7 }, 4);
    map.layer('rock-lichen');
    map.layer('snow-fresh');
    map.autoPaint();
    map.cliffs('limestone', 50);
    let top = 0;
    for (let x = -500; x <= 500; x += 4) for (let y = 150; y <= 510; y += 4) top = Math.max(top, map.h(x, y));
    return { top: Math.round(top) };
    `,
  ],
  // b3-water: the river from the step down under the starter road (a bridge) into the hollow, the hollow filled
  // to its rim (Fill basin with Ctrl)
  `
  const made = map.river(${j(P.river)}, { width: 16, depth: 2.5, bank: 10, reeds: true, bridges: true });
  map.water(-0.6);
  map.fill(${j(P.hollow)});
  return { rivers: made.length, waterfalls: made.map((r) => r.waterfalls), bridges: made.map((r) => r.bridges) };
  `,
  // b4-roads: the north road (gravel, lamps) through the pass to the starter road, its spawn; the bend moved round
  // the hill's west side, rounded and widened; the village stretch paved; the east road and its spawn
  `
  const near = (p) => map.nodes().reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
  const through = (p) => map.roads().find((r) => r.points.some((q, i) => i > 0 && segment(r.points[i - 1], q, p) < 6));
  const segment = (a, b, p) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
  };
  map.road(${j(P.northRoad)}, { width: 6, surface: ['gravel'], lamps: true });
  map.road(${j(P.northDown)}, { width: 6, surface: ['gravel'], lamps: true });
  map.spawn('North', ${P.northRoad[0].x}, ${P.northRoad[0].y});
  const bend = near(${j(P.northBend)});
  map.moveNode(bend.id, ${j(P.northBendTo)});
  const north = map.roads().filter((r) => r.a === bend.id || r.b === bend.id);
  for (const r of north) map.smoothRoad(r.id);
  map.editRoads(north.map((r) => r.id), { width: 8 });
  map.roadSurface([through(${j(P.village)}).id], 'cobblestone');
  map.road(${j(P.eastRoad)}, { width: 8, surface: ['gravel'], lamps: true });
  map.spawn('East', ${P.eastRoad[0].x}, ${P.eastRoad[0].y});
  log(JSON.stringify(map.roads().map((r) => [r.id, r.kind, r.width, r.points.map((q) => [Math.round(q.x), Math.round(q.y)]).filter((_, i, a) => i === 0 || i === a.length - 1)])));
  return { roads: map.roads().length, spawns: map.markers().spawns.map((s) => s.name), lanes: map.lanes() };
  `,
  // b5-biomes
  `
  for (const line of ${j(P.conifer)}) map.biome('conifer', line, { radius: 110, strength: 0.8 });
  map.biome('forest', ${j(P.forest)}, { radius: 70, strength: 0.7 });
  map.biome('autumn', ${j(P.autumn)}, { radius: 60, strength: 0.9 });
  map.biome('beach', ${j(P.beach)}, { radius: 40, strength: 1 });
  map.biome('meadow', ${j(P.meadow)}, { radius: 150, strength: 0.6 });
  return { objects: map.objects().length, layers: map.layers().length };
  `,
  // b6-village: afternoon; each building once, turned to the street; the chapel, the stalls, the windmill; the
  // castle ring with towers at the corners and its battlements outward, the gate; torches inside the wall, lamps
  // beside the street on both sides
  `
  map.environment({ sunAzimuth: 219, sunElevation: 47, sky: 'day' });
  for (const [asset, x, y] of ${j(P.houses)}) map.place(asset, x, y);
  map.place('chapel', ${P.chapel.x}, ${P.chapel.y});
  for (const [asset, x, y] of ${j(P.stalls)}) map.place(asset, x, y);
  map.place('windmill', ${P.windmill.x}, ${P.windmill.y});
  map.line('castle-wall', ${j(ring())}, { corners: 'towers', front: 'right' });
  map.place('castle-gate', ${P.gate.x}, ${P.gate.y}, { rotation: Math.PI / 2 });
  map.line('torch', ${j(ring(46))}, { spacing: 12 });
  const street = map.roads().find((r) => r.points.some((q, i) => i > 0 && Math.abs(q.y) < 4 && Math.abs(r.points[i - 1].y) < 4 && Math.min(q.x, r.points[i - 1].x) < 80 && Math.max(q.x, r.points[i - 1].x) > 80));
  map.line('lamp-post', street.points, { spacing: 16, offset: 5.5, bothSides: true });
  return { objects: map.objects().length };
  `,
  // b7-life: a boat on the lake, songbirds over the meadow, fireflies along the wood, ground fog in the valley,
  // cows and sheep on the pasture east of the hill with their bells, the map's own birds on again
  `
  map.lifeArea('boats', ${j(P.lake)}, { asset: 'fishing-boat', density: 0.6 });
  map.lifeArea('birds', [{ x: -400, y: 40 }, { x: -200, y: 40 }, { x: -200, y: 220 }, { x: -400, y: 220 }], { species: 'songbirds', height: 30 });
  map.lifeRoute('fireflies', [{ x: 40, y: 200 }, { x: 80, y: 250 }, { x: 140, y: 300 }]);
  map.lifeArea('fog', [{ x: -420, y: -60 }, { x: -220, y: -60 }, { x: -220, y: 200 }, { x: -420, y: 200 }], { density: 0.8 });
  map.scatter(['cow', 'cow-grazing', 'sheep', 'sheep-grazing'], ${j(P.pasture)}, { radius: 30, strength: 1 }, { density: 1.2 });
  map.lifeArea('sound', ${j(P.pasture)}, { sound: 'cowbells', volume: 0.6 });
  map.lifeSettings({ auto: { birds: true } });
  return { life: map.life().length, objects: map.objects().length };
  `,
  // b8-sky: what the scene leaves: the weather clear, moonlight set, the wave events (night at wave 7, rain at 9,
  // clear for the boss at 10), the clock back at 17:30 for the game
  `
  map.environment({ sky: 'day', sunAzimuth: 238, sunElevation: 32, weather: 'clear', moonlight: 0.6, fogDensity: 0.0004 });
  map.gameplay({ events: [{ wave: 7, kind: 'time', hour: 21 }, { wave: 9, kind: 'weather', weather: 'rain', strength: 1 }, { wave: 10, kind: 'weather', weather: 'clear' }] });
  return 'ok';
  `,
  // b9-rules: the map's own intro flight, an orbit round the HQ
  `
  map.intro({ kind: 'orbit', seconds: 10, radius: 220, height: 90, angle: Math.PI, sweep: 360 });
  return map.issues().filter((i) => i.severity === 'error').map((i) => i.message);
  `,
];
