/**
 * Demo valley: the generated sample map (src/app/world/custom-map/demo-map.ts),
 * dressed for shipping with the editor's operations. The lone hill in the
 * south-west becomes a crag with a castle ruin, a landmark seen from the west
 * road and the village; a knoll south of the village carries a chapel and a
 * lookout; the woods get deadwood, undergrowth and clearings; crows over the
 * woods. Roads, spawns and HQ stay as generated.
 */
import type { CustomMapDocument, MapPoint } from '../../../src/app/world/custom-map/map-document';
import { createDemoMap } from '../../../src/app/world/custom-map/demo-map';
import { facing, LevelKit } from './kit';

export function buildDemoValley(): CustomMapDocument {
  const base = createDemoMap(7);
  const k = new LevelKit({ id: 'demo-valley', name: base.meta.name, description: base.meta.description, size: base.terrain.width, base: 'grass', seed: 707 }, base);
  const ring = (c: MapPoint, r: number, from = 0, to = 360, step = 15): MapPoint[] => {
    const out: MapPoint[] = [];
    for (let a = from; a <= to; a += step) out.push({ x: c.x + Math.cos((a * Math.PI) / 180) * r, y: c.y + Math.sin((a * Math.PI) / 180) * r });
    return out;
  };
  const keepFx = (o: { asset: string }) => o.asset.startsWith('fx');

  // ---- The landmark: the ruin hill in the south-west rises to a crag with sheer sides and a castle ruin on top
  const crag = { x: -150, y: -190 };
  k.erase(crag, 52, keepFx);
  const top = k.h(crag.x, crag.y) + 18;
  k.plateau(crag, { radius: 36, falloff: 0.2 }, top);
  k.roughen(ring(crag, 38), { radius: 9, falloff: 0.8 }, 1.5, 707);
  k.level(crag, { radius: 26, falloff: 0.3 }, top);
  // Rock faces on the sides, scree at their feet
  k.cliffRocks(ring(crag, 36), { radius: 12 });
  k.scatter(['rock-large', 'rock-small', 'rock-granite', 'stones'], ring(crag, 46), { radius: 8, strength: 1 }, { density: 3, minDistance: 4, scaleMin: 0.7, scaleMax: 1.5 });
  // The ruin: a keep, broken curtain walls with towers, the gate toward the village
  const village = { x: 30, y: -130 };
  k.place('keep-ruin', crag.x - 4, crag.y - 3, { rotation: facing(crag, village), scale: 1.6 });
  const gateAt = 1.9;
  for (const [n, p] of ring(crag, 21, 0, 330, 30).entries()) {
    const a = (n * 30 * Math.PI) / 180;
    if (Math.abs(a - gateAt) < 0.3) continue;
    if (n % 3 === 0) k.place('castle-tower-ruined', p.x, p.y, { rotation: a, scale: 1.1 });
    else if (n !== 7) k.place(n % 2 ? 'castle-wall-ruined' : 'castle-wall-ruined-b', p.x, p.y, { rotation: a + Math.PI / 2, scale: 1.1 });
  }
  const gate = { x: crag.x + Math.cos(gateAt) * 21, y: crag.y + Math.sin(gateAt) * 21 };
  k.place('gate-ruin', gate.x, gate.y, { rotation: gateAt - Math.PI / 2, scale: 1.1 });
  k.scatter(['bush-ivy', 'shrub', 'grass-clump', 'stones-mossy-scatter'], crag, { radius: 20, strength: 1 }, { density: 6, minDistance: 2.5 });
  k.place('banner-red', crag.x + 6, crag.y + 6, { rotation: facing(crag, village) });

  // ---- The lookout: a knoll south of the village with a chapel, a watchtower and a bench
  const knoll = { x: -30, y: -205 };
  k.erase(knoll, 40, keepFx);
  k.raise(knoll, { radius: 42, falloff: 0.9 }, 16);
  k.smooth(knoll, { radius: 44, falloff: 0.8 }, 3);
  k.level(knoll, { radius: 14, falloff: 0.4 }, k.h(knoll.x, knoll.y));
  k.paint('meadow', knoll, { radius: 30, falloff: 0.8 }, 0.6);
  k.place('chapel', knoll.x - 3, knoll.y - 4, { rotation: facing(knoll, village) });
  k.place('watchtower', knoll.x + 9, knoll.y + 5, { rotation: 0.4 });
  k.place('bench', knoll.x + 2, knoll.y + 9, { rotation: facing(knoll, village) + Math.PI });
  k.place('signpost', knoll.x + 6, knoll.y + 14, { rotation: 0.8 });
  k.scatter(['flowers', 'grass-clump', 'flowers-yellow'], knoll, { radius: 32, strength: 1 }, { density: 10, minDistance: 1.6 });
  k.scatter(['tree-oak', 'tree-birch', 'bush'], ring(knoll, 34, 120, 330, 30), { radius: 9, strength: 0.8 }, { density: 2, minDistance: 6 });

  // ---- The woods: where trees stand thick, clearings in the densest ones, deadwood and undergrowth in the rest
  const cell = 32;
  const count = new Map<string, { n: number; x: number; y: number }>();
  for (const o of k.doc.objects) {
    if (!o.asset.startsWith('tree-')) continue;
    const key = `${Math.floor(o.x / cell)},${Math.floor(o.y / cell)}`;
    const c = count.get(key) ?? { n: 0, x: 0, y: 0 };
    count.set(key, { n: c.n + 1, x: c.x + o.x, y: c.y + o.y });
  }
  const woods = [...count.values()].filter((c) => c.n >= 10).map((c) => ({ n: c.n, x: c.x / c.n, y: c.y / c.n })).sort((a, b) => b.n - a.n || a.x - b.x || a.y - b.y);
  for (const c of woods.filter((_, i) => i % 6 === 1).slice(0, 5)) {
    k.erase(c, 11, keepFx);
    k.scatter(['grass-clump', 'flowers', 'fern', 'stump'], c, { radius: 11, strength: 1 }, { density: 12, minDistance: 1.6 });
  }
  k.scatter(['log', 'stump', 'fern', 'bush', 'tree-dead'], woods, { radius: 16, strength: 0.8 }, { density: 2.5, minDistance: 3, scaleMin: 0.8, scaleMax: 1.3 });
  // ---- Life: crows wheeling low over the two thickest woods, the river murmuring through the valley,
  // birdsong by day and crickets by night over the whole map (the houses' chimneys smoke by themselves)
  for (const c of woods.slice(0, 2)) k.lifeArea('birds', ring(c, 45, 0, 330, 40), { species: 'crows', density: 1, height: 28 });
  k.lifeRoute('sound', [{ x: -256, y: 158 }, { x: -170, y: 95 }, { x: -95, y: 70 }, { x: -30, y: 10 }, { x: 40, y: -15 }, { x: 120, y: -30 }, { x: 190, y: -95 }, { x: 256, y: -142 }], { sound: 'stream', volume: 0.7 });
  k.lifeSettings({ ambience: { sound: 'biome', volume: 0.55 } });
  // Cows and sheep on the pastures by the farm and at the valley's edge, off the roads
  // A herd: `count` animals round a spot, each turned its own way, none on a road
  const herd = (assets: readonly string[], at: MapPoint, count: number, radius: number) => {
    for (let n = 0, tries = 0; n < count && tries < count * 4; tries++) {
      const a = k.noise.hash(Math.round(at.x), tries, 71) * Math.PI * 2;
      const d = radius * Math.sqrt(k.noise.hash(Math.round(at.y), tries, 72));
      const p = { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d };
      if (!k.free(p.x, p.y, 2)) continue;
      k.place(assets[n % assets.length], p.x, p.y, { rotation: k.noise.hash(tries, n, 73) * Math.PI * 2 });
      n++;
    }
  };
  for (const at of [{ x: 185, y: -225 }, { x: 215, y: -195 }]) herd(['cow-grazing', 'cow', 'cow-grazing', 'cow-lying'], at, 4, 12);
  for (const at of [{ x: 30, y: -235 }, { x: 225, y: -120 }]) herd(['sheep-grazing', 'sheep', 'sheep-grazing', 'sheep-lying'], at, 7, 12);

  return k.finish();
}
