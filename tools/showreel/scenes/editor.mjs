// The editor, map 1: Green Valley, from an empty map to Test map. Every beat keeps the camera on what it changes
// and holds about a second on the result. Ground layers (12 at most): grass, snow (Paint),
// forest x3, sand, gravel and mud (river), cobblestone (road), 10 in all.
import { act, asset, clickMap, click, m, mode, newMap, orbit, par, path, seq, settings, stroke, tool, wait } from './common.mjs';

/** The camera on map points (director frame step): from the current side or `from` degrees, turning `turn` over `dur` */
const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });

const key = (k, mods) => ({ do: 'key', key: k, ...(mods ? { mods } : {}) });
const keys = (k, n, mods) => Array.from({ length: n }, () => [key(k, mods), wait(0.12)]).flat();

/** After a change: the editor idle, then the camera held `hold` seconds while it takes effect */
const settle = (hold) => [act('idle', { timeout: 20 }), wait(hold)];

/** The Sky panel's preset buttons and weather buttons (a bare withText 'Snow' also finds other fields) */
const SKY_PRESET = '[aria-labelledby=ep-sky] button[role=radio]';
const WEATHER = '[aria-label=Weather] button[role=radio]';

/** Camera poses [eye, look] the sky scene comes back to */
/** The oak grove behind the village (HQ at 128, 0): low, the trees and houses in front */
const FOREST_VIEW = [{ m: [70, -62], h: 7 }, { m: [62, -22], h: 4 }];
/** Low beside the West road, looking along it: the row of lamps recedes to the spawn */
const LAMPS_VIEW = [{ m: [-62, -14], h: 6 }, { m: [-160, 2], h: 3 }];
const WIDE_VIEW = [[0.05, -0.08, 45], [0.0, 0.3, 25]];
/** Low over the south, looking the valley's length north: fog shows in the depth */
const DEEP_VIEW = [[0.02, -0.46, 10], [0.0, 0.35, 15]];

