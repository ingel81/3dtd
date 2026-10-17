// K3 "Ein Level entsteht: Stillwater" (tmp/showreel/DREHBUCH_R4.md 2.4 and 3): an empty meadow becomes a level,
// stage by stage, each stage its own take on its own fixture (scenes/r4-k3-stages.mjs makes them: F-B<n> is the
// end of scene b<n>, the start of b<n+1>). Every stage opens and closes on the same build-up wide shot (TOTAL, the
// sun fixed), the work in between close; tools, modes and brush values are picked with the UI shown, strokes and
// results run without it (the brush ring stays, it is in the world). Marks: `total:<stage>` on the wide shots,
// `effect:<what>` where a change shows.
//
//   b0-new        the new-map form: Stillwater, Medium, Empty, Flat, Create; the empty meadow in the wide shot
//   b1-terrain    the ring grows to 140 m, strength to 1: a hill, a hollow, smoothed, a table with a cliff, a ramp
//   b2-mountains  three mountains, smoothed, a cliff edge for the waterfall, the whole map eroded, auto paint,
//                 limestone cliffs, the hill smoothed for the windmill; along the ridge
//   b3-water      the river from the step to the hollow (waterfall, bridge), the hollow filled to its rim; low
//                 over the lake
//   b4-roads      the north road (gravel, lamps) in two lines, its spawn, the routes; the bend dragged east,
//                 rounded, widened; the village stretch paved; the east road and its spawn
//   b5-biomes     conifers on the flanks, a wood, autumn by the lake, a beach, a meadow; down through the wood
//   b6-village    houses facing the street, chapel and stalls, the windmill, the castle ring and gate, torches,
//                 lamps along the street
//   b7-life       a boat, birds, fireflies, ground fog, cows and sheep with bells
//   b8-sky        morning fog lifting, rain and gusts, a time lapse into the night with the lights on
//   b9-rules      the check, the build areas, the map's own intro flight previewed
//   b10-trial     the trial wave followed over the bridge, Test map
//   b-totals      the ten stages in the same wide shot
import { act, click, clickMap, m, mode, orbit, par, path, settings, stroke, tool, wait } from './common.mjs';
import { P, ring } from './r4-k3-stages.mjs';

const FIX = (n) => `fixtures/stillwater-b${n}.3dtdmap`;

/** Headless as the recording display: 2048x1152 CSS at 125 % */
const WINDOW = { window: '2048x1152', dpr: 1.25, quality: 'ultra' };

/**
 * The build-up wide shot: the map from the south-south-west, the same in every stage. Lower than the script's
 * 900 m: from that far the ground away from the view's middle reads blurred (the terrain's detail follows the
 * point the camera looks at)
 */
const TOTAL = { eye: { m: [-130, -420], habs: 500 }, look: { m: [0, 60], habs: 0 } };

/** The sun of the wide shots and the work: low from the south-east, so relief casts shadows */
const SUN = { sky: 'day', sunAzimuth: 135, sunElevation: 25, weather: 'clear' };

const mark = (name) => ({ do: 'mark', name });
const effect = (what) => mark(`effect:${what}`);
const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });
const key = (k, mods) => ({ do: 'key', key: k, ...(mods ? { mods } : {}) });
const keys = (k, n, mods) => Array.from({ length: n }, () => [key(k, mods), wait(0.14)]).flat();
const idle = (hold = 0) => [act('idle', { timeout: 60 }), ...(hold ? [wait(hold)] : [])];
const pt = (p, h) => m(p.x, p.y, h);
/** A hard cut to a pose (eye, look): no flight through hills and walls between two far shots */
const cut = ([eye, look]) => [{ do: 'shot', dur: 0, keys: [{ eye, look }, { eye, look }] }, act('idle', { timeout: 30 }), wait(1.5), mark('cut')];

/** The UI for a choice (tool, mode, values), then the clean frame again; the pointer stays for the strokes */
const pick = (...steps) => [{ do: 'ui', on: true }, ...steps, wait(0.3), { do: 'ui', on: false }];
/** Brush ring and markers in the world while working, out of the picture for the result */
const ringOn = act('overlay', { on: true });
const ringOff = act('overlay', { on: false });

/** The wide shot: clean, held 2 s */
const total = (stage, glide = 2.2) => [
  { do: 'ui', on: false },
  ringOff,
  { do: 'cursor', show: false },
  path(glide, ['current', [TOTAL.eye, TOTAL.look]], { ease: 'inOut' }),
  wait(2),
  mark(`total:${stage}`),
];

