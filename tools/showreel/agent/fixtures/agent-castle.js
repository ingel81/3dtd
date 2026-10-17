// "Build a castle with a moat on the hill": a walled castle on a hard-edged mound, a ring of water round it,
// a stone bridge from the gate over the moat to the road. Written once against the map's MCP tools (map_summary,
// map_heights, map_objects, dry runs), replayed in the showreel's agent take (agent-castle.json).
const C = { x: -185, y: 0 };
const ring = (r, n = 40) => Array.from({ length: n + 1 }, (_, i) => ({ x: C.x + Math.cos((i / n) * Math.PI * 2) * r, y: C.y + Math.sin((i / n) * Math.PI * 2) * r }));
const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });

// The ground cleared of trees and scrub and levelled (it falls to the river in the east), then the mound:
// 4 m over the meadow with a hard rim
map.erase(C, 66);
const ground = map.h(C.x, C.y);
map.level(C, { radius: 64, strength: 1, falloff: 0.2 }, ground);
const top = ground + 4;
map.plateau(C, { radius: 38, strength: 1 }, top);

// The moat: a ring dug 2.5 m below a new body of water a metre under the bank
const moat = map.body(ground - 1, 'water');
map.lake(ring(47), { radius: 6, strength: 1 }, 2.5, moat);

// Curtain walls round the bailey, towers at the corners, battlements outward, open at the gate in the south
const s = 22;
map.line('castle-wall', [at(5, -s), at(s, -s), at(s, s), at(-s, s), at(-s, -s), at(-5, -s)], { corners: 'towers', front: 'right' });
map.place('castle-gate', C.x, C.y - s, { rotation: Math.PI });
map.place('castle-keep', C.x + 6, C.y + 7, { rotation: 0 });
for (const [dx, dy, a] of [[-4.5, -s - 3, 'torch'], [4.5, -s - 3, 'torch'], [-9, -s + 2, 'banner-red'], [9, -s + 2, 'banner-red'], [-10, 8, 'well'], [12, -10, 'weapon-rack']]) {
  map.place(a, C.x + dx, C.y + dy);
}

// From the gate over the moat: a causeway down to the meadow on the far bank
map.ramp({ ...at(0, -54), h: top }, { ...at(0, -72), h: ground }, 7);
map.walk([at(0, -s - 4), at(0, -72)], { width: 5 });
return { ground, top, moat };
