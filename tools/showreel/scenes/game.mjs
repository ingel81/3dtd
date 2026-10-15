// Red Canyon as edited, from the editor's Test map: towers built one by one on the canyon's rims, a wave, a tower's
// own view, the fight from above, and once the wave is beaten a slow pull-out.
import { act, orbit, path, wait } from './common.mjs';

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

export const SCENES = [
  {
    name: 'game-build',
    page: 'opened',
    // Straight into the game view: the intro flight is the intro's part
    noIntro: true,
    steps: [
      { do: 'mark', name: 'Test map' },
      act('hints'),
      act('research'),
      act('credits', { amount: 50000 }),
      wait(0.6),
      // Spots from 70 m out along the routes: the HQ stays out of the frame
      // On the rims above the canyon floor the enemies walk
      act('planTowers', { count: 4, tower: 'cannon', from: 60, to: 360, route: 0, offsets: [16, 20, 24, 28], step: 14 }),
      frame([{ at: 'spot:0' }, { at: 'spot:1' }, { at: 'spot:2' }, { at: 'spot:3' }], { from: 200, pitch: 45, margin: 8, pad: 1, glide: 1.8 }),
      frame([{ at: 'spot:0' }], { from: 200, pitch: 46, margin: 28, glide: 1 }),
      act('build', { tower: 'archer', spot: 0, hold: 1.2, label: 'build' }),
      frame([{ at: 'spot:1' }], { from: 200, pitch: 46, margin: 28, glide: 1 }),
      act('build', { tower: 'cannon', spot: 1, hold: 1.2 }),
      frame([{ at: 'spot:2' }], { from: 200, pitch: 46, margin: 28, glide: 1 }),
      act('build', { tower: 'ice', spot: 2, hold: 1.2 }),
      frame([{ at: 'spot:3' }], { from: 200, pitch: 46, margin: 28, glide: 1 }),
      act('build', { tower: 'lightning', spot: 3, hold: 1.2 }),
      // The last scaffold down, the turret sweeping
      wait(2.5),
      { do: 'mark', name: 'effect:towers' },
    ],
  },
  {
    name: 'game-wave',
    steps: [
      // A ground wave, quick enough to be beaten in the shot
      act('jumpWave', { wave: 5 }),
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      // Round the towers while the wave comes up the canyon, into the tower it reaches first (waiting, the camera
      // holds, so the orbit comes first), then the fight from above
      orbit(8, { at: 'spots' }, { from: 150, to: 200, radius: 60, height: 30, heightTo: 26, ease: 'inOut' }),
      act('man', { dur: 5, wait: 12, towers: ['archer', 'lightning'], label: 'tower view' }),
      orbit(14, { at: 'spots' }, { from: 200, to: 280, radius: 55, height: 26, heightTo: 20, label: 'fight', ease: 'inOut' }),
      act('waveDone', { timeout: 60 }),
      { do: 'mark', name: 'effect:wave beaten' },
      act('speed', { value: 1 }),
      // Slowly up and back over the city, the towers standing
      path(9, ['current', [{ at: 'spots', dx: -60, dy: -170, h: 120 }, { at: 'spots' }]], { ease: 'inOut', label: 'pull out' }),
      wait(1),
    ],
  },
];
