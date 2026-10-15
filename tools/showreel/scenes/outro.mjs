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
      // The sun low and bright on the regolith under the black, starry picture
      sky('deep-space', 'day', 16, { sunAzimuth: 120 }),
      { do: 'mark', name: 'Outro' },
      // Low over the craters from the south-east toward the station, rising as it closes in: the galaxy over the
      // rim (from the south-west the West landing zone's red beacon stood in the foreground)
      path(18, [[m(140, -205, 12), m(30, -20, 30)], [m(70, -200, 22), m(30, -20, 14)], [m(5, -130, 36), m(30, -20, 4)]], { ease: 'inOut', label: 'effect:moon base' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
