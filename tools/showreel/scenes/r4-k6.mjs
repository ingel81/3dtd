// K6 "Verteidigen" on Stillwater (DREHBUCH_R4.md 2.8). The fight starts from four saves of one run (A before wave 5,
// B before 7, C before 9, D before 10), made by fixtures.mjs: waves 1 to 4 played for real with normal credits,
// then the research of the new towers and, for D, the towers' upgrades by the developer commands (state only,
// nothing of it in a take; lead's decision 2026-10-16: the research of these towers opens at waves 8 to 12, a
// normal run has none of them before wave 5). Wave events of the map: night at wave 7, rain at 9, clear morning at 10, night at 12.
//
// Places (Stillwater F-B9, 2026-10-16, starter road along y = 0 to the HQ at (256, 0)): P1 the bridge's east end,
// P2 the village street by the market (north side), P3 below the castle table's south side by the east road, P4 the meadow between the
// starter road and the lake, P5 the north road's bend below the pass (both flat, clear of water and trees). The village street between bridge and chapel stays free (camera), and so do
// 15 m round each P until its tower comes.
import { act, click, clickMap, m, path, wait } from './common.mjs';

const MAP = 'fixtures/stillwater-b9.3dtdmap';
export const P = { P1: m(-40, 12), P2: m(70, 14), P3: m(300, -112), P4: m(-170, -25), P5: m(-30, 200) };

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

/** One wave played to its end at speed, as a player who lets it run */
const playWave = () => [act('wave'), act('speed', { value: 4 }), act('waveDone', { timeout: 420 }), act('speed', { value: 1 }), wait(2)];

/** Archers by the ramp and east of the castle, clear of P1 to P5 and the village street; skipped while too dear */
const defence = (spots) => spots.map((at) => act('build', { tower: 'archer', near: at, within: 24, hold: 0.1, dur: 0.4, optional: true }));

/** The new towers in the order the film shows them, their place, the camera's side and how far they reach (m) */
const NEW_TOWERS = [
  // Round 5: low, tower and road in one picture (R4 looked from high behind it, half the picture empty meadow);
  // the Chainsaw from the meadow north of it (south of the road the houses stood in the lens), the Shawarma from
  // across the road with the market in front
  { tower: 'chainsaw', at: P.P1, name: 'Chainsaw', from: 180, reach: 14, pitch: 12, margin: 5, road: [m(-48, 0), m(-32, 0)] },
  { tower: 'shawarma', at: P.P2, name: 'Shawarma Slicer', from: 0, reach: 30, pitch: 11, margin: 5, road: [m(58, 0), m(82, 0)] },
  // Below the castle table on its south side, the east road in front (round 5: inside the ring its wall hid the
  // road, the laser could not fire); seen from across the road, the castle behind the tower
  { tower: 'sentinel', at: P.P3, name: 'Sentinel Laser', from: 10, reach: 58, pitch: 10, margin: 9 },
  // From over the lake, the road behind the tower
  { tower: 'bastion', at: P.P4, name: 'Iron Bastion', from: 0, reach: 62, pitch: 12, margin: 8 },
  // Beside the north road's bend, the pass behind
  { tower: 'archer', at: P.P5, name: 'Ballista', from: 300, reach: 30, pitch: 34 },
];

/** What a player has at A: the five towers' research done and their price in the bank */
const CREDITS_A = 1000;