/** A stage's take: its fixture, the sun, the camera on the wide shot from the first frame, no UI */
const stage = (name, n, steps, sky = SUN, warm = []) => ({
  name,
  start: { editor: FIX(n) },
  warm,
  env: { ...WINDOW, sky, camera: TOTAL, ui: false, markers: false, seed: 7 },
  steps: [mark(`Stillwater ${name}`), wait(2), mark(`total:${name}:start`), { do: 'cursor', show: true }, ...steps],
});

const B0 = {
  name: 'b0-new',
  page: '/editor',
  env: { ...WINDOW, seed: 7 },
  steps: [
    mark('Stillwater b0-new'),
    wait(0.8),
    click('[data-test=new-map]', { label: 'new map' }),
    // The name pasted, not typed
    { do: 'type', sel: '[data-test=new-name]', text: 'Stillwater', cps: 400 },
    click('button[role=radio]', { withText: 'Medium' }),
    click('[data-template=""]'),
    click('[data-preset=flat]'),
    wait(0.3),
    click('[data-test=create-map]', { label: 'create' }),
    act('viewReady', { timeout: 120 }),
    ...idle(0.6),
    act('environment', { patch: SUN }),
    wait(1.2),
    ...total('b0-new', 2.4),
  ],
};

const B1 = stage('b1-terrain', 0, [
  // Close on the hill's place: the ring grows in the picture, then the strength goes up
  ringOn,
  frame([pt(P.hill)], { from: 15, pitch: 32, margin: 150, glide: 2 }),
  ...pick(tool('terrain', { label: 'terrain' }), mode('raise'), settings({ brush: { radius: 40, strength: 0.5, falloff: 0.5 } })),
  { do: 'move', to: pt(P.hill), dur: 0.6 },
  ...keys(']', 9),
  ...keys('}', 5, { shift: true }),
  wait(0.4),
  stroke(3, [pt(P.hill), m(P.hill.x + 1, P.hill.y)], { label: 'raise' }),
  ...idle(),
  effect('raise'),
  wait(1),
  // Smoothed: the cap rounds off
  ...pick(mode('smooth'), settings({ brush: { radius: 150, strength: 1, falloff: 0.5 } })),
  stroke(1.6, [m(P.hill.x - 40, P.hill.y), m(P.hill.x + 40, P.hill.y)], { label: 'smooth' }),
  ...idle(0.6),
  // The hollow for the lake
  frame([pt(P.hollow)], { from: 15, pitch: 34, margin: 100, glide: 1.8 }),
  ...pick(mode('lower'), settings({ brush: { radius: 90, strength: 1, falloff: 0.4 } })),
  // The stroke shows a dark cross along the tile edges for about 1 s (app bug, TODO E204): the edit cuts from here
  // to the settled hollow
  mark('lower-from'),
  stroke(1, [pt(P.hollow), m(P.hollow.x + 1, P.hollow.y)], { label: 'lower' }),
  ...idle(),
  wait(0.5),
  mark('cut'),
  effect('lower'),
  wait(1),
  // The table for the castle by the HQ: one cliff step of 14 m
  frame([pt(P.table)], { from: 20, pitch: 30, margin: 110, glide: 1.8 }),
  ...pick(mode('plateau', { label: 'cliff' }), settings({ brush: { radius: 100, strength: 1, falloff: 0.5 }, terrain: { step: 14 } })),
  stroke(1.6, [pt(P.table), m(P.table.x + 1, P.table.y)]),
  ...idle(),
  effect('cliff'),
  wait(1),
  // The ramp from the starter road up onto the table
  frame([pt(P.rampFoot), pt(P.rampTop)], { from: 0, pitch: 28, margin: 45, glide: 1.2 }),
  ...pick(mode('ramp', { label: 'ramp' }), settings({ brush: { falloff: 1 }, terrain: { rampWidth: 22 } })),
  clickMap(pt(P.rampFoot)),
  clickMap(pt(P.rampTop)),
  ...idle(),
  ringOff,
  { do: 'cursor', show: false },
  // From the road below, low: a way up the cliff
  path(3.2, ['current', [m(130, -45, 14), m(240, 5, 10)]], { ease: 'inOut' }),
  effect('ramp'),
  wait(1.6),
  ...total('b1-terrain'),
]);

