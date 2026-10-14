// The close.
import { act, asset, clickMap, click, flyover, m, mode, newMap, orbit, par, path, seq, settings, sky, stroke, tool, wait } from './common.mjs';

export const SCENES = [
  {
    name: 'finale-dusk',
    page: '/?world=map:mountain-pass',
    steps: [
      { do: 'ui', on: false },
      { do: 'markers', on: false },
      act('routes', { on: false }),
      sky('sunset', 'dusk', 8, { sunAzimuth: 250 }),
      { do: 'mark', name: 'Finale' },
      // Against the low sun (west-south-west): from the east over the waterfall side, high enough that the map's
      // edge stays under the horizon, turning 50 degrees
      orbit(20, m(30, -20), { from: 88, to: 138, radius: 190, radiusTo: 160, height: 170, heightTo: 140, ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
