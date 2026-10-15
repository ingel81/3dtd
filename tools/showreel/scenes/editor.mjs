// The editor on the four maps of the intro, as own copies of the shipped maps, hopping between them through the
// map list: every tool where it reads best. Demo Valley comes in from the game's pause menu (intro.mjs,
// edit-this-map). Each block ends on its result held; `effect:<what>` marks the moment it shows.
//
//   Demo Valley   sculpt (small and big brush), cliff and ramp, a mountain with snow, erase and forest; buildings that level
//                 their ground, lamps beside the road; later night (fireflies, lit windows, the lamps)
//   Red Canyon    a lake and a river into it (mirroring, foam, shallows); a road, select and move, stamps;
//                 symmetry painted from above (two, then four); the visit's history rewound and replayed
//   Ember Crater  lava poured into a new crater; hell ground, a lava flow; later rain, fog and sky
//   Ruined City   a bomb crater and Fill a hollow, build areas, a trial wave, Test map
//
// Ground layers (12 at most): Demo Valley 8 (+ snow, forest), Red Canyon 7 (+ river), Ember Crater 7,
// Ruined City 7 (+ meadow).
import { act, asset, clickMap, click, m, mode, orbit, path, settings, stroke, tool, wait } from './common.mjs';

/** The camera on map points (director frame step): from the current side or `from` degrees, turning `turn` over `dur` */
const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

const key = (k, mods) => ({ do: 'key', key: k, ...(mods ? { mods } : {}) });
const keys = (k, n, mods) => Array.from({ length: n }, () => [key(k, mods), wait(0.12)]).flat();

/** After a change: the editor idle, then the camera held `hold` seconds while it takes effect */
const settle = (hold) => [act('idle', { timeout: 30 }), wait(hold)];

/** The moment a change shows: the cut ends a beat after it */
const effect = (what) => ({ do: 'mark', name: `effect:${what}` });

/** The Sky panel's preset buttons and weather buttons (a bare withText 'Snow' also finds other fields) */
const SKY_PRESET = '[aria-labelledby=ep-sky] button[role=radio]';
const WEATHER = '[aria-label=Weather] button[role=radio]';

/**
 * To another map: the open one saved and closed (Back), its row in the list (an own copy when there is one, it
 * comes first; else the shipped map, which opens as an own copy), Open
 */
const hop = (name) => [
  click('[data-test=back]', { label: `hop ${name}` }),
  { do: 'waitFor', sel: '[data-test=new-map]', timeout: 30 },
  wait(0.5),
  click('[role=option][data-map]', { withText: name }),
  wait(0.4),
  click('[data-test=open-map]'),
  act('viewReady', { timeout: 90 }),
  wait(1.2),
];

/** A block on a map: the hop there first, `arrives` for a run that starts after it */
const block = (name, id, mapName, steps, before = []) => ({
  name,
  arrives: `/editor?map=${id}`,
  steps: [...hop(mapName), ...before, { do: 'mark', name: mapName }, ...steps],
});

