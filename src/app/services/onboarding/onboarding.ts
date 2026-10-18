import type { HintItem } from '../../components/context-hint/context-hint.component';
import { ABILITIES, AbilityId } from '../../configs/abilities.config';
import { readJson, writeJson } from '../../utils/storage';
import type { Messages } from '../../i18n/messages/en';

/** localStorage key of the first-run tips; v2 since they follow the course of a game */
export const ONBOARDING_KEY = 'td_onboarding_v2';

/** First-run tips in the order they show */
export type OnboardingStep =
  | 'build-tower'
  | 'start-wave'
  | 'upgrade-tower'
  | 'research-center'
  | 'start-research'
  | 'use-ability'
  | 'hire-hero';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'build-tower',
  'start-wave',
  'upgrade-tower',
  'research-center',
  'start-research',
  'use-ability',
  'hire-hero',
];

/**
 * Waves done before the research center tip shows. The cheapest research
 * costs 400 credits, about what wave 2 pays (campaign.config.ts); the
 * tip waits one wave longer than that, the user's call after the playtest of
 * 2026-09-15 (decision E1): the first credits belong in towers.
 */
export const RESEARCH_TIP_AFTER_WAVE = 3;

export interface OnboardingTip {
  title: string;
  text: string;
  /** Keys shown under the text, in the context hint's key style */
  keys: HintItem[];
}

/** A key cap: a named one (the dictionary's onboarding.caps) or a letter as it is */
export type KeyCap = keyof Messages['onboarding']['caps'] | (string & {});
type KeyDoes = keyof Messages['onboarding']['does'];

/** What each tip shows under its text: a key and what it does */
const TIP_KEYS: Record<OnboardingStep, readonly (readonly [KeyCap, KeyDoes])[]> = {
  'build-tower': [['lmb', 'pan'], ['rmb', 'rotate'], ['wheel', 'zoom'], ['WASD', 'move'], ['H', 'shortcuts']],
  'start-wave': [['space', 'nextWave'], ['P', 'pause'], ['+/-', 'speed']],
  'upgrade-tower': [['U', 'upgrade'], ['del', 'sellTwice']],
  'research-center': [],
  'start-research': [],
  // Filled in by tipFor() with the abilities researched so far
  'use-ability': [],
  'hire-hero': [['G', 'select'], ['V', 'ammo']],
};

/** A key cap in the player's language */
export function keyCap(t: Messages, cap: KeyCap): string {
  return Object.hasOwn(t.onboarding.caps, cap) ? t.onboarding.caps[cap as keyof Messages['onboarding']['caps']] : cap;
}

/** A key and what it does, as the context hint shows it */
export function keyHint(t: Messages, cap: KeyCap, does: KeyDoes): HintItem {
  return { key: keyCap(t, cap), description: t.onboarding.does[does] };
}

/**
 * How far the running game is, taken from its events and not stored: the
 * later tips wait until what they talk about is there.
 */
export interface OnboardingProgress {
  wavesCompleted: number;
  centerPlaced: boolean;
  /** Abilities with a button in the bar (research done, launch site standing), in its order */
  abilities: AbilityId[];
  heroUnlocked: boolean;
}

export const INITIAL_PROGRESS: OnboardingProgress = {
  wavesCompleted: 0,
  centerPlaced: false,
  abilities: [],
  heroUnlocked: false,
};

/** Equality for a signal holding the progress: snapshots repeat a lot. */
export function sameProgress(a: OnboardingProgress, b: OnboardingProgress): boolean {
  return a.wavesCompleted === b.wavesCompleted
    && a.centerPlaced === b.centerPlaced
    && a.heroUnlocked === b.heroUnlocked
    && a.abilities.length === b.abilities.length
    && a.abilities.every((id, i) => id === b.abilities[i]);
}

/** Whether a tip's moment has come in this game. */
export function isReady(step: OnboardingStep, progress: OnboardingProgress): boolean {
  switch (step) {
    case 'upgrade-tower':
      // Credits from the first wave to spend
      return progress.wavesCompleted >= 1;
    case 'research-center':
      return progress.wavesCompleted >= RESEARCH_TIP_AFTER_WAVE;
    case 'start-research':
      return progress.centerPlaced;
    case 'use-ability':
      return progress.abilities.length > 0;
    case 'hire-hero':
      return progress.heroUnlocked;
    default:
      return true;
  }
}

