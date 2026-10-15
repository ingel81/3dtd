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
  // The rim: a high jagged wall round the crater, peaks broken out of it, before rain cuts it up
  const rimR = 142;
  k.raise(ring(rimR), { radius: 16, falloff: 1 }, 5);
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5 * k.noise.hash(i, 3, 71)) / 16) * Math.PI * 2;
    const r = rimR + 10 * (k.noise.hash(i, 5, 72) - 0.5);
    k.raise({ x: Math.cos(a) * r, y: Math.sin(a) * r }, { radius: 9 + 6 * k.noise.hash(i, 7, 73), falloff: 0.9 }, 6 + 8 * k.noise.hash(i, 9, 74));
  }
  k.roughen(ring(rimR), { radius: 26, falloff: 0.8 }, 3, 7707);
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
  const southLine: MapPoint[] = [south, { x: 10, y: -190 }, { x: -6, y: -150 }, spiral[0]];
  const westLine: MapPoint[] = [west, { x: (west.x + wj.x) / 2, y: (west.y + wj.y) / 2 + 12 }, wj];
  const eastLine: MapPoint[] = [east, { x: (east.x + ej.x) / 2, y: (east.y + ej.y) / 2 - 10 }, ej];
  // A pass through the rim for each road coming in: a ramp from outside the wall to where the road meets the spiral
  for (const line of [southLine, westLine, eastLine]) {
    const outside = [...line].reverse().find((p) => Math.hypot(p.x, p.y) > rimR + 24) ?? line[0];
    const inner = line[line.length - 1];
    const toward = { x: inner.x - outside.x, y: inner.y - outside.y };
    // From the point where the line leaves the rim's reach on the outside
    let t = 0;
    while (t < 1 && Math.hypot(outside.x + toward.x * t, outside.y + toward.y * t) > rimR + 24) t += 0.01;
    k.ramp({ x: outside.x + toward.x * t, y: outside.y + toward.y * t }, inner, 18);
  }
  k.road(southLine, road);
  k.road(spiral, { ...road, snap: 3 });
  k.road(westLine, road);
  k.road(eastLine, road);
  // The bridge: a basalt arch over the lava, the ground under it built up to its deck
  const toIsland = { x: end.x * 0.42, y: end.y * 0.42 };
  // The bridge: a path edge of kind bridge in basalt, the renderer lays its deck from the shore to the island
  k.path([end, toIsland], 8, 'bridge', 3, 'lava');
  k.path([toIsland, island], 8, 'road', 3);
  k.spawn('South Slope', south.x, south.y);
  k.spawn('West Slope', west.x, west.y);
  k.spawn('East Slope', east.x, east.y);
  k.hq(island.x, island.y);


  // Lava falls into the lake: two ledges of rock between the windings and the shore, a cliff edge over the lava,
  // a glowing vent on each and its lava pouring over the edge (a fall whose foot is in lava is drawn as lava)
  const vents: { lip: MapPoint; at: MapPoint }[] = [];
  for (const [deg, r] of [[62, 49], [140, 47]] as const) {
    const th = (deg * Math.PI) / 180;
    const at = (d: number, side = 0) => ({ x: Math.cos(th) * d + Math.sin(th) * side, y: Math.sin(th) * d - Math.cos(th) * side });
    // Drawn clockwise round the crater: the ground left of it, away from the lake, rises
    k.cliff([at(r, -14), at(r, 14)], 9, 12);
    k.roughen([at(r + 4, -14), at(r + 4, 14)], { radius: 9, falloff: 0.7 }, 1.5, 7708 + deg);
    vents.push({ lip: at(r + 1.5), at: at(r + 6) });
  }

  // The lava runs on over the crater floor below its level once the roads are graded: dug into the uneven floor,
  // the lake's mask ended on the floor's low side and the lava stood there over the ground in the air
  k.fill({ x: -40, y: 0 }, lava);

  // ---- Ground: lava flows down the outer slopes first (a later flow cut the banks of the hell pools and they
  // hung in the air there), then hell outside, cracked crater walls
  for (const line of [
    [{ x: -130, y: -110 }, { x: -170, y: -170 }, { x: -230, y: -230 }],
    [{ x: 120, y: 120 }, { x: 170, y: 175 }, { x: 240, y: 230 }],
  ]) {
    k.river(line, { kind: 'lava', width: 7, depth: 1.2, bank: 6, reeds: false, bridges: false });
  }
  // One stroke per corner: a stroke's pools fill to one level near where it starts, so a single stroke round the
  // whole cone held pools only in a band of the slope
  for (const at of [{ x: -200, y: -200 }, { x: -220, y: 180 }, { x: 0, y: 220 }, { x: 210, y: 190 }, { x: 210, y: -190 }]) k.biome('hell', at, { radius: 70, strength: 0.6 });
  k.cracks([{ x: -110, y: 40 }, { x: -60, y: 100 }, { x: 40, y: 105 }, { x: 105, y: 30 }, { x: 80, y: -70 }], { radius: 30, strength: 0.8 }, 1);
  k.paint('volcanic-rock', [{ x: 0, y: -100 }, { x: -100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 0 }], { radius: 50, falloff: 1 }, 0.4);
  k.paint('obsidian', island, { radius: 26, falloff: 0.6 }, 0.9);
  k.paint('brimstone', [{ x: -170, y: -120 }, { x: 160, y: 150 }], { radius: 30, falloff: 1 }, 0.6);

  // ---- The island, the rim: spikes, the gate, braziers along the spiral, the forge, smoke
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const p = { x: Math.cos(a) * 24, y: Math.sin(a) * 24 };
    if (nearestOnPolyline([end, toIsland, island], p)!.dist < 8) continue;
    k.place(i % 2 ? 'obsidian-spikes' : 'obsidian-slabs', p.x, p.y, { rotation: a, scale: 1.2 });
  }
  // Larger than the catalogue's default: from the rim and in a fly-over the gate read as a small doorway
  const gate = k.place('hell-gate', -12, 12, { rotation: facing({ x: -12, y: 12 }, end), scale: 1.4 });
  // Glow in the gate: embers rising through it, sparks hanging in the opening
  // TODO(E190): a column of light rising from the gate
  k.place('fx-embers', gate.x, gate.y, { scale: 1.3, z: 1 });
  k.place('fx-sparkle', gate.x, gate.y, { scale: 1.5, z: 4, tint: '#ff7a2a' });
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
  // Columns of smoke over the crater: plumes stacked over the lake and the two vents, wider as they rise; the wind
  // (below) leans them north-east and they drift off over the rim
  const column = (at: MapPoint, scale: number) => {
    for (const [i, [z, sc]] of ([[0, 2.4], [10, 3], [22, 3.6], [36, 4.2]] as const).entries()) k.place('fx-smoke', at.x + i, at.y + i, { z, scale: sc * scale, tint: '#3a302c' });
  };
  column({ x: 18, y: -36 }, 1);
  for (const { at } of vents) column({ x: at.x * 0.8, y: at.y * 0.8 }, 0.7);
  // Obsidian towers and fire bowls on the rim's crest, off the passes
  for (let i = 0; i < 22; i++) {
    const a = ((i + 0.6 * k.noise.hash(i, 11, 81)) / 22) * Math.PI * 2;
    const r = rimR + 8 * (k.noise.hash(i, 13, 82) - 0.5);
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (!k.free(p.x, p.y, 8)) continue;
    if (i % 3 === 2) k.place('brazier', p.x, p.y, { scale: 1.4 });
    else k.place(i % 3 ? 'obsidian-tower' : 'hell-spires', p.x, p.y, { rotation: a, scale: 0.8 + 0.5 * k.noise.hash(i, 15, 83) });
  }
  for (const { lip, at } of vents) {
    k.place('lava-rock-large', at.x, at.y, { rotation: facing(at, lip), scale: 1.3 });
    k.place('fx-embers', at.x, at.y, { scale: 0.8 });
    // Two sheets side by side: one fall of 12 m is 6 m wide
    const across = { x: -(lip.y / Math.hypot(lip.x, lip.y)) * 2.5, y: (lip.x / Math.hypot(lip.x, lip.y)) * 2.5 };
    for (const side of [-1, 1]) {
      const p = { x: lip.x + across.x * side, y: lip.y + across.y * side };
      const h = k.h(p.x, p.y);
      k.place('fx-waterfall', p.x, p.y, { rotation: facing(p, { x: 0, y: 0 }), z: lavaLevel - h, scale: (h - lavaLevel) / 12 });
    }
  }
  // Embers only over the lava: the brush's ember spots elsewhere go, a ring of them round the lake shore
  k.doc.objects = k.doc.objects.filter((o) => o.asset !== 'fx-embers');
  for (const p of ring(44).slice(0, 24).filter((_, i) => i % 2 === 0)) k.place('fx-embers', p.x, p.y, { scale: 1.2 });
  // Glowing lava rocks and slabs on the crater wall: they light the ledges between the windings
  k.scatter(['lava-rock', 'lava-rock', 'lava-rock-large', 'rock-volcanic', 'obsidian-slabs'], ring(80), { radius: 22, strength: 0.8 }, { density: 1.6, minDistance: 8 });
  k.scatter(['rock-volcanic', 'rock-pumice', 'stones-volcanic-scatter'], ring(120), { radius: 25, strength: 0.8 }, { density: 2, minDistance: 6 });
  // Lava pools welling up on the outer slopes, between the flows
  for (let i = 0; i < 14; i++) {
    const a = ((i + 0.5 * k.noise.hash(i, 19, 85)) / 14) * Math.PI * 2;
    const r = 175 + 40 * k.noise.hash(i, 21, 86);
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (!k.free(p.x, p.y, 10)) continue;
    // Each pool on a ledge of its own, levelled into the slope
    k.level(p, { radius: 10, falloff: 0.3 }, k.h(p.x, p.y));
    k.place('lava-pool', p.x, p.y, { rotation: a, scale: 1.1 + 0.4 * k.noise.hash(i, 23, 87) });
  }

  // ---- Life: sparks over the lava, the lava's rumble over the whole crater and louder at the lake
  k.lifeSettings({ auto: { sparks: true }, ambience: { sound: 'biome', volume: 0.5 } });
  k.lifeArea('sound', ring(46).slice(0, 24), { sound: 'lava', volume: 0.8 });

  // Seven ground materials: the least used goes (each one is 8 MB of pixels to load)
  k.trimLayers(7);
  // Dusk over ash-dark ground: the lava and the rocks glow, and the slopes keep their shape in the low red light
  k.environment({ biome: 'hell', sky: 'dusk', sunAzimuth: 250, sunElevation: 26, fogDensity: 0.0006, tint: '#ffe2cc', wind: { strength: 0.4, direction: 220, gusts: 0.3 } });
  return k.finish();
}
