/**
 * The first-run tour of the editor: from the view through every tool, the
 * side column and the top bar to playing the map. A step opens the tool it
 * explains and rings the control it means. Some steps go on by themselves
 * when the player did what they ask (a stroke, a road, a spawn, the check,
 * the trial, the test), all of them with Next; Skip ends it and keeps the
 * step, so the help can resume there. Done or skipped, it does not come
 * back on its own (localStorage `3dtd-editor-tour`); the help and the
 * command palette start or resume it.
 */
import type { DocChange } from '../../model/editor-document';
import { TOOL_GROUPS, type ToolId } from '../../tools/tool';

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
  /** CSS selector of the element the step rings (none found, no ring) */
  target?: string;
  /** Whether an event (a document change with its parts) finishes the step */
  done?(event: TourEvent, change: DocChange | null): boolean;
}

/**
 * One step per tool, shown in the order of the tool column. A new tool
 * gets its step here and nowhere else (the spec asks for one per tool).
 */
export const TOOL_TOUR: Partial<Record<ToolId, Omit<TourStep, 'id' | 'tool' | 'target'>>> = {
  look: {
    title: 'Look: the empty hand',
    message:
      'The editor opens with Look. It changes nothing: click a tree, a road, a spawn or the HQ to see what it is, and the panel offers the tool that edits it. Esc comes back here from any tool.',
    hints: [
      { key: 'Click', description: 'What is this' },
      { key: 'Esc', description: 'Back to Look' },
    ],
  },
  landscape: {
    title: 'Paint the land',
    message:
      'Pick a biome and hold the left button over the map: ground, hills and plants grow together. The other modes shape mountains, valleys and craters or draw rivers, roads and cliff edges.',
    hints: [
      { key: 'LMB', description: 'Paint' },
      { key: '[ ]', description: 'Size' },
      { key: '{ }', description: 'Strength' },
    ],
    done: (e, c) => e === 'change' && !!(c?.heights || c?.splat || c?.objects),
  },
  terrain: {
    title: 'Terrain: the height by hand',
    message:
      'Raise and lower, smooth, roughen and erode; Flatten, Level and Terrace even the ground out, Cliff builds a hard step, Ramp joins two heights with two clicks.',
    hints: [
      { key: 'LMB', description: 'Sculpt' },
      { key: 'Shift', description: 'Reverse' },
      { key: 'Ctrl click', description: 'Pick a height' },
    ],
  },
  paint: {
    title: 'Paint the ground',
    message:
      'Up to eight ground layers. Choose one in the list and hold the button to paint it; + Add a ground brings another. Auto paint the map puts rock on slopes, sand on shores and snow on peaks.',
    hints: [
      { key: 'LMB', description: 'Paint' },
      { key: 'Shift', description: 'Erase' },
    ],
  },
  water: {
    title: 'Water, lava and ice',
    message:
      'Fill a hollow floods it to its rim. Pour lets water or lava run downhill, filling every hollow on its way. Dig a lake digs and fills, Paint and Erase draw by hand. Each body has its own kind, level and colour.',
    hints: [
      { key: 'Click', description: 'Fill or pour' },
      { key: 'Ctrl click', description: 'Fill to the rim' },
      { key: 'LMB', description: 'Paint' },
    ],
  },
  objects: {
    title: 'Objects',
    message:
      'Pick a model in the palette and click to place it; Scatter strews several, Line sets a row along a road or a river. Select picks objects to move, turn or scale with the handles.',
    hints: [
      { key: 'W E R', description: 'Move, turn, scale' },
      { key: 'Del', description: 'Delete' },
      { key: 'Ctrl+D', description: 'Duplicate' },
    ],
  },
  paths: {
    title: 'Lay the enemies a road',
    message:
      'Click along the way, Enter ends the road. Start on the existing road to branch off it. Edit moves the points; S smooths a road, X straightens it.',
    hints: [
      { key: 'Click', description: 'Point' },
      { key: 'Enter', description: 'End' },
    ],
    done: (e, c) => e === 'change' && !!c?.paths,
  },
  markers: {
    title: 'Where they come from',
    message:
      "Q places a spawn at the end of a road, H moves the HQ the enemies attack. Both snap onto the nearest road; the panel shows each spawn's route length.",
    hints: [
      { key: 'Q', description: 'Spawn' },
      { key: 'H', description: 'HQ' },
    ],
    done: (e, c) => e === 'change' && !!c?.markers,
  },
  gameplay: {
    title: 'Rules of the map',
    message:
      "Start credits and HQ health, how many lanes are open, which towers may be built, and the waves: the game's own or a list you write, wave by wave.",
    hints: [{ key: 'G', description: 'Rules' }],
  },
  environment: {
    title: 'Sky and weather',
    message:
      'Day, dusk, night or overcast, the time of day and where the sun stands, fog, rain or snow and the wind. Sliders show at once; letting go makes one step to undo.',
    hints: [{ key: '8', description: 'Sky' }],
  },
  settings: {
    title: 'The map itself',
    message:
      'Name, author and description, the size of the map, the terrain generator and rain over the whole map, height maps in and out, and the saved versions to go back to.',
    hints: [{ key: '9', description: 'Map' }],
  },
  stamp: {
    title: 'Copy and stamps',
    message:
      'Drag a rectangle and press Ctrl+C: the piece follows the pointer, R turns it, a click places it. Save the copy keeps it as a stamp for every map.',
    hints: [
      { key: 'Ctrl+C', description: 'Copy' },
      { key: 'Ctrl+V', description: 'Place' },
      { key: 'R', description: 'Turn' },
    ],
  },
  measure: {
    title: 'Measure',
    message:
      "Click points to measure a distance along the ground. The panel tells each lane's length and how long enemies walk it; height lines and a grid help to judge the ground.",
    hints: [{ key: 'D', description: 'Measure' }],
  },
};

