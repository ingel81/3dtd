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
      // Raking light: the sun low in the south-east, behind the camera's right, lights the crater rims from the side, long shadows across the floor;
      // the Earth larger and lower over the north rim. Held still while the new light settles
      act('environment', { patch: { sunAzimuth: 135, sunElevation: 18, planet: { azimuth: 5, elevation: 10, size: 14 } } }),
      wait(1.8),
      { do: 'mark', name: 'Outro' },
      // A slow push from the south over the station toward the Earth, the look rising onto it; it ends on the Earth
      path(18, [[m(25, -170, 9), m(40, 300, 45)], [m(30, -110, 14), m(40, 300, 62)], [m(34, -60, 20), m(40, 300, 88)]], { ease: 'inOut', label: 'effect:earth' }),
      wait(1.5),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