export const SCENES = [
  { name: 'editor-new', page: '/editor', steps: [{ do: 'mark', name: 'Map editor' }, ...newMap('Green Valley', 'new map')] },
  {
    // Small and weak, then the keys make the brush big and strong: the same stroke again, side by side
    name: 'editor-brush',
    steps: [
      path(1.5, ['current', [[-0.3, -0.52, 60], [-0.3, -0.3]]]),
      tool('terrain', { label: 'terrain' }),
      mode('raise'),
      settings({ brush: { radius: 10, strength: 0.25 } }),
      stroke(1.6, [[-0.37, -0.3], [-0.365, -0.3]], { label: 'small brush' }),
      wait(0.6),
      { do: 'move', to: [-0.25, -0.3], dur: 0.4 },
      ...keys(']', 9),
      ...keys('}', 4, { shift: true }),
      wait(0.5),
      stroke(2, [[-0.24, -0.3], [-0.235, -0.3]], { label: 'big brush' }),
      wait(1),
    ],
  },
  {
    name: 'editor-terrain',
    // Each sculpt mode framed on its own spot, result held: erode down the big hill's side, terraces on its top,
    // roughen the flat ground before it, smooth over the terraces
    steps: [
      mode('erode'),
      settings({ brush: { radius: 30, strength: 1 } }),
      frame([[-0.27, -0.27], [-0.22, -0.32]], { from: 200, pitch: 30, margin: 30, glide: 1.8 }),
      stroke(2.2, [[-0.27, -0.27], [-0.22, -0.32]], { label: 'erode' }),
      wait(0.9),
      mode('terrace'),
      settings({ brush: { radius: 34, strength: 1 } }),
      stroke(2, [[-0.24, -0.3], [-0.245, -0.295]], { label: 'terrace' }),
      wait(0.9),
      mode('noise'),
      settings({ brush: { radius: 28, strength: 1 } }),
      frame([[-0.38, -0.38], [-0.32, -0.4]], { from: 190, pitch: 32, margin: 22, glide: 1 }),
      stroke(1.8, [[-0.38, -0.38], [-0.32, -0.4]], { label: 'roughen' }),
      wait(0.9),
      mode('smooth'),
      settings({ brush: { radius: 30, strength: 1 } }),
      frame([[-0.24, -0.3]], { from: 200, pitch: 30, margin: 40, glide: 1 }),
      stroke(2, [[-0.26, -0.3], [-0.23, -0.29]], { label: 'smooth' }),
      wait(0.9),
    ],
  },
  {
    // A table with a hard rim, a ramp up to it seen from the side, then the rim smoothed away on camera
    name: 'editor-cliff-ramp',
    steps: [
      // Up and over the smoothed hill, then down to the table's spot (straight, the camera went into the hill)
      path(2.2, ['current', [[-0.12, -0.5, 80], [-0.12, -0.32]], [[-0.02, -0.5, 45], [-0.1, -0.33]]], { ease: 'inOut' }),
      mode('plateau'),
      settings({ brush: { radius: 42, strength: 1 }, terrain: { step: 14 } }),
      stroke(1.5, [[-0.1, -0.3], [-0.095, -0.3]], { label: 'cliff' }),
      wait(0.8),
      frame([[-0.1, -0.3], [-0.1, -0.44]], { from: 75, pitch: 16, margin: 8, pad: 0.85, glide: 1.2 }),
      mode('ramp'),
      clickMap([-0.1, -0.31], { label: 'ramp' }),
      clickMap([-0.1, -0.44]),
      wait(1.6),
    ],
  },
  {
    name: 'editor-shapes',
    steps: [
      tool('landscape', { label: 'landscape' }),
      mode('mountain'),
      settings({ brush: { radius: 75, strength: 1 }, landscape: { seed: 11, reroll: false } }),
      // A glide there first (the turning frame alone jumped in half a second), closer: the map's edge out of the picture
      frame([[-0.28, 0.32], [0.0, 0.38], [0.28, 0.33]], { from: 195, pitch: 22, margin: 15, pad: 0.85, glide: 1.8 }),
      par(
        frame([[-0.28, 0.32], [0.0, 0.38], [0.28, 0.33]], { from: 195, pitch: 22, margin: 15, pad: 0.85, dur: 14, turn: 22 }),
        seq(
          wait(0.9),
          stroke(3.5, [[-0.28, 0.32], [-0.27, 0.33]], { label: 'mountains' }),
          stroke(3.5, [[0.0, 0.38], [0.01, 0.38]]),
          settings({ landscape: { seed: 12 } }),
          stroke(3, [[0.27, 0.34], [0.28, 0.33]]),
        ),
      ),
      mode('valley', { label: 'valley' }),
      settings({ brush: { radius: 40, strength: 1 } }),
      frame([[0.22, 0.3], [0.33, 0.38]], { from: 160, pitch: 30, margin: 40, pad: 1 }),
      stroke(3, [[0.22, 0.3], [0.33, 0.38]]),
      wait(0.8),
      mode('cliff', { label: 'cliff edge' }),
      settings({ brush: { radius: 30, strength: 1 }, landscape: { cliffHeight: 14 } }),
      frame([[-0.42, 0.12], [-0.1, 0.14]], { from: 160, pitch: 28, margin: 25 }),
      stroke(2, [[-0.42, 0.12], [-0.25, 0.16], [-0.1, 0.14]]),
      wait(0.8),
    ],
  },
  {
    // Snow as a new layer, painted on a peak
    name: 'editor-paint',
    steps: [
      frame([[0.0, 0.38]], { from: 185, pitch: 28, margin: 70, pad: 1 }),
      tool('paint', { label: 'paint' }),
      click('[data-test=add-layer]'),
      click('.pp-group', { withText: 'Mountain' }),
      click('[data-material=snow-fresh]', { timeout: 8 }),
      settings({ brush: { radius: 22, strength: 1 } }),
      stroke(2.2, [[-0.02, 0.38], [0.02, 0.385], [0.0, 0.375]], { label: 'paint snow' }),
      // Auto paint left out: on these mountains it takes the snow away and browns the meadow (app, E177)
      wait(0.5),
      orbit(4, [0.0, 0.36], { from: 180, to: 215, radius: 120, height: 70 }),
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
        frame([[-0.36, 0.28], [-0.12, 0.3], [0.2, 0.22]], { from: 175, pitch: 28, margin: 20, pad: 0.85, dur: 9, turn: 20 }),
        seq(
          wait(0.9),
          stroke(3.5, [[-0.36, 0.28], [-0.3, 0.33], [-0.24, 0.31], [-0.18, 0.27], [-0.12, 0.3]]),
          stroke(2.5, [[-0.12, 0.24], [0.1, 0.25], [0.2, 0.22]]),
        ),
      ),
    ],
  },
  {
    name: 'editor-river',
    steps: [
      mode('river', { label: 'river' }),
      par(
        frame([[-0.02, 0.33], [-0.1, -0.48]], { from: 250, pitch: 35, margin: 20, dur: 5, turn: 15 }),
        stroke(3.5, [[-0.02, 0.33], [-0.1, 0.15], [-0.04, -0.02], [-0.14, -0.2], [-0.1, -0.48]], { settle: 0.3 }),
      ),
      wait(0.8),
      path(1.2, ['current', [{ at: 'river:0:10', dx: 35, dy: -70, h: 105 }, { at: 'river:0:10', dx: 14 }]]),
      tool('water', { label: 'move the river' }),
      wait(0.3),
      mode('river'),
      stroke(1.8, [{ at: 'river:0:10' }, { at: 'river:0:10', dx: 30, dy: 4 }], { settle: 0.3 }),
      // The river's handles go with the selection: the moved bed alone
      key('Escape'),
      wait(1.2),
    ],
  },
  {
    name: 'editor-lake',
    steps: [
      path(1.5, ['current', [[0.3, -0.45, 60], [0.18, -0.24]]]),
      // Esc after the river move left the tool: pick it again
      tool('water'),
      mode('lake', { label: 'dig a lake' }),
      settings({ brush: { radius: 26, strength: 1 } }),
      stroke(2.4, [[0.16, -0.22], [0.2, -0.25], [0.17, -0.27]]),
      act('idle', { timeout: 30 }),
      wait(1.2),
    ],
  },
  {
    name: 'editor-roads',
    steps: [
      frame([{ at: 'hq' }, [0.32, 0.08], [0.47, 0.2]], { from: 200, pitch: 48, margin: 25, glide: 1.5 }),
      tool('paths', { label: 'roads' }),
      mode('draw'),
      clickMap({ at: 'hq', dx: 0, dy: 6 }),
      clickMap([0.32, 0.08]),
      clickMap([0.4, 0.12]),
      clickMap([0.47, 0.2]),
      key('Enter'),
      wait(0.4),
      mode('edit', { label: 'bend the road' }),
      stroke(1.4, [{ at: 'node:-2' }, { at: 'node:-2', dx: -32, dy: 30 }], { settle: 0.2 }),
      key('s'),
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
      ...asset('chapel', 'chapel'),
      clickMap({ at: 'hq', dx: -45, dy: -32 }, { label: 'place buildings' }),
      ...asset('tall', 'house-tall'),
      clickMap({ at: 'hq', dx: -72, dy: -40 }),
      ...asset('watchtower', 'watchtower'),
      clickMap({ at: 'hq', dx: -88, dy: -58 }),
      ...asset('cottage', 'cottage'),
      clickMap({ at: 'hq', dx: -24, dy: -42 }),
      ...asset('castle wall', 'castle-wall'),
      mode('line', { label: 'castle wall' }),
      frame([{ at: 'hq', dx: -100, dy: -15 }, { at: 'hq', dx: -100, dy: -80 }, { at: 'hq', dx: -20, dy: -80 }], { pitch: 38, margin: 15 }),
      stroke(2.2, [{ at: 'hq', dx: -100, dy: -15 }, { at: 'hq', dx: -100, dy: -80 }, { at: 'hq', dx: -20, dy: -80 }], { settle: 0.3 }),
      wait(0.8),
      mode('scatter', { label: 'scatter trees' }),
      ...asset('oak', 'tree-oak'),
      // Behind the houses as the camera sees them from the south, dense enough to read as a grove
      settings({ brush: { radius: 14, strength: 1 }, objects: { scatter: { density: 14 } } }),
      frame([{ at: 'hq', dx: -95, dy: -24 }, { at: 'hq', dx: -30, dy: -20 }, { at: 'hq', dx: -45, dy: -45 }], { from: 10, pitch: 32, margin: 20 }),
      // West of the chapel only: a wider stroke grew oaks into the chapel and the houses
      stroke(2.4, [{ at: 'hq', dx: -96, dy: -20 }, { at: 'hq', dx: -66, dy: -18 }]),
      wait(1),
    ],
  },
  {
    // Select, scale with the gizmo, duplicate and drag the copy
    name: 'editor-select',
    steps: [
      frame([{ at: 'object:cottage' }, { at: 'object:cottage', dx: 16, dy: -10 }], { pitch: 35, margin: 14 }),
      mode('select', { label: 'select' }),
      clickMap({ at: 'object:cottage' }),
      key('r'),
      wait(0.3),
      stroke(1, [{ at: 'object:cottage', dx: 2 }, { at: 'object:cottage', dx: 4.5 }], { label: 'scale', settle: 0.3 }),
      wait(0.6),
      key('w'),
      key('d', { ctrl: true }),
      wait(0.3),
      stroke(1.3, [{ at: 'object:cottage', dx: 3, dy: -3 }, { at: 'object:cottage', dx: 19, dy: -13 }], { label: 'duplicate', settle: 0.3 }),
      // Align to slope left out: on this flat ground it changes nothing on screen
      wait(1),
      key('Escape'),
    ],
  },
  {
    // Lamps all along the road with one click; they light up at night in the sky scene
    name: 'editor-lamps',
    steps: [
      frame([{ m: [-100, 0] }, { m: [-40, 0] }], { from: 200, pitch: 20, margin: 10 }),
      mode('line'),
      click('[data-test=line-roads]'),
      ...asset('lamp', 'lamp-post'),
      // Beside the road on both sides (offset 0 stood them on the road's middle): half the 8 m road and 1.5 m
      settings({ objects: { line: { offset: 5.5, bothSides: true, spacing: 12 } } }),
      clickMap({ m: [-100, 0] }, { label: 'lamps' }),
      wait(0.6),
      act('overlay', { on: false }),
      path(2.2, ['current', LAMPS_VIEW], { ease: 'inOut' }),
      wait(0.8),
    ],
  },
  {
    name: 'editor-look',
    steps: [
      frame([{ at: 'object:chapel' }, { at: 'hq' }], { pitch: 35, margin: 20 }),
      tool('look', { label: 'look' }),
      clickMap({ at: 'object:chapel' }),
      wait(1.6),
    ],
  },
  {
    // Copy a piece of the village and stamp it twice, turned
    name: 'editor-stamps',
    // HQ at (128, 0): the village west of it (walls down to y -80, the lake below), free meadow east of it
    steps: [
      frame([{ at: 'hq', dx: -105, dy: -10 }, { at: 'hq', dx: -15, dy: -78 }, { at: 'hq', dx: 110, dy: -150 }], { from: 190, pitch: 40, margin: 12 }),
      // The lamps scene left the overlay off: on again once the camera has gone up
      act('overlay', { on: true }),
      tool('stamp', { label: 'stamps' }),
      mode('select'),
      // Objects only: with the heights, paint, water and roads the copy cut rectangles into the hilly ground
      click('input[aria-label="Heights"]'),
      click('input[aria-label="Ground paint"]'),
      click('input[aria-label="Water"]'),
      click('input[aria-label="Roads"]'),
      stroke(1.2, [{ at: 'hq', dx: -105, dy: -10 }, { at: 'hq', dx: -15, dy: -78 }], { label: 'copy' }),
      click('[data-test=copy]'),
      wait(0.3),
      clickMap({ at: 'hq', dx: 77, dy: -55 }, { label: 'stamp' }),
      act('idle', { timeout: 20 }),
      wait(0.6),
      key('r'),
      wait(0.4),
      clickMap({ at: 'hq', dx: 87, dy: -150 }, { label: 'stamp turned' }),
      act('idle', { timeout: 20 }),
      wait(1.2),
      key('Escape'),
    ],
  },
  {
    // A crater on a level table, then Fill a hollow: the water fills just that crater to its rim
    name: 'editor-fill',
    steps: [
      frame([{ m: [-170, -72] }], { from: 160, pitch: 30, margin: 45 }),
      tool('landscape'),
      // A level table first: on the hillside a crater's rim had a low side and the water ran off ("no hollow")
      mode('plateau'),
      settings({ brush: { radius: 55, strength: 1 } }),
      stroke(1.2, [{ m: [-170, -72] }, { m: [-169, -72] }]),
      mode('crater'),
      settings({ brush: { radius: 32, strength: 1 } }),
      stroke(2, [{ m: [-170, -72] }, { m: [-170, -72] }], { label: 'crater' }),
      wait(0.5),
      tool('water'),
      mode('fill', { label: 'fill a hollow' }),
      // Ctrl: the hollow's own rim sets the level, whatever water the map has already
      clickMap({ m: [-170, -72] }, { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      wait(1.5),
    ],
  },
  {
    // The whole build undone step by step to the empty map, then forward again
    name: 'editor-history',
    steps: [
      path(1.5, ['current', [[0.05, -0.55, 300], [0.0, 0.02]]]),
      click('[data-test=side-history]', { label: 'history' }),
      act('history', { to: 0, stepS: 0.09 }),
      wait(1),
      act('history', { to: 'end', stepS: 0.06 }),
      wait(0.8),
      click('[data-test=side-tool]'),
    ],
  },
  {
    // The Sky tool with the forest in front: wind from calm to storm, the day running into dusk; night at the
    // lamps; pictures, rain and the still frame; fog over the depth of the valley, snow; back to a clear day
    name: 'editor-sky',
    // Every setting made with the camera at rest, then held until it has taken effect (a new look compiles, the
    // wind reaches the trees, the rain starts to fall): changes during a camera move showed as stutter
    steps: [
      // Road nodes, spawn flag and HQ marker out of the picture for the whole scene
      act('overlay', { on: false }),
      path(1.5, ['current', FOREST_VIEW]),
      tool('environment', { label: 'sky' }),
      ...settle(0.6),
      { do: 'range', sel: '[data-test=wind] app-editor-range', to: 100, dur: 2.2, label: 'wind' },
      ...settle(2.6),
      { do: 'range', sel: '[data-test=wind] app-editor-range', to: 15, dur: 1 },
      ...settle(1.2),
      // Up over the grove's crowns, out to the mountains; then one slider from noon into dusk
      path(4, ['current', [{ m: [52, -50], h: 34 }, { m: [40, 20], h: 20 }], [[-0.06, 0.1, 22], [-0.07, 0.3, 28]]], { ease: 'smooth' }),
      ...settle(0.6),
      { do: 'range', sel: '[data-test=time-of-day]', to: 19.6, dur: 3.6, label: 'time of day' },
      ...settle(2),
      // Night where the lamps stand
      path(2, ['current', LAMPS_VIEW], { ease: 'inOut' }),
      ...settle(0.4),
      click(SKY_PRESET, { withText: 'Night', label: 'night' }),
      ...settle(1.6),
      { do: 'range', sel: '[data-test=moonlight]', to: 85, dur: 1.2, label: 'moonlight' },
      ...settle(2),
      path(2, ['current', WIDE_VIEW], { ease: 'inOut' }),
      ...settle(0.4),
      { do: 'select', sel: '[data-test=sky-image]', value: 'sunset', label: 'sky picture' },
      ...settle(2),
      { do: 'select', sel: '[data-test=sky-image]', value: 'thunderstorm' },
      ...settle(1.2),
      click(WEATHER, { withText: 'Rain', label: 'rain' }),
      { do: 'range', sel: 'app-editor-range[label=Strength]', to: 100, dur: 0.8 },
      ...settle(2.4),
      { do: 'key', key: 'b', label: 'still frame' },
      wait(0.4),
      orbit(3, 'look', { turn: 30, ease: 'inOut' }),
      { do: 'key', key: 'b' },
      ...settle(1),
      click(WEATHER, { withText: 'Clear' }),
      ...settle(1),
      { do: 'select', sel: '[data-test=sky-image]', value: 'starry-night', label: 'starry night' },
      ...settle(2.2),
      { do: 'select', sel: '[data-test=sky-image]', value: '' },
      click(SKY_PRESET, { withText: 'Day' }),
      { do: 'range', sel: '[data-test=time-of-day]', to: 11, dur: 0.8 },
      ...settle(1.2),
      // Snow under an overcast sky over the valley's depth (Fog left out: neither the weather nor the slider
      // showed on screen)
      path(2.5, ['current', DEEP_VIEW], { ease: 'smooth' }),
      ...settle(0.4),
      click(SKY_PRESET, { withText: 'Overcast', label: 'overcast' }),
      ...settle(1),
      click(WEATHER, { withText: 'Snow', label: 'snow' }),
      { do: 'range', sel: 'app-editor-range[label=Strength]', to: 90, dur: 0.8 },
      ...settle(2.6),
      click(WEATHER, { withText: 'Clear' }),
      // A clear day for everything after: the preset keeps the sun where it was, the clock sets it
      click(SKY_PRESET, { withText: 'Day' }),
      { do: 'range', sel: '[data-test=time-of-day]', to: 11, dur: 0.6 },
      ...settle(1.2),
      act('overlay', { on: true }),
    ],
  },
  {
    // A look at the spawn as the runners come out, then the camera chases one of them, then pulls up
    name: 'editor-trial',
    steps: [
      // The spawn flag and the route's node balls out of the picture for the whole trial
      act('overlay', { on: false }),
      // Over the hills to the spawn, not along the ground (the direct line grazed a slope)
      path(2.4, ['current', [{ m: [-150, -60], h: 70 }, { m: [-230, 0], h: 10 }], [{ m: [-215, -25], h: 6 }, { m: [-250, 0], h: 2 }]], { ease: 'inOut' }),
      click('[data-test=trial]', { label: 'trial wave' }),
      click('[data-test=trial-speed] button', { withText: '2x' }),
      wait(2.5),
      { do: 'follow', at: { at: 'runner:0' }, dur: 7, back: 12, side: 7, h: 5, label: 'chase' },
      path(3, ['current', [{ m: [-120, -100], h: 75 }, { m: [-120, 0] }]], { ease: 'inOut', label: 'pull up' }),
      wait(1.5),
      act('overlay', { on: true }),
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
    ],
  },
  { name: 'editor-test', steps: [click('[data-test=test-play]', { label: 'test map' }), wait(1.5)] },
];
