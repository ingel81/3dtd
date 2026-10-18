// Recoil and reload as the towers fire (TODO E244, TowerTypeConfig.firingMotion): one close look at each heavy gun
// on Red Canyon while a wave walks past, the farthest first. Not part of the programme; `run.mjs --scene r7-recoil`.
// Played against a build without the firing motion it gives the clips before.
import { act, orbit, wait } from './common.mjs';

/**
 * A close, held look at a standing tower while its targets pass, slightly from the side: `real` s at play speed, then
 * the same view for `slow` s at a quarter of the game's speed (the game slowed, not the video); the walk to it at
 * speed. `from` (degrees, 0 = south of it) puts the camera beside its barrel, `radius` m out, looking at `h` m over
 * the ground (the cannon stands on a high plinth).
 */
const look = (tower, label, from, radius, h = 3.5, real = 7, slow = 9) => [
  act('speed', { value: 4 }),
  act('enemiesNear', { near: `tower:${tower}`, radius: 40, timeout: 120, optional: true }),
  act('speed', { value: 1 }),
  orbit(real, { at: `tower:${tower}`, h }, { from, turn: 0, radius, height: 1.2, label }),
  act('speed', { value: 0.25 }),
  orbit(slow, { at: `tower:${tower}`, h }, { from, turn: 0, radius, height: 1.2, label: `${label} slow` }),
  act('speed', { value: 1 }),
];

export const FIXTURES = [
  {
    file: 'fixtures/r7-recoil.3dtdsave',
    game: 'red-canyon',
    // Bastion, cannon, gatling and an archer rebuilt as a ballista by the canyon road, from the HQ outward
    steps: [
      act('hints'),
      act('research'),
      act('credits', { amount: 80000 }),
      act('planTowers', { count: 4, tower: 'bastion', from: 60, to: 380, route: 0, offsets: [11, 14, 18, 22], step: 13 }),
      act('build', { tower: 'bastion', spot: 0, hold: 0.2 }),
      act('build', { tower: 'cannon', spot: 1, hold: 0.2 }),
      act('build', { tower: 'dual-gatling', spot: 2, hold: 0.2 }),
      act('build', { tower: 'archer', spot: 3, hold: 0.2 }),
      act('choosePath', { tower: 3, path: 'sniper' }),
      wait(1),
    ],
    credits: 900,
  },
];

export const SCENES = [
  {
    name: 'r7-recoil',
    start: { game: 'red-canyon', save: 'fixtures/r7-recoil.3dtdsave' },
    env: {
      ui: true,
      routes: false,
      healthBars: true,
      markers: false,
      credits: 900,
      seed: 5,
      camera: { eye: { at: 'tower:3', dx: 0, dy: -60, h: 35 }, look: { at: 'tower:3' } },
    },
    steps: [
      act('hints'),
      act('jumpWave', { wave: 4 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      // A clean frame once the wave runs (the wave button is part of the UI)
      { do: 'ui', on: false },
      ...look(3, 'ballista', 240, 9, 5),
      ...look(2, 'gatling', 250, 8),
      ...look(1, 'cannon', 30, 8, 5),
      ...look(0, 'bastion', 250, 9),
      wait(0.5),
    ],
  },
];
