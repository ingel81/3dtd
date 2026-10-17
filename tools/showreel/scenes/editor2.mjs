// The editor, map 2: Fire and Ice.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

/** The Sky panel's weather buttons ('Snow' alone also finds other fields) */
const WEATHER = '[aria-label=Weather] button[role=radio]';

export const SCENES = [
  // Level ground (the lava craters' rims leaked on noisy ground), frozen instead of the form's green grass
  { name: 'editor2-new', page: '/editor', steps: [{ do: 'mark', name: 'Fire and Ice' }, ...newMap('Fire and Ice', 'second map', 'flat', 'Frozen ground')] },
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
      // Snow, not Arctic: Arctic takes five ground layers and Hell after it found the map's twelve full
      click('[data-biome=snow]', { label: 'snow' }),
      settings({ brush: { radius: 70, strength: 1 } }),
      // Each biome painted with the camera at rest and held until it stands (it showed some 2 s late)
      act('idle', { timeout: 20 }),
      wait(0.4),
      stroke(3, [[-0.35, 0.3], [-0.1, 0.36], [0.15, 0.36], [0.35, 0.3]]),
      act('idle', { timeout: 30 }),
      wait(2.2),
      { do: 'mark', name: 'effect:snow' },
      { do: 'frame', points: [[-0.3, -0.3], [0.3, -0.28]], from: 180, pitch: 32, margin: 40 },
      click('[data-biome=hell]', { label: 'hell' }),
      act('idle', { timeout: 20 }),
      wait(0.4),
      stroke(4, [[-0.3, -0.3], [-0.1, -0.34], [0.1, -0.33], [0.3, -0.28]]),
      act('idle', { timeout: 30 }),
      wait(2.4),
      { do: 'mark', name: 'effect:hell' },
      path(1.5, ['current', [[-0.05, 0.05, 25], [0.0, 0.32, 30]]]),
      tool('environment'),
      click(WEATHER, { withText: 'Snow', label: 'snowfall' }),
      wait(3),
      { do: 'mark', name: 'effect:snowfall' },
      // Clear again: the snow cover whitened the whole map, the symmetry from above read as white on white
      click(WEATHER, { withText: 'Clear' }),
      { do: 'range', sel: 'app-editor-range[label="Snow cover"]', to: 0, dur: 0.6 },
      wait(0.8),
    ],
  },
  {
    name: 'editor2-lava',
    // A volcano behind the hell ground, three craters on it, each filled with its own lava to its rim
    steps: [
      { do: 'frame', points: [[0.42, -0.26], [0.16, -0.42]], from: 0, pitch: 35, margin: 50, glide: 2 },
      tool('landscape'),
      mode('mountain', { label: 'volcano' }),
      settings({ brush: { radius: 70, strength: 1 }, landscape: { seed: 61 } }),
      stroke(3.5, [[0.42, -0.26], [0.43, -0.26]]),
      { do: 'frame', points: [[0.04, -0.42], [0.28, -0.42], [0.42, -0.26]], from: 0, pitch: 42, margin: 15 },
      mode('crater', { label: 'craters' }),
      // On the hell ground's south edge: the rims hold there (a table under them stood as a cliff wall)
      settings({ brush: { radius: 30, strength: 1 } }),
      stroke(1.6, [[0.04, -0.42], [0.04, -0.42]]),
      stroke(1.6, [[0.16, -0.43], [0.16, -0.43]]),
      stroke(1.6, [[0.28, -0.42], [0.28, -0.42]]),
      // Each crater its own lava body, filled to its rim (Ctrl)
      tool('water'),
      mode('fill'),
      click('button', { withText: 'Add lava', label: 'lava' }),
      clickMap([0.04, -0.42], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([0.16, -0.43], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      click('button', { withText: 'Add lava' }),
      clickMap([0.28, -0.42], { mods: { ctrl: true } }),
      act('idle', { timeout: 30 }),
      // Low over the lava toward the volcano, the editor's frame out of the picture
      { do: 'ui', on: false },
      act('overlay', { on: false }),
      path(7, ['current', [[0.16, -0.62, 28], [0.16, -0.42]], [[0.32, -0.6, 26], [0.38, -0.3, 10]]], { ease: 'inOut', label: 'effect:lava' }),
    ],
  },
];
