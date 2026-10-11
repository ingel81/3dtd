/**
 * Witch marsh at night: boardwalks over black swamp water link low islands
 * with stilt huts; the witch's hut glows green beside the HQ. Lanterns on
 * the walks are the only light, fireflies and ground fog drift over the
 * reeds. Two spawns come out of the fog in the north and the west; the
 * northern walk splits round two islands, all meet on the big island.
 */
import type { CustomMapDocument, MapPathKind, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { resample, simplify } from '../../../src/app/editor/ops/landscape/lines';
import { edgePolyline, pointAt, polylineLength } from '../../../src/app/editor/ops/path-graph';
import { facing, LevelKit } from './kit';

interface Island {
  at: MapPoint;
  radius: number;
  height: number;
}

export function buildWitchMarsh(): CustomMapDocument {
  const k = new LevelKit({
    id: 'witch-marsh',
    name: 'Witch Marsh',
    description: 'Boardwalks over a swamp at night, islands with stilt huts and the witch\'s glowing hut by the HQ. Two spawns come out of the fog.',
    size: 512,
    base: 'swamp-ground',
    seed: 2202,
  });
  for (const m of ['swamp-ground', 'mud-wet', 'moss', 'mud-dark', 'grass-lush', 'leaves-brown', 'coast-mossy', 'forest-moss']) k.layer(m);
  k.cliffs('rock-lichen', 45);

  // ---- Ground: the marsh floor under the water, islands rising out of it
  for (let y = -300; y <= 300; y += 120) for (let x = -300; x <= 300; x += 120) k.level({ x, y }, { radius: 140, falloff: 0.4 }, -0.75);
  // Mud banks and tussocks break the water up: rough noise pokes through the surface here and there
  for (let y = -240; y <= 240; y += 60) k.roughen([{ x: -260, y }, { x: 260, y }], { radius: 70, falloff: 1 }, 0.55, 2202 + y);
  const islands: Island[] = [
    { at: { x: -10, y: 238 }, radius: 52, height: 2.6 },
    { at: { x: -48, y: 132 }, radius: 36, height: 2.8 },
    { at: { x: 95, y: 98 }, radius: 32, height: 2.8 },
    { at: { x: 22, y: -18 }, radius: 72, height: 3.2 },
    { at: { x: -150, y: -40 }, radius: 38, height: 2.8 },
    { at: { x: -242, y: -12 }, radius: 48, height: 2.6 },
    { at: { x: 98, y: -168 }, radius: 58, height: 3.2 },
    // Islands for the eye and for towers off the walks
    { at: { x: -150, y: 115 }, radius: 30, height: 2.4 },
    { at: { x: 190, y: 12 }, radius: 36, height: 2.6 },
    { at: { x: -95, y: -165 }, radius: 42, height: 2.6 },
    { at: { x: 205, y: -205 }, radius: 30, height: 2.4 },
    { at: { x: 175, y: 195 }, radius: 26, height: 2.2 },
    { at: { x: -205, y: 205 }, radius: 34, height: 2.4 },
  ];
  // Each island from a few lobes, so none is round
  for (const [n, isl] of islands.entries()) {
    k.raise(isl.at, { radius: isl.radius * 0.8, falloff: 0.55 }, isl.height + 0.75);
    for (let l = 0; l < 4; l++) {
      const a = k.noise.hash(n, l, 5) * Math.PI * 2;
      const d = isl.radius * (0.35 + 0.35 * k.noise.hash(n, l, 6));
      k.raise({ x: isl.at.x + Math.cos(a) * d, y: isl.at.y + Math.sin(a) * d }, { radius: isl.radius * (0.35 + 0.25 * k.noise.hash(n, l, 7)), falloff: 0.7 }, isl.height * 0.7);
    }
    k.roughen(isl.at, { radius: isl.radius * 1.2, falloff: 0.9 }, 0.8, 300 + n);
  }
  const marsh = k.water(0, 'swamp', '#283a22');
  k.sea(marsh);

  // ---- Walks: paths over the islands, boardwalks (bridges) over the water
  // A walk along a line: path where the ground is dry, boardwalk (a bridge) where it runs over the water
  const walk = (line: MapPoint[]) => {
    const pts = resample(line, 2);
    const wet = pts.map((p) => k.h(p.x, p.y) < 0.4);
    // Dry gaps shorter than 8 m stay boardwalk
    for (let i = 0; i < pts.length; ) {
      let j = i;
      while (j < pts.length && wet[j] === wet[i]) j++;
      if (!wet[i] && i > 0 && j < pts.length && j - i < 4) for (let q = i; q < j; q++) wet[q] = true;
      i = j;
    }
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && wet[i] === wet[start]) continue;
      const end = Math.min(i, pts.length - 1);
      const kind: MapPathKind = wet[start] ? 'bridge' : 'path';
      const seg = pts.slice(start, end + 1);
      if (seg.length >= 2) k.path(simplify(seg, 0.8), kind === 'bridge' ? 4 : 5, kind, 3);
      start = end;
    }
  };
  const j = { x: 25, y: -12 };
  const hq = { x: 100, y: -172 };
  const north = { x: -12, y: 244 };
  const west = { x: -246, y: -14 };
  walk([north, { x: -30, y: 190 }, { x: -48, y: 135 }, { x: -20, y: 60 }, j]);
  walk([{ x: -48, y: 135 }, { x: 30, y: 120 }, { x: 95, y: 98 }, { x: 60, y: 30 }, j]);
  walk([west, { x: -190, y: -30 }, { x: -150, y: -40 }, { x: -60, y: -20 }, j]);
  walk([j, { x: 50, y: -80 }, { x: 85, y: -120 }, hq]);
  k.spawn('North', -12, 244);
  k.spawn('West', -246, -14);
  k.hq(hq.x, hq.y);

  // ---- Land: swamp on every island (pools, reeds, willows, dead trees), moss and mud
  const play = [islands[3], islands[6]];
  for (const isl of islands) {
    const big = play.includes(isl);
    k.biome('swamp', isl.at, { radius: isl.radius * (big ? 0.95 : 1.1), strength: big ? 0.45 : 0.9 }, 1);
  }
  // Willows, mossy and dead trees on the island rims, some in the shallows
  k.scatter(['tree-willow', 'tree-swamp-moss', 'tree-swamp-dead', 'tree-dead', 'tree-mangrove'], islands.map((i) => i.at), { radius: 70, strength: 1, falloff: 0.5 }, { density: 0.9, minDistance: 9, scaleMin: 0.8, scaleMax: 1.3 }, true);
  // Reeds and lily pads in the shallows between the islands
  k.scatter(['reed-bed', 'reeds', 'grass-swamp'], islands.map((i) => i.at), { radius: 60, strength: 1 }, { density: 6, minDistance: 2.5, scaleMin: 0.8, scaleMax: 1.4 }, false);
  k.scatter(['lily-pads'], [{ x: -120, y: 60 }, { x: 140, y: -60 }, { x: -60, y: -100 }, { x: 150, y: 140 }, { x: -200, y: 100 }], { radius: 40, strength: 1 }, { density: 3, minDistance: 3, sinkOnSlope: false }, false);
  for (const o of k.doc.objects) if (o.asset === 'lily-pads' || o.asset.startsWith('reed') || o.asset === 'grass-swamp') o.z = Math.max(o.z, Math.round((0.02 - k.h(o.x, o.y)) * 100) / 100 * (o.asset === 'lily-pads' ? 1 : 0));
  // Remove whatever grew on a walk
  k.doc.objects = k.doc.objects.filter((o) => k.free(o.x, o.y, 0.6) || o.asset === 'lily-pads');

  // ---- The witch's hut beside the HQ, stilt huts at the shores, lanterns on the walks
  k.place('witch-hut', 122, -190, { rotation: facing({ x: 122, y: -190 }, j) });
  for (const [x, y] of [[132, -168], [114, -200], [88, -200]] as const) k.place('mushrooms-glow', x, y, { rotation: x });
  k.place('mushroom-giant', 136, -205, { rotation: 1.2 });
  k.place('campfire', 112, -158);
  for (const [x, y] of [[-30, 182], [70, 70], [-200, 30], [150, -130], [-110, -160], [200, 30], [-150, 140]] as const) {
    const shore = { x, y };
    k.place('hut-stilts', shore.x, shore.y, { rotation: facing(shore, j) });
  }
  // Lanterns: on posts beside every boardwalk, every 24 m
  for (const e of k.doc.paths.edges) {
    if (e.kind !== 'bridge') continue;
    const line = edgePolyline(k.doc.paths, e);
    const len = polylineLength(line);
    for (let s = 10, n = 0; s < len - 6; s += 24, n++) {
      const p = pointAt(line, s);
      const q = pointAt(line, s + 1);
      const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const side = n % 2 ? 1 : -1;
      const at = { x: p.x - ((q.y - p.y) / d) * 2.6 * side, y: p.y + ((q.x - p.x) / d) * 2.6 * side };
      k.place('torch', at.x, at.y, { z: Math.max(0, 0.6 - k.h(at.x, at.y)), rotation: n });
    }
  }
  // Fog banks in the north and west where the enemies come from, fireflies over the water
  for (const [x, y, sc] of [[-20, 225, 1.5], [30, 250, 1.4], [-60, 250, 1.3], [-230, 20, 1.5], [-245, -50, 1.4], [-220, -15, 1.3], [-150, 200, 1.2], [180, 120, 1], [-80, 60, 1], [150, -40, 1]] as const) {
    k.place('fx-fog', x, y, { scale: sc });
  }
  for (const [x, y] of [[-100, 80], [0, 80], [140, 40], [-90, -90], [40, -120], [160, -230], [-180, 60], [70, 180]] as const) k.place('fx-fireflies', x, y, { scale: 1.3 });

  k.environment({ biome: 'swamp', sky: 'night', sunAzimuth: 200, sunElevation: 20, fogDensity: 0.0008, tint: '#d8ecd0', weather: 'fog', weatherStrength: 0.12 });
  return k.finish();
}
