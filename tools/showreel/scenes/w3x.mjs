// A Warcraft 3 map imported: the file onto the map list, the report, the map opened and flown over. The file is
// read from the main checkout's tmp/wc3 (not in the repo); --w3x <path> in the runner is not needed, the step
// names the path.
import { act, click, orbit, path, wait } from './common.mjs';

export const W3X_FILE = 'D:/Source/3dtd/tmp/wc3/Mafa-Td-Queen-v14.6.w3x';

export const SCENES = [
  {
    name: 'w3x-import',
    page: '/editor',
    steps: [
      { do: 'mark', name: 'Warcraft 3 import' },
      wait(0.5),
      { do: 'move', to: 'label:has(input[data-test=import-input]), button:has(+ input[data-test=import-input])', dur: 0.5, label: 'import' },
      { do: 'upload', sel: '[data-test=import-input]', file: W3X_FILE },
      click('[data-test=w3x-import]', { timeout: 10 }),
      { do: 'waitFor', sel: '[data-test=open-imported]', timeout: 60 },
      { do: 'wait', dur: 2, label: 'report' },
      click('[data-test=open-imported]'),
      act('viewReady', { timeout: 90 }),
      path(6, ['current', [[0.35, -0.6, 140], [0.0, -0.05]], [[-0.3, -0.5, 110], [0.0, 0.05]]], { ease: 'inOut', label: 'imported map' }),
      orbit(6, { at: 'hq' }, { from: 200, to: 260, radius: 120, height: 60, ease: 'inOut' }),
    ],
  },
];
