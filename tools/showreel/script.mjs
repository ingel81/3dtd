// The showreel programme: scenes as data, played in order by run.mjs. A scene with `page` loads that page
// (`opened`: the window the editor's Test map asked for); one without plays on where the last one ended.
// Steps run on the page's frame clock (src/app/showreel/director.ts); `label` leaves a time mark for the cut.
//
// Points: [fx, fy, h] are shares of the map's width and depth around its middle (east, north) with h metres
// above the ground there; { at: 'hq' | 'center' | 'spawn:0', dx, dy, h } metres from a spot; no h: on the
// ground. Orbit angles in degrees, 0 = the camera south of the centre looking north, counter-clockwise.

/** A camera path through keyframes: [eye, look] pairs */
const path = (dur, keys, opts = {}) => ({ do: 'shot', dur, keys: keys.map((k) => (k === 'current' ? k : { eye: k[0], look: k[1] })), ...opts });
const orbit = (dur, center, opts) => ({ do: 'orbit', dur, center, ...opts });
const act = (name, args = {}) => ({ do: 'act', name, ...args });
const click = (sel, opts = {}) => ({ do: 'click', sel, ...opts });
const wait = (dur) => ({ do: 'wait', dur });
const par = (...steps) => ({ do: 'par', steps });
const stroke = (dur, points, opts = {}) => ({ do: 'stroke', dur, points, ...opts });
const settings = (patch) => act('settings', { patch });

/** A flight over a shipped map in photo mode, without the route lines */
const flyover = (name, map, label, shots) => ({
  name,
  page: `/?world=map:${map}`,
  steps: [act('photo'), act('routes', { on: false }), { do: 'mark', name: label }, ...shots],
});