export const SCENES = [
  {
    // Demo Valley, opened from the game: sculpt in the south meadow, small and weak, then big and strong
    name: 'dv-sculpt',
    steps: [
      { do: 'mark', name: 'Map editor' },
      act('viewReady', { timeout: 90 }),
      wait(1.5),
      frame([m(-120, -200), m(-55, -205)], { from: 0, pitch: 32, margin: 30, glide: 1.6 }),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 10, strength: 0.3 } }),
      stroke(1.6, [m(-115, -200), m(-114, -200)], { label: 'small brush' }),
      wait(0.6),
      { do: 'move', to: m(-75, -200), dur: 0.4 },
      ...keys(']', 9),
      ...keys('}', 4, { shift: true }),
      wait(0.4),
      stroke(2.2, [m(-76, -200), m(-74, -200)], { label: 'big brush' }),
      ...settle(0.4),
      effect('sculpt'),
      wait(0.8),
      // A table with a hard rim beside the hill, then a ramp up to it from the south
      mode('plateau', { label: 'cliff' }),
      settings({ brush: { radius: 30, strength: 1 }, terrain: { step: 12 } }),
      stroke(1.5, [m(-25, -192), m(-24, -192)]),
      ...settle(0.6),
      // From the south-east, the ramp running down from the table toward the camera's side
      frame([m(-25, -192), m(20, -205)], { from: 40, pitch: 26, margin: 22, glide: 1.4 }),
      mode('ramp', { label: 'ramp' }),
      clickMap(m(-20, -194)),
      clickMap(m(22, -206)),
      ...settle(0.4),
      effect('cliff ramp'),
      wait(1),
    ],
  },
  {
    // A mountain in the west meadow between the road and the river, snow painted on its top, a forest up its flank
    name: 'dv-mountain',
    steps: [
      frame([m(-235, 10), m(-145, 10)], { from: 15, pitch: 20, margin: 18, glide: 1.8 }),
      tool('landscape', { label: 'mountain' }),
      mode('mountain'),
      settings({ brush: { radius: 55, strength: 1 }, landscape: { seed: 11, reroll: false } }),
      stroke(4, [m(-190, 15), m(-189, 16)]),
      ...settle(0.6),
      effect('mountain'),
      // Snow as a new ground layer on the peak (the Snow biome lays rock on a slope this steep)
      tool('paint', { label: 'paint snow' }),
      click('[data-test=add-layer]'),
      click('.pp-group', { withText: 'Mountain' }),
      click('[data-material=snow-fresh]', { timeout: 8 }),
      settings({ brush: { radius: 24, strength: 1 } }),
      stroke(2.4, [m(-194, 18), m(-185, 13), m(-190, 23), m(-189, 15)]),
      ...settle(1),
      effect('snow'),
      // The meadow west of the mountain's foot cleared (a forest keeps its spacing from every object, the meadow's
      // grass clumps let no tree grow), then a wood grown on it
      tool('objects', { label: 'erase' }),
      mode('erase'),
      settings({ brush: { radius: 30, strength: 1 } }),
      stroke(2, [m(-228, -18), m(-218, -32), m(-230, -38), m(-222, -22)]),
      ...settle(0.6),
      effect('erase'),
      tool('landscape', { label: 'forest' }),
      mode('biome'),
      click('[data-biome=forest]'),
      settings({ brush: { radius: 34, strength: 1 }, landscape: { seed: 21 } }),
      ...settle(0.3),
      stroke(3.6, [m(-228, -18), m(-218, -32), m(-230, -38), m(-222, -22)]),
      ...settle(1.8),
      effect('forest'),
      wait(0.6),
    ],
  },
  block('rc-water', 'red-canyon', 'Red Canyon', [
    // A lake dug in the plain east of the north canyon, then a river from the east into it
    frame([m(110, 30), m(225, 180)], { from: 215, pitch: 32, margin: 12, glide: 1.6 }),
    tool('water', { label: 'dig a lake' }),
    mode('lake'),
    settings({ brush: { radius: 30, strength: 1 } }),
    stroke(3, [m(115, 40), m(140, 55), m(130, 30), m(120, 50)]),
    ...settle(1),
    effect('lake'),
    tool('landscape', { label: 'river' }),
    mode('river'),
    stroke(3.4, [m(225, 180), m(205, 140), m(180, 105), m(160, 78), m(142, 56)], { settle: 0.3 }),
    ...settle(1),
    effect('river'),
    // Low over the lake: the mesas mirrored, the foam at the shore, the shallows turquoise
    act('overlay', { on: false }),
    { do: 'cursor', show: false },
    path(5, ['current', [m(85, 15, 7), m(150, 60, 2)], [m(110, 5, 6), m(160, 70, 2)]], { ease: 'inOut', label: 'effect:mirror' }),
    { do: 'cursor', show: true },
    act('overlay', { on: true }),
  ]),
  block('ec-lava', 'ember-crater', 'Ember Crater', [
    // A crater on the open south-east slope, lava poured into it: it fills and runs on downhill
    frame([m(140, -140), m(175, -180)], { from: 330, pitch: 34, margin: 18, glide: 1.6 }),
    tool('landscape', { label: 'crater' }),
    mode('crater'),
    settings({ brush: { radius: 38, strength: 1 } }),
    stroke(1.6, [m(140, -140), m(140, -140)]),
    ...settle(0.4),
    tool('water', { label: 'pour lava' }),
    mode('pour'),
    click('[data-test=pour-lava]'),
    clickMap(m(140, -140)),
    ...settle(2.2),
    effect('lava'),
    // Hell ground round it, the camera closer; then a lava flow out of the pool
    frame([m(150, -125), m(190, -170)], { from: 330, pitch: 30, margin: 4, glide: 1.2 }),
    tool('landscape', { label: 'hell' }),
    mode('biome'),
    click('[data-biome=hell]'),
    settings({ brush: { radius: 34, strength: 1 } }),
    ...settle(0.3),
    stroke(3, [m(110, -110), m(175, -120), m(200, -175), m(165, -205)]),
    ...settle(1.8),
    effect('hell'),
    // A lava flow from the new pool down the outer slope
    mode('river', { label: 'lava flow' }),
    click('[data-test=river-lava]'),
    ...settle(0.3),
    stroke(3, [m(150, -152), m(168, -180), m(192, -205), m(215, -225)], { settle: 0.3 }),
    ...settle(1.6),
    effect('lava flow'),
  ]),
  block('dv-objects', 'demo-valley', 'Demo Valley', [
    // Buildings on the new hill's flank and table: each levels its ground as it lands
    frame([m(-80, -185), m(-30, -195), m(-110, -215)], { from: 10, pitch: 30, margin: 8, glide: 1.6 }),
    tool('objects', { label: 'objects' }),
    mode('place'),
    ...asset('chapel', 'chapel'),
    clickMap(m(-78, -182), { label: 'place buildings' }),
    ...settle(0.6),
    ...asset('tall', 'house-tall'),
    clickMap(m(-28, -198)),
    ...settle(0.4),
    ...asset('watchtower', 'watchtower'),
    clickMap(m(-112, -214)),
    ...settle(0.8),
    effect('buildings'),
    // Lamps all along the West road, beside it on both sides
    frame([m(-200, -110), m(-95, -100)], { from: 20, pitch: 24, margin: 12, glide: 1.4 }),
    mode('line'),
    click('[data-test=line-roads]'),
    ...asset('lamp', 'lamp-post'),
    settings({ objects: { line: { offset: 5.5, bothSides: true, spacing: 14 } } }),
    clickMap(m(-150, -85), { label: 'lamps' }),
    ...settle(0.6),
    act('overlay', { on: false }),
    path(2.4, ['current', [m(-115, -78, 6), m(-205, -105, 3)]], { ease: 'inOut' }),
    effect('lamps'),
    wait(1),
    act('overlay', { on: true }),
  ]),
  block('rc-roads', 'red-canyon', 'Red Canyon', [
    // A road out of the temple basin, bent; a tent moved and copied; the oasis stamped by the new lake
    frame([{ at: 'hq' }, m(210, -110), m(225, -40)], { from: 250, pitch: 45, margin: 25, glide: 1.6 }),
    tool('paths', { label: 'roads' }),
    mode('draw'),
    clickMap({ at: 'hq', dx: 4, dy: 6 }),
    clickMap(m(205, -125)),
    clickMap(m(225, -50)),
    key('Enter'),
    ...settle(0.4),
    mode('edit', { label: 'bend the road' }),
    stroke(1.4, [{ at: 'node:-2' }, { at: 'node:-2', dx: 18, dy: -22 }], { settle: 0.2 }),
    key('s'),
    ...settle(0.6),
    effect('road'),
    // The desert temple by the HQ: selected, moved, a copy dragged beside it. Drags start on the building beside
    // its middle: the middle holds the gizmo's lift handle (a drag there sank an obelisk), off the building a drag
    // draws a box
    frame([m(184, -153), m(210, -135)], { from: 300, pitch: 30, margin: 18, glide: 1.2 }),
    tool('objects', { label: 'select' }),
    mode('select'),
    clickMap(m(184, -153)),
    wait(0.4),
    stroke(1.3, [m(187, -150), m(199, -142)], { label: 'move', settle: 0.3 }),
    wait(0.6),
    key('d', { ctrl: true }),
    wait(0.3),
    stroke(1.3, [m(199, -142), m(220, -120)], { label: 'duplicate', settle: 0.3 }),
    wait(0.8),
    effect('select move'),
    key('Escape'),
    // The oasis's palms and tents copied and stamped round the new lake, once turned
    frame([m(86, -180), m(132, -226)], { from: 0, pitch: 50, margin: 20, glide: 1.4 }),
    tool('stamp', { label: 'stamps' }),
    mode('select'),
    click('input[aria-label="Heights"]'),
    click('input[aria-label="Ground paint"]'),
    click('input[aria-label="Water"]'),
    click('input[aria-label="Roads"]'),
    stroke(1.2, [m(86, -180), m(132, -226)], { label: 'copy' }),
    click('[data-test=copy]'),
    wait(0.3),
    // Up to the new lake: on its west shore, then turned on its south shore
    frame([m(70, 60), m(130, -10), m(160, 60)], { from: 0, pitch: 45, margin: 14, glide: 1.8 }),
    clickMap(m(78, 62), { label: 'stamp' }),
    ...settle(0.6),
    key('r'),
    wait(0.4),
    clickMap(m(130, -8), { label: 'stamp turned' }),
    ...settle(1),
    effect('stamps'),
    key('Escape'),
    // Symmetry from high above, green ground painted on the desert: Mirror X makes two of one stroke, Both four
    frame([m(-235, -235), m(235, 235)], { from: 0, pitch: 62, margin: 2, glide: 1.8 }),
    tool('paint', { label: 'symmetry' }),
    click('[data-test=add-layer]'),
    click('.pp-group', { withText: 'Temperate' }),
    click('[data-material=grass-lush]', { timeout: 8 }),
    settings({ brush: { radius: 26, strength: 1 } }),
    { do: 'select', sel: '[data-test=symmetry]', value: 'x', label: 'mirror' },
    ...settle(0.3),
    stroke(2.6, [m(190, -70), m(215, -95), m(200, -125), m(175, -110)], { label: 'two' }),
    ...settle(1.2),
    effect('mirror'),
    { do: 'select', sel: '[data-test=symmetry]', value: 'xy', label: 'both' },
    ...settle(0.3),
    stroke(2.6, [m(165, 205), m(190, 220), m(180, 238)], { label: 'four' }),
    ...settle(1.2),
    effect('four'),
    { do: 'select', sel: '[data-test=symmetry]', value: 'none' },
    // The visit undone step by step, then forward again
    click('[data-test=side-history]', { label: 'history' }),
    act('history', { to: 0, stepS: 0.3 }),
    wait(0.8),
    act('history', { to: 'end', stepS: 0.3 }),
    effect('history'),
    wait(0.8),
    click('[data-test=side-tool]'),
  ]),
  block('ec-sky', 'ember-crater', 'Ember Crater', [
    // Storm over the volcano: every setting with the camera at rest, held until it shows
    act('overlay', { on: false }),
    // Over the crater's south rim, the lava lake and the HQ island below
    path(1.8, ['current', [m(-30, -150, 50), m(0, -5, 14)]], { ease: 'inOut' }),
    tool('environment', { label: 'sky' }),
    ...settle(0.6),
    { do: 'select', sel: '[data-test=sky-image]', value: 'thunderstorm', label: 'sky picture' },
    ...settle(2),
    effect('sky'),
    click(WEATHER, { withText: 'Rain', label: 'rain' }),
    { do: 'range', sel: 'app-editor-range[label=Strength]', to: 100, dur: 0.8 },
    ...settle(2.4),
    effect('rain'),
    click(WEATHER, { withText: 'Fog', label: 'fog' }),
    { do: 'range', sel: 'app-editor-range[label=Strength]', to: 80, dur: 0.8 },
    ...settle(2.4),
    effect('fog'),
    click(WEATHER, { withText: 'Clear' }),
    ...settle(0.6),
    act('overlay', { on: true }),
  ]),
  block('dv-night', 'demo-valley', 'Demo Valley', [
    // Night where the lamps stand and the village begins: lit windows, the lamps, fireflies by the woods
    act('overlay', { on: false }),
    // Low by the West road where it reaches the village: lamps on the left, the houses ahead
    path(2, ['current', [m(-95, -140, 7), m(30, -115, 6)]], { ease: 'inOut' }),
    tool('environment', { label: 'night' }),
    ...settle(0.6),
    click(SKY_PRESET, { withText: 'Night' }),
    ...settle(1.6),
    { do: 'range', sel: '[data-test=moonlight]', to: 60, dur: 1 },
    ...settle(2.4),
    effect('night'),
    orbit(5, 'look', { turn: 18, ease: 'inOut' }),
    act('overlay', { on: true }),
  ]),
  block('city-fill', 'ruined-city', 'Ruined City', [
    // A bomb crater at a free crossing, filled to its rim (Ctrl): the ruins mirrored in it
    frame([m(64, -192)], { from: 20, pitch: 30, margin: 35, glide: 1.6 }),
    tool('landscape', { label: 'crater' }),
    mode('crater'),
    settings({ brush: { radius: 22, strength: 1 } }),
    stroke(1.4, [m(64, -192), m(64, -192)]),
    ...settle(0.4),
    tool('water', { label: 'fill' }),
    mode('fill'),
    clickMap(m(64, -192), { mods: { ctrl: true } }),
    ...settle(1.8),
    effect('fill'),
  ]),
  {
    // Where towers may stand, over the whole city
    name: 'city-areas',
    steps: [
      frame([m(-200, -200), m(200, 200)], { from: 0, pitch: 58, margin: 5, glide: 1.6 }),
      tool('measure', { label: 'build areas' }),
      click('[data-test=build-areas]'),
      wait(2.4),
      effect('build areas'),
      click('[data-test=build-areas]'),
    ],
  },
  {
    // The runners come out of the south gate, the camera chases one, then pulls up; then Test map
    name: 'city-trial',
    steps: [
      act('overlay', { on: false }),
      // Down into the avenue north of the South Gate, looking back at the gate the runners come through
      path(2.4, ['current', [m(-150, -150, 40), m(-192, -230, 4)], [m(-192, -185, 8), m(-192, -252, 3)]], { ease: 'inOut' }),
      click('[data-test=trial]', { label: 'trial wave' }),
      click('[data-test=trial-speed] button', { withText: '2x' }),
      wait(2.2),
      { do: 'follow', at: { at: 'runner:0' }, dur: 6, back: 12, side: 7, h: 5, label: 'chase' },
      path(3, ['current', [m(-80, -200, 80), m(-40, -100)]], { ease: 'inOut', label: 'pull up' }),
      wait(1),
      act('overlay', { on: true }),
      click('[data-test=trial]'),
      click('[data-test=test-play]', { label: 'test map' }),
      wait(1.2),
    ],
  },
];
