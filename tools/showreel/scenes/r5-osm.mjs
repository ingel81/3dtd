// Round 5, K1 "Your address as a map" in quick succession (tmp/showreel/FEEDBACK_R4.md B2): three more places, each
// an address typed into the OpenStreetMap world's menu, its frame, Make the map, then a short flight over the world
// it made. Each place's network is a recording (fixtures/osm-<place>.har.zip, net-fixture.mjs record, once against
// the real servers) and its world a map fixture made from that recording (net-fixture.mjs check --keep), so a take
// never asks a server.
//
// Coordinates in the flights: map metres round the HQ (x east, y north), read off each fixture's world.
import { click, m, path, sky, wait, act } from './common.mjs';

/** The places: address as pasted, the flight's keyframes ([eye, look] pairs) and their seconds */
export const PLACES = [
  {
    id: 'cochem',
    address: 'Endertplatz, Cochem',
    // Up the Mosel from its southern bend toward the old town and its bridge; then the Reichsburg on its hill
    fly: [
      { dur: 6, keys: [[m(230, -760, 30), m(60, -150, 10)], [m(190, -450, 26), m(60, 20, 10)]] },
      { dur: 5, keys: [[m(-70, -620, 50), m(30, -530, 22)], [m(-30, -690, 46), m(30, -530, 22)]] },
    ],
  },
  {
    // Not Lindau: the Bodensee, cut by the square, came out as meadow (reported to the lead, 2026-10-17)
    id: 'rothenburg',
    address: 'Marktplatz 1, Rothenburg ob der Tauber',
    // Over the Tauber valley toward the walled old town on its plateau; then low over its roofs
    fly: [
      { dur: 6, keys: [[m(-560, 40, 170), m(-60, 140, 0)], [m(-430, 80, 150), m(40, 160, 0)]] },
      { dur: 5, keys: [[m(0, -150, 38), m(50, 150, 8)], [m(30, 0, 34), m(70, 300, 8)]] },
    ],
  },
  {
    id: 'hallstatt',
    address: 'Marktplatz 1, Hallstatt',
    // Across the lake from the south-east toward the village under its mountains, then along its shore (the
    // lake's cut corners and the map's southern edge behind the camera)
    fly: [
      { dur: 6, keys: [[m(300, -900, 50), m(-100, -420, 40)], [m(250, -700, 42), m(-120, -300, 35)]] },
      { dur: 5, keys: [[m(180, -300, 18), m(-30, -250, 15)], [m(160, -120, 18), m(-30, -60, 15)]] },
    ],
  },
];

const net = (p) => `fixtures/osm-${p.id}.har.zip`;
const world = (p) => `fixtures/osm-${p.id}.3dtdmap`;

/** Address, frame, Make the map, made: the quick version of osm-make, without dragging a spawn */
const makeScene = (p) => ({
  name: `osm-${p.id}-make`,
  start: { menu: true },
  net: net(p),
  env: { window: '2048x1152', dpr: 1.25, globe: 'high' },
  steps: [
    { do: 'mark', name: 'globes' },
    wait(0.5),
    click('[data-world=osm]', { dur: 0.6, label: 'osm world' }),
    { do: 'waitFor', sel: 'app-world-osm app-td-address-autocomplete input', timeout: 15 },
    wait(0.8),
    { do: 'type', sel: 'app-world-osm app-td-address-autocomplete input', text: p.address, cps: 100000, label: 'address' },
    { do: 'waitFor', sel: 'app-td-address-autocomplete .result-item', timeout: 15 },
    wait(0.4),
    click('app-td-address-autocomplete .result-item'),
    { do: 'waitFor', sel: '[data-test=osm-spawns]', timeout: 90 },
    { ...wait(1.8), label: 'effect:frame' },
    click('[data-test=osm-make]', { label: 'make' }),
    { do: 'waitFor', sel: '[data-test=osm-made]', timeout: 180 },
    { ...wait(1.6), label: 'effect:made' },
  ],
});

/** The world it made, flown over in the afternoon light, HUD out; wave 1 runs for the game's sound */
const flyScene = (p) => ({
  name: `osm-${p.id}-fly`,
  start: { game: world(p) },
  noIntro: true,
  env: { window: '2048x1152', dpr: 1.25, ui: false, markers: false, routes: false, healthBars: false },
  warm: [{ do: 'ui', on: true }, act('wave', { label: 'wave 1' }), { do: 'cursor', show: false }, { do: 'ui', on: false }, { do: 'markers', on: false }, act('routes', { on: false }), act('healthBars', { on: false }), sky(null, 'day', 30, { sunAzimuth: 225 })],
  steps: [{ do: 'mark', name: p.id }, ...p.fly.map((f, i) => path(f.dur, f.keys, { ease: 'inOut', label: i === 0 ? `effect:${p.id}` : `effect:${p.id} ${i + 1}` })), wait(0.6)],
});

export const SCENES = PLACES.flatMap((p) => [makeScene(p), flyScene(p)]);