export const FIXTURES = [
  {
    file: 'fixtures/stillwater-A.3dtdsave',
    game: MAP,
    steps: [
      act('hints'),
      ...defence([m(200, 28), m(200, -28)]),
      ...playWave(),
      ...defence([m(392, -50), m(150, -26)]),
      ...playWave(),
      ...defence([m(392, -100), m(170, 30)]),
      ...playWave(),
      ...defence([m(430, -60)]),
      ...playWave(),
      act('research'),
    ],
    credits: CREDITS_A,
  },
  // A1 to A4: A with the first new towers standing, so each tower's scene starts where the one before ended
  ...NEW_TOWERS.slice(0, 4).map((t, i) => ({
    file: `fixtures/stillwater-A${i + 1}.3dtdsave`,
    game: MAP,
    save: i ? `fixtures/stillwater-A${i}.3dtdsave` : 'fixtures/stillwater-A.3dtdsave',
    steps: [act('hints'), act('build', { tower: t.tower, near: t.at, hold: 0.1, dur: 0.4 })],
  })),
  {
    file: 'fixtures/stillwater-B.3dtdsave',
    game: MAP,
    save: 'fixtures/stillwater-A.3dtdsave',
    steps: [
      act('hints'),
      act('build', { tower: 'chainsaw', near: P.P1, hold: 0.1, dur: 0.4 }),
      act('build', { tower: 'shawarma', near: P.P2, hold: 0.1, dur: 0.4 }),
      act('build', { tower: 'sentinel', near: P.P3, hold: 0.1, dur: 0.4 }),
      act('build', { tower: 'bastion', near: P.P4, hold: 0.1, dur: 0.4 }),
      act('build', { tower: 'archer', near: P.P5, hold: 0.1, dur: 0.4 }),
      // The archer at the pass rebuilt as a ballista (its Sniper path)
      act('choosePath', { tower: -1, path: 'sniper' }),
      ...playWave(),
      ...playWave(),
    ],
  },
  // B12: B with the waves before 12 skipped (the developer's jump, between waves, nothing of it in a take):
  // the night fight's wave is wave 12, four dragons (round 5: wave 7's bats read as dots); the map sets 21:00
  // at wave 12 as at 7
  {
    file: 'fixtures/stillwater-B12.3dtdsave',
    game: MAP,
    save: 'fixtures/stillwater-B.3dtdsave',
    steps: [act('hints'), act('jumpWave', { wave: 12 })],
  },
  {
    file: 'fixtures/stillwater-C.3dtdsave',
    game: MAP,
    save: 'fixtures/stillwater-B.3dtdsave',
    steps: [
      act('hints'),
      // The hero by the village street, explosive rounds
      act('hero', { at: m(20, 16), ammo: 'explosive' }),
      ...playWave(),
      ...playWave(),
      act('readyAbility', { ability: 'orbital-laser' }),
    ],
  },
  {
    file: 'fixtures/stillwater-D.3dtdsave',
    game: MAP,
    save: 'fixtures/stillwater-C.3dtdsave',
    steps: [act('hints'), ...playWave(), act('upgradeAll'), act('readyAbility', { ability: 'orbital-laser' })],
  },
];

/** The fight's look: no route lines, signs or health bars; the HUD only where a click needs it */
const FIGHT = { ui: true, routes: false, markers: false, healthBars: false, seed: 6 };

/**
 * A new tower on its place: its card picked with the UI (the name reads), set down, wave 5 started, the UI out; the camera beside the tower at about 12 m until an enemy comes into its reach, then a slow
 * turn with tower and target in one picture
 */
const showTower = (tower, at, name, { from = 200, reach = 30, pitch = 16, margin = 13, road = [], extra = [] } = {}) => [
  { do: 'ui', on: true },
  { do: 'cursor', show: true },
  frame([at], { from, pitch: 50, margin: 30, glide: 1 }),
  act('build', { tower, near: at, hold: 0.6, label: `card ${name}` }),
  ...extra,
  act('wave', { label: 'wave 5' }),
  { do: 'ui', on: false },
  { do: 'cursor', show: false },
  frame([{ at: 'tower:-1' }, ...road], { from, pitch, margin, glide: 1.2 }),
  act('speed', { value: 3 }),
  act('enemiesNear', { near: 'tower:-1', radius: reach, timeout: 120 }),
  act('speed', { value: 1 }),
  { do: 'mark', name: `tower:${name}` },
  frame([{ at: 'tower:-1' }, ...road], { from, pitch, margin, turn: road.length ? 8 : 14, dur: 4.5, glide: 0.1 }),
  { do: 'mark', name: `effect:${name}` },
];