const B2 = stage('b2-mountains', 1, [
  ringOn,
  frame([pt(P.peaks[0])], { from: 10, pitch: 24, margin: 190, pad: 1, glide: 2 }),
  ...pick(tool('landscape', { label: 'mountains' }), mode('mountain'), settings({ brush: { radius: 180, strength: 1, falloff: 0.5 }, landscape: { seed: 11, reroll: false } })),
  ...P.peaks.flatMap((p, i) => [
    ...(i ? [frame([pt(p)], { from: 10, pitch: 24, margin: 190, pad: 1, glide: 1.4 })] : []),
    settings({ brush: { radius: p.r } }),
    stroke(4, [pt(p), m(p.x + 1, p.y)], i === 0 ? { label: 'mountain' } : {}),
    ...idle(0.3),
  ]),
  effect('mountains'),
  wait(0.6),
  // The needles rounded into ridges
  frame([pt(P.peaks[0]), pt(P.peaks[2])], { from: 0, pitch: 24, margin: 60, pad: 1, glide: 1.6 }),
  ...pick(tool('terrain'), mode('smooth', { label: 'smooth peaks' }), settings({ brush: { radius: 200, strength: 1, falloff: 0.7 } })),
  stroke(3, P.peaks.map((p) => pt(p))),
  ...idle(0.6),
  // A cliff edge under the middle peak: the step the river will fall over
  frame([pt(P.step[0]), pt(P.step[1])], { from: 0, pitch: 26, margin: 70, glide: 1.6 }),
  ...pick(tool('landscape'), mode('cliff', { label: 'cliff edge' }), settings({ brush: { radius: 40 }, landscape: { cliffHeight: 24 } })),
  stroke(1.6, P.step.map((p) => pt(p))),
  ...idle(),
  effect('step'),
  wait(0.8),
  // The whole map eroded: gullies down every slope, band by band
  ringOff,
  frame([pt(P.peaks[0]), pt(P.peaks[2])], { from: 0, pitch: 24, margin: 60, pad: 1, glide: 1.6 }),
  ...pick(tool('settings', { label: 'erode' }), { do: 'range', sel: 'app-editor-range[label=Rain]', to: 20, dur: 0.6 }, click('[data-test=erode-map]')),
  ...idle(1),
  effect('erode'),
  // The hill kept gentle for the windmill
  ringOn,
  frame([pt(P.hill)], { from: 10, pitch: 30, margin: 150, glide: 1.4 }),
  ...pick(tool('terrain'), mode('smooth', { label: 'smooth hill' }), settings({ brush: { radius: 170, strength: 1, falloff: 0.7 } })),
  stroke(3, [m(P.hill.x - 30, P.hill.y), m(P.hill.x + 30, P.hill.y), m(P.hill.x, P.hill.y + 20)]),
  ...idle(0.6),
  ringOff,
  // Rock on the slopes, snow on the peaks, limestone in the cliffs
  frame([pt(P.peaks[0]), pt(P.peaks[2])], { from: 0, pitch: 24, margin: 60, pad: 1, glide: 1.6 }),
  ...pick(
    tool('paint', { label: 'auto paint' }),
    click('[data-test=add-layer]', { dur: 0.3 }),
    click('.pp-group', { withText: 'Mountain' }, { dur: 0.3 }),
    click('[data-material=rock-lichen]', { timeout: 8 }),
    click('[data-test=add-layer]', { dur: 0.3 }),
    click('.pp-group', { withText: 'Mountain' }, { dur: 0.3 }),
    click('[data-material=snow-fresh]', { timeout: 8 }),
    click('[data-test=auto-paint]'),
    { do: 'select', sel: 'select[aria-label="Cliff material"]', value: 'limestone' },
    // Cliff rock from 62 degrees: from the editor's 40 it covered the summits, where the snow lies up to 50
    { do: 'range', sel: 'app-editor-range[label=From]', to: 62, dur: 0.5 },
  ),
  ...idle(1.2),
  effect('auto paint'),
  { do: 'cursor', show: false },
  // Along the ridge, below the peaks
  // The peaks fill the picture: the look on their flanks, not the sky over them
  path(6, ['current', [m(-330, 190, 90), m(-150, 340, 20)], [m(80, 200, 90), m(200, 330, 20)]], { ease: 'inOut', label: 'ridge' }),
  ...total('b2-mountains'),
]);