/** The tip of a step, the ability tip with the keys of the abilities researched. */
export function tipFor(t: Messages, step: OnboardingStep, progress: OnboardingProgress): OnboardingTip {
  const { title, text } = t.onboarding.tips[step];
  const keys = step === 'use-ability'
    ? progress.abilities.map((id) => ({ key: ABILITIES[id].hotkey, description: t.abilities[id].name }))
    : TIP_KEYS[step].map(([cap, does]) => keyHint(t, cap, does));
  return { title, text, keys };
}

export interface OnboardingState {
  /** Tips over: all steps taken or skipped, or hidden */
  done: boolean;
  /** Steps done or skipped, in the order that happened */
  completed: OnboardingStep[];
}

export type OnboardingAction =
  | { kind: 'tower-placed'; towerType: string }
  | { kind: 'tower-upgraded'; towerType: string }
  | { kind: 'research-started' }
  | { kind: 'wave-started' }
  | { kind: 'ability-used' }
  | { kind: 'hero-hired' }
  /** Skip the tip on screen, which is `step` */
  | { kind: 'skip'; step: OnboardingStep }
  /** No more tips */
  | { kind: 'hide' }
  /** Show the tips again from the first, leaving out what the running game has done */
  | { kind: 'restart'; doneInGame: readonly OnboardingStep[] };

export const INITIAL_ONBOARDING: OnboardingState = { done: false, completed: [] };

/**
 * The tip to show: the first step not done yet whose moment has come, null
 * when there is none. One that still waits lets a later one show; a wave 1
 * that is still running shows no tip at all.
 */
export function currentStep(state: OnboardingState, progress: OnboardingProgress): OnboardingStep | null {
  if (state.done) return null;
  return ONBOARDING_STEPS.find((step) => !state.completed.includes(step) && isReady(step, progress)) ?? null;
}

/** The step an action takes care of, whichever tip is on screen. */
function stepFor(action: OnboardingAction): OnboardingStep | null {
  switch (action.kind) {
    case 'tower-placed':
      return action.towerType === 'research-center' ? 'research-center' : 'build-tower';
    case 'tower-upgraded':
      // The research wing is not what the upgrade tip is about
      return action.towerType === 'research-center' ? null : 'upgrade-tower';
    case 'research-started':
      return 'start-research';
    case 'wave-started':
      return 'start-wave';
    case 'ability-used':
      return 'use-ability';
    case 'hero-hired':
      return 'hire-hero';
    case 'skip':
      return action.step;
    default:
      return null;
  }
}

/**
 * The state after an action. Doing a step before its tip shows counts too: a
 * research center built in wave 1 leaves its tip out after wave 3. Returns
 * the same object when nothing changes, so a signal holding it does not
 * notify.
 */
export function advanceOnboarding(state: OnboardingState, action: OnboardingAction): OnboardingState {
  if (action.kind === 'restart') return restartOnboarding(action.doneInGame);
  if (state.done) return state;
  if (action.kind === 'hide') return { ...state, done: true };

  const step = stepFor(action);
  if (!step || state.completed.includes(step)) return state;
  const completed = [...state.completed, step];
  return { done: ONBOARDING_STEPS.every((s) => completed.includes(s)), completed };
}

/**
 * The tips from the first again, except for the steps the running game has
 * done: asking for them in wave 12 does not bring back "Build a tower". A
 * game that has done every step gets the whole round.
 */
function restartOnboarding(doneInGame: readonly OnboardingStep[]): OnboardingState {
  if (ONBOARDING_STEPS.every((step) => doneInGame.includes(step))) return { done: false, completed: [] };
  return { done: false, completed: [...doneInGame] };
}

function isStep(v: unknown): v is OnboardingStep {
  return ONBOARDING_STEPS.includes(v as OnboardingStep);
}

/** Stored state; a missing, unreadable or blocked store starts the tips fresh. */
export function loadOnboarding(): OnboardingState {
  const parsed = readJson(ONBOARDING_KEY) as Partial<OnboardingState> | null;
  if (!parsed || typeof parsed.done !== 'boolean' || !Array.isArray(parsed.completed)) {
    return INITIAL_ONBOARDING;
  }
  return { done: parsed.done, completed: parsed.completed.filter(isStep) };
}

export function saveOnboarding(state: OnboardingState): void {
  // Blocked storage: the tips show again next time
  writeJson(ONBOARDING_KEY, state);
}
