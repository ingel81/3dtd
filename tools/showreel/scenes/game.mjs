// A fight on Red Canyon: the four new towers and an archer built one by one beside the
// canyon road, the archer rebuilt as a ballista (Sniper path); the first wave's zombies up close, then the boss wave
// against the towers at their last level, played to the boss's fall, and a calm pull-out.
import { act, click, clickMap, orbit, path, wait } from './common.mjs';

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

/** One tower: the camera over its spot, the card, the spot held a moment, one click */
const build = (tower, spot, opts = {}) => [
  frame([{ at: `spot:${spot}` }], { from: 200, pitch: 42, margin: 18, glide: 0.9 }),
  act('build', { tower, spot, hold: 0.8, ...opts }),
];

export const SCENES = [
  {
    name: 'game-build',
    page: '/?world=map:red-canyon',
    // Straight into the game view: the intro flight is the intro's part
    noIntro: true,
    steps: [
      { do: 'mark', name: 'Red Canyon fight' },
      act('hints'),
      act('research'),
      act('credits', { amount: 80000 }),
      wait(0.4),
      // Along the canyon road from 60 m out (the HQ out of the frame), close to it: the chainsaw reaches 14 m
      act('planTowers', { count: 6, tower: 'bastion', from: 60, to: 380, route: 0, offsets: [11, 14, 18, 22], step: 13 }),
      frame([{ at: 'spot:0' }, { at: 'spot:1' }, { at: 'spot:2' }, { at: 'spot:3' }, { at: 'spot:4' }, { at: 'spot:5' }], { from: 200, pitch: 45, margin: 8, pad: 1, glide: 1.4 }),
      // From the gate's side inward: the chainsaw and the slicer meet the enemies first
      ...build('chainsaw', 5, { label: 'build' }),
      ...build('shawarma', 4),
      ...build('sentinel', 3),
      ...build('bastion', 2),
      ...build('archer', 1),
      ...build('lightning', 0),
      // The last scaffold down, the turrets sweeping
      frame([{ at: 'spot:2' }, { at: 'spot:3' }, { at: 'spot:4' }, { at: 'spot:5' }], { from: 210, pitch: 42, margin: 6, glide: 1.6 }),
      wait(1.6),
      { do: 'mark', name: 'effect:new towers' },
      // The archer rebuilt as a heavy ballista: the tower clicked, its Sniper path bought in the panel
      frame([{ at: 'spot:1' }], { from: 200, pitch: 30, margin: 16, glide: 1 }),
      clickMap({ at: 'spot:1', h: 4 }, { label: 'archer' }),
      click('.tp-paths .td-plate-btn', { withText: 'Sniper', label: 'sniper path' }),
      wait(1.8),
      { do: 'mark', name: 'effect:ballista' },
      { do: 'key', key: 'Escape' },
    ],
  },
  {
    // The first wave: zombies in their clothes, one followed up close from the gate (no health bars over them);
    // the long walk at speed (cut), then the chainsaw and the slicer at them
    name: 'game-zombies',
    steps: [
      act('wave', { label: 'zombie wave' }),
      { do: 'cursor', show: false },
      act('healthBars', { on: false }),
      wait(2.2),
      { do: 'follow', at: { at: 'enemy:zombie' }, dur: 7, back: 7, side: 3.5, h: 1.8, ahead: 8, label: 'zombies' },
      act('healthBars', { on: true }),
      orbit(1, { at: 'spot:5' }, { from: 190, to: 192, radius: 34, height: 18 }),
      act('speed', { value: 4 }),
      act('enemiesNear', { near: 'spot:5', radius: 45, timeout: 120 }),
      act('speed', { value: 1 }),
      { do: 'mark', name: 'zombies at the towers' },
      orbit(8, { at: 'spot:5' }, { from: 192, to: 240, radius: 34, height: 18, heightTo: 14, ease: 'inOut', label: 'effect:chainsaw' }),
      act('speed', { value: 3 }),
      act('waveDone', { timeout: 120 }),
    ],
  },
  {
    // The boss wave against every tower at its last level: Herbert's entrance at the gate (the game's own boss
    // camera), the walk at speed (cut), then the slicer, the laser, the ballista's bolts and the bastion's shells at
    // play speed; the camera on the boss until it falls, then slowly up and back
    name: 'game-boss',
    steps: [
      act('upgradeAll'),
      act('jumpWave', { wave: 10 }),
      wait(0.6),
      act('wave', { label: 'boss wave' }),
      { do: 'cursor', show: false },
      wait(4.5),
      { do: 'mark', name: 'effect:boss entrance' },
      frame([{ at: 'spot:2' }, { at: 'spot:3' }, { at: 'spot:4' }, { at: 'spot:5' }], { from: 200, pitch: 36, margin: 4, glide: 1 }),
      act('speed', { value: 4 }),
      act('enemiesNear', { near: 'spot:5', radius: 60, timeout: 120 }),
      act('speed', { value: 1.5 }),
      { do: 'mark', name: 'boss at the towers' },
      orbit(9, { at: 'spot:4' }, { from: 200, to: 245, radius: 42, height: 20, heightTo: 15, ease: 'inOut', label: 'fight' }),
      act('man', { dur: 5, wait: 14, towers: ['archer'], label: 'tower view' }),
      { do: 'follow', at: { at: 'enemy:herbert' }, dur: 40, back: 18, side: 9, h: 9, ahead: 8, label: 'boss' },
      // The follow ends as the boss falls: the climax; what is left of the wave goes at speed (cut)
      { do: 'mark', name: 'boss down' },
      wait(1.5),
      act('speed', { value: 3 }),
      act('waveDone', { timeout: 120 }),
      { do: 'mark', name: 'effect:wave beaten' },
      act('speed', { value: 1 }),
      wait(1.2),
      // Slowly up and back over the canyon, the towers standing
      path(9, ['current', [{ at: 'spots', dx: -60, dy: -170, h: 120 }, { at: 'spots' }]], { ease: 'inOut', label: 'pull out' }),
      wait(0.5),
    ],
  },
];