const B3 = stage('b3-water', 2, [
  ringOn,
  // Steep onto the step: flatter, the view went over the map's north edge
  path(2, ['current', [m(110, 250, 280), m(40, 370, 40)]], { ease: 'inOut' }),
  ...pick(tool('landscape', { label: 'river' }), mode('river'), settings({ landscape: { river: { width: 16, depth: 2.5, bank: 10, reeds: true, bridges: true, kind: 'water' } } })),
  // The camera goes down the river with the pointer
  par(stroke(5, P.river.map((p) => pt(p)), { settle: 0.3 }), path(5, ['current', [m(80, -260, 260), m(-80, -40, 0)]], { ease: 'inOut' })),
  ...idle(1),
  effect('river'),
  ringOff,
  { do: 'cursor', show: false },
  // Low at the waterfall over the step
  path(3.5, ['current', [m(75, 238, 9), m(40, 300, 14)]], { ease: 'inOut', label: 'waterfall' }),
  effect('waterfall'),
  wait(2.5),
  // The hollow filled to its rim
  frame([pt(P.hollow)], { from: 10, pitch: 30, margin: 90, glide: 2 }),
  { do: 'cursor', show: true },
  ...pick(tool('water', { label: 'fill' }), mode('fill')),
  clickMap(pt(P.hollow), { mods: { ctrl: true } }),
  ...idle(1.5),
  effect('lake'),
  { do: 'cursor', show: false },
  // Low over the lake against the light, then the bridge from the side
  path(5, ['current', [{ m: [-55, -215], habs: 9 }, { m: [-170, -130], habs: 0 }], [{ m: [-80, -240], habs: 7 }, { m: [-185, -130], habs: 0 }]], { ease: 'inOut', label: 'lake' }),
  path(3, ['current', [{ m: [-38, -36], habs: 7 }, { m: [-74, 0], habs: 1 }]], { ease: 'inOut', label: 'bridge' }),
  wait(1.5),
  ...total('b3-water'),
]);

const B4 = stage('b4-roads', 3, [
  ringOn,
  frame([pt(P.northRoad[0]), pt(P.northDown[1])], { from: 340, pitch: 42, margin: 10, pad: 1, glide: 2 }),
  ...pick(
    tool('landscape', { label: 'road' }),
    mode('road'),
    settings({ landscape: { road: { width: 6, kind: 'road', adapt: true, lamps: true, fences: false, snap: 12 } } }),
    { do: 'select', sel: 'select[aria-label=Surface]', value: 'gravel' },
  ),
  stroke(3, P.northRoad.map((p) => pt(p)), { settle: 0.3 }),
  ...idle(0.4),
  stroke(1.8, P.northDown.map((p) => pt(p)), { settle: 0.3 }),
  ...idle(0.8),
  effect('north road'),
  ...pick(tool('markers', { label: 'spawn' }), mode('spawn')),
  clickMap(pt(P.northRoad[0])),
  ...idle(0.3),
  // The routes from both spawns to the HQ
  settings({ paths: { showRoutes: true } }),
  frame([pt(P.northRoad[0]), { at: 'hq' }, { at: 'spawn:0' }], { from: 350, pitch: 55, margin: 10, pad: 1, glide: 1.4 }),
  wait(2),
  settings({ paths: { showRoutes: false } }),
  // The bend dragged east, rounded, widened
  frame([pt(P.northBend), pt(P.northBendTo), pt(P.northDown[1])], { from: 350, pitch: 40, margin: 30, pad: 1, glide: 1.6 }),
  ...pick(tool('paths', { label: 'edit road' }), mode('edit')),
  stroke(1.6, [pt(P.northBend), pt(P.northBendTo)], { settle: 0.3 }),
  ...idle(0.6),
  key('s'),
  ...idle(0.8),
  effect('bend'),
  clickMap(m((P.northBendTo.x + P.northDown[1].x) / 2, (P.northBendTo.y + P.northDown[1].y) / 2)),
  ...pick({ do: 'range', sel: 'app-editor-range[label=Width]', to: 8, dur: 0.6 }),
  ...idle(1),
  effect('width'),
  // The village stretch paved: the same picture before and after
  { do: 'cursor', show: false },
  path(2, ['current', [m(80, -40, 25), m(80, 0, 0)]], { ease: 'inOut' }),
  wait(1.5),
  { do: 'cursor', show: true },
  clickMap(pt(P.village), { label: 'surface' }),
  // Brick paving: the starter road without a surface already draws cobbles, a cobblestone surface hardly showed
  ...pick({ do: 'select', sel: '[data-test=road-surface]', value: 'brick-paving' }),
  ...idle(1.5),
  effect('paving'),
  key('Escape'),
  // The east road and its spawn
  // From the east looking in: from the south the map's edge filled half the picture
  frame([pt(P.eastRoad[0]), pt(P.eastRoad[P.eastRoad.length - 1])], { from: 80, pitch: 42, margin: 20, pad: 1, glide: 1.6 }),
  ...pick(tool('landscape'), mode('road', { label: 'east road' }), settings({ landscape: { road: { width: 8 } } })),
  stroke(2.4, P.eastRoad.map((p) => pt(p)), { settle: 0.3 }),
  ...idle(0.6),
  ...pick(tool('markers'), mode('spawn')),
  clickMap(pt(P.eastRoad[0])),
  ...idle(0.6),
  effect('east road'),
  ...total('b4-roads'),
]);

