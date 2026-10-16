// K6 "Verteidigen" on Stillwater (DREHBUCH_R4.md 2.8). The fight starts from four saves of one run (A before wave 5,
// B before 7, C before 9, D before 10), made by fixtures.mjs: waves 1 to 4 played for real with normal credits,
// then the research of the new towers and, for D, the towers' upgrades by the developer commands (state only,
// nothing of it in a take; lead's decision 2026-10-16: the research of these towers opens at waves 8 to 12, a
// normal run has none of them before wave 5). Wave events of the map: night at wave 7, rain at 9, clear at 10.
//
// Places (reel-k3's map, 2026-10-16, starter road along y = 0 to the HQ at (256, 0)): P1 the bridge's east end,
// P2 the village street by the market (north side), P3 the castle table at the ramp, P4 the lake's north shore,
// P5 the pass of the north road. The village street between bridge and chapel stays free (camera), and so do
// 15 m round each P until its tower comes.
import { act, click, clickMap, m, path, wait } from './common.mjs';

const MAP = 'fixtures/stillwater-b9.3dtdmap';
export const P = { P1: m(-40, 12), P2: m(70, 14), P3: m(262, -30), P4: m(-150, -78), P5: m(-110, 250) };

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

/** One wave played to its end at speed, as a player who lets it run */
const playWave = () => [act('wave'), act('speed', { value: 4 }), act('waveDone', { timeout: 420 }), act('speed', { value: 1 }), wait(2)];

/** Archers by the ramp and east of the castle, clear of P1 to P5 and the village street; skipped while too dear */
const defence = (spots) => spots.map((at) => act('build', { tower: 'archer', near: at, within: 24, hold: 0.1, dur: 0.4, optional: true }));

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
 * A new tower on its place: its card picked with the UI (the name reads), set down, the next wave started when
 * none runs, the UI out; the camera beside the tower at about 12 m until an enemy comes into its reach, then a slow
 * turn with tower and target in one picture
 */
const showTower = (tower, at, name, { from = 200, reach = 30, extra = [] } = {}) => [
  { do: 'ui', on: true },
  { do: 'cursor', show: true },
  frame([at], { from, pitch: 50, margin: 30, glide: 1 }),
  act('build', { tower, near: at, hold: 0.6, label: `card ${name}` }),
  ...extra,
  act('wave', { ifIdle: true }),
  { do: 'ui', on: false },
  { do: 'cursor', show: false },
  frame([{ at: 'tower:-1' }], { from, pitch: 18, margin: 18, glide: 1.2 }),
  act('speed', { value: 3 }),
  act('enemiesNear', { near: 'tower:-1', radius: reach, timeout: 150 }),
  act('speed', { value: 1 }),
  { do: 'mark', name: `tower:${name}` },
  frame([{ at: 'tower:-1' }], { from, pitch: 18, margin: 18, turn: 14, dur: 4.5, glide: 0.1 }),
  { do: 'mark', name: `effect:${name}` },
];

export const SCENES = [
  {
    // The five new towers one by one, waves 5 and 6 (save A: researched, their price in the bank)
    name: 'g-towers',
    start: { game: MAP, save: 'fixtures/stillwater-A.3dtdsave' },
    env: FIGHT,
    steps: [
      act('hints'),
      ...showTower('chainsaw', P.P1, 'Chainsaw', { from: 160, reach: 22 }),
      ...showTower('shawarma', P.P2, 'Shawarma Slicer', { from: 200, reach: 24 }),
      ...showTower('sentinel', P.P3, 'Sentinel Laser', { from: 230, reach: 45 }),
      ...showTower('bastion', P.P4, 'Iron Bastion', { from: 180, reach: 70 }),
      // The archer at the pass, then (its scaffold down) its Sniper path: the model turns into a ballista
      ...showTower('archer', P.P5, 'Ballista', {
        from: 200,
        reach: 45,
        extra: [wait(4), clickMap({ at: 'tower:-1', h: 4 }), click('.tp-paths .td-plate-btn', { withText: 'Sniper', label: 'sniper path' }), wait(1.2), { do: 'key', key: 'Escape' }],
      }),
    ],
  },
  {
    // Wave 7: its event sets 21:00, night falls in the fight; the camera along the paved village street at 6 m
    name: 'g-night',
    start: { game: MAP, save: 'fixtures/stillwater-B.3dtdsave' },
    env: { ...FIGHT, camera: { eye: m(-40, -6, 6), look: m(60, -2, 3) } },
    steps: [
      act('hints'),
      act('wave', { label: 'wave 7' }),
      { do: 'ui', on: false },
      { do: 'cursor', show: false },
      act('speed', { value: 3 }),
      act('enemiesNear', { near: 'tower:0', radius: 60, timeout: 150 }),
      act('speed', { value: 1 }),
      { do: 'mark', name: 'night' },
      path(9, [[m(-40, -6, 6), m(60, -2, 3)], [m(40, -6, 6), m(140, -2, 3)], [m(110, -8, 7), m(200, 0, 3)]], { ease: 'inOut', label: 'street' }),
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
      frame([m(20, 16), m(-20, 0)], { from: 160, pitch: 20, margin: 14, glide: 1.2 }),
      act('speed', { value: 3 }),
      act('enemiesNear', { near: 'any', radius: 100000, timeout: 30 }),
      act('enemiesNear', { near: 'tower:1', radius: 50, timeout: 150 }),
      act('speed', { value: 1 }),
      { do: 'mark', name: 'hero' },
      frame([m(20, 16), m(-20, 0)], { from: 160, pitch: 20, margin: 14, turn: 10, dur: 3.5, glide: 0.1 }),
      { do: 'mark', name: 'effect:hero' },
      frame([{ at: 'enemy:0' }], { from: 200, pitch: 35, margin: 30, glide: 0.8 }),
      act('ability', { ability: 'orbital-laser', at: { at: 'enemy:0' }, label: 'laser' }),
      wait(3),
      { do: 'mark', name: 'effect:orbital laser' },
    ],
  },
  {
    // Wave 10: Herbert's entrance (the game's own camera), the walk at speed (cut), then 1x beside him with a
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
          { do: 'follow', at: { at: 'enemy:herbert' }, dur: 400, back: 18, side: 12, h: 10, ahead: 8, label: 'boss' },
          {
            do: 'seq',
            steps: [
              act('speed', { value: 4 }),
              act('enemiesNear', { near: 'tower:0', radius: 70, kind: 'herbert', timeout: 300 }),
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