/** Step ids the e2e test and stored skips know from before every tool had a step */
const TOOL_STEP_ID: Partial<Record<ToolId, string>> = { landscape: 'land', paths: 'road' };

const TOOL_STEPS: TourStep[] = TOOL_GROUPS.flatMap((g) => g.tools).flatMap((t) => {
  const step = TOOL_TOUR[t.id];
  return step ? [{ id: TOOL_STEP_ID[t.id] ?? t.id, tool: t.id, target: `[data-tour="tool-${t.id}"]`, ...step }] : [];
});

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
    id: 'tools',
    title: 'The tools',
    message:
      "The left column holds every tool in three groups: Shape the land, make it Play, and the Map as a whole. A tool's options open on the right; the bar at the foot says what it does under the pointer.",
    hints: [
      { key: '1 to 9, 0', description: 'Tools' },
      { key: 'G D', description: 'Rules, measure' },
    ],
    target: 'nav[aria-label="Tools"]',
  },
  ...TOOL_STEPS,
  {
    id: 'side',
    title: 'Outline and history',
    message:
      "Next to the tool's options, Outline lists everything on the map by kind; a click selects, the eye hides a kind in the view. History lists every step, a click jumps back to it.",
    hints: [
      { key: 'Ctrl+Z', description: 'Undo' },
      { key: 'Ctrl+Y', description: 'Redo' },
    ],
    target: '[aria-label="Side column"]',
  },
  {
    id: 'views',
    title: 'Minimap and kept views',
    message:
      'The minimap shows the whole map and what the camera sees; a click moves the view there. + Keep view keeps the current camera on a number to fly back to.',
    hints: [
      { key: 'Alt+1 to 9', description: 'Keep' },
      { key: 'Shift+1 to 9', description: 'Fly back' },
      { key: 'C', description: 'Game view' },
    ],
    target: 'app-editor-minimap',
  },
  {
    id: 'symmetry',
    title: 'Fair maps',
    message:
      'Symmetry repeats every stroke, object and road in the mirrored or turned parts of the map. Mirror now copies the part in the middle of the view to the others at once.',
    hints: [{ key: 'M', description: 'Next symmetry' }],
    target: '[data-test="symmetry"]',
  },
  {
    id: 'save',
    title: 'Saving and files',
    message:
      'The editor saves by itself; Ctrl+S saves now with a fresh picture. File downloads the map as a .3dtdmap file or a picture from above. The arrow at the top left goes back to your maps.',
    hints: [
      { key: 'Ctrl+S', description: 'Save' },
      { key: 'File', description: 'Download' },
    ],
    target: '[data-test="save"]',
  },
  {
    id: 'help',
    title: 'Commands and help',
    message:
      'Ctrl+K finds any tool, biome, view or object by name. Help lists every key, lets you change the single keys, has tips for good levels and starts or resumes this tour.',
    hints: [
      { key: 'Ctrl+K', description: 'Commands' },
      { key: '?', description: 'Help' },
    ],
    target: '[data-test="help"]',
  },
  {
    id: 'check',
    title: 'Check the map',
    message:
      'The check lists what keeps the map from playing: a spawn without a road, an HQ off the path. Its bot test plays the map in the game and reports back.',
    hints: [{ key: 'V', description: 'Check' }],
    target: '[data-tour="check"]',
    done: (e) => e === 'check',
  },
  {
    id: 'trial',
    title: 'Watch a wave walk',
    message:
      "The trial wave sends the game's enemies down every route at their real speed, right here. + and - make it faster or slower, up to 8x.",
    hints: [
      { key: 'P', description: 'Trial wave' },
      { key: '+ -', description: 'Speed' },
    ],
    target: '[data-tour="trial"]',
    done: (e) => e === 'trial',
  },
  {
    id: 'test',
    title: 'Play it',
    message:
      'Test map saves and opens the game on your map in a new tab; every test reuses that tab. The help (?) has tips for good levels.',
    hints: [{ key: '?', description: 'Help' }],
    target: '[data-tour="test-play"]',
    done: (e) => e === 'test',
  },
];

const STORAGE_KEY = '3dtd-editor-tour';
const SKIPPED = 'skipped:';

/** Whether the tour should start by itself (never finished nor skipped here) */
export function tourPending(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    return v !== 'done' && !v?.startsWith(SKIPPED);
  } catch {
    return false;
  }
}

/** Finished, or skipped at step `at`: it does not start by itself again; a skip past the first step can be resumed */
export function markTourDone(storage: Pick<Storage, 'setItem'> | null = safeStorage(), at: number | null = null): void {
  try {
    const step = at !== null && at > 0 ? TOUR_STEPS[at] : undefined;
    storage?.setItem(STORAGE_KEY, step ? SKIPPED + step.id : 'done');
  } catch {
    // a private window shows it again next time
  }
}

/** The step a skipped tour resumes at, or null (never skipped, finished, or the step is gone) */
export function tourResumeAt(storage: Pick<Storage, 'getItem'> | null = safeStorage()): number | null {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    if (!v?.startsWith(SKIPPED)) return null;
    const k = TOUR_STEPS.findIndex((s) => s.id === v.slice(SKIPPED.length));
    return k > 0 ? k : null;
  } catch {
    return null;
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
