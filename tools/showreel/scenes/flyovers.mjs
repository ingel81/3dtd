// The shipped maps: low, fast, sweeping fly-overs, clean frames.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

/**
 * A fly-over that opens with the game's own intro flight, whole: the page loads with the HUD hidden (an intro
 * page, see run.mjs openPage), the sound and the flash come while the map loads, the flight shows the lanes, the
 * HQ and the spawns; once it has landed the frame goes clean (photo mode, no route lines and markers) and the
 * shots follow
 */
const introFlyover = (name, map, label, shots) => ({
  name,
  page: `/?world=map:${map}`,
  intro: true,
  steps: [
    { do: 'mark', name: `${label} intro` },
    act('intro', { label: 'intro flight' }),
    { do: 'ui', on: false },
    { do: 'markers', on: false },
    act('routes', { on: false }),
    { do: 'mark', name: label },
    ...shots,
  ],
});

export const SCENES = [
  flyover('harbor-flyover', 'harbor-town', 'Harbor Town', [
    sky('starry-night', 'night', 30, { moonlight: 0.7 }),
    path(6.5, [[m(-235, -205, 10), m(-150, -165, 4)], [m(-70, -205, 14), m(0, -130, 8)]], { label: 'harbor quay', ease: 'inOut' }),
    path(6.5, [[m(30, -70, 35), m(0, 40, 0)], [m(-70, 115, 95), m(10, 30, 0)]], { label: 'harbor city', ease: 'inOut' }),
  ]),
  introFlyover('mountain-flyover', 'mountain-pass', 'Mountain Pass', [
    sky('sunset', 'dusk', 6),
    path(6.5, [[m(245, -70, 30), m(160, 5, 32)], [m(205, 48, 42), m(150, 18, 15)]], { label: 'waterfall', ease: 'inOut' }),
    path(6.5, [[m(-30, -40, 70), m(-139, -67, 45)], [m(-70, -175, 55), m(-139, -60, 45)]], { label: 'cable car', ease: 'inOut' }),
  ]),
  flyover('archipelago-flyover', 'archipelago', 'Archipelago', [
    sky('fair-weather', 'day', 45),
    path(6, [[m(20, -215, 8), m(70, -135, 3)], [m(120, -175, 16), m(68, -125, 4)]], { label: 'harbour', ease: 'inOut' }),
    // Round the lighthouse at a distance: the line through (255, 135) passed through the tower
    path(6.5, [[m(140, 0, 40), m(205, 78, 15)], [m(275, 50, 42), m(205, 80, 15)]], { label: 'lighthouse', ease: 'inOut' }),
  ]),
  flyover('ember-flyover', 'ember-crater', 'Ember Crater', [
    orbit(6.5, { at: 'hq' }, { from: 20, to: 95, radius: 120, radiusTo: 80, height: 55, heightTo: 28, label: 'crater', ease: 'inOut' }),
    path(6, ['current', [m(120, 120, 40), m(45, 65, 8)], [m(-30, 115, 30), m(10, 30, 5)]], { label: 'hell gate', ease: 'inOut' }),
  ]),
  introFlyover('autumn-flyover', 'autumn-keep', 'Autumn Keep', [
    // The low sun from the north-west, behind the orbit's camera: the keep lit, not a silhouette against it
    sky('afterglow', 'dusk', 15, { sunAzimuth: 330 }),
    orbit(6.5, { at: 'hq', dy: 12 }, { from: 140, to: 230, radius: 80, radiusTo: 60, height: 32, heightTo: 20, label: 'keep', ease: 'inOut' }),
    path(6, ['current', [m(-130, -40, 22), m(0, 60, 10)], [m(-45, -10, 85), m(0, 70, 0)]], { label: 'woods', ease: 'inOut' }),
  ]),
  // A meadow up close: a metre over the ground through grass and flowers, a breeze in the blades, afternoon sun
  // from the west. The look goes down to the ground some 15 m ahead: the blades grow round that focus
  flyover('meadow-closeup', 'demo-valley', 'Meadow', [
    sky('fair-weather', 'day', 20, { sunAzimuth: 285, tint: '#fff0dc', wind: { strength: 0.6, direction: 250, gusts: 0.7 } }),
    path(7, [[m(-127, -157, 0.9), m(-118, -144, 0)], [m(-119, -146, 1.1), m(-110, -133, 0)]], { label: 'meadow', ease: 'inOut' }),
  ]),
  introFlyover('frost-flyover', 'frost-hamlet', 'Frost Hamlet', [
    act('environment', { patch: { weather: 'snow', weatherStrength: 0.9 }, label: 'snowfall' }),
    path(6.5, [[m(0, -150, 22), m(10, 40, 0)], [m(10, 40, 30), m(20, 160, 5)]], { label: 'frozen lake', ease: 'inOut' }),
    orbit(6, { at: 'hq' }, { from: 160, to: 240, radius: 70, height: 40, heightTo: 26, label: 'hamlet', ease: 'inOut' }),
  ]),
  flyover('moon-flyover', 'moon-base', 'Moon Base', [
    sky('deep-space', 'night', 25, { moonlight: 0.8 }),
    path(6, [[m(-130, -170, 12), m(20, -90, 3)], [m(70, -130, 18), m(30, -25, 5)]], { label: 'landing pad', ease: 'inOut' }),
    orbit(6, { at: 'hq' }, { from: 200, to: 290, radius: 75, radiusTo: 55, height: 35, heightTo: 22, label: 'moon base', ease: 'inOut' }),
  ]),
  flyover('mars-flyover', 'mars-canyon', 'Mars Canyon', [
    path(6, [[m(-70, -235, 20), m(20, -130, 5)], [m(100, -225, 24), m(30, -130, 5)]], { label: 'mars base', ease: 'inOut' }),
    orbit(6, { at: 'hq' }, { from: 0, to: 90, radius: 65, radiusTo: 50, height: 34, heightTo: 26, label: 'greenhouse', ease: 'inOut' }),
  ]),
];
