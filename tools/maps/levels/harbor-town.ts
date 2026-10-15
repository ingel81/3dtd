/**
 * Harbor town: a port on a bay at dusk. Streets of brick and apartment
 * blocks run to the waterfront, where the HQ holds the harbor master's
 * square between the quay, the cranes and the container yard. Three columns
 * come down the streets from the edge of the town; a mole with a
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
  for (const m of ['pavers', 'asphalt', 'sidewalk', 'brick-paving', 'concrete', 'sand-coast', 'sand', 'grass-leafy']) k.layer(m);
  // The quay walls are the map's only sheer faces: stone blocks, not an earth bank
  k.cliffs('stone-blocks', 45);

  // ---- The land: the town on level ground behind a quay wall, the bay to the south. The city brush levels each
  // block to one height while the streets keep theirs: on the gentle slope the town once stood on, the blocks
  // stood as terraces with earth walls up to 3 m over the streets
  const shore = -156;
  // The quay's top over the water: a harbour wall, not a cliff
  const quayTop = 2.6;
  for (let x = -300; x <= 300; x += 60) {
    for (let y = shore + 20; y <= 300; y += 60) k.level({ x, y }, { radius: 70, falloff: 0.4 }, quayTop);
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

  // ---- The hill behind the town: the church over the roofs, seen from the quay down the streets; green flanks,
  // the churchyard walled on its top. The blocks that stood there go
  const hill = { x: 128, y: 222 };
  k.erase(hill, 78);
  k.raise(hill, { radius: 76, falloff: 0.95 }, 44);
  k.smooth(hill, { radius: 70, falloff: 0.8 }, 3);
  const crown = k.h(hill.x, hill.y);
  k.plateau(hill, { radius: 30, falloff: 0.5 }, crown, 1);
  k.paint('grass-leafy', hill, { radius: 70, falloff: 0.6 }, 1);
  k.scatter(['tree-oak', 'tree-maple', 'tree-birch', 'shrub-wide', 'bush'], [{ x: hill.x - 40, y: hill.y - 20 }, { x: hill.x + 35, y: hill.y - 30 }, { x: hill.x - 10, y: hill.y + 40 }, { x: hill.x + 45, y: hill.y + 20 }], { radius: 26, strength: 0.8 }, { density: 3, minDistance: 6 });
  const church = k.place('chapel', hill.x, hill.y, { rotation: Math.PI });
  k.row('wall-stone', [{ x: hill.x - 16, y: hill.y - 14 }, { x: hill.x + 16, y: hill.y - 14 }, { x: hill.x + 16, y: hill.y + 14 }, { x: hill.x - 16, y: hill.y + 14 }, { x: hill.x - 16, y: hill.y - 14 }], 4.4, { turn: Math.PI / 2 });
  for (const [dx, dy] of [[-10, 8], [-6, 10], [9, 9], [11, 4]] as const) k.place('graves', hill.x + dx, hill.y + dy, { rotation: church.rotation });

  // ---- The quay: laid after the town's ground, whose smoothing would round its edge. The land's slopes reach
  // into the bay (they left mounds by the piers): the whole basin first, then the quay wall as one straight
  // step from the beach to the east edge, bollards and lamps along its edge (the quay's promenade)
  k.level([{ x: -256, y: shore - 60 }, { x: 256, y: shore - 60 }], { radius: 46, falloff: 0.2 }, -7);
  k.quay([{ x: -234, y: shore }, { x: 258, y: shore }], { top: quayTop, bed: -6, land: 'left', reach: 40, spacing: 12 });
  // A sandy beach in the west corner, down from the quay's end: the ramp, then the beach brush once the bay is
  // filled (sand to the water, the wet strip, driftwood, dune grass, shore pines)
  k.ramp({ x: -250, y: shore + 4, h: quayTop }, { x: -250, y: shore - 30, h: -2 }, 30, 0.8);
  // The mole out to the lighthouse: sheer stone sides like the quay, its top a little under the quay's
  k.level([{ x: 150, y: shore - 4 }, { x: 190, y: -200 }, { x: 205, y: -228 }], { radius: 6, falloff: 0.05 }, quayTop - 0.4);
  const sea = k.water(0, 'sea', '#24566a');
  k.sea(sea);
  k.biome('beach', { x: -246, y: shore - 8 }, { radius: 20, strength: 1 }, 1);

  // ---- The waterfront: paved quay, the harbor master's square at the HQ, cranes, containers, warehouses
  k.erase({ x: 0, y: -130 }, 30);
  k.paint('concrete', [{ x: -256, y: shore + 14 }, { x: 256, y: shore + 14 }], { radius: 16, falloff: 0.4 }, 1);
  k.paint('brick-paving', hq, { radius: 20, falloff: 0.5 }, 1);
  // Two steel portal cranes over the ship's berth, their containers on the hook over the water; the wooden jib cranes
  // with a crate on theirs by the fishing piers and the yard
  for (const x of [-56, 18]) if (k.free(x, shore + 6, 6)) k.place('dock-crane', x, shore + 6, { rotation: Math.PI });
  for (const x of [-110, 60]) if (k.free(x, shore + 12, 2)) k.place('harbor-crane', x, shore + 12, { rotation: Math.PI });
  // The container yard east of the HQ, stacks in rows
  const yard = { x: 100, y: -130 };
  k.erase(yard, 22);
  for (let i = 0; i < 12; i++) {
    const p = { x: yard.x - 18 + (i % 4) * 12, y: yard.y - 10 + Math.floor(i / 4) * 10 };
    if (k.free(p.x, p.y, 3)) k.place(['container-red', 'container-blue', 'container-green'][i % 3], p.x, p.y, { rotation: Math.PI / 2 });
  }
  for (const [x, y] of [[-100, -120], [-160, -125], [160, -110]] as const) {
    k.erase({ x, y }, 12);
    if (k.free(x, y, 8)) k.chimney(k.place('warehouse', x, y, { rotation: facing({ x, y }, { x, y: y + 10 }) }));
  }
  for (const [x, y, a] of [[-20, -112, 'crate-long'], [18, -110, 'barrel-old'], [-24, -146, 'crate-flat'], [26, -146, 'trade-goods'], [12, -150, 'barrel-small']] as const) {
    if (k.free(x, y, 2)) k.place(a, x, y, { rotation: x * 0.05 });
  }
  // The market on the harbour master's square: stalls round the HQ, their fronts to it, goods between them
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const p = { x: hq.x + Math.cos(a) * 20, y: hq.y + Math.sin(a) * 18 };
    if (k.free(p.x, p.y, 2)) k.place(i % 2 ? 'market-stall-blue' : 'market-stall-red', p.x, p.y, { rotation: facing(p, hq) });
  }
  for (const [dx, dy, a] of [[-11, 6, 'basket'], [10, -8, 'barrel-small'], [-9, -9, 'crate'], [12, 7, 'trade-goods']] as const) {
    if (k.free(hq.x + dx, hq.y + dy, 1)) k.place(a, hq.x + dx, hq.y + dy, { rotation: dx });
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
  // A second ship riding at anchor in the bay, fishing boats out
  // TODO(E179): ships with lit windows
  k.place('ship', 90, -215, { rotation: 2.6, scale: 0.85 });
  for (const [x, y, r] of [[30, -200, 0.4], [-110, -225, 2.1]] as const) k.place('fishing-boat', x, y, { rotation: r });
  k.scatter(['pebbles-scatter'], { x: -235, y: shore - 10 }, { radius: 24, strength: 0.7 }, { density: 2, minDistance: 4 });
  // Banners on the harbour master's square, waving in the wind off the bay
  for (const [dx, dy, a] of [[-27, 10, 'banner-blue'], [27, 10, 'banner-red'], [-27, -14, 'banner-red'], [27, -14, 'banner-blue']] as const) {
    if (k.free(hq.x + dx, hq.y + dy, 0.5)) k.place(a, hq.x + dx, hq.y + dy, { rotation: Math.PI });
  }

  // ---- Life: gulls over the harbour and the mole, fishing boats going out past the ships and back, rowing boats
  // drifting in the east basin, a fog bank on the open sea beyond the mole; the town's murmur, surf on the mole and
  // the beach
  // TODO(E190): gull calls, a ship's horn
  k.lifeArea('birds', [{ x: -200, y: -168 }, { x: 140, y: -168 }, { x: 215, y: -215 }, { x: 160, y: -250 }, { x: -200, y: -245 }], { species: 'gulls', height: 25, density: 1.2 });
  k.lifeArea('birds', [{ x: -256, y: -150 }, { x: -200, y: -150 }, { x: -200, y: -215 }, { x: -256, y: -215 }], { species: 'gulls', height: 18, density: 0.6 });
  k.lifeRoute('boats', [{ x: -160, y: -212 }, { x: -40, y: -232 }, { x: 60, y: -240 }, { x: 150, y: -246 }, { x: 250, y: -246 }], { asset: 'fishing-boat' });
  k.lifeArea('boats', [{ x: 38, y: -168 }, { x: 140, y: -168 }, { x: 150, y: -192 }, { x: 46, y: -192 }], { density: 0.5 });
  k.lifeArea('fog', [{ x: 214, y: -200 }, { x: 256, y: -200 }, { x: 256, y: -256 }, { x: -60, y: -256 }, { x: 150, y: -240 }], { density: 0.7, quality: 'high' });
  k.lifeRoute('sound', [{ x: 150, y: shore - 4 }, { x: 190, y: -200 }, { x: 205, y: -228 }], { sound: 'surf', volume: 0.6 });
  k.lifeRoute('sound', [{ x: -256, y: -150 }, { x: -232, y: -186 }], { sound: 'surf', volume: 0.5 });
  k.lifeSettings({ flags: true, ambience: { sound: 'city', volume: 0.4 } });

  k.trimLayers(7);
  // Dusk over the bay: the lamps come on in the streets, the sea catches the last light
  k.environment({ biome: 'city', sky: 'dusk', sunAzimuth: 250, sunElevation: 20, fogDensity: 0.0008, tint: '#ffe2c8' });
  return k.finish();
}
