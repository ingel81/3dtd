/**
 * Ember crater: a volcano's crater with a lava lake. A road spirals from
 * the rim down the crater wall to an obsidian island in the lake, the HQ on
 * it, reached over a basalt lava bridge. Three spawns on the outer slopes
 * join the spiral at different turns; the ledges between the windings are
 * the build ground. Glow cracks, lava flows down the outer slopes, a forge
 * on the rim, smoke and embers.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { nearestOnPolyline } from '../../../src/app/editor/ops/path-graph';
import { facing, LevelKit } from './kit';

export function buildEmberCrater(): CustomMapDocument {
  const k = new LevelKit({
    id: 'ember-crater',
    name: 'Ember Crater',
    description: 'A road spirals down a volcano\'s crater to the HQ on an obsidian island in a lava lake. Three spawns on the outer slopes join the spiral.',
    size: 512,
    base: 'cinders',
    seed: 7707,
  });
  for (const m of ['cinders', 'scorched-ground', 'volcanic-rock', 'obsidian', 'lava', 'lava-crust', 'basalt', 'brimstone']) k.layer(m);
  k.cliffs('basalt', 38);

  // ---- The volcano: a broad cone, the crater in its top, an island in the middle
  k.generate('hills', 77, 0.25);
  k.raise({ x: 0, y: 0 }, { radius: 200, falloff: 1 }, 26);
  k.raise({ x: 0, y: 0 }, { radius: 160, falloff: 1 }, 14);
  k.form('crater', { x: 0, y: 0 }, { radius: 200, strength: 1 }, 6);
  // Rain and rockfall: gullies and fans down the inner wall and the outer slopes, before the road is graded in
  const ring = (r: number): MapPoint[] => Array.from({ length: 25 }, (_, i) => ({ x: Math.cos((i / 24) * Math.PI * 2) * r, y: Math.sin((i / 24) * Math.PI * 2) * r }));
  k.erode(ring(95), { radius: 40, strength: 1 }, 4);
  k.erode(ring(165), { radius: 45, strength: 1 }, 3);
  // The lava lake dug into the crater floor, the island left standing in it
  const lavaLevel = Math.round((k.h(0, 0) - 0.5) * 10) / 10;
  const lava = k.body(lavaLevel, 'lava');
  k.lake({ x: 0, y: 0 }, { radius: 50, falloff: 0.35 }, 3, lava, 14);
  const island = { x: 0, y: 0 };
  k.plateau(island, { radius: 30, falloff: 0.35 }, lavaLevel + 3.5);

  // ---- The spiral: from the south rim round and down to the lake shore, then the bridge to the island
  const spiral: MapPoint[] = [];
  const turns = 1.1;
  for (let i = 0; i <= 120; i++) {
    const f = i / 120;
    const a = -Math.PI / 2 + f * turns * Math.PI * 2;
    const r = 116 - 64 * f;
    spiral.push({ x: Math.round(Math.cos(a) * r * 10) / 10, y: Math.round(Math.sin(a) * r * 10) / 10 });
  }
  const end = spiral[spiral.length - 1];
  const south = { x: 0, y: -252 };
  const road = { width: 8, surface: [] as string[], lamps: false };
  k.road([south, { x: 10, y: -190 }, { x: -6, y: -150 }, spiral[0]], road);
  k.road(spiral, { ...road, snap: 3 });
  // Spawns from the west and the east join the spiral where it passes nearest
  const join = (from: MapPoint) => {
    let best = spiral[0];
    for (const p of spiral.slice(10, 90)) if (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)) best = p;
    return best;
  };
  const west = { x: -252, y: 70 };
  const east = { x: 252, y: 40 };
  const wj = join(west);
  const ej = join(east);
  k.road([west, { x: (west.x + wj.x) / 2, y: (west.y + wj.y) / 2 + 12 }, wj], road);
  k.road([east, { x: (east.x + ej.x) / 2, y: (east.y + ej.y) / 2 - 10 }, ej], road);
  // The bridge: a basalt arch over the lava, the ground under it built up to its deck
  const toIsland = { x: end.x * 0.42, y: end.y * 0.42 };
  // The bridge: a path edge of kind bridge in basalt, the renderer lays its deck from the shore to the island
  k.path([end, toIsland], 8, 'bridge', 3, 'lava');
  k.path([toIsland, island], 8, 'road', 3);
  k.spawn('South Slope', south.x, south.y);
  k.spawn('West Slope', west.x, west.y);
  k.spawn('East Slope', east.x, east.y);
  k.hq(island.x, island.y);


  // ---- Ground: hell outside, cracked crater walls, lava flows down the outer slopes
  k.biome('hell', [{ x: -200, y: -200 }, { x: -220, y: 180 }, { x: 0, y: 220 }, { x: 210, y: 190 }, { x: 210, y: -190 }], { radius: 70, strength: 0.6 });
  k.cracks([{ x: -110, y: 40 }, { x: -60, y: 100 }, { x: 40, y: 105 }, { x: 105, y: 30 }, { x: 80, y: -70 }], { radius: 30, strength: 0.8 }, 1);
  k.paint('volcanic-rock', [{ x: 0, y: -100 }, { x: -100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 0 }], { radius: 50, falloff: 1 }, 0.4);
  k.paint('obsidian', island, { radius: 26, falloff: 0.6 }, 0.9);
  k.paint('brimstone', [{ x: -170, y: -120 }, { x: 160, y: 150 }], { radius: 30, falloff: 1 }, 0.6);
  for (const line of [
    [{ x: -130, y: -110 }, { x: -170, y: -170 }, { x: -230, y: -230 }],
    [{ x: 120, y: 120 }, { x: 170, y: 175 }, { x: 240, y: 230 }],
  ]) {
    k.river(line, { kind: 'lava', width: 7, depth: 1.2, bank: 6, reeds: false, bridges: false });
  }

  // ---- The island, the rim: spikes, the gate, braziers along the spiral, the forge, smoke
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const p = { x: Math.cos(a) * 24, y: Math.sin(a) * 24 };
    if (nearestOnPolyline([end, toIsland, island], p)!.dist < 8) continue;
    k.place(i % 2 ? 'obsidian-spikes' : 'obsidian-slabs', p.x, p.y, { rotation: a, scale: 1.2 });
  }
  k.place('hell-gate', -12, 12, { rotation: facing({ x: -12, y: 12 }, end) });
  for (let i = 8; i < spiral.length - 4; i += 14) {
    const p = spiral[i];
    const q = spiral[i + 1];
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    k.place('brazier', p.x - ((q.y - p.y) / d) * 6.5, p.y + ((q.x - p.x) / d) * 6.5);
  }
  k.place('forge', 30, -150, { rotation: facing({ x: 30, y: -150 }, { x: 0, y: -252 }) });
  k.place('anvil', 22, -158, { rotation: 0.4 });
  k.place('altar', -150, 30, { rotation: 0.2 });
  for (const [x, y] of [[-30, -20], [25, 30], [-140, -60], [130, -40], [-60, 150], [80, -140], [0, -60]] as const) k.place('fx-smoke', x, y, { scale: 1.4 });
  // Embers only over the lava: the brush's ember spots elsewhere go, a ring of them round the lake shore
  k.doc.objects = k.doc.objects.filter((o) => o.asset !== 'fx-embers');
  for (const p of ring(44).slice(0, 24).filter((_, i) => i % 2 === 0)) k.place('fx-embers', p.x, p.y, { scale: 1.2 });
  // Glowing lava rocks and slabs on the crater wall: they light the ledges between the windings
  k.scatter(['lava-rock', 'lava-rock', 'lava-rock-large', 'rock-volcanic', 'obsidian-slabs'], ring(80), { radius: 22, strength: 0.8 }, { density: 1.6, minDistance: 8 });
  k.scatter(['rock-volcanic', 'rock-pumice', 'stones-volcanic-scatter'], ring(120), { radius: 25, strength: 0.8 }, { density: 2, minDistance: 6 });

  // Five ground materials load faster than eight; the least used go
  k.trimLayers(5);
  // Dusk over ash-dark ground: the lava and the rocks glow, and the slopes keep their shape in the low red light
  k.environment({ biome: 'temperate', sky: 'dusk', sunAzimuth: 250, sunElevation: 14, fogDensity: 0.0006, tint: '#ffcfb0' });
  return k.finish();
}
