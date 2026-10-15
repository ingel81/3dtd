// The intro: one short flight each over the four maps the editor part works on, clean frames, today's life in
// the picture (water mirroring and lapping at the oasis, lava crust plates, smoke over the ruins, chimney smoke
// and birds over the village). Demo Valley comes last: its game goes on into the editor (edit-this-map).
import { act, click, flyover, m, orbit, path, wait } from './common.mjs';

export const SCENES = [
  flyover('intro-red-canyon', 'red-canyon', 'Red Canyon', [
    // Round the oasis by the temple, high enough to see over the basin's rim: the palms and mesas mirrored in its still water, the foam at its rim
    orbit(8, { m: [110, -195] }, { from: 150, to: 190, radius: 52, radiusTo: 40, height: 30, heightTo: 20, ease: 'inOut', label: 'effect:oasis' }),
  ]),
  flyover('intro-ember-crater', 'ember-crater', 'Ember Crater', [
    // Low over the lava lake round the HQ island: the crust plates drift, the cracks glow
    path(8, [[m(-75, -80, 24), m(-5, -10, 0)], [m(55, -85, 18), m(10, -5, 0)]], { ease: 'inOut', label: 'effect:lava crust' }),
  ]),
  flyover('intro-ruined-city', 'ruined-city', 'Ruined City', [
    // Over the roofs toward the barricaded crossroads, smoke and haze between the blocks
    path(8, [[m(-160, -185, 46), m(0, -50, 0)], [m(-50, -215, 36), m(64, -64, 0)]], { ease: 'inOut', label: 'effect:ruins' }),
  ]),
  flyover('intro-demo-valley', 'demo-valley', 'Demo Valley', [
    // The village from the south: chimney smoke, birds circling over the meadows
    path(8, [[m(-60, -255, 28), m(40, -140, 8)], [m(60, -268, 32), m(72, -135, 8)]], { ease: 'inOut', label: 'effect:village' }),
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
