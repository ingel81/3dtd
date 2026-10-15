/**
 * Moon base: a research station in a wide crater on a pocked grey plain.
 * Rover tracks wind between the craters from three landing zones to the
 * station's hub; the crater rims and the low ridges between them are the
 * build ground. The station's crater has a high, broken wall; north-west a
 * great crater with a central peak. Domes, modules and tunnels round the
 * hub, a landing pad with a lander, a launch pad, solar arrays, fuel tanks
 * and antennas, lit under the black sky; the Earth stands over the north
 * rim, hard light from a low sun.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

export function buildMoonBase(): CustomMapDocument {
  const k = new LevelKit({
    id: 'moon-base',
    name: 'Moon Base',
    description: 'A research station in a crater on the Moon. Rover tracks wind between the craters from three landing zones; build on the rims.',
    size: 512,
    base: 'regolith',
    seed: 9109,
  });
  for (const m of ['regolith', 'regolith-rough', 'crater-floor', 'regolith-tracks', 'moon-basalt', 'concrete']) k.layer(m);
  k.cliffs('moon-basalt', 42);

  // ---- The plain: gently rolling, then craters of every size; the station's crater the widest
  k.generate('hills', 91, 0.12);
  const hq = { x: 30, y: -20 };
  const ringAt = (c: MapPoint, r: number, n = 48, wobble = 0): MapPoint[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const d = r * (1 + wobble * (k.noise.hash(c.x + i % n, c.y, 41) - 0.5));
      return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
    });
  k.form('crater', hq, { radius: 120, strength: 0.6 }, 1);
  const floor = k.h(hq.x, hq.y);
  // The station crater's wall: a rim of rock standing high over the plain, broken by slumps and gullies
  k.level(ringAt(hq, 82, 56, 0.08), { radius: 24, falloff: 1 }, floor + 20, 0.5);
  k.roughen(ringAt(hq, 82, 56), { radius: 24, falloff: 0.8 }, 1.2, 9109);
  k.level(hq, { radius: 58, falloff: 0.5 }, floor);
  const craters: [number, number, number][] = [
    [-175, 150, 95], [160, 170, 48], [-190, -150, 52], [180, -170, 44], [-60, 200, 30], [210, 40, 34],
    [-230, 20, 28], [-100, -230, 26], [90, 230, 24], [-120, 60, 22], [130, -90, 20], [-20, -170, 22],
  ];
  for (const [x, y, r] of craters) k.form('crater', { x, y }, { radius: r, strength: 1 }, 2);
  // The great crater north-west: deep, a high terraced wall and a central peak, as the big lunar craters have
  const great = { x: craters[0][0], y: craters[0][1] };
  const greatFloor = k.h(great.x, great.y);
  k.level(ringAt(great, 60, 48, 0.08), { radius: 20, falloff: 1 }, greatFloor + 28, 0.5);
  k.terrace(ringAt(great, 46, 48), { radius: 10, falloff: 0.8 }, 5, greatFloor, 0.3);
  k.form('mountain', great, { radius: 26, strength: 0.9 }, 3);
  k.roughen(ringAt(great, 60, 48), { radius: 20, falloff: 0.8 }, 1.2, 9110);
  // Two more with raised walls on the east side, seen from the station
  for (const [x, y, r, h] of [[160, 170, 30, 14], [180, -170, 27, 12]] as const) {
    k.level(ringAt({ x, y }, r, 40, 0.08), { radius: 12, falloff: 1 }, k.h(x, y) + h, 0.5);
    k.roughen(ringAt({ x, y }, r, 40), { radius: 12, falloff: 0.8 }, 1, 9111 + x);
  }
  // Highland massifs in three corners, away from the landing zones: broad rounded swells 26 to 32 m over the plain
  // with a lower shoulder, worn smooth as the lunar highlands are, a skyline behind the craters
  for (const [x, y, r, h] of [[190, 195, 85, 32], [-195, -195, 75, 28], [195, -205, 70, 26]] as const) {
    k.raise({ x, y }, { radius: r, falloff: 1 }, h);
    const a = k.noise.hash(x, y, 43) * Math.PI * 2;
    k.raise({ x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.6 }, { radius: r * 0.6, falloff: 1 }, h * 0.4);
    k.smooth({ x, y }, { radius: r * 1.1, falloff: 0.6 }, 8);
    k.roughen({ x, y }, { radius: r, falloff: 0.8 }, 2, 9120 + x);
  }
  k.erode(hq, { radius: 150, strength: 1 }, 4);
  k.erode(ringAt(great, 56, 24), { radius: 30, strength: 1 }, 3);

  // ---- Rover tracks: three landing zones, each track between the craters to the hub
  const north = { x: -40, y: 252 };
  const west = { x: -252, y: -60 };
  const east = { x: 252, y: -90 };
  const track = { width: 8, surface: [] as string[], lamps: false };
  const join = { x: -20, y: 25 };
  const northLine: MapPoint[] = [north, { x: 10, y: 215 }, { x: 40, y: 170 }, { x: -20, y: 135 }, { x: -95, y: 110 }, { x: -70, y: 70 }, { x: -60, y: 40 }, join, hq];
  const westLine: MapPoint[] = [west, { x: -205, y: -95 }, { x: -150, y: -110 }, { x: -140, y: -60 }, { x: -170, y: -10 }, { x: -120, y: 15 }, { x: -70, y: -5 }, join];
  const eastLine: MapPoint[] = [east, { x: 215, y: -120 }, { x: 175, y: -75 }, { x: 120, y: -130 }, { x: 95, y: -75 }, { x: 150, y: -10 }, { x: 175, y: 60 }, { x: 110, y: 50 }, { x: 70, y: 0 }, hq];
  // Gentle ways down the crater wall: cut through the rim where the tracks come in, then down to the hub
  k.ramp({ x: -70, y: 50 }, join, 16);
  k.ramp({ x: -80, y: -6 }, join, 16);
  k.ramp({ x: 118, y: 58 }, { x: 70, y: 0 }, 16);
  k.ramp(join, hq, 14);
  k.road(northLine, track);
  k.road(westLine, track);
  k.road(eastLine, track);
  k.spawn('North Landing', north.x, north.y);
  k.spawn('West Landing', west.x, west.y);
  k.spawn('East Landing', east.x, east.y);
  k.hq(hq.x, hq.y);

  // ---- Ground: regolith, rough ejecta round the craters, dark basalt floors, tracks and the pad in concrete
  k.biome('moon', [{ x: -200, y: 200 }, { x: 200, y: 200 }, { x: -220, y: -210 }, { x: 210, y: -210 }, { x: 0, y: 120 }, { x: -150, y: 0 }, { x: 160, y: -60 }], { radius: 70, strength: 0.55 });
  for (const [x, y, r] of craters) {
    k.paint('regolith-rough', { x, y }, { radius: r * 1.2, falloff: 1 }, 0.5);
    k.paint('crater-floor', { x, y }, { radius: r * 0.55, falloff: 0.8 }, 0.7);
  }
  for (const line of [northLine, westLine, eastLine]) k.paint('regolith-tracks', line, { radius: 7, falloff: 0.8 }, 0.8);
  k.paint('concrete', hq, { radius: 22, falloff: 0.5 }, 0.9);

  // ---- The station: hub on the HQ, modules and domes round it, tunnels between, the pad to the south
  const ring = (r: number, n: number, phase = 0): MapPoint[] =>
    Array.from({ length: n }, (_, i) => ({ x: hq.x + Math.cos(phase + (i / n) * Math.PI * 2) * r, y: hq.y + Math.sin(phase + (i / n) * Math.PI * 2) * r }));
  k.place('research-station', hq.x + 20, hq.y + 18, { rotation: facing({ x: hq.x + 20, y: hq.y + 18 }, hq) });
  for (const [i, p] of ring(34, 6, 0.4).entries()) {
    if (!k.free(p.x, p.y, 6)) continue;
    k.place(i % 3 === 0 ? 'dome-white' : i % 3 === 1 ? 'base-module' : 'dome-glass', p.x, p.y, { rotation: facing(p, hq) });
  }
  for (const p of ring(22, 4, 1.1)) if (k.free(p.x, p.y, 3)) k.place('base-tunnel', p.x, p.y, { rotation: facing(p, hq) + Math.PI / 2 });
  // The landing pad on the crater floor, its lights round it (the pad's own and the masts')
  const pad = { x: hq.x - 6, y: hq.y - 47 };
  k.paint('concrete', pad, { radius: 13, falloff: 0.4 }, 1);
  k.place('landing-pad', pad.x, pad.y);
  k.place('lander', pad.x + 2, pad.y + 1, { rotation: 0.6 });
  for (const [dx, dy] of [[-20, 6], [-22, -6]] as const) if (k.free(pad.x + dx, pad.y + dy, 3)) k.place('fuel-tanks', pad.x + dx, pad.y + dy, { rotation: 0.2 });
  // Floodlight masts by the pad and round the hub, lit under the black sky
  // A red warning light blinking on top of each mast
  const mast = (p: MapPoint, toward: MapPoint) => {
    if (!k.free(p.x, p.y, 1)) return;
    k.place('floodlight-mast', p.x, p.y, { rotation: facing(p, toward) });
    k.place('fx-beacon', p.x, p.y, { z: 13.2 });
  };
  for (const a of [0.5, 3.7]) mast({ x: pad.x + Math.cos(a) * 12, y: pad.y + Math.sin(a) * 12 }, pad);
  for (const p of ring(46, 3, 0.9)) mast(p, hq);
  // The launch site out on the plain south-west: the rocket on its own pad with its tower, a fuel farm beside it
  const launch = { x: -55, y: -115 };
  k.level(launch, { radius: 22, falloff: 0.5 }, k.h(launch.x, launch.y));
  k.paint('concrete', launch, { radius: 18, falloff: 0.4 }, 1);
  k.place('rocket', launch.x, launch.y, { rotation: facing(launch, hq) });
  for (const [dx, dy] of [[-18, 10], [-20, -4], [-16, -16]] as const) k.place('fuel-tanks', launch.x + dx, launch.y + dy, { rotation: 1.2 });
  k.paint('regolith-tracks', [launch, { x: -30, y: -80 }, { x: pad.x - 14, y: pad.y - 8 }], { radius: 3, falloff: 0.8 }, 0.7);
  // Solar fields on the plain past the crater wall, antennas on its crest and on the high ground
  for (let i = 0; i < 8; i++) {
    const p = { x: hq.x + 84 + (i % 4) * 13, y: hq.y + 74 + Math.floor(i / 4) * 12 };
    if (k.free(p.x, p.y, 5)) k.place('solar-array', p.x, p.y, { rotation: 0 });
  }
  for (let i = 0; i < 4; i++) {
    const p = { x: hq.x - 96 + (i % 2) * 14, y: hq.y + 74 + Math.floor(i / 2) * 12 };
    if (k.free(p.x, p.y, 5)) k.place('solar-array', p.x, p.y, { rotation: 0.3 });
  }
  const crest = (deg: number): MapPoint => ({ x: hq.x + Math.cos((deg * Math.PI) / 180) * 82, y: hq.y + Math.sin((deg * Math.PI) / 180) * 82 });
  // Position lights round the crest of the wall, small enough not to light the ground red
  for (let deg = 0; deg < 360; deg += 30) {
    const p = crest(deg + 9);
    if (k.free(p.x, p.y, 2)) k.place('beacon-post', p.x, p.y);
  }
  for (const [p, a] of [[crest(60), 'antenna-dish'], [crest(205), 'antenna-dish'], [crest(-25), 'antenna-dish'], [{ x: -140, y: 120 }, 'antenna-dish'], [{ x: 150, y: 110 }, 'antenna-mast'], [{ x: -90, y: -140 }, 'antenna-mast']] as const) {
    if (k.free(p.x, p.y, 5)) k.place(a, p.x, p.y, { rotation: facing(p, hq) });
  }
  // Rover tracks out to the solar fields and the antennas
  for (const to of [crest(60), crest(205), { x: hq.x + 100, y: hq.y + 80 }]) k.paint('regolith-tracks', [hq, to], { radius: 2.5, falloff: 0.8 }, 0.6);
  // Rovers parked by the station and out on the tracks
  for (const [x, y] of [[hq.x - 30, hq.y + 30], [hq.x + 44, hq.y - 12], [-150, -55], [175, -20], [hq.x + 78, hq.y + 66]] as const) {
    if (k.free(x, y, 4)) k.place('rover', x, y, { rotation: facing({ x, y }, hq) });
  }
  // Crater rims and boulder fields: ejecta strewn along the rims, boulders strewn on the plain
  for (const [x, y, r] of craters.slice(0, 6)) k.ejecta({ x, y }, r, ['moon-boulder', 'moon-rock', 'moon-rocks-small']);
  k.scatter(['moon-boulder', 'moon-rock', 'moon-rocks-small'], [{ x: -200, y: 80 }, { x: 100, y: 180 }, { x: -150, y: -200 }, { x: 220, y: -150 }, { x: 0, y: -120 }], { radius: 60, strength: 0.7 }, { density: 2.5, minDistance: 5, scaleMin: 0.6, scaleMax: 1.6 });

  // ---- Life: rovers driving the track out to the launch site and the one to the solar field; the dishes turn on
  // their own (the catalogue's spin)
  // Both start clear of the pad's fuel tanks and mast and of the research station: a rover drove through them
  k.lifeRoute('movers', [{ x: pad.x - 20, y: pad.y - 18 }, { x: -30, y: -80 }, { x: launch.x + 10, y: launch.y + 14 }], { asset: 'rover', speed: 1.6 });
  k.lifeRoute('movers', [{ x: hq.x + 38, y: hq.y + 28 }, { x: hq.x + 62, y: hq.y + 48 }, { x: hq.x + 96, y: hq.y + 64 }], { asset: 'rover', speed: 1.4 });
  // Radio hiss in the station, round the hub and its modules
  k.lifeArea('sound', ring(40, 8), { sound: 'radio-hiss', volume: 0.6 });
  k.trimLayers(7);
  // Hard light from a low sun: long shadows show every crater, the sky stays black; the Earth over the north rim,
  // half lit from the sun's side
  k.environment({ biome: 'moon', sky: 'day', sunAzimuth: 120, sunElevation: 32, fogDensity: 0, tint: '#f2f4ff', planet: { azimuth: 12, elevation: 20, size: 9 } });
  return k.finish();
}
