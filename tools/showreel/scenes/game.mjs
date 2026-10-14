// The new map in the game: a few towers and a short fight.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

export const SCENES = [
  {
    name: 'game-build',
    page: 'opened',
    steps: [
      { do: 'mark', name: 'Test map' },
      act('hints'),
      act('research'),
      act('credits', { amount: 50000 }),
      wait(0.6),
      act('planTowers', { count: 4, tower: 'cannon' }),
      path(1.8, ['current', [{ at: 'spots', dx: -25, dy: -75, h: 45 }, { at: 'spots' }]]),
      act('build', { tower: 'archer', spot: 0, hold: 1.2, label: 'build' }),
      act('build', { tower: 'cannon', spot: 1, hold: 1.2 }),
      act('build', { tower: 'ice', spot: 2, hold: 1.2 }),
      act('build', { tower: 'lightning', spot: 3, hold: 1.2 }),
    ],
  },
  {
    name: 'game-wave',
    steps: [
      act('jumpWave', { wave: 8 }),
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      orbit(6, { at: 'spots' }, { from: 190, to: 228, radius: 75, height: 35, heightTo: 29, label: 'fight', ease: 'in' }),
      // Into the tower the wave reaches first (up to 3 s for one) for a few shots of its own, then out where the camera was
      act('man', { dur: 4.5, wait: 3, label: 'tower view' }),
      orbit(3.5, { at: 'spots' }, { from: 228, to: 280, radius: 75, height: 29, heightTo: 22, ease: 'out' }),
    ],
  },
];
