// K5 "Auf jeder Welt" (DREHBUCH_R4 2.6): one tool each on four maps, each scene on a page of its own (the cut hops
// between them), then the Warcraft 3 import. Pattern: tool and mode picked with the editor's UI, then the frame
// clean (the brush ring stays) for the stroke and the result; `effect:<what>` where it shows.
//
//   w-mars     Mars Canyon: a volcano on the sunlit plain north-east of the colony: mountain, crater, glow cracks,
//              lava filled to the rim, a smoke column; the cone seen from low on the plain
//   w-moon     Moon Base: symmetry on level ground (fixture moon-flat: the south plain and the north band levelled
//              and cleared): Mirror X, two craters of one stroke; Both, four
//   w-canyon   Red Canyon: the oasis taken along with heights, paint, water and objects, stamped turned on the
//              mesa west of it
//   w-valley   Demo Valley: the game's pause menu, Edit this map, the confirm; w-valley-edit (its own take, the cut
//              joins them on the click) at once a hill raised on the west meadow
//   w-w3x      a Warcraft 3 map imported straight to the map, a trial wave at 2x, beside the runners
import { act, click, clickMap, m, settings, stroke, wait } from './common.mjs';
import { W3X_FILE } from './w3x.mjs';

/** Every take on the recording display's size (2048x1152 CSS at 125 %) */
const WINDOW = { window: '2048x1152', dpr: 1.25 };

/** The start states (fixtures.mjs): Moon Base with its south plain and north band level, cleared of rocks */
export const FIXTURES = [
  {
    file: 'fixtures/moon-flat.3dtdmap',
    from: 'moon-base',
    seed: 1,
    script: `
const x0 = -172;
const step = 4;
const cols = 87;
for (const b of [{ y0: -250, y1: -140 }, { y0: 140, y1: 248 }]) {
  const rows = Math.round((b.y1 - b.y0) / step) + 1;
  map.heightGrid({ x: x0, y: b.y0 }, step, Array.from({ length: rows }, () => new Array(cols).fill(0)), { blend: 1, edge: 24 });
  const ids = map.objects({ x0: x0 - 10, y0: b.y0 - 10, x1: x0 + (cols - 1) * step + 10, y1: b.y1 + 10 }).map((o) => o.id);
  if (ids.length) map.removeObjects(ids);
  map.paint('regolith', [{ x: -150, y: (b.y0 + b.y1) / 2 }, { x: 150, y: (b.y0 + b.y1) / 2 }], { radius: (b.y1 - b.y0) / 2, falloff: 0.3 }, 1);
}`,
  },
];

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });
const key = (k, mods) => ({ do: 'key', key: k, ...(mods ? { mods } : {}) });
const tool = (id, opts = {}) => click(`[data-tool=${id}]`, opts);
const mode = (id, opts = {}) => click(`[data-mode=${id}]`, opts);
const effect = (what) => ({ do: 'mark', name: `effect:${what}` });
const settle = (hold) => [act('idle', { timeout: 30 }), wait(hold)];
/** The editor's frame on for a pick, off for what follows */
const ui = (on) => ({ do: 'ui', on });

/** Mars: the volcano's middle on the plain (40 m up, flat round it) */
const VOLCANO = m(150, 40);
/** Red Canyon: the oasis by the temple, the free mesa top west of it */
const OASIS = [90, -234, 140, -178];
const MESA = m(25, -205);

