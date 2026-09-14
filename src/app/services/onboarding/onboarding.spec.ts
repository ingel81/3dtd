import { describe, it, expect, beforeEach } from 'vitest';
import {
  INITIAL_ONBOARDING,
  INITIAL_PROGRESS,
  ONBOARDING_KEY,
  ONBOARDING_STEPS,
  OnboardingAction,
  OnboardingProgress,
  OnboardingState,
  RESEARCH_TIP_AFTER_WAVE,
  advanceOnboarding,
  currentStep,
  loadOnboarding,
  sameProgress,
  saveOnboarding,
  tipFor,
} from './onboarding';

const run = (...actions: OnboardingAction[]): OnboardingState =>
  actions.reduce(advanceOnboarding, INITIAL_ONBOARDING);

const progress = (patch: Partial<OnboardingProgress>): OnboardingProgress => ({ ...INITIAL_PROGRESS, ...patch });

/** Everything there: every tip may show */
const LATE = progress({
  wavesCompleted: 20, centerPlaced: true, abilities: ['nuclear-strike'], heroUnlocked: true,
});

describe('onboarding state machine', () => {
  it('starts with the tower tip, not with research', () => {
    expect(currentStep(INITIAL_ONBOARDING, INITIAL_PROGRESS)).toBe('build-tower');
  });

  it('walks the first wave: tower, wave, then nothing until the wave is done', () => {
    let s = run({ kind: 'tower-placed', towerType: 'archer' });
    expect(currentStep(s, INITIAL_PROGRESS)).toBe('start-wave');
    s = advanceOnboarding(s, { kind: 'wave-started' });
    expect(currentStep(s, INITIAL_PROGRESS)).toBeNull();
    expect(currentStep(s, progress({ wavesCompleted: 1 }))).toBe('upgrade-tower');
  });

  it('holds the research center tip back until wave 2 is done', () => {
    const s = run(
      { kind: 'tower-placed', towerType: 'archer' },
      { kind: 'wave-started' },
      { kind: 'tower-upgraded', towerType: 'archer' },
    );
    expect(currentStep(s, progress({ wavesCompleted: RESEARCH_TIP_AFTER_WAVE - 1 }))).toBeNull();
    expect(currentStep(s, progress({ wavesCompleted: RESEARCH_TIP_AFTER_WAVE }))).toBe('research-center');
  });

  it('asks for a research only once a research center stands', () => {
    const s = run(
      { kind: 'tower-placed', towerType: 'archer' },
      { kind: 'wave-started' },
      { kind: 'tower-upgraded', towerType: 'archer' },
      { kind: 'skip', step: 'research-center' },
    );
    expect(currentStep(s, progress({ wavesCompleted: 5 }))).toBeNull();
    expect(currentStep(s, progress({ wavesCompleted: 5, centerPlaced: true }))).toBe('start-research');
    expect(currentStep(advanceOnboarding(s, { kind: 'research-started' }), LATE)).toBe('use-ability');
  });

  it('counts a step done before its tip showed', () => {
    const s = run({ kind: 'tower-placed', towerType: 'research-center' }, { kind: 'tower-placed', towerType: 'archer' });
    expect(s.completed).toEqual(['research-center', 'build-tower']);
    expect(currentStep(s, INITIAL_PROGRESS)).toBe('start-wave');
  });

  it('a later tip shows while an earlier one still waits', () => {
    const s = run(
      { kind: 'tower-placed', towerType: 'archer' },
      { kind: 'wave-started' },
      { kind: 'tower-upgraded', towerType: 'archer' },
      { kind: 'tower-placed', towerType: 'research-center' },
      { kind: 'research-started' },
    );
    expect(currentStep(s, progress({ wavesCompleted: 8, centerPlaced: true, heroUnlocked: true }))).toBe('hire-hero');
  });

  it('upgrading the research center is not the tower upgrade', () => {
    expect(run({ kind: 'tower-upgraded', towerType: 'research-center' })).toBe(INITIAL_ONBOARDING);
    expect(run({ kind: 'tower-upgraded', towerType: 'cannon' }).completed).toEqual(['upgrade-tower']);
  });

  it('ability and hero tips end with using the ability and hiring him', () => {
    const s = run({ kind: 'ability-used' }, { kind: 'hero-hired' });
    expect(s.completed).toEqual(['use-ability', 'hire-hero']);
  });

  it('skip moves on from the given tip only', () => {
    const s = run({ kind: 'skip', step: 'build-tower' });
    expect(s.completed).toEqual(['build-tower']);
    expect(currentStep(s, INITIAL_PROGRESS)).toBe('start-wave');
  });

  it('doing or skipping every tip ends the tips', () => {
    const s = run(...ONBOARDING_STEPS.map((step): OnboardingAction => ({ kind: 'skip', step })));
    expect(s.done).toBe(true);
    expect(currentStep(s, LATE)).toBeNull();
    expect(advanceOnboarding(s, { kind: 'wave-started' })).toBe(s);
  });

  it('hide ends the tips at once, actions after that change nothing', () => {
    const s = run({ kind: 'hide' });
    expect(currentStep(s, LATE)).toBeNull();
    expect(advanceOnboarding(s, { kind: 'wave-started' })).toBe(s);
  });

  it('restart shows the tips again from the first', () => {
    const s = run({ kind: 'hide' }, { kind: 'restart', doneInGame: [] });
    expect(s).toEqual({ done: false, completed: [] });
    expect(currentStep(s, LATE)).toBe('build-tower');
  });

  it('restart leaves out what the running game has done, skips do not count', () => {
    const s = run(
      { kind: 'skip', step: 'build-tower' },
      { kind: 'skip', step: 'start-wave' },
      { kind: 'hide' },
      { kind: 'restart', doneInGame: ['start-wave', 'upgrade-tower'] },
    );
    expect(s).toEqual({ done: false, completed: ['start-wave', 'upgrade-tower'] });
    expect(currentStep(s, LATE)).toBe('build-tower');
    expect(currentStep(advanceOnboarding(s, { kind: 'tower-placed', towerType: 'archer' }), LATE)).toBe('research-center');
  });

  it('restart after a game that did every step shows the whole round', () => {
    const s = run({ kind: 'restart', doneInGame: ONBOARDING_STEPS });
    expect(s).toEqual({ done: false, completed: [] });
    expect(currentStep(s, LATE)).toBe('build-tower');
  });

  it('returns the same state when an action repeats', () => {
    const s = run({ kind: 'wave-started' });
    expect(advanceOnboarding(s, { kind: 'wave-started' })).toBe(s);
  });
});

describe('onboarding tips', () => {
  it('the ability tip names the keys of the abilities researched', () => {
    expect(tipFor('use-ability', progress({ abilities: ['frost-bomb', 'nuclear-strike'] })).keys).toEqual([
      { key: 'F', description: 'Frost Bomb' },
      { key: 'K', description: 'Nuclear Strike' },
    ]);
  });

  it('the first tip carries the camera keys', () => {
    expect(tipFor('build-tower', INITIAL_PROGRESS).keys.map((k) => k.key)).toEqual(['LMB', 'RMB', 'Wheel', 'WASD', 'H']);
  });

  it('progress equality looks at the values', () => {
    expect(sameProgress(progress({ abilities: ['emp'] }), progress({ abilities: ['emp'] }))).toBe(true);
    expect(sameProgress(progress({ abilities: ['emp'] }), progress({ abilities: [] }))).toBe(false);
    expect(sameProgress(INITIAL_PROGRESS, progress({ centerPlaced: true }))).toBe(false);
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
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ done: false, completed: ['start-wave', 'open-research'] }));
    expect(loadOnboarding()).toEqual({ done: false, completed: ['start-wave'] });
  });
});
