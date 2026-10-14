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
      // The fly-over's cable car shot, slow: from the east over the valley round to the south, the peak by the
      // cable car against the low sun
      path(20, [[m(10, -25, 80), m(-139, -15, 60)], [m(-40, -110, 65), m(-139, -40, 52)], [m(-80, -190, 60), m(-139, -55, 48)]], { ease: 'smooth', label: 'dusk orbit' }),
      { do: 'fade', to: 1, dur: 2, label: 'fade out' },
      wait(0.5),
    ],
  },
];