export const SCENES = [
  {
    name: 'w-mars',
    // Sun 35 degrees over the plain (from the south-west, behind the closing shot); the map's name signs out (the
    // brush ring with them)
    start: { editor: 'mars-canyon' },
    env: { ...WINDOW, sky: { sunElevation: 35 }, markers: false },
    steps: [
      frame([m(105, 40), m(195, 40)], { from: 330, pitch: 30, margin: 20, glide: 0.2 }),
      // Warm-up: the smoke column placed once and undone (its first placement stalls)
      tool('objects'),
      mode('place'),
      settings({ objects: { asset: 'fx-smoke-column', randomRotation: false } }),
      clickMap(m(120, 10)),
      ...settle(1.2),
      key('z', { ctrl: true }),
      ...settle(1.2),
      { do: 'mark', name: 'Mars Canyon' },
      tool('landscape', { label: 'volcano' }),
      mode('mountain'),
      settings({ brush: { radius: 60, strength: 1 }, landscape: { seed: 31, reroll: false } }),
      ui(false),
      // Held: the mountain grows while the button is down
      stroke(4, [VOLCANO, m(151, 41)]),
      ...settle(0.6),
      effect('mountain'),
      // Closer on the top for the crater, the cracks and the lava
      frame([VOLCANO], { from: 330, pitch: 42, margin: 48, glide: 1.2 }),
      ui(true),
      mode('crater', { label: 'crater' }),
      settings({ brush: { radius: 40, strength: 1 } }),
      ui(false),
      // Held: a deep bowl with a closed rim
      stroke(3, [VOLCANO, VOLCANO]),
      ...settle(0.8),
      effect('crater'),
      ui(true),
      mode('cracks', { label: 'glow cracks' }),
      settings({ brush: { radius: 25, strength: 1 } }),
      ui(false),
      stroke(2.6, [m(146, 36), m(154, 44), m(150, 40)]),
      ...settle(1),
      effect('glow cracks'),
      ui(true),
      tool('water', { label: 'lava' }),
      mode('fill'),
      click('[data-test=add-lava]'),
      ui(false),
      // Ctrl: the crater filled to its rim
      clickMap(VOLCANO, { mods: { ctrl: true } }),
      ...settle(1.2),
      effect('lava'),
      ui(true),
      tool('objects', { label: 'smoke' }),
      mode('place'),
      settings({ objects: { asset: 'fx-smoke-column', randomRotation: false } }),
      ui(false),
      clickMap(VOLCANO),
      ...settle(1),
      // Down to the plain: from low the cone stands in the lower third, its smoke against the sky
      { do: 'cursor', show: false },
      // Over the rim into the lava, then down to the plain: from low the cone stands in the lower third
      { do: 'shot', dur: 2.5, ease: 'inOut', keys: ['current', { eye: m(110, 0, 70), look: m(150, 40, 20) }] },
      effect('lava crater'),
      wait(0.8),
      { do: 'shot', dur: 3.5, ease: 'inOut', keys: ['current', { eye: m(80, -20, 8), look: m(150, 40, 16) }] },
      effect('volcano'),
      wait(1.5),
    ],
  },
  {
    name: 'w-moon',
    start: { editor: 'fixtures/moon-flat.3dtdmap' },
    // The name signs out (the brush ring with them)
    env: { ...WINDOW, markers: false },
    steps: [
      frame([m(-110, -240), m(110, -160)], { from: 0, pitch: 40, margin: 10, glide: 0.2 }),
      wait(1.2),
      { do: 'mark', name: 'Moon Base' },
      tool('landscape', { label: 'symmetry' }),
      mode('crater'),
      settings({ brush: { radius: 30, strength: 1 } }),
      { do: 'select', sel: '[data-test=symmetry]', value: 'x', label: 'mirror' },
      ...settle(0.3),
      ui(false),
      frame([m(-80, -205), m(80, -205)], { from: 0, pitch: 36, margin: 0, glide: 0.8 }),
      stroke(3, [m(40, -205), m(40, -205)], { label: 'two' }),
      ...settle(2),
      effect('mirror'),
      // Both: the two taken back, then four craters of one stroke over the whole map
      key('z', { ctrl: true }),
      ...settle(0.8),
      // From the east: the four lie across the picture, two near, two far
      frame([m(-70, -195), m(70, -195), m(-70, 195), m(70, 195)], { from: 90, pitch: 52, margin: -20, glide: 1.6 }),
      ui(true),
      { do: 'select', sel: '[data-test=symmetry]', value: 'xy', label: 'both' },
      settings({ brush: { radius: 40, strength: 1 } }),
      ...settle(0.3),
      ui(false),
      stroke(3, [m(70, -195), m(70, -195)], { label: 'four' }),
      ...settle(2),
      effect('four'),
    ],
  },
  {
    name: 'w-canyon',
    start: { editor: 'red-canyon' },
    // The markers on: the selection's outline is one of them
    env: { ...WINDOW, markers: true },
    steps: [
      // Steep, so the mesas do not hide the basin floor from the selection's corners
      frame([m(OASIS[0], OASIS[1]), m(OASIS[2], OASIS[3]), MESA], { from: 0, pitch: 62, margin: 24, glide: 0.2 }),
      wait(1.2),
      { do: 'mark', name: 'Red Canyon' },
      tool('stamp', { label: 'stamps' }),
      mode('select'),
      // Heights, ground paint, water and objects along; no roads
      click('input[aria-label="Roads"]'),
      stroke(1.1, [m(OASIS[0], OASIS[3]), m(OASIS[2], OASIS[1])], { label: 'copy' }),
      click('[data-test=copy]'),
      wait(0.3),
      ui(false),
      // Once turned, on the mesa beside the original
      key('r'),
      wait(0.4),
      clickMap(MESA, { label: 'stamp' }),
      ...settle(1.2),
      key('Escape'),
      // The copy's hollow lies 40 m over the oasis's water level (water keeps its level): water of its own, filled to the rim
      ui(true),
      tool('water', { label: 'water' }),
      mode('fill'),
      click('[data-test=add-lake]'),
      ui(false),
      clickMap(MESA, { mods: { ctrl: true } }),
      ...settle(1.5),
      effect('stamp'),
      act('overlay', { on: false }),
      { do: 'cursor', show: false },
      frame([m(108, -202), MESA], { from: 10, turn: 10, pitch: 34, margin: 26, glide: 1.6, dur: 4.5 }),
      effect('two oases'),
    ],
  },
  {
    // The game on Demo Valley: wave 1 runs, the pause menu's Edit this map, asked first; the take ends on the
    // pointer over "Open in the editor" (a take stays on its page), w-valley-edit starts in the editor
    name: 'w-valley',
    page: '/?world=map:demo-valley',
    noIntro: true,
    env: { ...WINDOW, routes: false },
    steps: [
      wait(0.6),
      { do: 'mark', name: 'Demo Valley' },
      act('wave', { label: 'wave 1' }),
      wait(2),
      click('.sb-menu', { label: 'pause menu' }),
      wait(0.5),
      click('[data-entry=edit-map]', { label: 'edit this map' }),
      { do: 'waitFor', sel: '.mh-confirm' },
      wait(0.3),
      { do: 'move', to: '.mh-confirm .td-btn-primary', dur: 0.5, label: 'open in the editor' },
      wait(0.5),
    ],
  },
  {
    name: 'w-valley-edit',
    start: { editor: 'demo-valley' },
    env: { ...WINDOW, markers: false, camera: { eye: m(-170, 150, 120), look: m(-170, -10) } },
    steps: [
      // The flat west meadow (the south one is too narrow for the brush on this 512 m map), at once a hill raised
      // on it with a 90 m brush; the ruin crag behind it
      frame([m(-240, -10), m(-100, -10)], { from: 190, pitch: 36, margin: 20, glide: 1 }),
      tool('terrain', { label: 'raise' }),
      mode('raise'),
      settings({ brush: { radius: 90, strength: 0.7 } }),
      ui(false),
      stroke(2.4, [m(-170, -10), m(-169, -10)]),
      ...settle(1.2),
      effect('hill'),
    ],
  },
  {
    name: 'w-w3x',
    page: '/editor',
    env: { ...WINDOW },
    steps: [
      wait(0.5),
      { do: 'mark', name: 'Warcraft 3 import' },
      { do: 'move', to: 'label:has(input[data-test=import-input]), button:has(+ input[data-test=import-input])', dur: 0.6, label: 'import' },
      { do: 'upload', sel: '[data-test=import-input]', file: W3X_FILE },
      wait(0.8),
      click('[data-test=w3x-import]', { timeout: 10 }),
      { do: 'waitFor', sel: '[data-test=open-imported]', timeout: 60 },
      // The report skipped: straight to the map
      click('[data-test=open-imported]'),
      act('viewReady', { timeout: 90 }),
      act('overlay', { on: false }),
      wait(1.5),
      click('[data-test=trial]', { label: 'trial wave' }),
      click('[data-test=trial-speed] button', { withText: '2x' }),
      ui(false),
      { do: 'cursor', show: false },
      wait(2.5),
      // Low beside the runners along a lane of the maze (a chase from behind turned onto the first runner's face)
      { do: 'follow', at: { at: 'runner:0' }, dur: 5, back: 8, side: 16, h: 6, ahead: 6, label: 'effect:runners' },
    ],
  },
];
