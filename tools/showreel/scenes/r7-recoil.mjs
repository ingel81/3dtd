// Recoil and reload as the towers fire (TODO E244, TowerTypeConfig.firingMotion): one close look at each heavy gun
// on Red Canyon while a wave walks past, the farthest first. Not part of the programme; `run.mjs --scene r7-recoil`.
// Played against a build without the firing motion it gives the clips before.
import { act, orbit, wait } from './common.mjs';

/** A close, slowly turning look at a standing tower while its targets pass; the walk to it at speed */
const look = (tower, label, dur, from) => [
  act('speed', { value: 4 }),
  act('enemiesNear', { near: `tower:${tower}`, radius: 45, timeout: 120, optional: true }),
  act('speed', { value: 1 }),
  // Round the gun at its own height, close: 13 m out, a little above it, turning slowly
  orbit(dur, { at: `tower:${tower}`, h: 4 }, { from, turn: 18, radius: 13, height: 3, label }),
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
      ...look(3, 'ballista', 10, 240),
      ...look(2, 'gatling', 6, 250),
      ...look(1, 'cannon', 8, 250),
      ...look(0, 'bastion', 9, 250),
      wait(0.5),
    ],
  },
];
