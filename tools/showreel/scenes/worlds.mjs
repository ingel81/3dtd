// The shipped maps after today's round, between the editor and the fight: autumn foliage turning tree by tree and
// the keep's torches after dark, Harbor Town's lamps mirrored in the harbour at night, Archipelago's closed cliffs
// and its buoys blinking at dusk. Clean frames; each sky set with the camera at rest (the new look compiles and
// stalls its first frames: the cut starts at the shot).
import { act, flyover, m, orbit, path, sky, wait } from './common.mjs';

export const SCENES = [
  flyover('autumn-keep', 'autumn-keep', 'Autumn Keep', [
    // Low over the woods at dusk, the low sun behind the camera: the foliage red to yellow, tree by tree
    sky('afterglow', 'dusk', 15, { sunAzimuth: 330 }),
    path(6, [[m(-130, -40, 22), m(0, 60, 10)], [m(-60, -20, 40), m(0, 70, 4)]], { ease: 'inOut', label: 'effect:autumn' }),
    // Night: the torches on the walls and the braziers in the bailey
    sky('starry-night', 'night', 30, { moonlight: 0.6 }),
    orbit(6.5, { at: 'hq', dy: 12 }, { from: 150, to: 215, radius: 70, radiusTo: 56, height: 30, heightTo: 20, ease: 'inOut', label: 'effect:torches' }),
  ]),
  flyover('harbor-night', 'harbor-town', 'Harbor Town', [
    // Along the quay at night: the lamps' light lying on the water, the ships' lit windows
    sky('starry-night', 'night', 30, { moonlight: 0.7 }),
    path(6, [[m(-235, -205, 10), m(-150, -165, 4)], [m(-80, -205, 13), m(0, -130, 8)]], { ease: 'inOut', label: 'effect:lights on water' }),
    path(5.5, [[m(30, -70, 35), m(0, 40, 0)], [m(-60, 105, 90), m(10, 30, 0)]], { ease: 'inOut', label: 'effect:harbor city' }),
  ]),
  flyover('archipelago-dusk', 'archipelago', 'Archipelago', [
    // The harbour at dusk, the buoys blinking red and green; then round the lighthouse rock, its cliffs closed
    sky('afterglow', 'dusk', 8, { sunAzimuth: 250 }),
    path(6, [[m(20, -215, 8), m(70, -135, 3)], [m(115, -180, 15), m(68, -125, 4)]], { ease: 'inOut', label: 'effect:buoys' }),
    path(6, [[m(140, 0, 40), m(205, 78, 15)], [m(275, 50, 42), m(205, 80, 15)]], { ease: 'inOut', label: 'effect:cliffs' }),
  ]),
];
