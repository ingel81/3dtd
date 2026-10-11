/**
 * The first-run tour of the editor: seven steps from the view to
 * playing the map, each with the tool it needs. A step goes on by itself
 * when the player did what it asks (a stroke, a road, a spawn, the check,
 * the trial, the test), or with Next; Skip ends it. Done or skipped, it
 * does not come back on its own (localStorage `3dtd-editor-tour`); the key
 * help and the command palette start it again.
 */
import type { DocChange } from '../../model/editor-document';
import type { ToolId } from '../../tools/tool';

/** What a step waits for, besides Next */
export type TourEvent = 'change' | 'check' | 'trial' | 'test';

export interface TourStep {
  id: string;
  title: string;
  message: string;
  /** Keys and mouse for the hint row */
  hints: { key: string; description: string }[];
  /** The tool the step opens */
  tool?: ToolId;
  /** `data-tour` of the element the step points at */
  target?: string;
  /** Whether an event (a document change with its parts) finishes the step */
  done?(event: TourEvent, change: DocChange | null): boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'view',
    title: 'Your map in 3D',
    message:
      'The left button always works with the chosen tool. The view moves with the others: right drag turns, middle drag or the arrow keys pan, the wheel zooms; hold right and press W A S D to fly. The legend in the corner keeps this at hand.',
    hints: [
      { key: 'RMB', description: 'Turn' },
      { key: 'MMB', description: 'Pan' },
      { key: 'Wheel', description: 'Zoom' },
      { key: 'RMB+WASD', description: 'Fly' },
    ],
  },
  {
    id: 'land',
    title: 'Paint the land',
    message: 'Pick a biome and hold the left button over the map: ground, hills and plants grow together.',
    hints: [
      { key: 'LMB', description: 'Paint' },
      { key: '[ ]', description: 'Size' },
    ],
    tool: 'landscape',
    target: 'tool-landscape',
    done: (e, c) => e === 'change' && !!(c?.heights || c?.splat || c?.objects),
  },
  {
    id: 'road',
    title: 'Lay the enemies a road',
    message: 'Click along the way, Enter ends the road. Start on the existing road to branch off it.',
    hints: [
      { key: 'Click', description: 'Point' },
      { key: 'Enter', description: 'End' },
    ],
    tool: 'paths',
    target: 'tool-paths',
    done: (e, c) => e === 'change' && !!c?.paths,
  },
  {
    id: 'markers',
    title: 'Where they come from',
    message: 'Q places a spawn at the end of a road, H moves the HQ the enemies attack.',
    hints: [
      { key: 'Q', description: 'Spawn' },
      { key: 'H', description: 'HQ' },
    ],
    tool: 'markers',
    target: 'tool-markers',
    done: (e, c) => e === 'change' && !!c?.markers,
  },
  {
    id: 'check',
    title: 'Check the map',
    message: 'The check lists what keeps the map from playing: a spawn without a road, an HQ off the path.',
    hints: [{ key: 'V', description: 'Check' }],
    target: 'check',
    done: (e) => e === 'check',
  },
  {
    id: 'trial',
    title: 'Watch a wave walk',
    message: "The trial wave sends the game's enemies down every route at their real speed, right here.",
    hints: [{ key: 'P', description: 'Trial wave' }],
    target: 'trial',
    done: (e) => e === 'trial',
  },
  {
    id: 'test',
    title: 'Play it',
    message: 'Test map saves and opens the game on your map in a new tab. The key help (?) has tips for good levels.',
    hints: [{ key: '?', description: 'Help' }],
    target: 'test-play',
    done: (e) => e === 'test',
  },
];

const STORAGE_KEY = '3dtd-editor-tour';

/** Whether the tour should start by itself (never finished nor skipped here) */
export function tourPending(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) !== 'done';
  } catch {
    return false;
  }
}

export function markTourDone(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, 'done');
  } catch {
    // a private window shows it again next time
  }
}

/** The step after `index` when `event` happened, or `index` when it does not finish the step */
export function tourAdvance(index: number, event: TourEvent, change: DocChange | null): number {
  const step = TOUR_STEPS[index];
  return step?.done?.(event, change) ? index + 1 : index;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
