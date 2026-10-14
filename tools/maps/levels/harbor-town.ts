/**
 * Harbor town: a port on a bay at dusk. Streets of brick and apartment
 * blocks run down to the waterfront, where the HQ holds the harbor master's
 * square between the quay, the cranes and the container yard. Three columns
 * come down the streets from the hills behind the town; a mole with a
 * lighthouse closes the harbor, ships and fishing boats lie at the piers.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

export function buildHarborTown(): CustomMapDocument {
  const k = new LevelKit({
    id: 'harbor-town',
    name: 'Harbor Town',
    description: 'A port on a bay at dusk. Three columns come down the streets to the HQ on the waterfront, between quay, cranes and the container yard.',
    size: 512,
    base: 'pavers',
    seed: 8818,
  });
  for (const m of ['pavers', 'asphalt', 'sidewalk', 'brick-paving', 'concrete', 'sand-coast', 'pebbles', 'grass-leafy']) k.layer(m);
  k.cliffs('concrete', 45);

  // ---- The land: the town on a gentle slope up to the north, a quay wall, the bay to the south
  const shore = -156;
  for (let x = -300; x <= 300; x += 60) {
    for (let y = shore + 20; y <= 300; y += 60) k.level({ x, y }, { radius: 70, falloff: 0.4 }, 4 + Math.max(0, y - shore) * 0.025);
    for (let y = shore - 50; y >= -300; y -= 40) k.level({ x, y }, { radius: 45, falloff: 0.4 }, -7);
  }

  // ---- The streets: on the city grid (64 m), from the hills behind the town to the waterfront
  const hq = { x: 0, y: -128 };
  const north = { x: -64, y: 252 };
  const west = { x: -252, y: 0 };
  const east = { x: 252, y: 128 };
  const northLine: MapPoint[] = [north, { x: -64, y: 64 }, { x: 0, y: 64 }, hq];
  const westLine: MapPoint[] = [west, { x: -128, y: 0 }, { x: -128, y: -128 }, hq];
  const eastLine: MapPoint[] = [east, { x: 128, y: 128 }, { x: 128, y: -64 }, { x: 64, y: -64 }, { x: 64, y: -128 }, hq];
  for (const line of [northLine, westLine, eastLine]) k.path(line, 10, 'road', 2);
  k.spawn('Hill Road', north.x, north.y);
  k.spawn('West Gate', west.x, west.y);
  k.spawn('East Road', east.x, east.y);
  k.hq(hq.x, hq.y);

  // ---- The town: the street grid with brick and apartment blocks, a little green up the hill
  k.biome('city', [{ x: -160, y: 160 }, { x: 0, y: 160 }, { x: 160, y: 160 }, { x: -160, y: 40 }, { x: 0, y: 30 }, { x: 160, y: 40 }, { x: -160, y: -80 }, { x: 0, y: -70 }, { x: 160, y: -70 }], { radius: 100, strength: 0.85 });
  k.paint('grass-leafy', [{ x: -200, y: 230 }, { x: 200, y: 230 }], { radius: 40, falloff: 1 }, 0.6);
  k.scatter(['tree-oak', 'tree-maple', 'shrub-wide'], [{ x: -200, y: 230 }, { x: 200, y: 230 }], { radius: 36, strength: 0.8 }, { density: 3, minDistance: 6 });

  // ---- The quay: laid after the town's ground, whose smoothing would round its edge. The land's slopes reach
  // into the bay (they left mounds by the piers): the whole basin first, then the quay wall as one straight step
  k.level([{ x: -256, y: shore - 60 }, { x: 256, y: shore - 60 }], { radius: 46, falloff: 0.2 }, -7);
  k.level([{ x: -256, y: shore + 10 }, { x: 256, y: shore + 10 }], { radius: 11, falloff: 0.05 }, 4.4);
  k.level([{ x: -256, y: shore - 14 }, { x: 256, y: shore - 14 }], { radius: 12, falloff: 0.05 }, -6);
  // A beach in the west corner
  k.ramp({ x: -250, y: shore + 4, h: 4 }, { x: -250, y: shore - 30, h: -2 }, 30, 0.8);
  // The mole out to the lighthouse
  k.level([{ x: 150, y: shore }, { x: 190, y: -200 }, { x: 205, y: -228 }], { radius: 9, falloff: 0.3 }, 3);
  const sea = k.water(0, 'sea', '#24566a');
  k.sea(sea);

  // ---- The waterfront: paved quay, the harbor master's square at the HQ, cranes, containers, warehouses
  k.erase({ x: 0, y: -130 }, 30);
  k.paint('concrete', [{ x: -256, y: shore + 14 }, { x: 256, y: shore + 14 }], { radius: 16, falloff: 0.4 }, 1);
  k.paint('brick-paving', hq, { radius: 20, falloff: 0.5 }, 1);
  k.row('harbor-quay', [{ x: -200, y: shore + 3 }, { x: 140, y: shore + 3 }], 12, { turn: Math.PI });
  for (const x of [-90, -40, 60]) if (k.free(x, shore + 12, 6)) k.place('harbor-crane', x, shore + 12, { rotation: Math.PI });
  // The container yard east of the HQ, stacks in rows
  const yard = { x: 100, y: -130 };
  k.erase(yard, 22);
  for (let i = 0; i < 12; i++) {
    const p = { x: yard.x - 18 + (i % 4) * 12, y: yard.y - 10 + Math.floor(i / 4) * 10 };
    if (k.free(p.x, p.y, 3)) k.place(['container-red', 'container-blue', 'container-green'][i % 3], p.x, p.y, { rotation: Math.PI / 2 });
  }
  for (const [x, y] of [[-100, -120], [-160, -125], [160, -110]] as const) {
    k.erase({ x, y }, 12);
    if (k.free(x, y, 8)) k.place('warehouse', x, y, { rotation: facing({ x, y }, { x, y: y + 10 }) });
  }
  for (const [x, y, a] of [[-20, -112, 'crate-long'], [18, -110, 'barrel-old'], [-24, -146, 'crate-flat'], [26, -146, 'trade-goods'], [12, -150, 'barrel-small']] as const) {
    if (k.free(x, y, 2)) k.place(a, x, y, { rotation: x * 0.05 });
  }
  // Piers and boats, a ship at the quay, the lighthouse on the mole, buoys at the harbor mouth
  for (const x of [-180, -140]) {
    k.row('pier', [{ x, y: shore - 2 }, { x, y: shore - 41 }], 3);
    k.place('pier-end', x, shore - 44);
    k.place('fishing-boat', x + 10, shore - 26, { rotation: 0 });
  }
  k.place('ship', -20, shore - 30, { rotation: Math.PI / 2 });
  k.place('rowboat', -230, shore - 14, { rotation: 0.6 });
  k.place('lighthouse', 205, -228);
  for (const [x, y, a] of [[120, -230, 'buoy-red'], [70, -240, 'buoy-green'], [-60, -230, 'buoy-red']] as const) k.place(a, x, y);
  k.scatter(['pebbles-scatter', 'rock-coast'], { x: -235, y: shore - 10 }, { radius: 24, strength: 0.7 }, { density: 2, minDistance: 4 });

  k.trimLayers(6);
  // Dusk over the bay: the lamps come on in the streets, the sea catches the last light
  k.environment({ biome: 'city', sky: 'dusk', sunAzimuth: 250, sunElevation: 20, fogDensity: 0.0008, tint: '#ffe2c8' });
  return k.finish();
}