const biomeStroke = (id, line, brush, label, view) => [
  frame(line.map((p) => pt(p)), { pitch: 34, margin: brush.radius * 0.8, pad: 1, glide: 1.6, ...view }),
  ...pick(click(`[data-biome=${id}]`, label ? { label } : {}), settings({ brush: { ...brush, falloff: 0.5 } })),
  stroke(3, line.map((p) => pt(p)), { settle: 0.3 }),
  ...idle(2),
];

const B5 = stage('b5-biomes', 4, [
  ringOn,
  ...pick(tool('landscape', { label: 'biomes' }), mode('biome'), settings({ landscape: { seed: 21, reroll: true } })),
  ...biomeStroke('conifer', P.conifer[0], { radius: 110, strength: 0.8 }, 'conifer', { from: 10 }),
  ...biomeStroke('conifer', P.conifer[1], { radius: 110, strength: 0.8 }, null, { from: 350 }),
  effect('conifer'),
  ...biomeStroke('forest', P.forest, { radius: 70, strength: 0.7 }, 'forest', { from: 0 }),
  effect('forest'),
  ...biomeStroke('autumn', P.autumn, { radius: 60, strength: 0.9 }, 'autumn', { from: 20 }),
  effect('autumn'),
  ...biomeStroke('beach', P.beach, { radius: 40, strength: 1 }, 'beach', { from: 0 }),
  effect('beach'),
  ...biomeStroke('meadow', P.meadow, { radius: 150, strength: 0.6 }, 'meadow', { from: 20 }),
  effect('meadow'),
  ringOff,
  { do: 'cursor', show: false },
  // Over the autumn wood, down to the beach
  path(6, ['current', [m(40, -230, 22), m(-40, -150, 4)], [m(-60, -150, 18), m(-150, -90, 2)], [{ m: [-110, -110], habs: 8 }, { m: [-190, -70], habs: 1 }]], { ease: 'inOut', label: 'through the wood' }),
  wait(1),
  ...total('b5-biomes'),
]);

/** One building from the palette, set down: the camera on its place first */
const place = (asset, x, y, label) => [
  // From the street's north side, close: the houses face the street, from the south only their backs showed, small
  frame([m(x, y)], { from: 180, pitch: 26, margin: 16, pad: 1, glide: 0.9 }),
  ...pick({ do: 'type', sel: 'input[aria-label="Search assets"]', text: asset, cps: 400 }, click(`[data-asset=${asset}]`, label ? { label } : {})),
  clickMap(m(x, y)),
  ...idle(0.5),
];

/** Afternoon, the sun from the west */
const AFTERNOON = { sky: 'day', sunAzimuth: 219, sunElevation: 47, weather: 'clear' };
const search = (text) => ({ do: 'type', sel: 'input[aria-label="Search assets"]', text, cps: 400 });

const B6 = stage('b6-village', 5, [
  // Markers off while the houses go down: the route's dots lay big on the street in front of them
  ringOff,
  ...pick(tool('objects', { label: 'objects' }), mode('place'), settings({ objects: { randomRotation: false, alignToSlope: false } })),
  ...P.houses.flatMap(([asset, x, y], i) => place(asset, x, y, i === 0 ? 'houses' : null)),
  effect('houses'),
  ...place('chapel', P.chapel.x, P.chapel.y, 'chapel'),
  ...P.stalls.flatMap(([asset, x, y]) => place(asset, x, y)),
  effect('chapel'),
  ...place('windmill', P.windmill.x, P.windmill.y, 'windmill'),
  effect('windmill'),
  // The castle ring round the table: towers at the corners, battlements outward; the line's preview is a marker
  ringOn,
  frame([pt(P.table)], { from: 330, pitch: 26, margin: 80, pad: 1, glide: 1.6 }),
  ...pick(
    mode('line', { label: 'castle' }),
    search('castle wall'),
    click('[data-asset=castle-wall]'),
    settings({ objects: { line: { follow: 'free', corners: 'towers', front: 'right', spacing: 4, offset: 0, bothSides: false } } }),
  ),
  stroke(5, ring().map((p) => m(p.x, p.y)), { settle: 0.3 }),
  ...idle(1),
  effect('castle'),
  // The gate at the ramp, turned to face it
  ...pick(mode('place'), search('gatehouse'), click('[data-asset=castle-gate]')),
  clickMap(pt(P.gate)),
  ...idle(0.3),
  ...pick(mode('select'), clickMap(pt(P.gate)), { do: 'type', sel: '.op-grid input[step="5"]', text: '90', cps: 400 }),
  ...idle(0.6),
  key('Escape'),
  effect('gate'),
  // Torches inside the wall, lamps beside the street on both sides
  ...pick(mode('line', { label: 'torches' }), search('torch'), click('[data-asset=torch]'), settings({ objects: { line: { follow: 'free', spacing: 12 } } })),
  stroke(3, ring(46).map((p) => m(p.x, p.y)), { settle: 0.3 }),
  ...idle(0.6),
  frame([m(-20, 0), m(170, 0)], { from: 0, pitch: 30, margin: 10, pad: 1, glide: 1.4 }),
  ...pick(
    { ...search('lamp'), label: 'lamps' },
    click('[data-asset=lamp-post]'),
    click('[data-test=line-roads]'),
    settings({ objects: { line: { follow: 'roads', spacing: 16, offset: 5.5, bothSides: true, turn: 'along' } } }),
  ),
  clickMap(pt(P.village)),
  ...idle(0.8),
  effect('lamps'),
  ringOff,
  { do: 'cursor', show: false },
  // Down the street, then out to the castle on its table
  path(6, ['current', [m(-40, -12, 10), m(80, -6, 6)], [m(170, -30, 18), m(300, -10, 22)]], { ease: 'inOut', label: 'street' }),
  wait(1),
  ...total('b6-village'),
], AFTERNOON);