export const SCENES = [
  // The five new towers one by one, each its own take in wave 5: from A (or A1 to A4, the towers before it standing)
  ...NEW_TOWERS.map((t, i) => ({
    name: `g-${t.tower === 'archer' ? 'ballista' : t.tower}`,
    start: { game: MAP, save: i ? `fixtures/stillwater-A${i}.3dtdsave` : 'fixtures/stillwater-A.3dtdsave' },
    env: FIGHT,
    steps: [
      act('hints'),
      ...showTower(t.tower, t.at, t.name, {
        from: t.from,
        reach: t.reach,
        pitch: t.pitch,
        margin: t.margin,
        road: t.road,
        // The archer at the pass, then (its scaffold down) its Sniper path: the model turns into a ballista
        extra: t.tower === 'archer'
          ? [wait(4), clickMap({ at: 'tower:-1', h: 4 }), click('.tp-paths .td-plate-btn', { withText: 'Sniper', label: 'sniper path' }), wait(1.2), { do: 'key', key: 'Escape' }]
          : [],
      }),
    ],
  })),
  {
    // Wave 12 (round 5: dragons instead of wave 7's bats) at night (the jump to it in B12 passed wave 7's event,
    // the night is there from the start); the camera along the lit village street, then behind a dragon
    name: 'g-night',
    start: { game: MAP, save: 'fixtures/stillwater-B12.3dtdsave' },
    env: { ...FIGHT, camera: { eye: m(-40, -6, 6), look: m(60, 6, 9) } },
    steps: [
      act('hints'),
      act('wave', { label: 'wave 12' }),
      { do: 'ui', on: false },
      { do: 'cursor', show: false },
      act('speed', { value: 3 }),
      act('enemiesNear', { at: m(-120, 0), radius: 140, kind: 'dragon', timeout: 150 }),
      act('speed', { value: 1 }),
      { do: 'mark', name: 'night' },
      path(5, [[m(-40, -6, 6), m(60, 6, 9)], [m(10, -8, 7), m(110, 6, 12)]], { ease: 'inOut', label: 'street' }),
      // Level with the dragons, the night sky behind them (from above the ground below was black)
      { do: 'follow', at: { at: 'enemy:dragon' }, dur: 7, back: 24, side: 10, h: 21, lookH: 21, ahead: 6, label: 'dragon' },
      { do: 'mark', name: 'effect:night fight' },
    ],
  },
  {
    // Wave 9 in the rain: the hero's explosive rounds, then the orbital laser over a squad
    name: 'g-hero',
    start: { game: MAP, save: 'fixtures/stillwater-C.3dtdsave' },
    env: FIGHT,
    steps: [
      act('hints'),
      act('wave', { label: 'wave 9' }),
      { do: 'ui', on: false },
      { do: 'cursor', show: false },
      frame([{ at: 'hero' }], { from: 160, pitch: 20, margin: 12, glide: 1.2 }),
      act('speed', { value: 3 }),
      act('enemiesNear', { near: 'any', radius: 100000, timeout: 30 }),
      // Wave 9 comes from the west spawn and falls before the village (2026-10-17: before the archers east of it)
      act('enemiesNear', { at: m(-90, 0), radius: 50, timeout: 150 }),
      act('speed', { value: 1 }),
      { do: 'mark', name: 'hero' },
      frame([{ at: 'hero' }], { from: 160, pitch: 20, margin: 12, turn: 10, dur: 3.5, glide: 0.1 }),
      { do: 'mark', name: 'effect:hero' },
      frame([{ at: 'enemy:0' }], { from: 200, pitch: 35, margin: 30, glide: 0.8 }),
      act('ability', { ability: 'orbital-laser', at: { at: 'enemy:0' }, label: 'laser' }),
      wait(3),
      { do: 'mark', name: 'effect:orbital laser' },
    ],
  },
  {
    // Wave 10 (round 5: the follow higher and wider, the zombies round him kept out of the lens): Herbert's entrance (the game's own camera), the walk at speed (cut), then 1x beside him with a
    // tower in the picture until he falls; "Wave cleared" with the UI on; up and back over the night village
    name: 'g-boss',
    start: { game: MAP, save: 'fixtures/stillwater-D.3dtdsave' },
    env: FIGHT,
    steps: [
      act('hints'),
      act('wave', { label: 'boss wave' }),
      { do: 'ui', on: false },
      { do: 'cursor', show: false },
      wait(4.5),
      { do: 'mark', name: 'effect:boss entrance' },
      act('enemiesNear', { near: 'any', radius: 100000, kind: 'herbert', timeout: 60 }),
      {
        do: 'par',
        steps: [
          { do: 'follow', at: { at: 'enemy:herbert' }, dur: 400, back: 18, side: 14, h: 8, lookH: 3, ahead: 8, label: 'boss' },
          {
            do: 'seq',
            steps: [
              act('speed', { value: 4 }),
              // He walks the starter road from the west and falls by the bridge, at the Chainsaw (P1): 1x from 70 m before it
              act('enemiesNear', { at: P.P1, radius: 70, kind: 'herbert', timeout: 300 }),
              act('speed', { value: 1 }),
              { do: 'mark', name: 'boss at the towers' },
            ],
          },
        ],
      },
      { do: 'mark', name: 'boss down' },
      wait(1.5),
      act('speed', { value: 3 }),
      act('waveDone', { timeout: 150 }),
      act('speed', { value: 1 }),
      { do: 'ui', on: true },
      wait(1.5),
      { do: 'mark', name: 'effect:wave cleared' },
      { do: 'ui', on: false },
      path(9, ['current', [m(80, -120, 70), m(60, 0, 0)]], { ease: 'inOut', label: 'pull out' }),
      wait(0.5),
    ],
  },
];
