// Round 4, K1 "Your address as a map" (tmp/showreel/DREHBUCH_R4.md 2.3): an OSM world made from an address in the
// menu, then flown over in the game. The network comes from a recording (fixtures/osm-miltenberg.har.zip, made by
// net-fixture.mjs): Nominatim, Overpass, the Mapterhorn heights and the OpenFreeMap tiles of the frame, so the take
// never waits on a server (Overpass was down on 2026-10-16).
//
// The place: Am Thorwengert 6, Miltenberg (the HQ there; the Altstadt, the Main with the Martinsbrücke, the road
// tunnel north of it and the railway lie in the 2.4 km square). Spawn 1, the one open in wave 1, is dragged onto
// the road beyond the tunnel's north-west portal, so the first wave walks through the tunnel and over the bridge.
// Coordinates in the game: map metres round the HQ (x east, y north); the tunnel runs from (-833, 973) to
// (-526, 798), the bridge from (-468, 759) to (-175, 540), the tracks at y 300 to 400 west of x -700.
import { act, click, m, path, sky, wait } from './common.mjs';

/** The address as pasted, all in one frame (the autocomplete asks once, for the whole line, which the HAR has) */
const ADDRESS = 'Am Thorwengert 6, Miltenberg';

/** The Main's surface in map metres (the river's water body): heights over it are given from it */
const MAIN = 0.64;

/** The network of both scenes: the recorded answers; anything else off the dev server is refused */
const NET = 'fixtures/osm-miltenberg.har.zip';

export const SCENES = [
  {
    name: 'osm-make',
    // Today's way in (K0's globe menu hands over later, wt/e195-p6): the pause menu over a map, New game, Real places
    page: '/?world=map:demo-valley',
    noIntro: true,
    net: NET,
    env: { window: '2048x1152', dpr: 1.25 },
    leave: '[data-test=osm-play]',
    steps: [
      // The menu, then the HUD out behind it (photo mode)
      click('.sb-menu', { dur: 0.01 }),
      { do: 'ui', on: false },
      wait(0.6),
      click('app-main-menu button', { withText: 'New game', label: 'new game' }),
      wait(0.3),
      click('app-main-menu [role=tab]', { withText: 'Real places' }),
      wait(0.3),
      { do: 'type', sel: 'app-main-menu app-td-address-autocomplete input', text: ADDRESS, cps: 100000, label: 'address' },
      { do: 'waitFor', sel: 'app-td-address-autocomplete .result-item', timeout: 15 },
      wait(0.5),
      click('app-td-address-autocomplete .result-item'),
      // The frame: the place's data, then its flat map with the HQ, the square and four spawns with their routes
      { do: 'waitFor', sel: '[data-test=osm-spawns]', timeout: 90 },
      { ...wait(2.5), label: 'effect:frame' },
      // Spawn 1 onto the road beyond the tunnel: it snaps onto the street, its route runs through the tunnel
      act('osmDrag', { spawn: 0, to: [-960, 1026], dur: 1.8, hold: 0.4, label: 'drag spawn' }),
      { ...wait(1.6), label: 'effect:spawn' },
      click('[data-test=osm-make]', { label: 'make' }),
      { do: 'waitFor', sel: '[data-test=osm-made]', timeout: 180 },
      { ...wait(2), label: 'effect:made' },
    ],
    arrives: '/?world=map:osm-am-thorwengert-6',
  },
  {
    name: 'osm-fly',
    // The world osm-make made, as a file (made by the take of osm-make, saved from the map store); with the old
    // runner it follows osm-make on the page its Play button opens
    start: { game: 'fixtures/osm-miltenberg.3dtdmap' },
    noIntro: true,
    env: { window: '2048x1152', dpr: 1.25, ui: false, markers: false, routes: false, healthBars: false },
    steps: [
      // Wave 1 by its button (the HUD on for the click), then the frame clean
      { do: 'ui', on: true },
      act('wave', { label: 'wave 1' }),
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      act('healthBars', { on: false }),
      // Dusk, the sun low in the west: the street lamps on
      sky(null, 'dusk', 12, { sunAzimuth: 255 }),
      { do: 'mark', name: 'Miltenberg' },
      // (1) Low over the Main toward the Altstadt on its south bank, 20 to 26 m over the water
      path(7, [[{ m: [-520, 210], habs: MAIN + 26 }, m(-690, -350, 5)], [{ m: [-640, -40], habs: MAIN + 20 }, m(-730, -420, 8)]], { ease: 'inOut', label: 'effect:river' }),
      // (2) The first enemies from the north-west spawn pass the camera and walk into the tunnel's concrete mouth
      // 40 m ahead, the camera 20 m beside the road; it starts once the first is level with the camera (a fixed
      // wait would run off: the simulation's pace under load is not the clock's)
      act('enemiesNear', { at: m(-885, 992), radius: 8, timeout: 90 }),
      path(12, [[m(-888, 972, 5), m(-848, 976, 3)], [m(-874, 968, 4.5), m(-845, 974, 3)]], { ease: 'inOut', label: 'effect:tunnel in' }),
      // Off camera at four times the pace until the first is 8 m short of the other mouth
      act('speed', { value: 4 }),
      act('enemiesNear', { at: m(-546, 804), radius: 6, timeout: 120 }),
      act('speed', { value: 1 }),
      // (3) Out of the other mouth, held on it
      path(10, [[m(-505, 778, 10), m(-537, 798, 4)], [m(-500, 782, 10), m(-535, 797, 4)]], { ease: 'inOut', label: 'effect:tunnel out' }),
      // Onto the concrete Martinsbrücke, seen from over the Main 22 m beside it, 10 m over the water
      act('enemiesNear', { at: m(-445, 733), radius: 40, timeout: 30 }),
      path(8, [[{ m: [-378, 652], habs: MAIN + 10 }, { m: [-385, 695], habs: 16 }], [{ m: [-342, 625], habs: MAIN + 11 }, { m: [-335, 655], habs: 13 }]], { ease: 'inOut', label: 'effect:bridge' }),
      // (4) The railway on the west bank north of the bridge, the Main beside it
      path(7, [[m(-455, 795, 12), m(-395, 950, 0)], [m(-440, 860, 12), m(-375, 1040, 0)]], { ease: 'inOut', label: 'effect:rails' }),
      wait(1),
    ],
  },
];
