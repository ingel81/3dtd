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
import type { DocChange } from '../../model/doc-change';
import { TOOL_GROUPS, type ToolId } from '../../tools/tool-defs';

/** What a step waits for, besides Next */
export type TourEvent = 'change' | 'check' | 'trial' | 'test';

/** A step of the tour; its title, text and key row are the dictionary's (i18n `editor.tour`, by id) */
export interface TourStep {
  id: string;
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
export const TOOL_TOUR: Partial<Record<ToolId, Pick<TourStep, 'done'>>> = {
  look: {},
  landscape: {
    done: (e, c) => e === 'change' && !!(c?.heights || c?.splat || c?.objects),
  },
  terrain: {},
  paint: {},
  water: {},
  objects: {},
  life: {},
  surfaces: {},
  paths: {
    done: (e, c) => e === 'change' && !!c?.paths,
  },
  markers: {
    done: (e, c) => e === 'change' && !!c?.markers,
  },
  gameplay: {},
  environment: {},
  settings: {},
  stamp: {},
  measure: {},
};

/** Step ids the e2e test and stored skips know from before every tool had a step */
const TOOL_STEP_ID: Partial<Record<ToolId, string>> = { landscape: 'land', paths: 'road' };

const TOOL_STEPS: TourStep[] = TOOL_GROUPS.flatMap((g) => g.tools).flatMap((t) => {
  const step = TOOL_TOUR[t.id];
  return step ? [{ id: TOOL_STEP_ID[t.id] ?? t.id, tool: t.id, target: `[data-tour="tool-${t.id}"]`, ...step }] : [];
});

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'view' },
  {
    id: 'tools',
    target: '[data-tour="tools"]',
  },
  ...TOOL_STEPS,
  {
    id: 'side',
    target: '[data-tour="side"]',
  },
  {
    id: 'views',
    target: 'app-editor-minimap',
  },
  {
    id: 'symmetry',
    target: '[data-test="symmetry"]',
  },
  {
    id: 'save',
    target: '[data-test="save"]',
  },
  {
    id: 'help',
    target: '[data-test="help"]',
  },
  {
    id: 'check',
    target: '[data-tour="check"]',
    done: (e) => e === 'check',
  },
  {
    id: 'trial',
    target: '[data-tour="trial"]',
    done: (e) => e === 'trial',
  },
  {
    id: 'test',
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
