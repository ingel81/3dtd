// The close on Moon Base: the station in its crater, the Earth over the north rim (NASA's Blue Marble), a slow
// push toward it; the logo goes on in the cut.
import { act, m, path, wait } from './common.mjs';

export const SCENES = [
  {
    name: 'outro-moon',
    page: '/?world=map:moon-base',
    clean: true,
    steps: [
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      // The map's own sky: black, the sun low from the south-east, the Earth over the north rim. A slow push from
      // the south over the station toward it, rising as it closes in
      wait(1),
      { do: 'mark', name: 'Outro' },
      path(16, [[m(20, -175, 20), m(36, 220, 46)], [m(26, -120, 26), m(36, 220, 50)], [m(30, -70, 34), m(36, 220, 54)]], { ease: 'inOut', label: 'effect:earth' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
