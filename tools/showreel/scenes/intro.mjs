// The intro, short: one flight each over Ember Crater (lava crust, the smoke columns), Red Canyon (the oasis
// mirroring) and Demo Valley (chimney smoke, birds), clean frames. Demo Valley's game goes on into the editor
// (edit-this-map).
import { act, click, flyover, m, orbit, path, wait } from './common.mjs';

export const SCENES = [
  flyover('intro-ember-crater', 'ember-crater', 'Ember Crater', [
    // Low over the lava lake round the HQ island, the look raised to the three smoke columns over the crater: the
    // crust plates drift, the cracks glow, the columns lean off over the rim
    path(7, [[m(-85, -95, 22), m(10, -20, 26)], [m(60, -100, 18), m(15, -25, 30)]], { ease: 'inOut', label: 'effect:lava crust' }),
  ]),
  flyover('intro-red-canyon', 'red-canyon', 'Red Canyon', [
    // Round the oasis by the temple, high enough to see over the basin's rim: the palms and mesas mirrored in its still water, the foam at its rim
    orbit(7, { m: [110, -195] }, { from: 150, to: 185, radius: 52, radiusTo: 40, height: 30, heightTo: 20, ease: 'inOut', label: 'effect:oasis' }),
  ]),
  flyover('intro-demo-valley', 'demo-valley', 'Demo Valley', [
    // The village from the south: chimney smoke, birds circling over the meadows
    path(6, [[m(-60, -255, 28), m(40, -140, 8)], [m(50, -266, 31), m(70, -136, 8)]], { ease: 'inOut', label: 'effect:village' }),
  ]),
  {
    // The game on Demo Valley goes on: a wave started, then the pause menu's Edit this map, asked first while a
    // run is under way; the click on "Open in the editor" leaves the page for the editor on an own copy
    name: 'edit-this-map',
    arrives: '/editor?map=demo-valley',
    leave: '.mh-confirm .td-btn-primary',
    steps: [
      { do: 'ui', on: true },
      act('routes', { on: true }),
      act('hints'),
      wait(0.8),
      act('wave', { label: 'wave started' }),
      wait(2),
      click('.sb-menu', { label: 'pause menu' }),
      wait(0.7),
      click('[data-entry=edit-map]', { label: 'edit this map' }),
      { do: 'waitFor', sel: '.mh-confirm' },
      wait(0.4),
      { do: 'move', to: '.mh-confirm .td-btn-primary', dur: 0.6 },
      wait(1),
    ],
  },
];
