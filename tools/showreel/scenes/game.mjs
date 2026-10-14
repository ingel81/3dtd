// The new map in the game: a few towers and a short fight.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

export const SCENES = [
  {
    name: 'game-build',
    page: 'opened',
    // Straight into the game view: the intro flight is the fly-overs' part
    noIntro: true,
    steps: [
      { do: 'mark', name: 'Test map' },
      act('hints'),
      act('research'),
      act('credits', { amount: 50000 }),
      wait(0.6),
      // Spots from 90 m out along the routes: the HQ crystal stays out of the frame
      act('planTowers', { count: 4, tower: 'cannon', from: 90, to: 220, route: 0 }),
      // All four spots in one frame, from the side the fight orbit starts on
      { do: 'frame', points: [{ at: 'spot:0' }, { at: 'spot:1' }, { at: 'spot:2' }, { at: 'spot:3' }], from: 190, pitch: 45, margin: 8, pad: 1, glide: 1.8 },
      { do: 'frame', points: [{ at: 'spot:0' }], from: 190, pitch: 40, margin: 24, glide: 1 },
      act('build', { tower: 'archer', spot: 0, hold: 1.2, label: 'build' }),
      { do: 'frame', points: [{ at: 'spot:1' }], from: 190, pitch: 40, margin: 24, glide: 1 },
      act('build', { tower: 'cannon', spot: 1, hold: 1.2 }),
      { do: 'frame', points: [{ at: 'spot:2' }], from: 190, pitch: 40, margin: 24, glide: 1 },
      act('build', { tower: 'ice', spot: 2, hold: 1.2 }),
      { do: 'frame', points: [{ at: 'spot:3' }], from: 190, pitch: 40, margin: 24, glide: 1 },
      act('build', { tower: 'lightning', spot: 3, hold: 1.2 }),
    ],
  },
  {
    name: 'game-wave',
    steps: [
      // A ground wave (8 was fliers only, out of the orbit's frame)
      act('jumpWave', { wave: 5 }),
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      // Into the tower the wave reaches first (it waits up to 8 s for an enemy in range), then the orbit over the
      // fight: started right away it showed the spots before any enemy had come
      act('man', { dur: 4.5, wait: 8, towers: ['archer', 'lightning'], label: 'tower view' }),
      orbit(7, { at: 'spots' }, { from: 190, to: 250, radius: 70, height: 32, heightTo: 24, label: 'fight', ease: 'inOut' }),
    ],
  },
];
