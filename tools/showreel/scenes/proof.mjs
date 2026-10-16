// Two short takes that prove the take flow end to end (README.md, "Takes"): an editor scene from a generated map
// fixture and a game scene from a generated save. Not part of the programme; `run.mjs --scene proof-editor`.
//
//   proof-editor  Demo Valley after a first hill was raised in the south meadow (the fixture, made by MapKit as a
//                 scene before would have left it): a second, bigger hill beside it with the Terrain tool
//   proof-game    Red Canyon with three towers standing and normal credits (the save): the first wave at them
import { act, m, mode, settings, stroke, tool, wait } from './common.mjs';

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

/** The start states the takes need, made by fixtures.mjs in this order */
export const FIXTURES = [
  {
    file: 'fixtures/proof-editor.3dtdmap',
    from: 'demo-valley',
    // The hill the scene before would have raised: one dab of the Terrain tool's Raise, as MapKit plays it
    script: 'map.raise({ x: -115, y: -200 }, { radius: 22, strength: 0.6 }, 9);',
    seed: 1,
  },
  {
    file: 'fixtures/proof-game.3dtdsave',
    game: 'red-canyon',
    // Three towers by the canyon road, built through the sidebar as a player would; then the credits set to what
    // a player would have left, so the HUD shows no cheat sum
    steps: [
      act('hints'),
      act('credits', { amount: 20000 }),
      act('planTowers', { count: 3, tower: 'archer', from: 60, to: 380, route: 0, offsets: [11, 14, 18, 22], step: 13 }),
      act('build', { tower: 'archer', spot: 0, hold: 0.2 }),
      act('build', { tower: 'archer', spot: 1, hold: 0.2 }),
      act('build', { tower: 'archer', spot: 2, hold: 0.2 }),
    ],
    credits: 420,
  },
];

export const SCENES = [
  {
    name: 'proof-editor',
    start: { editor: 'fixtures/proof-editor.3dtdmap' },
    env: {
      sky: { sky: 'day', sunElevation: 38, sunAzimuth: 150, weather: 'clear' },
      camera: { eye: m(-95, -290, 55), look: m(-95, -200, 0) },
      ui: true,
      markers: true,
      seed: 3,
    },
    steps: [
      frame([m(-120, -200), m(-70, -205)], { from: 0, pitch: 30, margin: 30, glide: 1.2, label: 'hill' }),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 26, strength: 0.7 } }),
      stroke(2, [m(-74, -200), m(-72, -200)], { label: 'big brush' }),
      act('idle', { timeout: 30 }),
      { do: 'mark', name: 'effect:second hill' },
      wait(0.8),
    ],
  },
  {
    name: 'proof-game',
    start: { game: 'red-canyon', save: 'fixtures/proof-game.3dtdsave' },
    env: {
      ui: true,
      routes: true,
      healthBars: true,
      markers: true,
      credits: 420,
      seed: 5,
      // Over the canyon road, the towers below
      camera: { eye: { at: 'tower:1', dx: 0, dy: -90, h: 70 }, look: { at: 'tower:1' } },
    },
    steps: [
      act('hints'),
      frame([{ at: 'tower:0' }, { at: 'tower:1' }, { at: 'tower:2' }], { from: 200, pitch: 48, margin: 18, glide: 1.4, label: 'towers' }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      // The walk to the towers at speed (the cut leaves it out)
      act('speed', { value: 4 }),
      act('enemiesNear', { near: 'tower:1', radius: 70, timeout: 90 }),
      act('speed', { value: 1 }),
      frame([{ at: 'tower:0' }, { at: 'tower:1' }, { at: 'tower:2' }], { from: 200, pitch: 40, margin: 14, turn: 20, dur: 7, label: 'fight' }),
      { do: 'mark', name: 'effect:fight' },
    ],
  },
];
