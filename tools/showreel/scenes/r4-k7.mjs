// K7 "Schluss" (DREHBUCH_R4 2.9): Moon Base in raking light, the Earth large and low over the north rim, the station
// with its lamps in frame from the first picture and a Sentinel Laser on the south rim in front; a slow push over the
// tower and the station toward the Earth, the look rising onto it. The end card (logo, address, the opening's
// promise) goes on in the cut after `effect:earth`.
import { act, m, path, wait } from './common.mjs';

/** The Sentinel Laser's spot on the station crater's south rim (the HQ at 30, -20, the rim some 82 m round it) */
const TOWER = m(10, -98);
/** Close behind the tower on the rim: the tower large in the lower right, the station's lamps beyond, the Earth upper left */
const FIRST = { eye: m(-5, -114, 14), look: m(40, 60, 6) };

/** The start state (fixtures.mjs): the tower stands, built through the sidebar before the save; normal credits */
export const FIXTURES = [
  {
    file: 'fixtures/outro-tower.3dtdsave',
    game: 'moon-base',
    steps: [
      act('hints'),
      act('research'),
      act('credits', { amount: 400 }),
      act('build', { tower: 'sentinel', at: TOWER, dur: 0.4, hold: 0.3 }),
      // Its build animation (the scaffold) over before the save
      wait(10),
    ],
    credits: 120,
  },
];

export const SCENES = [
  {
    name: 'r4-outro',
    start: { game: 'moon-base', save: 'fixtures/outro-tower.3dtdsave' },
    env: {
      window: '2048x1152',
      dpr: 1.25,
      ui: false,
      markers: false,
      routes: false,
      // Raking light: the sun low in the south-west, behind the camera's left, lights the tower and the rims from the side; the Earth larger and lower over
      // the north rim; a little fill so the shadows are not black (F174)
      sky: { sunAzimuth: 215, sunElevation: 22, moonlight: 0.8, planet: { azimuth: 5, elevation: 10, size: 14 } },
      camera: FIRST,
    },
    steps: [
      { do: 'cursor', show: false },
      wait(1),
      { do: 'mark', name: 'Outro' },
      wait(0.5),
      // Past the tower and over the station toward the Earth, the look rising onto it
      path(7.5, [[FIRST.eye, FIRST.look], [m(-6, -96, 20), m(46, 130, 30)], [m(12, -64, 24), m(42, 230, 62)]], { ease: 'inOut', label: 'effect:earth' }),
      wait(1.5),
      { do: 'fade', to: 1, dur: 1.2, label: 'fade out' },
      wait(0.3),
    ],
  },
];
