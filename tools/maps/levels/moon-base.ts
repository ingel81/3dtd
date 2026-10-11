/**
 * Moon base: a research station in a wide crater on a pocked grey plain.
 * Rover tracks wind between the craters from three landing zones to the
 * station's hub; the crater rims and the low ridges between them are the
 * build ground. Domes, modules and tunnels round the hub, a landing pad
 * with a lander, solar arrays, fuel tanks and antennas; hard light from a
 * low sun under a black sky.
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
  k.cliffs('moon-basalt', 34);

  // ---- The plain: gently rolling, then craters of every size; the station's crater the widest
  k.generate('hills', 91, 0.12);
  const hq = { x: 30, y: -20 };
  k.form('crater', hq, { radius: 120, strength: 0.6 }, 1);
  k.level(hq, { radius: 58, falloff: 0.5 }, k.h(hq.x, hq.y));
  const craters: [number, number, number][] = [
    [-170, 150, 60], [160, 170, 48], [-190, -150, 52], [180, -170, 44], [-60, 200, 30], [210, 40, 34],
    [-230, 20, 28], [-100, -230, 26], [90, 230, 24], [-120, 60, 22], [130, -90, 20], [-20, -170, 22],
  ];
  for (const [x, y, r] of craters) k.form('crater', { x, y }, { radius: r, strength: 1 }, 2);
  k.erode(hq, { radius: 150, strength: 1 }, 4);

  // ---- Rover tracks: three landing zones, each track between the craters to the hub
  const north = { x: -40, y: 252 };
  const west = { x: -252, y: -60 };
  const east = { x: 252, y: -90 };
  const track = { width: 8, surface: [] as string[], lamps: false };
  const join = { x: -20, y: 25 };
  const northLine: MapPoint[] = [north, { x: 10, y: 215 }, { x: 40, y: 170 }, { x: -20, y: 135 }, { x: -95, y: 110 }, { x: -70, y: 70 }, { x: -60, y: 40 }, join, hq];
  const westLine: MapPoint[] = [west, { x: -205, y: -95 }, { x: -150, y: -110 }, { x: -140, y: -60 }, { x: -170, y: -10 }, { x: -120, y: 15 }, { x: -70, y: -5 }, join];
  const eastLine: MapPoint[] = [east, { x: 215, y: -120 }, { x: 175, y: -75 }, { x: 120, y: -130 }, { x: 95, y: -75 }, { x: 150, y: -10 }, { x: 175, y: 60 }, { x: 110, y: 50 }, { x: 70, y: 0 }, hq];
  // A gentle way down the crater wall where the tracks meet
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
  const pad = { x: hq.x - 10, y: hq.y - 70 };
  k.paint('concrete', pad, { radius: 16, falloff: 0.4 }, 1);
  k.place('landing-pad', pad.x, pad.y);
  k.place('lander', pad.x + 2, pad.y + 1, { rotation: 0.6 });
  for (const [dx, dy] of [[-30, 8], [-36, -6], [-30, -20]] as const) k.place('fuel-tanks', pad.x + dx, pad.y + dy, { rotation: 0.2 });
  // Solar fields on the crater's flat rim, antennas on the high ground
  for (let i = 0; i < 6; i++) {
    const p = { x: hq.x + 64 + (i % 3) * 14, y: hq.y + 52 + Math.floor(i / 3) * 12 };
    if (k.free(p.x, p.y, 5)) k.place('solar-array', p.x, p.y, { rotation: 0 });
  }
  for (let i = 0; i < 4; i++) {
    const p = { x: hq.x - 80 + (i % 2) * 14, y: hq.y + 60 + Math.floor(i / 2) * 12 };
    if (k.free(p.x, p.y, 5)) k.place('solar-array', p.x, p.y, { rotation: 0.3 });
  }
  for (const [x, y, a] of [[-140, 120, 'antenna-dish'], [150, 110, 'antenna-mast'], [-90, -140, 'antenna-mast'], [hq.x + 50, hq.y - 40, 'antenna-dish']] as const) {
    if (k.free(x, y, 5)) k.place(a, x, y, { rotation: facing({ x, y }, hq) });
  }
  // Rovers parked by the station and out on the tracks; a chain-link fence round the pad
  for (const [x, y] of [[hq.x - 30, hq.y + 30], [hq.x + 44, hq.y - 12], [-150, -55], [175, -20]] as const) {
    if (k.free(x, y, 4)) k.place('rover', x, y, { rotation: facing({ x, y }, hq) });
  }
  k.row('fence-chainlink', [{ x: pad.x - 22, y: pad.y - 22 }, { x: pad.x + 22, y: pad.y - 22 }, { x: pad.x + 22, y: pad.y + 20 }], 5);
  // Crater rims and boulder fields: the rims as walls of rock, boulders strewn on the plain
  for (const [x, y, r] of craters.slice(0, 6)) {
    for (let i = 0; i < 5; i++) {
      const a = k.noise.hash(x, y, i) * Math.PI * 2;
      const p = { x: x + Math.cos(a) * r * 0.95, y: y + Math.sin(a) * r * 0.95 };
      if (k.free(p.x, p.y, 6)) k.place('crater-rim', p.x, p.y, { rotation: a + Math.PI / 2, scale: 0.9 + 0.3 * k.noise.hash(y, x, i) });
    }
  }
  k.scatter(['moon-boulder', 'moon-rock', 'moon-rocks-small'], [{ x: -200, y: 80 }, { x: 100, y: 180 }, { x: -150, y: -200 }, { x: 220, y: -150 }, { x: 0, y: -120 }], { radius: 60, strength: 0.7 }, { density: 2.5, minDistance: 5, scaleMin: 0.6, scaleMax: 1.6 });

  k.trimLayers(5);
  // Hard light from a low sun: long shadows show every crater, the sky stays black
  k.environment({ biome: 'moon', sky: 'day', sunAzimuth: 120, sunElevation: 22, fogDensity: 0, tint: '#f2f4ff' });
  return k.finish();
}