export const SCENES = [
  // ---------------------------------------------------------------- the shipped maps
  flyover('harbor-flyover', 'harbor-town', 'Harbor Town', [
    path(14, [
      [[0.12, -0.78, 35], [0.0, -0.2, 10]],
      [[-0.02, -0.42, 60], [0.0, 0.05, 20]],
      [[-0.22, -0.05, 115], [0.15, 0.3, 10]],
    ], { label: 'harbor sweep' }),
  ]),
  flyover('mountain-flyover', 'mountain-pass', 'Mountain Pass', [
    path(13, [
      [[0.05, -0.68, 45], [0.0, 0.0, 30]],
      [[0.08, -0.45, 70], [0.02, 0.25, 60]],
      [[0.25, -0.1, 120], [-0.05, 0.4, 80]],
    ], { label: 'pass climb' }),
  ]),
  flyover('archipelago-flyover', 'archipelago', 'Archipelago', [
    path(12, [
      [[0.62, -0.55, 55], [0.12, -0.12, 0]],
      [[0.55, 0.05, 70], [0.05, -0.1, 0]],
      [[0.3, 0.45, 90], [-0.1, -0.05, 0]],
    ], { label: 'islands' }),
  ]),
  flyover('ember-flyover', 'ember-crater', 'Ember Crater', [
    orbit(12, { at: 'hq' }, { from: 20, to: 95, radius: 230, radiusTo: 170, height: 110, heightTo: 70, label: 'crater orbit' }),
  ]),
  flyover('autumn-flyover', 'autumn-keep', 'Autumn Keep', [
    orbit(11, { at: 'hq' }, { from: 160, to: 215, radius: 190, height: 80, heightTo: 55, label: 'keep orbit' }),
  ]),
  flyover('frost-flyover', 'frost-hamlet', 'Frost Hamlet', [
    path(10, [
      [[-0.62, -0.45, 45], [0.0, 0.25, 0]],
      [[0.28, -0.5, 65], [0.02, 0.25, 0]],
    ], { label: 'frozen lake' }),
  ]),
  flyover('moon-flyover', 'moon-base', 'Moon Base', [
    path(9, [
      [[-0.62, -0.6, 35], [0.1, 0.0, 0]],
      [[-0.05, -0.72, 50], [0.1, 0.05, 0]],
    ], { label: 'moon' }),
  ]),
  flyover('mars-flyover', 'mars-canyon', 'Mars Canyon', [
    path(9, [
      [[0.52, -0.62, 60], [0.05, -0.2, 0]],
      [[-0.18, -0.58, 45], [0.1, 0.0, 0]],
    ], { label: 'mars' }),
  ]),

  // ---------------------------------------------------------------- the editor, from nothing to a map
  {
    name: 'editor-new',
    page: '/editor',
    steps: [
      { do: 'mark', name: 'Map editor' },
      wait(0.8),
      click('[data-test=new-map]', { label: 'new map' }),
      { do: 'type', sel: '[data-test=new-name]', text: 'Ember Valley', cps: 11 },
      click('button[role=radio]', { withText: 'Small' }),
      click('[data-template=""]'),
      wait(0.4),
      click('[data-test=create-map]', { label: 'create' }),
      act('viewReady', { timeout: 90 }),
      wait(1),
    ],
  },
  {
    name: 'editor-mountains',
    steps: [
      path(2.5, ['current', [[0.05, -0.72, 230], [0.0, 0.12]]]),
      click('[data-tool=landscape]'),
      click('[data-mode=mountain]', { label: 'mountains' }),
      settings({ brush: { radius: 85, strength: 1 }, landscape: { seed: 11, reroll: false } }),
      par(
        path(13, ['current', [[0.32, -0.6, 210], [0.0, 0.15]]], { ease: 'smooth' }),
        { do: 'seq', steps: [
          stroke(3.5, [[-0.3, 0.3], [-0.27, 0.32], [-0.25, 0.31]]),
          stroke(4, [[-0.04, 0.36], [0.0, 0.38], [0.03, 0.37]]),
          settings({ landscape: { seed: 12 } }),
          stroke(3.5, [[0.24, 0.32], [0.27, 0.3], [0.29, 0.28]]),
        ] },
      ),
    ],
  },
  {
    name: 'editor-symmetry',
    steps: [
      { do: 'select', sel: '[data-test=symmetry]', value: 'x', label: 'symmetry' },
      click('[data-mode=crater]'),
      settings({ brush: { radius: 45, strength: 1 } }),
      stroke(1.6, [[-0.27, -0.2], [-0.26, -0.2]]),
      click('[data-mode=plateau]'),
      stroke(2.2, [[-0.33, 0.05], [-0.3, 0.07]]),
      wait(1),
      { do: 'select', sel: '[data-test=symmetry]', value: 'none' },
    ],
  },
  {
    name: 'editor-biomes',
    steps: [
      click('[data-mode=biome]', { label: 'biomes' }),
      click('[data-biome=forest]'),
      settings({ brush: { radius: 55, strength: 0.9 }, landscape: { seed: 21 } }),
      par(
        path(12, ['current', [[-0.35, -0.7, 240], [-0.05, 0.05]], [[0.2, -0.75, 220], [0.05, 0.1]]], { ease: 'smooth' }),
        { do: 'seq', steps: [
          stroke(3.5, [[-0.42, 0.14], [-0.22, 0.2], [-0.05, 0.25], [0.1, 0.22]]),
          click('[data-biome=conifer]'),
          stroke(3, [[-0.32, 0.38], [-0.1, 0.42], [0.15, 0.42], [0.35, 0.36]]),
        ] },
      ),
    ],
  },
  {
    name: 'editor-river',
    steps: [
      click('[data-mode=river]', { label: 'river' }),
      par(
        path(6, ['current', [[-0.35, -0.55, 200], [-0.05, 0.05]]], { ease: 'smooth' }),
        stroke(3.5, [[-0.02, 0.33], [-0.1, 0.15], [-0.05, -0.05], [-0.15, -0.25], [-0.1, -0.48]], { settle: 0.3 }),
      ),
      wait(1.5),
    ],
  },
  {
    name: 'editor-lava',
    steps: [
      path(2.5, ['current', [[0.5, -0.55, 170], [0.28, -0.22]]]),
      click('[data-mode=biome]', { label: 'hell' }),
      click('[data-biome=hell]'),
      settings({ brush: { radius: 45, strength: 1 }, landscape: { seed: 31 } }),
      stroke(3, [[0.2, -0.38], [0.32, -0.3], [0.38, -0.15], [0.3, -0.05]]),
      click('[data-mode=cracks]'),
      stroke(2.5, [[0.25, -0.3], [0.33, -0.2], [0.28, -0.12]]),
      click('[data-mode=river]', { label: 'lava river' }),
      click('[data-test=river-lava]'),
      stroke(2.5, [[0.42, 0.25], [0.42, 0.0], [0.43, -0.2], [0.44, -0.42]], { settle: 0.3 }),
      wait(1.5),
    ],
  },
  {
    name: 'editor-pour',
    steps: [
      path(2.5, ['current', [[0.02, -0.68, 190], [0.0, -0.18]]]),
      click('[data-tool=water]'),
      // Water > Pour: the hollow fills to its rim, the overflow runs down into the next ones
      { do: 'if', sel: '[data-mode=pour]', steps: [
        click('[data-mode=pour]', { label: 'pour' }),
        click('[data-test=pour-lava]'),
        { do: 'clickMap', at: [0.27, -0.2], label: 'pour lava' },
        act('idle', { timeout: 30 }),
        wait(2),
        click('[data-test=pour-water]'),
        { do: 'clickMap', at: [-0.27, -0.2], label: 'pour water' },
        act('idle', { timeout: 30 }),
        wait(2.5),
      ] },
    ],
  },
  {
    name: 'editor-road',
    steps: [
      click('[data-tool=landscape]'),
      click('[data-mode=road]', { label: 'road' }),
      path(2, ['current', [[0.25, -0.5, 230], [0.15, 0.0]]]),
      stroke(3, [[0.47, 0.12], [0.3, 0.08], [0.15, 0.02], { at: 'hq', dx: 8, dy: 4 }], { settle: 0.3 }),
      wait(0.8),
      click('[data-tool=markers]', { label: 'spawn' }),
      click('[data-mode=spawn]'),
      { do: 'clickMap', at: [0.46, 0.12] },
      wait(0.6),
      click('[data-tool=landscape]', { label: 'village' }),
      click('[data-mode=biome]'),
      click('[data-biome=village]'),
      settings({ brush: { radius: 35, strength: 1 }, landscape: { seed: 41 } }),
      stroke(2.5, [{ at: 'hq', dx: -40, dy: 30 }, { at: 'hq', dx: 0, dy: 40 }, { at: 'hq', dx: 40, dy: 30 }]),
      wait(0.6),
    ],
  },
  {
    name: 'editor-sky',
    steps: [
      click('[data-tool=environment]', { label: 'sky' }),
      par(
        path(9, ['current', [[-0.1, -0.62, 110], [0.05, 0.1, 20]]], { ease: 'smooth' }),
        { do: 'seq', steps: [
          click('button[role=radio]', { withText: 'Dusk' }),
          wait(1),
          { do: 'range', sel: '[data-test=time-of-day]', to: 18.6, dur: 3 },
          wait(0.6),
          click('button[role=radio]', { withText: 'Rain', label: 'rain' }),
          wait(2),
          click('button[role=radio]', { withText: 'Clear' }),
        ] },
      ),
    ],
  },
  {
    name: 'editor-trial',
    steps: [
      click('[data-test=trial]', { label: 'trial wave' }),
      wait(0.5),
      click('[data-test=trial-speed] button', { withText: '4x' }),
      orbit(11, { at: 'hq', dx: -70 }, { from: 200, to: 250, radius: 130, height: 70, heightTo: 45 }),
      click('[data-test=trial]'),
    ],
  },
  {
    name: 'editor-test',
    steps: [
      { do: 'cursor', show: true },
      click('[data-test=test-play]', { label: 'test map' }),
      wait(2),
    ],
  },

  // ---------------------------------------------------------------- the new map in the game
  {
    name: 'game-build',
    page: 'opened',
    steps: [
      { do: 'mark', name: 'Test map' },
      act('hints'),
      act('research'),
      act('credits', { amount: 50000 }),
      path(2.5, ['current', [{ at: 'hq', dx: -110, dy: -120, h: 95 }, { at: 'hq', dx: -100 }]]),
      act('build', { tower: 'archer', at: { at: 'hq', dx: -45, dy: 18 }, label: 'build' }),
      act('build', { tower: 'cannon', at: { at: 'hq', dx: -95, dy: -18 } }),
      act('build', { tower: 'ice', at: { at: 'hq', dx: -150, dy: 18 } }),
      act('build', { tower: 'lightning', at: { at: 'hq', dx: 60, dy: -18 } }),
      act('build', { tower: 'fire', at: { at: 'hq', dx: -200, dy: -18 } }),
    ],
  },
  {
    name: 'game-wave',
    steps: [
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      orbit(14, { at: 'hq', dx: -100 }, { from: 190, to: 250, radius: 150, height: 75, heightTo: 55, label: 'fight' }),
      path(10, ['current', [{ at: 'hq', dx: -170, dy: -60, h: 25 }, { at: 'hq', dx: -60, dy: 10 }]], { ease: 'smooth' }),
      wait(4),
    ],
  },

  // ---------------------------------------------------------------- the close: a slow orbit at dusk
  {
    name: 'finale-dusk',
    page: '/?world=map:mountain-pass',
    steps: [
      act('photo'),
      act('routes', { on: false }),
      act('environment', { patch: { sky: 'dusk', sunElevation: 12, sunAzimuth: 250 } }),
      { do: 'mark', name: 'Finale' },
      orbit(26, { at: 'hq' }, { from: 145, to: 185, radius: 250, radiusTo: 200, height: 95, heightTo: 125, ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2.5, label: 'fade out' },
      wait(0.5),
    ],
  },
];
