// K7 "Schluss" (DREHBUCH_R4 2.9): Moon Base in raking light, the Earth large and low over the north rim, the station
// with its lamps in frame from the first picture and a Sentinel Laser on the south rim in front; a slow push over the
// tower and the station toward the Earth, the look rising onto it. The end card (logo, address, the opening's
// promise) goes on in the cut after `effect:earth`.
//
// The tower stands before the mark: research and credits for it in the pre-roll (the HUD is out of the picture
// from the mark on, nothing of it is in the cut), then the clean frame.
import { act, m, path, wait } from './common.mjs';

/** The Sentinel Laser's spot on the station crater's south rim (the HQ at 30, -20, the rim some 82 m round it) */
const TOWER = m(10, -98);

export const SCENES = [
  {
    name: 'r4-outro',
    page: '/?world=map:moon-base',
    noIntro: true,
    steps: [
      act('research'),
      act('credits', { amount: 400 }),
      act('build', { tower: 'sentinel', at: TOWER, dur: 0.4, hold: 0.3 }),
      // Its build animation (the scaffold) over before the picture counts
      wait(10),
      { do: 'cursor', show: false },
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      // Raking light: the sun low in the south-east lights the rims from the side; the Earth larger and lower over the
      // north rim; a little fill so the shadows are not black (F174). Held still while the new light settles
      act('environment', { patch: { sunAzimuth: 135, sunElevation: 18, moonlight: 0.5, planet: { azimuth: 5, elevation: 10, size: 14 } } }),
      // Low behind the rim west of the tower: the Earth upper left, the tower in the right third, the station's lamps between
      path(0.1, [[m(-15, -118, 12), m(55, 60, 8)], [m(-15, -118, 12), m(55, 60, 8)]]),
      wait(2),
      { do: 'mark', name: 'Outro' },
      wait(0.5),
      // Past the tower and over the station toward the Earth, the look rising onto it
      path(7.5, [[m(-15, -118, 12), m(55, 60, 8)], [m(-6, -94, 18), m(50, 130, 30)], [m(12, -62, 24), m(42, 230, 62)]], { ease: 'inOut', label: 'effect:earth' }),
      wait(1.5),
      { do: 'fade', to: 1, dur: 1.2, label: 'fade out' },
      wait(0.3),
    ],
  },
];
