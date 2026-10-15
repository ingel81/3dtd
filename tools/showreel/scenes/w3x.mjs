// A Warcraft 3 map imported, slow enough to read: the file onto the map list, the report held, the map opened
// and flown over calmly. The file is read from the main checkout's tmp/wc3 (not in the repo).
import { act, click, orbit, path, wait } from './common.mjs';

export const W3X_FILE = 'D:/Source/3dtd/tmp/wc3/Mafa-Td-Queen-v14.6.w3x';

export const SCENES = [
  {
    name: 'w3x-import',
    page: '/editor',
    steps: [
      { do: 'mark', name: 'Warcraft 3 import' },
      wait(0.8),
      { do: 'move', to: 'label:has(input[data-test=import-input]), button:has(+ input[data-test=import-input])', dur: 0.7, label: 'import' },
      wait(0.4),
      { do: 'upload', sel: '[data-test=import-input]', file: W3X_FILE },
      // The file's name and the import options on screen before the click
      wait(2.2),
      { do: 'mark', name: 'effect:w3x file' },
      click('[data-test=w3x-import]', { timeout: 10 }),
      { do: 'waitFor', sel: '[data-test=open-imported]', timeout: 60 },
      { do: 'wait', dur: 4.5, label: 'effect:w3x report' },
      click('[data-test=open-imported]'),
      act('viewReady', { timeout: 90 }),
      // The trees stream in a moment after the view stands; ten spawn signs would crowd the flight
      act('overlay', { on: false }),
      wait(1.5),
      path(10, ['current', [[0.35, -0.6, 140], [0.0, -0.05]], [[-0.3, -0.5, 110], [0.0, 0.05]]], { ease: 'inOut', label: 'effect:imported map' }),
      // On from where the path ends, round the point it looks at
      orbit(8, 'look', { turn: 45, ease: 'inOut' }),
    ],
  },
];
