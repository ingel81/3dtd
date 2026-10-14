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
// Ground layers, measured on an empty map (grass): forest +3, river +3 (sand, gravel, mud),
// road +1 (cobblestone), snow +3, desert +4, arctic +5, hell +6; a map holds 12 since round 3. Green Valley
// paints gravel first (the river reuses it): grass, gravel, forest x3, sand, mud, cobblestone. Fire and Ice:
// grass, arctic x5, hell x6; its lava is water bodies (Fill a hollow), no ground layers.

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

/** A photographed sky (sky-images.ts) with the preset and sun height it stands for */
const sky = (skyImage, preset, sunElevation, extra = {}) => act('environment', { patch: { skyImage, sky: preset, sunElevation, ...extra } });

export const SCENES = [
  // ---------------------------------------------------------------- the shipped maps: low, fast, sweeping
  flyover('harbor-flyover', 'harbor-town', 'Harbor Town', [
    sky('starry-night', 'night', 30, { moonlight: 0.7 }),
    path(6.5, [[m(-235, -205, 10), m(-150, -165, 4)], [m(-70, -205, 14), m(0, -130, 8)]], { label: 'harbor quay', ease: 'inOut' }),
    path(6.5, [[m(30, -70, 35), m(0, 40, 0)], [m(-70, 115, 95), m(10, 30, 0)]], { label: 'harbor city', ease: 'inOut' }),
  ]),
  flyover('mountain-flyover', 'mountain-pass', 'Mountain Pass', [
    sky('sunset', 'dusk', 6),
    path(6.5, [[m(245, -70, 12), m(160, 5, 32)], [m(205, 30, 42), m(150, 5, 15)]], { label: 'waterfall', ease: 'inOut' }),
    path(6.5, [[m(-30, -40, 70), m(-139, -67, 45)], [m(-70, -175, 55), m(-139, -60, 45)]], { label: 'cable car', ease: 'inOut' }),
  ]),
  flyover('archipelago-flyover', 'archipelago', 'Archipelago', [
    sky('fair-weather', 'day', 45),
    path(6, [[m(20, -215, 8), m(70, -135, 3)], [m(120, -175, 16), m(68, -125, 4)]], { label: 'harbour', ease: 'inOut' }),
    path(6.5, [[m(150, -10, 30), m(205, 75, 15)], [m(255, 135, 28), m(205, 80, 15)]], { label: 'lighthouse', ease: 'inOut' }),
  ]),
  flyover('ember-flyover', 'ember-crater', 'Ember Crater', [
    orbit(6.5, { at: 'hq' }, { from: 20, to: 95, radius: 120, radiusTo: 80, height: 55, heightTo: 28, label: 'crater', ease: 'inOut' }),
    path(6, ['current', [m(120, 120, 25), m(45, 65, 8)], [m(-30, 115, 30), m(10, 30, 5)]], { label: 'hell gate', ease: 'inOut' }),
  ]),
  flyover('autumn-flyover', 'autumn-keep', 'Autumn Keep', [
    sky('afterglow', 'dusk', 8),
    orbit(6.5, { at: 'hq', dy: 12 }, { from: 140, to: 230, radius: 80, radiusTo: 60, height: 32, heightTo: 20, label: 'keep', ease: 'inOut' }),
    path(6, ['current', [m(-130, -40, 22), m(0, 60, 10)], [m(-45, -10, 85), m(0, 70, 0)]], { label: 'woods', ease: 'inOut' }),
  ]),
  flyover('frost-flyover', 'frost-hamlet', 'Frost Hamlet', [
    act('environment', { patch: { weather: 'snow', weatherStrength: 0.9 }, label: 'snowfall' }),
    path(6.5, [[m(0, -150, 22), m(10, 40, 0)], [m(10, 40, 30), m(20, 160, 5)]], { label: 'frozen lake', ease: 'inOut' }),
    orbit(6, { at: 'hq', dy: 15 }, { from: 160, to: 240, radius: 70, height: 26, heightTo: 18, label: 'hamlet', ease: 'inOut' }),
  ]),
  flyover('moon-flyover', 'moon-base', 'Moon Base', [
    sky('deep-space', 'night', 25, { moonlight: 0.8 }),
    path(6, [[m(-130, -170, 12), m(20, -90, 3)], [m(70, -130, 18), m(30, -25, 5)]], { label: 'landing pad', ease: 'inOut' }),
    orbit(6, { at: 'hq' }, { from: 200, to: 290, radius: 75, radiusTo: 55, height: 35, heightTo: 22, label: 'moon base', ease: 'inOut' }),
  ]),
  flyover('mars-flyover', 'mars-canyon', 'Mars Canyon', [
    path(6, [[m(-70, -235, 20), m(20, -130, 5)], [m(100, -225, 24), m(30, -130, 5)]], { label: 'mars base', ease: 'inOut' }),
    orbit(6, { at: 'hq', dy: -10 }, { from: 0, to: 90, radius: 65, radiusTo: 48, height: 30, heightTo: 18, label: 'greenhouse', ease: 'inOut' }),
  ]),

  // ---------------------------------------------------------------- editor, map 1: Green Valley
  { name: 'editor-new', page: '/editor', steps: [{ do: 'mark', name: 'Map editor' }, ...newMap('Green Valley', 'new map')] },
  {
    name: 'editor-terrain',
    steps: [
      path(2, ['current', [[-0.16, -0.52, 70], [-0.27, -0.28]]]),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 45, strength: 0.8 } }),
      par(
        path(16, ['current', [[-0.42, -0.5, 65], [-0.2, -0.28]]], { ease: 'smooth' }),
        seq(
          stroke(2.5, [[-0.3, -0.28], [-0.27, -0.26], [-0.29, -0.3]], { label: 'raise' }),
          mode('erode'),
          stroke(1.8, [[-0.32, -0.25], [-0.26, -0.3]], { label: 'erode' }),
          mode('plateau'),
          settings({ brush: { radius: 26, strength: 1 } }),
          stroke(1.2, [[-0.12, -0.3], [-0.115, -0.3]], { label: 'cliff' }),
          wait(0.4),
          mode('smooth'),
          settings({ brush: { radius: 20, strength: 1 } }),
          stroke(2.2, [[-0.17, -0.35], [-0.17, -0.25], [-0.07, -0.24], [-0.07, -0.35]], { label: 'smooth the edge' }),
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
        path(15, ['current', [[-0.05, -0.02, 100], [0.0, 0.33]], [[0.22, 0.0, 100], [0.02, 0.34]]], { ease: 'smooth' }),
        seq(
          stroke(3.5, [[-0.28, 0.32], [-0.27, 0.33]], { label: 'mountains' }),
          stroke(3.5, [[0.0, 0.38], [0.01, 0.38]]),
          settings({ landscape: { seed: 12 } }),
          stroke(3, [[0.27, 0.34], [0.28, 0.33]]),
          mode('cliff', { label: 'cliff edge' }),
          settings({ brush: { radius: 30, strength: 1 }, landscape: { cliffHeight: 14 } }),
          stroke(2, [[-0.42, 0.12], [-0.25, 0.16], [-0.1, 0.14]]),
        ),
      ),
    ],
  },
  {
    name: 'editor-paint',
    steps: [
      path(1.5, ['current', [[-0.22, -0.42, 90], [-0.2, -0.17]]]),
      tool('paint', { label: 'paint' }),
      click('[data-test=add-layer]'),
      click('[data-material=gravel]', { timeout: 8 }),
      settings({ brush: { radius: 26, strength: 0.9 } }),
      stroke(2.5, [[-0.35, -0.2], [-0.25, -0.15], [-0.15, -0.2], [-0.05, -0.15]], { label: 'paint gravel' }),
      wait(0.4),
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
        path(9, ['current', [[-0.35, -0.05, 85], [-0.1, 0.24]], [[0.25, -0.02, 90], [0.1, 0.24]]], { ease: 'smooth' }),
        seq(
          stroke(3, [[-0.42, 0.22], [-0.22, 0.24], [-0.05, 0.26], [0.12, 0.24]]),
          stroke(2.5, [[0.2, 0.2], [0.35, 0.2], [0.42, 0.28]]),
        ),
      ),
    ],
  },
  {
    name: 'editor-river',
    steps: [
      mode('river', { label: 'river' }),
      par(
        path(5, ['current', [[-0.35, -0.4, 140], [-0.08, 0.02]]], { ease: 'smooth' }),
        stroke(3, [[-0.02, 0.33], [-0.1, 0.15], [-0.04, -0.02], [-0.14, -0.2], [-0.1, -0.48]], { settle: 0.3 }),
      ),
      wait(0.6),
      path(1.2, ['current', [{ at: 'river:0:28', dx: 45, dy: -85, h: 60 }, { at: 'river:0:28', dx: 12 }]]),
      tool('water', { label: 'move the river' }),
      wait(0.3),
      mode('river'),
      stroke(1.8, [{ at: 'river:0:28' }, { at: 'river:0:28', dx: 30, dy: 4 }], { settle: 0.3 }),
      wait(1),
    ],
  },
  {
    name: 'editor-roads',
    steps: [
      path(1.5, ['current', [[0.3, -0.12, 120], [0.36, 0.1]]]),
      tool('paths', { label: 'roads' }),
      mode('draw'),
      clickMap({ at: 'hq', dx: 0, dy: 6 }),
      clickMap([0.32, 0.08]),
      clickMap([0.4, 0.12]),
      clickMap([0.47, 0.2]),
      { do: 'key', key: 'Enter' },
      wait(0.4),
      mode('edit', { label: 'bend the road' }),
      stroke(1.4, [{ at: 'node:-2' }, { at: 'node:-2', dx: -18, dy: 22 }], { settle: 0.2 }),
      { do: 'key', key: 's' },
      wait(0.6),
      tool('markers', { label: 'spawn' }),
      mode('spawn'),
      clickMap({ at: 'node:-1' }),
      wait(0.8),
    ],
  },
  {
    name: 'editor-objects',
    steps: [
      path(1.8, ['current', [{ at: 'hq', dx: -45, dy: -105, h: 38 }, { at: 'hq', dx: -60, dy: -45 }]]),
      tool('objects', { label: 'objects' }),
      mode('place'),
      ...asset('house', 'house'),
      clickMap({ at: 'hq', dx: -45, dy: -30 }, { label: 'place houses' }),
      clickMap({ at: 'hq', dx: -70, dy: -38 }),
      ...asset('cottage', 'cottage'),
      clickMap({ at: 'hq', dx: -58, dy: -60 }),
      ...asset('castle wall', 'castle-wall'),
      mode('line', { label: 'castle wall' }),
      stroke(2.2, [{ at: 'hq', dx: -100, dy: -15 }, { at: 'hq', dx: -100, dy: -75 }, { at: 'hq', dx: -30, dy: -75 }], { settle: 0.3 }),
      wait(0.6),
      mode('scatter', { label: 'scatter trees' }),
      ...asset('oak', 'tree-oak'),
      settings({ brush: { radius: 18, strength: 0.9 } }),
      stroke(2, [{ at: 'hq', dx: -95, dy: -95 }, { at: 'hq', dx: -40, dy: -100 }]),
      path(1, ['current', [{ at: 'object:cottage', dx: 10, dy: -40, h: 22 }, { at: 'object:cottage' }]]),
      mode('select', { label: 'move' }),
      clickMap({ at: 'object:cottage' }),
      stroke(1.3, [{ at: 'object:cottage' }, { at: 'object:cottage', dx: 12, dy: -8 }], { settle: 0.2 }),
      click('[data-test=align-selection]', { label: 'align to slope' }),
      wait(0.6),
      { do: 'key', key: 'Escape' },
    ],
  },
  {
    name: 'editor-look',
    steps: [
      tool('look', { label: 'look' }),
      clickMap({ at: 'object:house' }),
      wait(0.8),
      clickMap({ at: 'hq' }),
      wait(0.8),
    ],
  },
  {
    name: 'editor-symmetry',
    steps: [
      path(1.8, ['current', [[0.0, -0.66, 110], [0.0, -0.36]]]),
      tool('landscape'),
      { do: 'select', sel: '[data-test=symmetry]', value: 'x', label: 'symmetry' },
      mode('crater'),
      settings({ brush: { radius: 32, strength: 1 } }),
      stroke(1.5, [[-0.2, -0.38], [-0.2, -0.38]]),
      wait(0.8),
      { do: 'select', sel: '[data-test=symmetry]', value: 'none' },
    ],
  },
  {
    name: 'editor-fill',
    steps: [
      path(1.5, ['current', [[0.3, -0.56, 55], [0.2, -0.38]]]),
      tool('water'),
      mode('fill', { label: 'fill a hollow' }),
      // Ctrl: the hollow's own rim sets the level, whatever water the map has already
      clickMap([0.2, -0.38], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      wait(1.5),
    ],
  },
  {
    name: 'editor-sky',
    steps: [
      tool('environment', { label: 'sky' }),
      par(
        path(26, ['current', [[-0.2, -0.55, 40], [0.05, 0.1, 40]], [[0.3, -0.5, 45], [0.0, 0.15, 45]]], { ease: 'smooth' }),
        seq(
          click('button[role=radio]', { withText: 'Dusk', label: 'dusk' }),
          { do: 'range', sel: '[data-test=time-of-day]', to: 19.2, dur: 2 },
          click('button[role=radio]', { withText: 'Night', label: 'night' }),
          { do: 'range', sel: '[data-test=moonlight]', to: 75, dur: 1.4, label: 'moonlight' },
          wait(0.8),
          { do: 'if', sel: '[data-test=sky-image]', steps: [
            { do: 'select', sel: '[data-test=sky-image]', value: 'sunset', label: 'sky picture' },
            wait(1.6),
            { do: 'select', sel: '[data-test=sky-image]', value: 'thunderstorm' },
            click('button[role=radio]', { withText: 'Rain', label: 'rain' }),
            wait(2.2),
            { do: 'select', sel: '[data-test=sky-image]', value: 'starry-night' },
            wait(1.6),
            { do: 'select', sel: '[data-test=sky-image]', value: '' },
          ] },
          click('button[role=radio]', { withText: 'Overcast', label: 'overcast' }),
          click('button[role=radio]', { withText: 'Snow', label: 'snow' }),
          wait(2.5),
          click('button[role=radio]', { withText: 'Fog', label: 'fog' }),
          wait(2),
          click('button[role=radio]', { withText: 'Clear' }),
          click('button[role=radio]', { withText: 'Day' }),
        ),
      ),
    ],
  },
  {
    name: 'editor-trial',
    steps: [
      path(1.5, ['current', [{ m: [-205, -30], h: 9 }, { m: [-240, 0], h: 2 }]]),
      click('[data-test=trial]', { label: 'trial wave' }),
      click('[data-test=trial-speed] button', { withText: '2x' }),
      path(9, ['current', [{ m: [-150, -32], h: 10 }, { m: [-185, 0], h: 2 }]], { ease: 'inOut' }),
      click('[data-test=trial]'),
    ],
  },
  {
    name: 'editor-overlays',
    steps: [
      path(1.5, ['current', [[0.05, -0.62, 240], [0.0, 0.0]]]),
      tool('measure', { label: 'build areas' }),
      click('[data-test=build-areas]'),
      wait(2.8),
      click('[data-test=build-areas]'),
      tool('gameplay', { label: 'difficulty' }),
      { do: 'range', sel: '[data-test=difficulty]', to: 140, dur: 1.3 },
      tool('settings', { label: 'scene cost' }),
      { do: 'move', to: '[data-test=map-budget]', dur: 0.6 },
      wait(1.4),
    ],
  },
  { name: 'editor-test', steps: [click('[data-test=test-play]', { label: 'test map' }), wait(1.5)] },

  // ---------------------------------------------------------------- editor, map 2: Fire and Ice
  { name: 'editor2-new', page: '/editor', steps: [...newMap('Fire and Ice', 'second map')] },
  {
    name: 'editor2-biomes',
    steps: [
      path(1.5, ['current', [[0.0, -0.3, 120], [0.0, 0.25]]]),
      tool('landscape'),
      mode('mountain', { label: 'peaks' }),
      settings({ brush: { radius: 80, strength: 1 }, landscape: { seed: 51, reroll: false } }),
      stroke(3.5, [[-0.2, 0.3], [-0.19, 0.31]]),
      stroke(3.5, [[0.12, 0.34], [0.13, 0.33]]),
      mode('biome'),
      click('[data-biome=arctic]', { label: 'arctic' }),
      settings({ brush: { radius: 70, strength: 1 } }),
      stroke(3, [[-0.35, 0.3], [-0.1, 0.36], [0.15, 0.36], [0.35, 0.3]]),
      path(1.5, ['current', [[0.05, -0.6, 80], [0.0, -0.32]]]),
      click('[data-biome=hell]', { label: 'hell' }),
      stroke(4, [[-0.3, -0.3], [-0.1, -0.34], [0.1, -0.33], [0.3, -0.28]]),
      path(1.5, ['current', [[-0.05, 0.05, 25], [0.0, 0.32, 30]]]),
      tool('environment'),
      click('button[role=radio]', { withText: 'Snow', label: 'snowfall' }),
      wait(3),
    ],
  },
  {
    name: 'editor2-lava',
    steps: [
      path(2, ['current', [[0.15, -0.66, 85], [-0.1, -0.36]]]),
      tool('landscape'),
      mode('mountain', { label: 'volcano' }),
      settings({ brush: { radius: 70, strength: 1 }, landscape: { seed: 61 } }),
      stroke(3.5, [[-0.3, -0.28], [-0.29, -0.28]]),
      mode('crater', { label: 'craters' }),
      settings({ brush: { radius: 26, strength: 1 } }),
      stroke(1.4, [[-0.16, -0.4], [-0.16, -0.4]]),
      stroke(1.4, [[-0.04, -0.42], [-0.04, -0.42]]),
      stroke(1.4, [[0.08, -0.4], [0.08, -0.4]]),
      // Each crater its own lava body, filled to its rim (Ctrl)
      tool('water'),
      mode('fill'),
      click('button', { withText: 'Add lava', label: 'lava' }),
      clickMap([-0.16, -0.4], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([-0.04, -0.42], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([0.08, -0.4], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      path(7, ['current', [[0.15, -0.55, 35], [-0.04, -0.41]], [[-0.25, -0.55, 40], [-0.02, -0.41]]], { ease: 'inOut' }),
    ],
  },

  // ---------------------------------------------------------------- the new map in the game: short
  {
    name: 'game-build',
    page: 'opened',
    steps: [
      { do: 'mark', name: 'Test map' },
      act('hints'),
      act('research'),
      act('credits', { amount: 50000 }),
      wait(0.6),
      act('planTowers', { count: 4, tower: 'cannon' }),
      path(1.8, ['current', [{ at: 'spots', dx: -25, dy: -75, h: 45 }, { at: 'spots' }]]),
      act('build', { tower: 'archer', spot: 0, hold: 1.2, label: 'build' }),
      act('build', { tower: 'cannon', spot: 1, hold: 1.2 }),
      act('build', { tower: 'ice', spot: 2, hold: 1.2 }),
      act('build', { tower: 'lightning', spot: 3, hold: 1.2 }),
    ],
  },
  {
    name: 'game-wave',
    steps: [
      act('jumpWave', { wave: 8 }),
      act('speed', { value: 2 }),
      act('wave', { label: 'wave' }),
      { do: 'cursor', show: false },
      orbit(14, { at: 'spots' }, { from: 190, to: 280, radius: 75, height: 35, heightTo: 22, label: 'fight', ease: 'inOut' }),
    ],
  },

  // ---------------------------------------------------------------- the close: a slow orbit at sunset
  {
    name: 'finale-dusk',
    page: '/?world=map:mountain-pass',
    steps: [
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      sky('sunset', 'dusk', 8, { sunAzimuth: 250 }),
      { do: 'mark', name: 'Finale' },
      orbit(20, { at: 'hq' }, { from: 145, to: 190, radius: 240, radiusTo: 190, height: 90, heightTo: 120, ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
