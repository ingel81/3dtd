// The showreel programme: scenes as data, played in order by run.mjs. A scene with `page` loads that page
// (`opened`: the window the editor's Test map asked for); one without plays on where the last one ended.
// Steps run on the page's frame clock (src/app/showreel/director.ts); `label` leaves a time mark for the cut.
//
// Points: [fx, fy, h] are shares of the map's width and depth around its middle (east, north) with h metres
// above the ground there; { at, dx, dy, h } metres from a named spot: 'hq', 'center', 'spawn:0', in the editor
// 'node:-1' (newest road node), 'river:0:3' (a river point), 'object:<asset>' or 'object:last', in the game
// 'spot:<i>' and 'spots' (tower spots from planTowers); { m: [x, y], h } metres on the map. Without h: on the
// ground, followed live. Orbit angles in degrees, 0 = the camera south of the centre looking north,
// counter-clockwise.
//
// UI per step: { do: 'ui', on } the page's UI or a clean frame (game: photo mode; editor: without header, tool
// column, side column, status bar and minimap), { do: 'legend', on } the editor's mouse legend (off by default),
// { do: 'markers', on } the game's HQ diamond and name signs. Fly-overs and the finale play clean, editor and
// game with their full UI.
//
// Ground layers: a map holds 8. Measured on an empty map (grass): forest +3, river +3 (sand, gravel, mud),
// road +1 (cobblestone), snow +3, desert +4, hell +6. Green Valley paints gravel first (the river reuses it):
// grass, gravel, forest x3, sand, mud, cobblestone. Fire and Ice: grass, snow x3, desert x4; its lava is water
// bodies (Fill a hollow), no ground layers.

/** A camera path through keyframes: [eye, look] pairs */
const path = (dur, keys, opts = {}) => ({ do: 'shot', dur, keys: keys.map((k) => (k === 'current' ? k : { eye: k[0], look: k[1] })), ...opts });
const orbit = (dur, center, opts) => ({ do: 'orbit', dur, center, ...opts });
const act = (name, args = {}) => ({ do: 'act', name, ...args });
const click = (sel, opts = {}) => ({ do: 'click', sel, ...opts });
const clickMap = (at, opts = {}) => ({ do: 'clickMap', at, ...opts });
const wait = (dur) => ({ do: 'wait', dur });
const par = (...steps) => ({ do: 'par', steps });
const seq = (...steps) => ({ do: 'seq', steps });
const stroke = (dur, points, opts = {}) => ({ do: 'stroke', dur, points, ...opts });
const settings = (patch) => act('settings', { patch });
const m = (x, y, h) => ({ m: [x, y], ...(h === undefined ? {} : { h }) });
const tool = (id, opts = {}) => click(`[data-tool=${id}]`, opts);
const mode = (id, opts = {}) => click(`[data-mode=${id}]`, opts);
/** An asset from the object palette by its search */
const asset = (search, id) => [{ do: 'type', sel: 'input[aria-label="Search assets"]', text: search, cps: 14 }, click(`[data-asset=${id}]`)];

/** A flight over a shipped map in photo mode, without the route lines and markers */
const flyover = (name, map, label, shots) => ({
  name,
  page: `/?world=map:${map}`,
  steps: [{ do: 'ui', on: false }, { do: 'markers', on: false }, act('routes', { on: false }), { do: 'mark', name: label }, ...shots],
});

/** The new-map form: a name, Small, the empty ground, Create */
const newMap = (name, label) => [
  wait(0.6),
  click('[data-test=new-map]', { label }),
  { do: 'type', sel: '[data-test=new-name]', text: name, cps: 11 },
  click('button[role=radio]', { withText: 'Small' }),
  click('[data-template=""]'),
  wait(0.3),
  click('[data-test=create-map]', { label: 'create' }),
  act('viewReady', { timeout: 90 }),
  wait(0.8),
];

