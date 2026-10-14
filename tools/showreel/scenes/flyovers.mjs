// The shipped maps: low, fast, sweeping fly-overs, clean frames.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

export const SCENES = [
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
];
