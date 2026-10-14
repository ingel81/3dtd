/**
 * Mars canyon: a colony on a mesa's foot where two canyons meet. The roads
 * run on the canyon floors between stepped ochre walls; towers stand on the
 * benches and the mesas above. The HQ is the colony's hub with greenhouse
 * domes, wind turbines and solar fields; rovers on the tracks. Mars as the
 * rovers see it: butterscotch dust and dunes, dark basalt sand in the low
 * ground, grey bedrock, rust, grey and black rocks, a pale butterscotch sky.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

export function buildMarsCanyon(): CustomMapDocument {
  const k = new LevelKit({
    id: 'mars-canyon',
    name: 'Mars Canyon',
    description: 'A colony where two canyons meet. Enemies walk the canyon floors, towers stand on the benches and mesas above.',
    size: 512,
    base: 'desert-gravel',
    seed: 6203,
  });
  for (const m of ['desert-gravel', 'mars-dunes', 'mars-dust', 'volcanic-rock', 'regolith', 'concrete']) k.layer(m);
  k.cliffs('cliff-ochre', 40);

  // ---- The plain at 26 m, dunes on it, mesas rising over it
  const plain = 26;
  for (let y = -300; y <= 300; y += 110) for (let x = -300; x <= 300; x += 110) k.level({ x, y }, { radius: 130, falloff: 0.4 }, plain);
  k.form('dunes', [{ x: 150, y: 200 }, { x: 230, y: 120 }], { radius: 70, strength: 0.7 }, 1);
  k.form('dunes', [{ x: -220, y: -200 }, { x: -120, y: -230 }], { radius: 60, strength: 0.7 }, 1);
  for (const [n, [x, y, r, h]] of ([[-160, 150, 46, 18], [190, -40, 40, 16], [-180, -120, 38, 14], [40, 200, 34, 12]] as const).entries()) {
    k.plateau({ x, y }, { radius: r, falloff: 0.45 }, plain + h);
    for (let l = 0; l < 3; l++) {
      const a = k.noise.hash(n, l, 21) * Math.PI * 2;
      const d = r * (0.4 + 0.3 * k.noise.hash(n, l, 22));
      k.plateau({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }, { radius: r * 0.55, falloff: 0.45 }, plain + h - 2);
    }
    k.erode({ x, y }, { radius: r * 1.3, strength: 1 }, 8);
  }

  // ---- Two canyons meeting in a basin, the colony on its south side
  const west = { x: -252, y: 30 };
  const north = { x: 120, y: 252 };
  const east = { x: 252, y: -235 };
  const basin = { x: 0, y: -30 };
  const hq = { x: 20, y: -120 };
  const westCanyon: MapPoint[] = [west, { x: -190, y: 50 }, { x: -140, y: 10 }, { x: -90, y: 40 }, { x: -50, y: 0 }, basin];
  const northCanyon: MapPoint[] = [north, { x: 100, y: 190 }, { x: 130, y: 130 }, { x: 70, y: 90 }, { x: 60, y: 30 }, basin];
  const eastCanyon: MapPoint[] = [east, { x: 205, y: -215 }, { x: 215, y: -165 }, { x: 165, y: -190 }, { x: 120, y: -160 }, { x: 135, y: -110 }, { x: 95, y: -90 }, { x: 70, y: -140 }, hq];
  const carve = (line: MapPoint[], floor: number, radius: number, seed: number) => {
    k.terrace(line, { radius: radius * 1.9, falloff: 0.5 }, 7, floor, 0.35);
    k.level(line, { radius, falloff: 0.35 }, floor);
    k.roughen(line, { radius: radius * 1.6, falloff: 0.6 }, 2.5, seed);
  };
  carve(westCanyon, 3, 24, 1);
  carve(northCanyon, 3, 22, 2);
  carve(eastCanyon, 2.5, 22, 3);
  carve([basin, hq], 2, 28, 4);
  k.level(basin, { radius: 48, falloff: 0.4 }, 3);
  for (const [dx, dy, r] of [[0, 0, 56], [30, -20, 40], [-30, -10, 40]] as const) k.level({ x: hq.x + dx, y: hq.y + dy }, { radius: r, falloff: 0.45 }, 2);
  for (const line of [westCanyon, northCanyon, eastCanyon]) k.erode(line, { radius: 34, strength: 1 }, 5);
  k.erode(basin, { radius: 90, strength: 1 }, 8);
  // A mesa left standing in the basin, a ramp up to a bench over the colony
  k.plateau({ x: -10, y: 10 }, { radius: 15, falloff: 0.3 }, 17);
  k.ramp({ x: 40, y: -165, h: 2 }, { x: 25, y: -195, h: 18 }, 7);

  // ---- Roads on the canyon floors
  const road = { width: 8, surface: [] as string[], lamps: false, adapt: false };
  k.road([west, { x: -190, y: 48 }, { x: -140, y: 12 }, { x: -90, y: 38 }, { x: -50, y: 2 }, { x: -20, y: -20 }, { x: 0, y: -60 }], road);
  k.road([north, { x: 100, y: 190 }, { x: 128, y: 130 }, { x: 70, y: 90 }, { x: 58, y: 30 }, { x: 20, y: -10 }, { x: 0, y: -60 }], road);
  k.road([{ x: 0, y: -60 }, hq], road);
  k.road(eastCanyon, road);
  k.spawn('West Canyon', west.x, west.y);
  k.spawn('North Canyon', north.x, north.y);
  k.spawn('East Rim', east.x, east.y);
  k.hq(hq.x, hq.y);

  // ---- Ground: dust and dunes on the plain, dark basalt sand gathered on the canyon floors with ochre gravel at
  // their foot, grey bedrock on the mesas, ochre walls, concrete at the colony
  k.biome('mars', [{ x: -200, y: 200 }, { x: 0, y: 230 }, { x: 220, y: 200 }, { x: 220, y: 60 }, { x: -230, y: -200 }, { x: -60, y: -220 }, { x: 200, y: -230 }], { radius: 70, strength: 0.55 });
  for (const line of [westCanyon, northCanyon, eastCanyon]) {
    k.paint('desert-gravel', line, { radius: 24, falloff: 0.8 }, 0.7);
    k.paint('mars-dust', line, { radius: 5, falloff: 0.8 }, 0.5);
  }
  // Dark sand drifts on the canyon floors and in the basin, patchy
  for (const [n, line] of [westCanyon, northCanyon, eastCanyon].entries()) {
    for (const [i, p] of line.entries()) {
      if (k.noise.hash(n, i, 31) < 0.4) continue;
      k.paint('volcanic-rock', { x: p.x + 8 * (k.noise.hash(n, i, 32) - 0.5), y: p.y + 8 * (k.noise.hash(n, i, 33) - 0.5) }, { radius: 14, falloff: 0.9 }, 0.55);
    }
  }
  k.paint('volcanic-rock', { x: basin.x - 20, y: basin.y + 15 }, { radius: 30, falloff: 0.9 }, 0.5);
  for (const [x, y, r] of [[-160, 150, 30], [190, -40, 26], [-180, -120, 24], [40, 200, 22], [-10, 10, 10]] as const) {
    k.paint('regolith', { x, y }, { radius: r, falloff: 0.7 }, 0.55);
  }
  for (const p of [{ x: -120, y: 220 }, { x: 160, y: 60 }, { x: -60, y: -230 }, { x: 230, y: -120 }]) k.paint('mars-dust', p, { radius: 50, falloff: 0.9 }, 0.6);
  // Butterscotch gravel plains between the dunes
  for (const p of [{ x: -220, y: 60 }, { x: -60, y: 120 }, { x: 100, y: 230 }, { x: 230, y: 130 }, { x: -140, y: -60 }, { x: 160, y: -120 }, { x: -200, y: -240 }, { x: 60, y: -240 }]) {
    k.paint('desert-gravel', p, { radius: 60, falloff: 0.9 }, 0.6);
  }
  k.paint('concrete', hq, { radius: 18, falloff: 0.5 }, 0.9);

  // ---- The colony: hub and modules, greenhouses, a landing pad, turbines and solar on the bench above
  const around = (r: number, n: number, phase: number): MapPoint[] =>
    Array.from({ length: n }, (_, i) => ({ x: hq.x + Math.cos(phase + (i / n) * Math.PI * 2) * r, y: hq.y + Math.sin(phase + (i / n) * Math.PI * 2) * r }));
  k.place('base-hub', hq.x + 16, hq.y - 16, { rotation: facing({ x: hq.x + 16, y: hq.y - 16 }, hq) });
  for (const [i, p] of around(32, 7, 0.2).entries()) {
    if (!k.free(p.x, p.y, 6)) continue;
    k.place(['greenhouse-dome', 'base-module', 'dome-white', 'greenhouse-dome', 'dome-glass', 'base-module', 'research-station'][i], p.x, p.y, { rotation: facing(p, hq) });
  }
  for (const p of around(20, 3, 1.4)) if (k.free(p.x, p.y, 3)) k.place('base-tunnel', p.x, p.y, { rotation: facing(p, hq) + Math.PI / 2 });
  const pad = { x: hq.x - 60, y: hq.y - 40 };
  k.paint('concrete', pad, { radius: 14, falloff: 0.4 }, 1);
  if (k.free(pad.x, pad.y, 8)) k.place('landing-pad', pad.x, pad.y);
  for (const [dx, dy] of [[24, 6], [24, -8]] as const) if (k.free(pad.x + dx, pad.y + dy, 4)) k.place('fuel-tanks', pad.x + dx, pad.y + dy);
  for (let i = 0; i < 6; i++) {
    const p = { x: 90 + (i % 3) * 14, y: -190 + Math.floor(i / 3) * 12 };
    if (k.free(p.x, p.y, 5)) k.place('solar-array', p.x, p.y, { rotation: 0.4 });
  }
  for (const [x, y] of [[-40, -170], [-60, -185], [-80, -170], [110, -60]] as const) if (k.free(x, y, 5)) k.place('wind-turbine', x, y, { rotation: 0.8 });
  for (const [x, y, a] of [[-150, 165, 'antenna-dish'], [190, -30, 'antenna-mast'], [40, 205, 'antenna-mast']] as const) {
    if (k.free(x, y, 5)) k.place(a, x, y, { rotation: facing({ x, y }, hq) });
  }
  for (const [x, y] of [[hq.x + 40, hq.y + 24], [-120, 20], [110, 120]] as const) if (k.free(x, y, 4)) k.place('rover', x, y, { rotation: facing({ x, y }, hq) });
  // Craters on the plain, boulders fallen into the canyons, rock towers on the horizon
  for (const [x, y, r] of [[-60, 190, 26], [210, 170, 22], [-220, -60, 20]] as const) {
    k.form('crater', { x, y }, { radius: r, strength: 1 }, 2);
    for (let i = 0; i < 4; i++) {
      const a = k.noise.hash(x, y, i) * Math.PI * 2;
      const p = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
      if (k.free(p.x, p.y, 6)) k.place('mars-crater-rim', p.x, p.y, { rotation: a + Math.PI / 2 });
    }
  }
  for (const line of [westCanyon, northCanyon, eastCanyon]) {
    k.scatter(['mars-boulder', 'mars-rock-large', 'mars-stone', 'boulder', 'mars-boulder', 'rock-basalt'], line, { radius: 30, strength: 0.6, falloff: 0.3 }, { density: 1.2, minDistance: 7, scaleMin: 0.7, scaleMax: 1.5 });
  }
  // Stones and dust ripples over the plain
  k.scatter(['mars-stone', 'stones-desert-scatter', 'boulder', 'stones-volcanic-scatter', 'mars-boulder'], [{ x: -200, y: 230 }, { x: 0, y: 150 }, { x: 200, y: 100 }, { x: -230, y: -190 }, { x: -100, y: -200 }, { x: 180, y: -230 }, { x: -220, y: 100 }], { radius: 55, strength: 0.7 }, { density: 2.5, minDistance: 4, scaleMin: 0.6, scaleMax: 1.4 });
  for (const [x, y, a, sc] of [[-250, 240, 'mesa', 0.9], [245, 240, 'sandstone-pillar', 1.3], [250, 30, 'mars-cliff', 1], [-245, -240, 'mesa', 0.8], [-30, -245, 'sandstone-pillar', 1.2]] as const) {
    if (k.free(x, y, 8)) k.place(a, x, y, { scale: sc, rotation: x * 0.01 });
  }

  k.trimLayers(7);
  // Butterscotch sky, the sun low in the dust
  k.environment({ biome: 'mars', sky: 'day', sunAzimuth: 230, sunElevation: 30, fogDensity: 0.0012, tint: '#fff0e2' });
  return k.finish();
}