export const SCENES = [
  // ---------------------------------------------------------------- the shipped maps, closer and moving
  flyover('harbor-flyover', 'harbor-town', 'Harbor Town', [
    path(9, [
      [m(-215, -215, 22), m(-130, -165, 4)],
      [m(-110, -215, 24), m(-40, -150, 6)],
      [m(-20, -205, 30), m(10, -125, 8)],
    ], { label: 'harbor quay', ease: 'smooth' }),
    path(9, ['current', [m(40, -40, 75), m(0, 45, 0)], [m(-70, 120, 120), m(10, 30, 0)]], { label: 'harbor city', ease: 'smooth' }),
  ]),
  flyover('mountain-flyover', 'mountain-pass', 'Mountain Pass', [
    path(9, [
      [m(225, -95, 35), m(160, 5, 25)],
      [m(215, 10, 45), m(150, 10, 20)],
      [m(140, 80, 70), m(30, 100, 10)],
    ], { label: 'waterfall', ease: 'smooth' }),
    path(9, ['current', [m(-30, -40, 70), m(-139, -67, 45)], [m(-60, -170, 60), m(-139, -60, 45)]], { label: 'cable car', ease: 'smooth' }),
  ]),
  flyover('archipelago-flyover', 'archipelago', 'Archipelago', [
    path(8, [
      [m(30, -200, 14), m(70, -135, 3)],
      [m(115, -180, 20), m(68, -125, 4)],
    ], { label: 'harbour', ease: 'smooth' }),
    path(9, ['current', [m(140, -20, 45), m(200, 70, 15)], [m(250, 140, 35), m(205, 80, 15)]], { label: 'lighthouse', ease: 'smooth' }),
  ]),
  flyover('ember-flyover', 'ember-crater', 'Ember Crater', [
    orbit(9, { at: 'hq' }, { from: 20, to: 85, radius: 140, radiusTo: 95, height: 70, heightTo: 40, label: 'crater', ease: 'smooth' }),
    path(8, ['current', [m(120, 120, 35), m(45, 65, 8)], [m(-30, 115, 40), m(10, 30, 5)]], { label: 'hell gate', ease: 'smooth' }),
  ]),
  flyover('autumn-flyover', 'autumn-keep', 'Autumn Keep', [
    orbit(9, { at: 'hq', dy: 12 }, { from: 140, to: 210, radius: 95, radiusTo: 70, height: 45, heightTo: 28, label: 'keep', ease: 'smooth' }),
    path(8, ['current', [m(-130, -40, 35), m(0, 60, 10)], [m(-50, -10, 95), m(0, 70, 0)]], { label: 'woods', ease: 'smooth' }),
  ]),
  flyover('frost-flyover', 'frost-hamlet', 'Frost Hamlet', [
    path(9, [[m(0, -150, 35), m(10, 40, 0)], [m(10, 30, 50), m(20, 160, 5)]], { label: 'frozen lake', ease: 'smooth' }),
    orbit(8, { at: 'hq', dy: 15 }, { from: 160, to: 230, radius: 85, height: 40, heightTo: 30, label: 'hamlet', ease: 'smooth' }),
  ]),
  flyover('moon-flyover', 'moon-base', 'Moon Base', [
    path(8, [[m(-130, -170, 18), m(20, -90, 3)], [m(70, -130, 26), m(30, -25, 5)]], { label: 'landing pad', ease: 'smooth' }),
    orbit(8, { at: 'hq' }, { from: 200, to: 275, radius: 90, radiusTo: 70, height: 45, heightTo: 30, label: 'moon base', ease: 'smooth' }),
  ]),
  flyover('mars-flyover', 'mars-canyon', 'Mars Canyon', [
    path(8, [[m(-70, -235, 28), m(20, -130, 5)], [m(100, -225, 32), m(30, -130, 5)]], { label: 'mars base', ease: 'smooth' }),
    orbit(8, { at: 'hq', dy: -10 }, { from: 0, to: 75, radius: 80, radiusTo: 60, height: 40, heightTo: 26, label: 'greenhouse', ease: 'smooth' }),
  ]),

  // ---------------------------------------------------------------- editor, map 1: Green Valley
  { name: 'editor-new', page: '/editor', steps: [{ do: 'mark', name: 'Map editor' }, ...newMap('Green Valley', 'new map')] },
  {
    name: 'editor-terrain',
    steps: [
      path(2.5, ['current', [[-0.05, -0.75, 150], [-0.1, -0.28]]]),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 45, strength: 0.7 } }),
      par(
        path(30, ['current', [[0.2, -0.78, 145], [-0.05, -0.3]], [[0.35, -0.6, 150], [0.0, -0.28]]], { ease: 'smooth' }),
        seq(
          stroke(2.8, [[-0.3, -0.28], [-0.27, -0.26], [-0.29, -0.3]], { label: 'raise' }),
          mode('erode'),
          stroke(2.2, [[-0.32, -0.25], [-0.26, -0.3]], { label: 'erode' }),
          mode('plateau'),
          settings({ brush: { radius: 30, strength: 1 } }),
          stroke(1.4, [[-0.05, -0.3], [-0.04, -0.3]], { label: 'cliff' }),
          wait(0.6),
          mode('smooth'),
          settings({ brush: { radius: 22, strength: 1 } }),
          stroke(3, [[-0.12, -0.36], [-0.12, -0.24], [0.02, -0.22], [0.03, -0.36]], { label: 'smooth the edge' }),
          mode('lower'),
          settings({ brush: { radius: 40, strength: 0.8 } }),
          stroke(2.5, [[0.2, -0.3], [0.22, -0.28]], { label: 'lower' }),
          mode('ramp'),
          clickMap([-0.3, -0.27], { label: 'ramp' }),
          clickMap([-0.3, -0.42]),
          wait(0.8),
        ),
      ),
    ],
  },
  {
    name: 'editor-shapes',
    steps: [
      tool('landscape', { label: 'landscape' }),
      mode('mountain'),
      settings({ brush: { radius: 75, strength: 1 }, landscape: { seed: 11, reroll: false } }),
      par(
        path(18, ['current', [[-0.05, -0.12, 150], [0.0, 0.32]], [[0.25, -0.08, 150], [0.02, 0.33]]], { ease: 'smooth' }),
        seq(
          stroke(4.5, [[-0.28, 0.32], [-0.27, 0.33]], { label: 'mountains' }),
          stroke(4.5, [[0.0, 0.38], [0.01, 0.38]]),
          settings({ landscape: { seed: 12 } }),
          stroke(4, [[0.27, 0.34], [0.28, 0.33]]),
          mode('cliff', { label: 'cliff edge' }),
          settings({ brush: { radius: 30, strength: 1 }, landscape: { cliffHeight: 14 } }),
          stroke(2.5, [[-0.42, 0.12], [-0.25, 0.16], [-0.1, 0.14]]),
        ),
      ),
    ],
  },
  {
    name: 'editor-paint',
    steps: [
      path(2.5, ['current', [[-0.15, -0.55, 170], [-0.2, -0.2]]]),
      tool('paint', { label: 'paint' }),
      click('[data-test=add-layer]'),
      click('[data-material=gravel]', { timeout: 8 }),
      settings({ brush: { radius: 30, strength: 0.8 } }),
      stroke(3, [[-0.35, -0.2], [-0.25, -0.15], [-0.15, -0.2], [-0.05, -0.15]], { label: 'paint gravel' }),
      wait(0.4),
      click('[data-test=auto-paint]', { label: 'auto paint' }),
      act('idle', { timeout: 30 }),
      wait(1.5),
    ],
  },
  {
    name: 'editor-forest',
    steps: [
      tool('landscape'),
      mode('biome', { label: 'forest' }),
      click('[data-biome=forest]'),
      settings({ brush: { radius: 50, strength: 0.9 }, landscape: { seed: 21 } }),
      par(
        path(12, ['current', [[-0.35, -0.5, 190], [-0.05, 0.18]], [[0.25, -0.5, 180], [0.05, 0.2]]], { ease: 'smooth' }),
        seq(
          stroke(3.5, [[-0.42, 0.22], [-0.22, 0.24], [-0.05, 0.26], [0.12, 0.24]]),
          stroke(3, [[0.2, 0.2], [0.35, 0.2], [0.42, 0.28]]),
        ),
      ),
    ],
  },
  {
    name: 'editor-river',
    steps: [
      mode('river', { label: 'river' }),
      par(
        path(6, ['current', [[-0.4, -0.45, 190], [-0.1, 0.05]]], { ease: 'smooth' }),
        stroke(3.5, [[-0.02, 0.33], [-0.1, 0.15], [-0.04, -0.02], [-0.14, -0.2], [-0.1, -0.48]], { settle: 0.3 }),
      ),
      wait(1),
      path(1.5, ['current', [{ at: 'river:0:28', dx: 60, dy: -120, h: 90 }, { at: 'river:0:28', dx: 10 }]]),
      tool('water', { label: 'move the river' }),
      wait(0.4),
      mode('river'),
      stroke(2, [{ at: 'river:0:28' }, { at: 'river:0:28', dx: 30, dy: 4 }], { settle: 0.3 }),
      wait(1.5),
    ],
  },
  {
    name: 'editor-roads',
    steps: [
      path(2.5, ['current', [[0.1, -0.2, 210], [0.25, 0.08]]]),
      tool('paths', { label: 'roads' }),
      mode('draw'),
      clickMap({ at: 'hq', dx: 0, dy: 6 }),
      clickMap([0.32, 0.08]),
      clickMap([0.4, 0.12]),
      clickMap([0.47, 0.2]),
      { do: 'key', key: 'Enter' },
      wait(0.6),
      mode('edit', { label: 'bend the road' }),
      stroke(1.6, [{ at: 'node:-2' }, { at: 'node:-2', dx: -18, dy: 22 }], { settle: 0.2 }),
      wait(0.4),
      { do: 'key', key: 's' },
      wait(1),
      tool('markers', { label: 'spawn' }),
      mode('spawn'),
      clickMap({ at: 'node:-1' }),
      wait(1),
    ],
  },
  {
    name: 'editor-objects',
    steps: [
      path(2.5, ['current', [{ at: 'hq', dx: -40, dy: -125, h: 55 }, { at: 'hq', dx: -60, dy: -50 }]]),
      tool('objects', { label: 'objects' }),
      mode('place'),
      ...asset('house', 'house'),
      clickMap({ at: 'hq', dx: -45, dy: -30 }, { label: 'place houses' }),
      clickMap({ at: 'hq', dx: -70, dy: -38 }),
      ...asset('cottage', 'cottage'),
      clickMap({ at: 'hq', dx: -58, dy: -60 }),
      ...asset('castle wall', 'castle-wall'),
      mode('line', { label: 'castle wall' }),
      stroke(2.5, [{ at: 'hq', dx: -100, dy: -15 }, { at: 'hq', dx: -100, dy: -75 }, { at: 'hq', dx: -30, dy: -75 }], { settle: 0.3 }),
      wait(0.8),
      mode('scatter', { label: 'scatter trees' }),
      ...asset('oak', 'tree-oak'),
      settings({ brush: { radius: 20, strength: 0.8 } }),
      stroke(2.5, [{ at: 'hq', dx: -130, dy: -100 }, { at: 'hq', dx: -60, dy: -110 }]),
      mode('select', { label: 'move and turn' }),
      clickMap({ at: 'object:cottage' }),
      wait(0.3),
      stroke(1.4, [{ at: 'object:cottage' }, { at: 'object:cottage', dx: 10, dy: -6 }], { settle: 0.2 }),
      click('[data-test=align-selection]', { label: 'align to slope' }),
      { do: 'key', key: 'd', mods: { ctrl: true } },
      wait(1),
      { do: 'key', key: 'Escape' },
    ],
  },
  {
    name: 'editor-look',
    steps: [
      tool('look', { label: 'look' }),
      clickMap({ at: 'object:house' }),
      wait(0.9),
      clickMap({ at: 'spawn:0' }),
      wait(0.9),
      clickMap({ at: 'hq' }),
      wait(0.9),
    ],
  },
  {
    name: 'editor-symmetry',
    steps: [
      path(2.5, ['current', [[0.3, -0.78, 170], [0.05, -0.2]]]),
      tool('landscape'),
      { do: 'select', sel: '[data-test=symmetry]', value: 'y', label: 'symmetry' },
      mode('crater'),
      settings({ brush: { radius: 35, strength: 1 } }),
      stroke(1.5, [[0.05, -0.42], [0.05, -0.42]]),
      wait(1.2),
      { do: 'select', sel: '[data-test=symmetry]', value: 'none' },
    ],
  },
  {
    name: 'editor-fill',
    steps: [
      path(2.5, ['current', [[0.18, -0.6, 90], [0.05, -0.42]]]),
      tool('water'),
      mode('fill', { label: 'fill a hollow' }),
      // Ctrl: the hollow's own rim sets the level, whatever water the map has already
      clickMap([0.05, -0.42], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      wait(2.5),
    ],
  },
  {
    name: 'editor-sky',
    steps: [
      tool('environment', { label: 'sky' }),
      par(
        path(11, ['current', [[-0.1, -0.62, 120], [0.05, 0.1, 20]]], { ease: 'smooth' }),
        seq(
          click('button[role=radio]', { withText: 'Dusk' }),
          wait(0.8),
          { do: 'range', sel: '[data-test=time-of-day]', to: 18.6, dur: 3 },
          wait(0.5),
          click('button[role=radio]', { withText: 'Rain', label: 'rain' }),
          wait(2.2),
          click('button[role=radio]', { withText: 'Clear' }),
        ),
      ),
    ],
  },
  {
    name: 'editor-trial',
    steps: [
      click('[data-test=trial]', { label: 'trial wave' }),
      wait(0.5),
      click('[data-test=trial-speed] button', { withText: '4x' }),
      orbit(11, { at: 'hq', dx: -60 }, { from: 200, to: 250, radius: 130, height: 70, heightTo: 45 }),
      click('[data-test=trial]'),
    ],
  },
  { name: 'editor-test', steps: [click('[data-test=test-play]', { label: 'test map' }), wait(2)] },

  // ---------------------------------------------------------------- editor, map 2: Fire and Ice
  { name: 'editor2-new', page: '/editor', steps: [...newMap('Fire and Ice', 'second map')] },
  {
    name: 'editor2-biomes',
    steps: [
      path(2.5, ['current', [[0.0, -0.75, 230], [0.0, 0.05]]]),
      tool('landscape'),
      mode('mountain', { label: 'snowy peaks' }),
      settings({ brush: { radius: 80, strength: 1 }, landscape: { seed: 51, reroll: false } }),
      stroke(4.5, [[-0.2, 0.3], [-0.19, 0.31]]),
      stroke(4.5, [[0.12, 0.34], [0.13, 0.33]]),
      mode('biome'),
      click('[data-biome=snow]', { label: 'snow' }),
      settings({ brush: { radius: 70, strength: 1 } }),
      par(
        path(12, ['current', [[0.3, -0.6, 220], [0.0, 0.1]]], { ease: 'smooth' }),
        seq(
          stroke(3.5, [[-0.35, 0.3], [-0.1, 0.36], [0.15, 0.36], [0.35, 0.3]]),
          click('[data-biome=desert]', { label: 'desert' }),
          stroke(3.5, [[-0.35, -0.3], [-0.1, -0.36], [0.15, -0.34], [0.35, -0.28]]),
        ),
      ),
    ],
  },
  {
    name: 'editor2-lava',
    steps: [
      path(2.5, ['current', [[0.15, -0.68, 100], [-0.1, -0.36]]]),
      mode('mountain', { label: 'volcano' }),
      settings({ brush: { radius: 70, strength: 1 }, landscape: { seed: 61 } }),
      stroke(4.5, [[-0.3, -0.28], [-0.29, -0.28]]),
      mode('crater', { label: 'craters' }),
      settings({ brush: { radius: 26, strength: 1 } }),
      stroke(1.6, [[-0.16, -0.4], [-0.16, -0.4]]),
      stroke(1.6, [[-0.04, -0.42], [-0.04, -0.42]]),
      stroke(1.6, [[0.08, -0.4], [0.08, -0.4]]),
      // Each crater its own lava body, filled to its rim (Ctrl): Fill a hollow, as the user expects of one
      // crater; Pour would let the spill run on over the flat desert
      tool('water'),
      mode('fill'),
      click('button', { withText: 'Add lava', label: 'lava' }),
      clickMap([-0.16, -0.4], { mods: { ctrl: true }, dur: 0.6 }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([-0.04, -0.42], { mods: { ctrl: true }, dur: 0.5 }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([0.08, -0.4], { mods: { ctrl: true }, dur: 0.5 }),
      act('idle', { timeout: 30 }),
      path(9, ['current', [[0.2, -0.62, 70], [-0.05, -0.4]], [[-0.25, -0.62, 80], [-0.02, -0.4]]], { ease: 'smooth' }),
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
      wait(1),
      act('planTowers', { count: 6, tower: 'cannon' }),
      path(2.5, ['current', [{ at: 'spots', dx: -30, dy: -95, h: 60 }, { at: 'spots' }]]),
      act('build', { tower: 'archer', spot: 0, label: 'build' }),
      act('build', { tower: 'cannon', spot: 1 }),
      act('build', { tower: 'ice', spot: 2 }),
      act('build', { tower: 'lightning', spot: 3 }),
      act('build', { tower: 'fire', spot: 4 }),
      act('build', { tower: 'rocket', spot: 5 }),
    ],
  },
  {
    name: 'game-wave',
    steps: [
      act('jumpWave', { wave: 8 }),
      wait(0.5),
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      orbit(16, { at: 'spots' }, { from: 190, to: 260, radius: 100, height: 55, heightTo: 38, label: 'fight' }),
      path(14, ['current', [{ at: 'spot:1', dx: -50, dy: -60, h: 22 }, { at: 'spot:2' }], [{ at: 'spot:4', dx: 40, dy: -50, h: 30 }, { at: 'spots' }]], { ease: 'smooth' }),
      wait(4),
    ],
  },

  // ---------------------------------------------------------------- the close: a slow orbit at dusk
  {
    name: 'finale-dusk',
    page: '/?world=map:mountain-pass',
    steps: [
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      act('environment', { patch: { sky: 'dusk', sunElevation: 12, sunAzimuth: 250 } }),
      { do: 'mark', name: 'Finale' },
      orbit(26, { at: 'hq' }, { from: 145, to: 185, radius: 250, radiusTo: 200, height: 95, heightTo: 125, ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2.5, label: 'fade out' },
      wait(0.5),
    ],
  },
];
