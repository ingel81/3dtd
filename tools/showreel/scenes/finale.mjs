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
      orbit(20, { at: 'hq' }, { from: 145, to: 190, radius: 240, radiusTo: 190, height: 90, heightTo: 120, ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
