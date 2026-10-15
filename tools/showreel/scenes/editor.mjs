// The editor on four shipped maps, as own copies, hopping between them through the map list: every tool where it
// reads best. Demo Valley comes in from the game's pause menu (intro.mjs, edit-this-map). Each block ends on its
// result held; `effect:<what>` marks the moment it shows.
//
//   Demo Valley   sculpt (small and big brush), cliff and ramp; later a mountain with snow, a cleared meadow grown
//                 into an autumn wood; later buildings that level their ground, a road paved, lamps beside the
//                 West road, rain and then night (lit windows, the lamps)
//   Mars Canyon   the colony's greenhouses on arrival, a volcano raised on the plain with a crater on its top;
//                 later a greenhouse and a dome placed, one moved and copied
//   Moon Base     symmetry from high above: two craters of one stroke, then four
//   Red Canyon    a lake and a river into it (mirroring, foam, shallows); the oasis stamped by it, the visit's
//                 history rewound and replayed
//
// Order: Demo Valley, Mars Canyon, Moon Base, Red Canyon, Demo Valley, Mars Canyon, Demo Valley.
//
// Ground layers (12 at most): Demo Valley 8 (+ snow, autumn wood, road surface), Mars Canyon 6, Moon Base 6,
// Red Canyon 8 (+ river).
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
      wait(1.2),
      frame([m(-120, -200), m(-55, -205)], { from: 0, pitch: 32, margin: 30, glide: 1.4 }),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 10, strength: 0.3 } }),
      stroke(1.4, [m(-115, -200), m(-114, -200)], { label: 'small brush' }),
      wait(0.4),
      { do: 'move', to: m(-75, -200), dur: 0.4 },
      ...keys(']', 9),
      ...keys('}', 4, { shift: true }),
      wait(0.3),
      stroke(2, [m(-76, -200), m(-74, -200)], { label: 'big brush' }),
      ...settle(0.4),
      effect('sculpt'),
      wait(0.6),
      // A table with a hard rim beside the hill, then a ramp up to it from the south
      mode('plateau', { label: 'cliff' }),
      settings({ brush: { radius: 30, strength: 1 }, terrain: { step: 12 } }),
      stroke(1.4, [m(-25, -192), m(-24, -192)]),
      ...settle(0.5),
      // From the south-east, the ramp running down from the table toward the camera's side
      frame([m(-25, -192), m(20, -205)], { from: 40, pitch: 26, margin: 22, glide: 1.2 }),
      mode('ramp', { label: 'ramp' }),
      clickMap(m(-20, -194)),
      clickMap(m(22, -206)),
      ...settle(0.4),
      effect('cliff ramp'),
      wait(0.8),
    ],
  },
  block('mars-volcano', 'mars-canyon', 'Mars Canyon', [
    // The colony on arrival: the greenhouses with their dark glass among the domes
    frame([m(20, -120), m(-20, -170), m(60, -170)], { from: 350, pitch: 22, margin: 4, glide: 1.6, label: 'greenhouses' }),
    wait(1),
    effect('greenhouses'),
    // A volcano on the plain west of the colony: the mountain, then a crater on its top
    frame([m(-150, -60), m(-70, -60)], { from: 330, pitch: 30, margin: 20, glide: 1.4 }),
    tool('landscape', { label: 'volcano' }),
    mode('mountain'),
    settings({ brush: { radius: 48, strength: 1 }, landscape: { seed: 31, reroll: false } }),
    stroke(3.2, [m(-110, -60), m(-109, -59)]),
    ...settle(0.5),
    mode('crater', { label: 'crater' }),
    settings({ brush: { radius: 18, strength: 1 } }),
    stroke(1.6, [m(-110, -60), m(-110, -60)]),
    ...settle(1),
    effect('volcano'),
  ]),
  block('moon-craters', 'moon-base', 'Moon Base', [
    // Symmetry: Mirror X makes two big craters of one stroke on the south plain, then Both four over the whole map
    frame([m(-120, -250), m(120, -160)], { from: 0, pitch: 48, margin: 6, glide: 1.6 }),
    tool('landscape', { label: 'symmetry' }),
    mode('crater'),
    settings({ brush: { radius: 40, strength: 1 } }),
    { do: 'select', sel: '[data-test=symmetry]', value: 'x', label: 'mirror' },
    ...settle(0.3),
    stroke(1.8, [m(60, -205), m(60, -205)], { label: 'two' }),
    ...settle(1),
    effect('mirror'),
    frame([m(-235, -235), m(235, 235)], { from: 0, pitch: 60, margin: 0, glide: 1.4 }),
    { do: 'select', sel: '[data-test=symmetry]', value: 'xy', label: 'both' },
    settings({ brush: { radius: 36, strength: 1 } }),
    ...settle(0.3),
    stroke(1.8, [m(135, 205), m(135, 205)], { label: 'four' }),
    ...settle(1.2),
    effect('four'),
    { do: 'select', sel: '[data-test=symmetry]', value: 'none' },
  ]),
  block('rc-water', 'red-canyon', 'Red Canyon', [
    // A lake dug in the plain east of the north canyon, then a river from the east into it
    frame([m(110, 30), m(225, 180)], { from: 215, pitch: 32, margin: 12, glide: 1.4 }),
    tool('water', { label: 'dig a lake' }),
    mode('lake'),
    settings({ brush: { radius: 30, strength: 1 } }),
    stroke(2.6, [m(115, 40), m(140, 55), m(130, 30), m(120, 50)]),
    ...settle(0.8),
    effect('lake'),
    tool('landscape', { label: 'river' }),
    mode('river'),
    stroke(3, [m(225, 180), m(205, 140), m(180, 105), m(160, 78), m(142, 56)], { settle: 0.3 }),
    ...settle(0.8),
    effect('river'),
    // Low over the lake: the mesas mirrored, the foam at the shore, the shallows turquoise
    act('overlay', { on: false }),
    { do: 'cursor', show: false },
    path(4.5, ['current', [m(85, 15, 7), m(150, 60, 2)], [m(110, 5, 6), m(160, 70, 2)]], { ease: 'inOut', label: 'effect:mirror' }),
    { do: 'cursor', show: true },
    act('overlay', { on: true }),
    // The oasis's palms and tents copied and stamped by the new lake, once turned
    frame([m(86, -180), m(132, -226)], { from: 0, pitch: 50, margin: 20, glide: 1.2 }),
    tool('stamp', { label: 'stamps' }),
    mode('select'),
    click('input[aria-label="Heights"]'),
    click('input[aria-label="Ground paint"]'),
    click('input[aria-label="Water"]'),
    click('input[aria-label="Roads"]'),
    stroke(1.1, [m(86, -180), m(132, -226)], { label: 'copy' }),
    click('[data-test=copy]'),
    wait(0.2),
    frame([m(70, 60), m(130, -10), m(160, 60)], { from: 0, pitch: 45, margin: 14, glide: 1.6 }),
    clickMap(m(78, 62), { label: 'stamp' }),
    ...settle(0.5),
    key('r'),
    wait(0.3),
    clickMap(m(130, -8), { label: 'stamp turned' }),
    ...settle(0.8),
    effect('stamps'),
    key('Escape'),
    // The visit undone step by step, then forward again
    click('[data-test=side-history]', { label: 'history' }),
    act('history', { to: 0, stepS: 0.3 }),
    wait(0.6),
    act('history', { to: 'end', stepS: 0.3 }),
    effect('history'),
    wait(0.6),
    click('[data-test=side-tool]'),
  ]),
  block('dv-autumn', 'demo-valley', 'Demo Valley', [
    // A mountain in the west meadow between the road and the river, snow painted on its top
    frame([m(-235, 10), m(-145, 10)], { from: 15, pitch: 20, margin: 18, glide: 1.6 }),
    tool('landscape', { label: 'mountain' }),
    mode('mountain'),
    settings({ brush: { radius: 55, strength: 1 }, landscape: { seed: 11, reroll: false } }),
    stroke(3.4, [m(-190, 15), m(-189, 16)]),
    ...settle(0.5),
    effect('mountain'),
    // Snow as a new ground layer on the peak (the Snow biome lays rock on a slope this steep)
    tool('paint', { label: 'paint snow' }),
    click('[data-test=add-layer]'),
    click('.pp-group', { withText: 'Mountain' }),
    click('[data-material=snow-fresh]', { timeout: 8 }),
    settings({ brush: { radius: 24, strength: 1 } }),
    stroke(2.2, [m(-194, 18), m(-185, 13), m(-190, 23), m(-189, 15)]),
    ...settle(0.8),
    effect('snow'),
    // The meadow west of the mountain's foot cleared (a wood keeps its spacing from every object, the meadow's
    // grass clumps let no tree grow), then the new Autumn wood grown on it: its leaves turn tree by tree
    tool('objects', { label: 'erase' }),
    mode('erase'),
    settings({ brush: { radius: 30, strength: 1 } }),
    stroke(1.8, [m(-228, -18), m(-218, -32), m(-230, -38), m(-222, -22)]),
    ...settle(0.5),
    effect('erase'),
    tool('landscape', { label: 'autumn wood' }),
    mode('biome'),
    click('[data-biome=autumn]'),
    settings({ brush: { radius: 34, strength: 1 }, landscape: { seed: 21 } }),
    ...settle(0.3),
    stroke(3.2, [m(-228, -18), m(-218, -32), m(-230, -38), m(-222, -22)]),
    ...settle(1.6),
    effect('autumn wood'),
    // Down among the new trees: red to yellow, each its own
    act('overlay', { on: false }),
    { do: 'cursor', show: false },
    path(4, ['current', [m(-250, -60, 8), m(-215, -25, 6)], [m(-200, -70, 9), m(-222, -28, 6)]], { ease: 'inOut', label: 'effect:autumn trees' }),
    { do: 'cursor', show: true },
    act('overlay', { on: true }),
  ]),
  block('mars-objects', 'mars-canyon', 'Mars Canyon', [
    // A greenhouse and a dome by the landing pad: each levels its ground as it lands; the greenhouse moved, a copy
    // dragged beside it. Drags start on the building beside its middle (the middle holds the gizmo's lift handle)
    frame([m(-95, -185), m(-70, -215), m(-125, -175)], { from: 20, pitch: 32, margin: 0, glide: 1.4 }),
    tool('objects', { label: 'objects' }),
    mode('place'),
    ...asset('greenhouse', 'greenhouse-dome'),
    clickMap(m(-95, -185), { label: 'place buildings' }),
    ...settle(0.5),
    ...asset('dome', 'dome-white'),
    clickMap(m(-70, -215)),
    ...settle(0.6),
    effect('buildings'),
    mode('select', { label: 'select' }),
    clickMap(m(-95, -185)),
    wait(0.3),
    key('d', { ctrl: true }),
    wait(0.3),
    stroke(1.3, [m(-92, -182), m(-125, -172)], { label: 'duplicate', settle: 0.3 }),
    wait(0.8),
    effect('duplicate'),
    key('Escape'),
  ]),
  block('dv-village', 'demo-valley', 'Demo Valley', [
    // Buildings on the new hill's flank and table: each levels its ground as it lands
    frame([m(-80, -185), m(-30, -195), m(-110, -215)], { from: 10, pitch: 30, margin: 8, glide: 1.4 }),
    tool('objects', { label: 'objects' }),
    mode('place'),
    ...asset('chapel', 'chapel'),
    clickMap(m(-78, -182), { label: 'place buildings' }),
    ...settle(0.5),
    ...asset('tall', 'house-tall'),
    clickMap(m(-28, -198)),
    ...settle(0.6),
    effect('buildings'),
    // The village road paved: the road picked in the Roads panel, its surface chosen, painted at once
    frame([m(25, -128), m(75, -142)], { from: 10, pitch: 40, margin: 2, glide: 1.4 }),
    tool('paths', { label: 'road surface' }),
    mode('edit'),
    clickMap(m(50, -135)),
    wait(0.4),
    { do: 'select', sel: '[data-test=road-surface]', value: 'cobblestone' },
    ...settle(1),
    effect('road surface'),
    key('Escape'),
    // Lamps all along the West road, beside it on both sides
    frame([m(-200, -110), m(-95, -100)], { from: 20, pitch: 24, margin: 12, glide: 1.2 }),
    tool('objects'),
    mode('line', { label: 'lamps' }),
    click('[data-test=line-roads]'),
    ...asset('lamp', 'lamp-post'),
    settings({ objects: { line: { offset: 5.5, bothSides: true, spacing: 14 } } }),
    clickMap(m(-150, -85)),
    ...settle(0.5),
    // Low along the road between the two rows
    act('overlay', { on: false }),
    path(2.4, ['current', [m(-115, -78, 6), m(-205, -105, 3)]], { ease: 'inOut' }),
    effect('lamps'),
    wait(0.6),
    // Rain, then night where the lamps stand and the village begins: every setting with the camera at rest, held
    // until it shows
    act('overlay', { on: false }),
    path(2, ['current', [m(-95, -140, 7), m(30, -115, 6)]], { ease: 'inOut' }),
    tool('environment', { label: 'sky' }),
    ...settle(0.4),
    click(WEATHER, { withText: 'Rain', label: 'rain' }),
    { do: 'range', sel: 'app-editor-range[label=Strength]', to: 100, dur: 0.7 },
    ...settle(2),
    effect('rain'),
    click(WEATHER, { withText: 'Clear' }),
    click(SKY_PRESET, { withText: 'Night', label: 'night' }),
    ...settle(1.4),
    { do: 'range', sel: '[data-test=moonlight]', to: 60, dur: 0.8 },
    ...settle(2),
    effect('night'),
    orbit(5, 'look', { turn: 18, ease: 'inOut' }),
    act('overlay', { on: true }),
  ]),
];
