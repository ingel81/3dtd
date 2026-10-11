/**
 * Ruined city: a downtown after the end. The street grid still stands
 * between burnt-out blocks; wrecks rust at the curbs, rubble spills over
 * the sidewalks, smoke rises. The survivors hold a crossroads with
 * sandbags, barricades and tank traps; three columns come down the avenues
 * from the north, the east and the south. The towers stand on the corners
 * and in the gaps where blocks have fallen.
 */
import type { CustomMapDocument, MapObject, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { facing, LevelKit } from './kit';

/** Ruined stand-ins for the city biome's whole buildings */
const RUINED: Record<string, string> = {
  'apartment-block': 'apartment-block-ruined',
  'apartment-block-tall': 'apartment-block-ruined',
  'office-tower': 'tower-stump',
  'brick-block': 'brick-block-ruined',
  'brick-house': 'brick-block-ruined',
  'house-tall': 'brick-block-ruined',
  shop: 'warehouse-rusty',
  'car-red': 'car-wreck',
  'car-blue': 'car-wreck-b',
  'car-white': 'car-burnt',
  'car-grey': 'car-wreck',
  pickup: 'pickup-wreck',
  truck: 'truck-wreck',
  bus: 'bus-burnt',
  'tree-street': 'tree-charred',
  'tree-oak-young': 'tree-dead',
  'tree-maple': 'tree-dead-pale',
  'street-lamp': 'power-pole-fallen',
};

export function buildRuinedCity(): CustomMapDocument {
  const k = new LevelKit({
    id: 'ruined-city',
    name: 'Ruined City',
    description: 'A downtown after the end: three columns come down the avenues to the survivors\' barricaded crossroads. Build on the corners and in the fallen blocks.',
    size: 512,
    base: 'rubble',
    seed: 3313,
  });
  for (const m of ['rubble', 'asphalt-cracked', 'sidewalk', 'concrete-damaged', 'debris', 'concrete-moss']) k.layer(m);
  k.cliffs('concrete-damaged', 50);

  // ---- Flat ground, a few shell craters
  k.generate('flat', 13, 0.1);
  for (const [x, y, r] of [[-100, 60, 14], [160, -170, 16], [-170, -40, 12], [30, 200, 13], [190, 70, 11]] as const) {
    k.form('crater', { x, y }, { radius: r, strength: 1 }, 1);
  }

  // ---- The avenues: on the city grid (64 m), from three edges to the held crossroads
  const hq = { x: 64, y: -64 };
  const north = { x: -192, y: 252 };
  const east = { x: 252, y: 192 };
  const south = { x: -192, y: -252 };
  const join = { x: 64, y: 0 };
  const northLine: MapPoint[] = [north, { x: -192, y: 128 }, { x: -64, y: 128 }, { x: -64, y: 0 }, join, hq];
  const eastLine: MapPoint[] = [east, { x: 128, y: 192 }, { x: 128, y: -64 }, hq];
  const southLine: MapPoint[] = [south, { x: -192, y: -128 }, { x: 0, y: -128 }, { x: 0, y: -64 }, hq];
  // Straight edges along the grid, not the Road line's curves: the avenues keep their corners
  for (const line of [northLine, eastLine, southLine]) k.path(line, 10, 'road', 2);
  k.spawn('North Avenue', north.x, north.y);
  k.spawn('East Bridge', east.x, east.y);
  k.spawn('South Gate', south.x, south.y);
  k.hq(hq.x, hq.y);

  // ---- The city: the street grid with its blocks, then everything in it ruined; rubble and wrecks over all
  k.biome('city', [{ x: -160, y: 160 }, { x: 0, y: 160 }, { x: 160, y: 160 }, { x: -160, y: 0 }, { x: 0, y: 0 }, { x: 160, y: 0 }, { x: -160, y: -160 }, { x: 0, y: -160 }, { x: 160, y: -160 }], { radius: 110, strength: 0.9 });
  k.doc.objects = k.doc.objects
    .map((o): MapObject | null => {
      const ruined = RUINED[o.asset];
      if (o.asset in RUINED) return { ...o, asset: ruined };
      // Benches, signs and stops mostly gone
      if (['bench', 'bus-stop', 'street-sign', 'hydrant', 'bollards', 'trash-can'].includes(o.asset)) return k.noise.hash(o.x, o.y, 1) < 0.35 ? o : null;
      return o;
    })
    .filter((o): o is MapObject => o !== null);
  // Some blocks fell altogether: rubble fields where the towers can stand
  for (const [x, y] of [[-96, 96], [96, -32], [-32, -96], [160, 96], [-160, -96]] as const) {
    k.erase({ x, y }, 26);
    k.paint('rubble', { x, y }, { radius: 26, falloff: 0.6 }, 1);
    k.scatter(['rubble-pile', 'rubble-pile-large', 'barrel-rusty-tipped', 'tyres'], { x, y }, { radius: 22, strength: 0.7 }, { density: 2, minDistance: 6 });
  }
  // Wrecks, barrels and rubble strewn over the blocks and the streets, debris patches on the ground
  const spots: MapPoint[] = [];
  for (let x = -224; x <= 224; x += 64) for (let y = -224; y <= 224; y += 64) spots.push({ x: x + 32 * (k.noise.hash(x, y, 3) - 0.5), y: y + 32 * (k.noise.hash(y, x, 4) - 0.5) });
  k.scatter(['rubble-pile', 'barrel-rusty', 'barrel-rusty-tipped', 'tyres', 'toxic-barrel', 'barrels-broken', 'car-wreck', 'car-burnt'], spots, { radius: 18, strength: 0.6 }, { density: 1.5, minDistance: 5 });
  k.scatter(['grass-tall-dry', 'nettles', 'thorns'], spots, { radius: 22, strength: 0.6 }, { density: 6, minDistance: 2 });
  for (const p of spots.filter((_, i) => i % 3 === 0)) k.paint('debris', p, { radius: 14, falloff: 1 }, 0.5);
  for (const line of [northLine, eastLine, southLine]) k.paint('asphalt-cracked', line, { radius: 6, falloff: 0.8 }, 0.9);

  // ---- The held crossroads: sandbag rings, barricades across the side streets, tank traps out front, a camp
  k.paint('concrete-damaged', hq, { radius: 18, falloff: 0.5 }, 0.8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const p = { x: hq.x + Math.cos(a) * 18, y: hq.y + Math.sin(a) * 18 };
    if (k.free(p.x, p.y, 2.5)) k.place('sandbags', p.x, p.y, { rotation: a + Math.PI / 2 });
  }
  for (const [x, y] of [[hq.x + 30, hq.y], [hq.x, hq.y - 30], [hq.x + 40, hq.y + 8]] as const) if (k.free(x, y, 4)) k.place('barricade', x, y, { rotation: facing({ x, y }, hq) });
  for (const [x, y] of [[hq.x - 26, hq.y + 30], [hq.x + 22, hq.y + 40], [hq.x - 40, hq.y - 20]] as const) if (k.free(x, y, 3)) k.place('tank-trap', x, y, { rotation: x * 0.1 });
  for (const [dx, dy, a] of [[12, -24, 'campfire'], [20, -30, 'supply-crates'], [26, -20, 'ammo-crate'], [-22, -26, 'barrel-stove'], [-28, -18, 'jerrycan']] as const) {
    if (k.free(hq.x + dx, hq.y + dy, 2)) k.place(a, hq.x + dx, hq.y + dy, { rotation: facing({ x: hq.x + dx, y: hq.y + dy }, hq) });
  }
  // Burnt-out tanks and buses blocking side streets, smoke over the ruins
  for (const [x, y, a] of [[-64, -64, 'tank-burnt'], [128, -128, 'bus-wreck'], [-128, 64, 'tank-wreck'], [192, -64, 'truck-wreck'], [0, 192, 'bus-burnt']] as const) {
    if (k.free(x, y, 5)) k.place(a, x, y, { rotation: x * 0.02 });
  }
  for (const [x, y] of [[-96, 96], [160, 96], [-160, -96], [96, -160], [-200, 40], [30, 30]] as const) k.place('fx-smoke', x, y, { scale: 1.5 });

  k.trimLayers(5);
  // Overcast, ash in the air
  k.environment({ biome: 'apocalypse', sky: 'overcast', sunAzimuth: 200, sunElevation: 35, fogDensity: 0.0016, tint: '#e6dccb', weather: 'fog', weatherStrength: 0.3 });
  return k.finish();
}
