// The close on Moon Base: the station in its crater under the deep-space sky, a slow push past the craters; the
// logo goes on in the cut.
import { act, m, path, sky, wait } from './common.mjs';

export const SCENES = [
  {
    name: 'outro-moon',
    page: '/?world=map:moon-base',
    clean: true,
    steps: [
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      sky('deep-space', 'night', 18, { sunAzimuth: 120, moonlight: 0.8 }),
      { do: 'mark', name: 'Outro' },
      // Low over the craters toward the station, rising as it closes in: the sky's galaxy over the rim
      path(18, [[m(-175, -125, 14), m(30, -20, 8)], [m(-115, -175, 22), m(30, -20, 6)], [m(-25, -190, 42), m(30, -20, 4)]], { ease: 'inOut', label: 'effect:moon base' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