const outline = (points) => [...points.map((p) => clickMap(p, { dur: 0.35 })), key('Enter'), ...idle(0.4)];
const drawMode = (name) => click('[aria-label="Click draws"] button', { withText: name });

/**
 * Round 5 (FEEDBACK_R4 B10): the gizmo on one object of the finished village. The windmill picked, moved up the
 * hill with the move handle, turned half round with the ring, scaled up with the cube; each mode picked with the UI,
 * the drag without it (the gizmo is in the world, it stays). Starts on F-B6, changes nothing the later stages see
 */
const MILL = P.windmill;
const MOVED = { x: MILL.x - 13, y: MILL.y + 18 };
const around = (c, r, from, to, n = 7) => Array.from({ length: n }, (_, i) => {
  const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
  return m(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
});
const gizmoMode = (name) => click('[aria-label="Drag does"] button', { withText: name, label: `gizmo ${name.toLowerCase()}` });
const B6G = stage('b6-gizmo', 6, [
  ringOn,
  frame([m(MILL.x, MILL.y), m(MOVED.x, MOVED.y)], { from: 200, pitch: 28, margin: 26, pad: 1, glide: 1.4 }),
  ...pick(tool('objects', { label: 'objects' }), mode('select')),
  // A click on the mill: selected, the gizmo over it
  clickMap(m(MILL.x, MILL.y, 6), { label: 'select' }),
  ...idle(1),
  ...pick(gizmoMode('Move')),
  stroke(1.6, [m(MILL.x, MILL.y), m(MOVED.x, MOVED.y)], { settle: 0.3 }),
  ...idle(0.8),
  effect('gizmo move'),
  ...pick(gizmoMode('Turn')),
  stroke(1.8, around(MOVED, 8, 0, 160), { settle: 0.3 }),
  ...idle(0.8),
  effect('gizmo turn'),
  ...pick(gizmoMode('Scale')),
  stroke(1.4, [m(MOVED.x + 7, MOVED.y), m(MOVED.x + 11.5, MOVED.y)], { settle: 0.3 }),
  ...idle(0.8),
  effect('gizmo scale'),
  // The result without the gizmo: deselected, turning round the mill
  key('Escape'),
  ringOff,
  { do: 'cursor', show: false },
  frame([m(MOVED.x, MOVED.y)], { from: 200, pitch: 22, margin: 22, pad: 1, turn: 25, dur: 4, glide: 0.4, label: 'result' }),
], AFTERNOON);

const B7 = stage('b7-life', 6, [
  ringOn,
  frame([pt(P.hollow)], { from: 10, pitch: 40, margin: 80, pad: 1, glide: 1.6 }),
  ...pick(tool('life', { label: 'life' }), drawMode('Outline'), click('[data-kind=boats]')),
  ...outline(P.lake.map((p) => pt(p))),
  ...pick({ do: 'select', sel: '[data-test=life-boat]', value: 'fishing-boat', label: 'boat' }),
  frame([m(-400, 40), m(-200, 220)], { from: 10, pitch: 40, margin: 10, pad: 1, glide: 1.4 }),
  ...pick(click('[data-kind=birds]', { label: 'birds' })),
  ...outline([m(-400, 40), m(-200, 40), m(-200, 220), m(-400, 220)]),
  ...pick(click('[data-kind=fog]', { label: 'fog' })),
  ...outline([m(-420, -60), m(-220, -60), m(-220, 200), m(-420, 200)]),
  frame([m(40, 200), m(140, 300)], { from: 0, pitch: 34, margin: 20, pad: 1, glide: 1.2 }),
  ...pick(drawMode('Line'), click('[data-kind=fireflies]', { label: 'fireflies' })),
  ...outline([m(40, 200), m(80, 250), m(140, 300)]),
  // The herd on the pasture east of the hill, and its bells
  frame(P.pasture.map((p) => pt(p)), { from: 0, pitch: 34, margin: 20, pad: 1, glide: 1.4 }),
  ...pick(
    tool('objects', { label: 'herd' }),
    mode('scatter'),
    search('cow'),
    click('[data-asset=cow]'),
    click('[data-asset=cow-grazing]', { mods: { shift: true } }),
    settings({ brush: { radius: 30, strength: 1 }, objects: { scatter: { density: 1.2 } } }),
  ),
  stroke(2, P.pasture.map((p) => pt(p))),
  ...idle(0.6),
  ...pick(tool('life'), drawMode('Outline'), click('[data-kind=sound]', { label: 'bells' })),
  ...outline(P.pasture.map((p) => pt(p))),
  ...pick({ do: 'select', sel: '[data-test=life-sound]', value: 'cowbells' }, click('[data-test=auto-birds]')),
  ...idle(0.6),
  ringOff,
  { do: 'cursor', show: false },
  // Low over the lake to the boat, then the herd: cuts, the flights between went through the castle and a rock
  ...cut([{ m: [-130, -200], habs: 14 }, { m: [-150, -150], habs: 0 }]),
  path(5, ['current', [{ m: [-170, -195], habs: 10 }, { m: [-148, -148], habs: 0 }]], { ease: 'inOut', label: 'effect:boat' }),
  ...cut([m(300, 92, 4), m(340, 145, 1)]),
  path(4, ['current', [m(322, 90, 4), m(345, 150, 1)]], { ease: 'inOut', label: 'effect:herd' }),
  ...total('b7-life'),
], AFTERNOON);

/** A time of day as the Sky panel's slider sets it (world/custom-map/time-of-day.ts) */
function timeOfDay(hour) {
  const f = (hour - 6) / 14;
  const elevation = 60 * Math.sin(Math.PI * f);
  const azimuth = (((90 + 180 * f) % 360) + 360) % 360;
  const sky = elevation < -6 ? 'night' : elevation < 15 ? 'dusk' : 'day';
  return { sunAzimuth: Math.round(azimuth), sunElevation: Math.round(Math.max(2, elevation)), sky };
}

/** An environment change over `seconds`, a step every quarter second, as a dragged slider does */
function tween(seconds, at, label) {
  const n = Math.round(seconds * 4);
  const steps = Array.from({ length: n + 1 }, (_, i) => [act('environment', { patch: at(i / n) }), wait(0.25)]).flat();
  return label ? [...steps, effect(label)] : steps;
}

/** Over the lake and the village to the mountains, the camera at rest */
const SKY_VIEW = [m(-170, -360, 45), m(20, 150, 50)];
const WOOD_VIEW = [m(30, 110, 10), m(100, 260, 14)];

/** Morning: the sun up far enough for daylight (6:00 is dusk, the fog would read orange) */
const MORNING = 7.5;

const B8 = stage('b8-sky', 7, [
  { do: 'cursor', show: false },
  path(2, ['current', SKY_VIEW], { ease: 'inOut' }),
  ...idle(2),
  mark('morning fog'),
  // The fog lifts, then the sun climbs
  ...tween(6, (k) => ({ weatherStrength: Math.max(0.02, 1 - k) }), 'fog lifts'),
  act('environment', { patch: { weather: 'clear' } }),
  ...tween(6, (k) => timeOfDay(MORNING + 3 * k), 'sunrise'),
  wait(1.5),
  // Rain under a closed sky
  act('environment', { patch: { sky: 'overcast', weather: 'rain', weatherStrength: 1 } }),
  ...idle(2.5),
  effect('rain'),
  // Gusts over the wood
  path(1.6, ['current', WOOD_VIEW], { ease: 'inOut' }),
  wait(0.6),
  act('environment', { patch: { wind: { strength: 0.9, gusts: 0.8, direction: 240 } } }),
  wait(5),
  effect('gusts'),
  // Clear again, and a time lapse into the night: lamps, windows and torches come on
  act('environment', { patch: { ...timeOfDay(15), weather: 'clear', wind: { strength: 0.3, gusts: 0.3, direction: 240 } } }),
  path(1.6, ['current', SKY_VIEW], { ease: 'inOut' }),
  ...idle(1.5),
  ...tween(12, (k) => timeOfDay(15 + 7 * k), 'night'),
  wait(1.5),
  orbit(5, { m: [70, 0] }, { from: 340, to: 358, radius: 260, height: 70, ease: 'inOut', label: 'effect:lights' }),
  wait(1),
], { ...SUN, ...timeOfDay(MORNING), weather: 'fog', weatherStrength: 1, moonlight: 0.6 }, [
  // Before the picture counts: night, rain and fog once, so their shaders are warm; then the morning fog
  act('environment', { patch: { sky: 'night', weather: 'rain', weatherStrength: 1 } }),
  wait(1.5),
  act('environment', { patch: { sky: 'overcast', weather: 'snow', weatherStrength: 1 } }),
  wait(1.5),
  act('environment', { patch: { ...timeOfDay(MORNING), weather: 'fog', weatherStrength: 1, moonlight: 0.6 } }),
  wait(1),
]);

/** Evening of the game's start (F-B8): 17:30 */
const EVENING = { ...timeOfDay(17.5), weather: 'clear' };

const B9 = stage('b9-rules', 8, [
  { do: 'ui', on: true },
  key('v'),
  wait(2),
  effect('check'),
  // The check's list closed again: it stayed over the picture to the end
  click('[aria-label="Close the check"]'),
  wait(0.3),
  // The build areas are an overlay in the world: on with the markers while they show
  ringOn,
  ...pick(tool('measure', { label: 'build areas' }), click('[data-test=build-areas]')),
  frame([m(-140, 0), pt(P.table)], { from: 0, pitch: 50, margin: 40, pad: 1, glide: 1.4 }),
  wait(2),
  effect('build areas'),
  ...pick(click('[data-test=build-areas]')),
  ringOff,
  // The map's own intro flight: an orbit round the HQ, previewed
  frame([{ at: 'hq' }], { from: 200, pitch: 25, margin: 200, pad: 1, glide: 1.4 }),
  ...pick(
    tool('settings', { label: 'intro flight' }),
    click('[data-test=intro-orbit]'),
    { do: 'range', sel: 'app-editor-range[label=Turn]', to: 360, dur: 0.6 },
    { do: 'range', sel: 'app-editor-range[label=Length]', to: 10, dur: 0.6 },
  ),
  { do: 'ui', on: true },
  click('[data-test=intro-preview]', { label: 'preview' }),
  { do: 'ui', on: false },
  { do: 'cursor', show: false },
  wait(10.5),
  effect('intro'),
  ...total('b9-rules'),
], EVENING);

const B10 = stage('b10-trial', 9, [
  { do: 'ui', on: true },
  click('[data-test=trial]', { label: 'trial' }),
  { do: 'ui', on: false },
  { do: 'cursor', show: false },
  act('trialSpeed', { value: 2 }),
  path(2, ['current', [m(-160, -40, 30), m(-90, 0, 0)]], { ease: 'inOut' }),
  // Behind a runner over the bridge and on to the ramp
  // Behind a stone golem (round 5: not the zombie, the weakest model), a step further back for its size
  { do: 'follow', at: { at: 'runner:stone-golem' }, dur: 12, back: 11, side: 4, h: 4.5, label: 'effect:runner' },
  { do: 'ui', on: true },
  { do: 'cursor', show: true },
  click('[data-test=test-play]', { label: 'test map' }),
  wait(3),
], EVENING, [
  // The trial walks the first wave of the map's own list: golems and zombies (the default list has no golem)
  act('script', {
    source: `map.gameplay({ events: [{ wave: 7, kind: 'time', hour: 21 }, { wave: 9, kind: 'weather', weather: 'rain', strength: 1 }, { wave: 10, kind: 'weather', weather: 'clear' }, { wave: 12, kind: 'time', hour: 21 }], waves: { kind: 'table', table: { cycle: { fromWave: 1, hpGrowth: 1.2 }, waves: [{ wave: 1, name: 'Golems', enemies: { 'stone-golem': 4, zombie: 8 }, hpMult: 1, spawnDelay: 1500 }] } } }); return 'ok';`,
  }),
]);

/** The wide shot of every stage, the sun the same: the build-up as one series (the cut lays them end to end) */
const TOTALS = Array.from({ length: 10 }, (_, n) => ({
  name: `bt-${n}`,
  start: { editor: FIX(n) },
  env: { ...WINDOW, sky: SUN, camera: TOTAL, ui: false, markers: false, seed: 7 },
  steps: [mark(`total:stage ${n}`), wait(3)],
}));

export const SCENES = [B0, B1, B2, B3, B4, B5, B6, B6G, B7, B8, B9, B10, ...TOTALS];
export const FIXTURES = [];
