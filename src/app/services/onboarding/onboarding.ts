import type { HintItem } from '../../components/context-hint/context-hint.component';

/** localStorage key of the first-run tips */
export const ONBOARDING_KEY = 'td_onboarding_v1';

/** First-run tips in the order they show */
export type OnboardingStep = 'research-center' | 'build-tower' | 'start-wave' | 'open-research';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'research-center',
  'build-tower',
  'start-wave',
  'open-research',
];

export interface OnboardingTip {
  title: string;
  text: string;
  /** Keys shown under the text, in the context hint's key style */
  keys: HintItem[];
}

export const ONBOARDING_TIPS: Record<OnboardingStep, OnboardingTip> = {
  'research-center': {
    title: 'Place the research center',
    text: 'Pick Research Center in the BUILD panel, then click the map to place it.',
    // First tip of a first run: it carries the camera controls, the
    // separate controls hint stays away while a tip shows
    keys: [
      { key: 'LMB', description: 'Pan' },
      { key: 'RMB', description: 'Rotate' },
      { key: 'Wheel', description: 'Zoom' },
      { key: 'WASD', description: 'Move' },
      { key: 'H', description: 'Shortcuts' },
    ],
  },
  'build-tower': {
    title: 'Build a tower',
    text: 'Pick a tower in BUILD and place it where it can see the route.',
    keys: [],
  },
  'start-wave': {
    title: 'Start the first wave',
    text: 'Press the wave button in the sidebar, or Space, once your defense stands.',
    keys: [],
  },
  'open-research': {
    title: 'Open research',
    text: 'Click the research center to start a research. It unlocks towers and upgrades.',
    keys: [],
  },
};

export interface OnboardingState {
  /** Tips over: all steps taken or skipped, or hidden */
  done: boolean;
  /** Steps done or skipped, in the order that happened */
  completed: OnboardingStep[];
}

export type OnboardingAction =
  | { kind: 'tower-placed'; towerType: string }
  | { kind: 'tower-selected'; towerType: string }
  | { kind: 'research-started' }
  | { kind: 'wave-started' }
  /** Skip the tip on screen */
  | { kind: 'skip' }
  /** No more tips */
  | { kind: 'hide' }
  /** Show the tips again from the first */
  | { kind: 'restart' };

export const INITIAL_ONBOARDING: OnboardingState = { done: false, completed: [] };

/** The tip to show, null when the tips are over. */
export function currentStep(state: OnboardingState): OnboardingStep | null {
  if (state.done) return null;
  return ONBOARDING_STEPS.find((step) => !state.completed.includes(step)) ?? null;
}

/** The step an action takes care of, whichever tip is on screen. */
function stepFor(action: OnboardingAction, state: OnboardingState): OnboardingStep | null {
  switch (action.kind) {
    case 'tower-placed':
      return action.towerType === 'research-center' ? 'research-center' : 'build-tower';
    case 'tower-selected':
      return action.towerType === 'research-center' ? 'open-research' : null;
    case 'research-started':
      return 'open-research';
    case 'wave-started':
      return 'start-wave';
    case 'skip':
      return currentStep(state);
    default:
      return null;
  }
}

/**
 * The state after an action. Doing a step before its tip shows counts too: a
 * tower built first leaves the research center tip on screen, then goes
 * straight to the wave. Returns the same object when nothing changes, so a
 * signal holding it does not notify.
 */
export function advanceOnboarding(state: OnboardingState, action: OnboardingAction): OnboardingState {
  if (action.kind === 'restart') return { done: false, completed: [] };
  if (state.done) return state;
  if (action.kind === 'hide') return { ...state, done: true };

  const step = stepFor(action, state);
  if (!step || state.completed.includes(step)) return state;
  const completed = [...state.completed, step];
  return { done: ONBOARDING_STEPS.every((s) => completed.includes(s)), completed };
}

function isStep(v: unknown): v is OnboardingStep {
  return ONBOARDING_STEPS.includes(v as OnboardingStep);
}

/** Stored state; a missing, unreadable or blocked store starts the tips fresh. */
export function loadOnboarding(): OnboardingState {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return INITIAL_ONBOARDING;
    const parsed = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!parsed || typeof parsed.done !== 'boolean' || !Array.isArray(parsed.completed)) {
      return INITIAL_ONBOARDING;
    }
    return { done: parsed.done, completed: parsed.completed.filter(isStep) };
  } catch {
    return INITIAL_ONBOARDING;
  }
}

export function saveOnboarding(state: OnboardingState): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the tips show again next time
  }
}
