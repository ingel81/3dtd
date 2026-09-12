import { describe, it, expect, beforeEach } from 'vitest';
import {
  INITIAL_ONBOARDING,
  ONBOARDING_KEY,
  OnboardingAction,
  OnboardingState,
  advanceOnboarding,
  currentStep,
  loadOnboarding,
  saveOnboarding,
} from './onboarding';

const run = (...actions: OnboardingAction[]): OnboardingState =>
  actions.reduce(advanceOnboarding, INITIAL_ONBOARDING);

describe('onboarding state machine', () => {
  it('starts with the research center tip', () => {
    expect(currentStep(INITIAL_ONBOARDING)).toBe('research-center');
  });

  it('walks the four tips as the player does each action', () => {
    let s = run({ kind: 'tower-placed', towerType: 'research-center' });
    expect(currentStep(s)).toBe('build-tower');
    s = advanceOnboarding(s, { kind: 'tower-placed', towerType: 'archer' });
    expect(currentStep(s)).toBe('start-wave');
    s = advanceOnboarding(s, { kind: 'wave-started' });
    expect(currentStep(s)).toBe('open-research');
    s = advanceOnboarding(s, { kind: 'tower-selected', towerType: 'research-center' });
    expect(currentStep(s)).toBeNull();
    expect(s.done).toBe(true);
  });

  it('counts a step done before its tip showed', () => {
    const s = run({ kind: 'tower-placed', towerType: 'archer' }, { kind: 'wave-started' });
    expect(currentStep(s)).toBe('research-center');
    expect(currentStep(advanceOnboarding(s, { kind: 'tower-placed', towerType: 'research-center' }))).toBe('open-research');
  });

  it('takes a started research as opening research', () => {
    const s = run({ kind: 'research-started' });
    expect(s.completed).toEqual(['open-research']);
  });

  it('ignores selecting a tower other than the research center', () => {
    const s = run({ kind: 'tower-selected', towerType: 'archer' });
    expect(s).toBe(INITIAL_ONBOARDING);
  });

  it('skip moves on from the tip on screen only', () => {
    const s = run({ kind: 'skip' });
    expect(s.completed).toEqual(['research-center']);
    expect(currentStep(s)).toBe('build-tower');
  });

  it('skipping every tip ends the tips', () => {
    const s = run({ kind: 'skip' }, { kind: 'skip' }, { kind: 'skip' }, { kind: 'skip' });
    expect(s.done).toBe(true);
    expect(advanceOnboarding(s, { kind: 'skip' })).toBe(s);
  });

  it('hide ends the tips at once, actions after that change nothing', () => {
    const s = run({ kind: 'hide' });
    expect(currentStep(s)).toBeNull();
    expect(advanceOnboarding(s, { kind: 'wave-started' })).toBe(s);
  });

  it('restart shows the tips again from the first', () => {
    const s = run({ kind: 'hide' }, { kind: 'restart' });
    expect(s).toEqual({ done: false, completed: [] });
    expect(currentStep(s)).toBe('research-center');
  });

  it('returns the same state when an action repeats', () => {
    const s = run({ kind: 'wave-started' });
    expect(advanceOnboarding(s, { kind: 'wave-started' })).toBe(s);
  });
});

describe('onboarding persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through its key', () => {
    saveOnboarding({ done: false, completed: ['build-tower'] });
    expect(localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
    expect(loadOnboarding()).toEqual({ done: false, completed: ['build-tower'] });
  });

  it('starts fresh on a missing or broken entry, dropping unknown steps', () => {
    expect(loadOnboarding()).toEqual(INITIAL_ONBOARDING);
    localStorage.setItem(ONBOARDING_KEY, 'nope');
    expect(loadOnboarding()).toEqual(INITIAL_ONBOARDING);
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ done: false, completed: ['start-wave', 'fly'] }));
    expect(loadOnboarding()).toEqual({ done: false, completed: ['start-wave'] });
  });
});
