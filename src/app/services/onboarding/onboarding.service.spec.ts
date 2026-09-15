import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { OnboardingService } from './onboarding.service';
import { ONBOARDING_KEY, OnboardingStep } from './onboarding';
import { lockedAbilityStatus } from '../../configs/abilities.config';
import { heroStatus } from '../../configs/hero.config';

const tower = (id: string) => ({ id: 't1', typeConfig: { id } }) as never;

const waveCompleted = (wave: number) =>
  ({ type: 'wave:completed', wave, credits: 0, perfect: true, closeCall: false, hpLost: 0 }) as const;

/** Stored as done or skipped before the service starts */
const storeCompleted = (...completed: OnboardingStep[]) =>
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ done: false, completed }));

describe('OnboardingService', () => {
  let bus: GameEventBus;
  let service: OnboardingService;

  const start = () => {
    service = new OnboardingService();
    service.connect(bus);
  };

  beforeEach(() => {
    localStorage.clear();
    bus = new GameEventBus();
    start();
  });

  it('shows the first tip with its place in the sequence', () => {
    expect(service.tip()).toMatchObject({ title: 'Build a tower', index: 1, total: 7 });
  });

  it('moves on when the game reports the action, and stores it', () => {
    bus.emit({ type: 'tower:placed', tower: tower('archer'), position: { lat: 0, lon: 0 }, cost: 0 });
    expect(service.tip()).toMatchObject({ title: 'Start the first wave', index: 2 });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!)).toEqual({ done: false, completed: ['build-tower'] });
  });

  it('waits with the upgrade tip until the first wave is done', () => {
    storeCompleted('build-tower', 'start-wave');
    start();
    expect(service.tip()).toBeNull();
    bus.emit(waveCompleted(1));
    expect(service.tip()).toMatchObject({ title: 'Upgrade a tower', index: 3 });
  });

  it('shows the research center tip after wave 3, the research tip once it stands', () => {
    storeCompleted('build-tower', 'start-wave', 'upgrade-tower');
    start();
    bus.emit(waveCompleted(1));
    bus.emit(waveCompleted(2));
    expect(service.tip()).toBeNull();
    bus.emit(waveCompleted(3));
    expect(service.tip()?.title).toBe('Build a research center');

    bus.emit({ type: 'tower:placed', tower: tower('research-center'), position: { lat: 0, lon: 0 }, cost: 0 });
    expect(service.tip()).toBeNull();
    bus.emit({
      type: 'research:state-changed', activeResearches: [], completedResearches: new Set(),
      queuedResearches: [], centerLevel: 1, maxSlots: 1,
    });
    expect(service.tip()?.title).toBe('Start a research');
  });

  it('shows the ability tip with its key once researched, gone when used', () => {
    storeCompleted('build-tower', 'start-wave', 'upgrade-tower', 'research-center', 'start-research');
    start();
    expect(service.tip()).toBeNull();
    bus.emit({
      type: 'ability:state-changed',
      abilities: [{ ...lockedAbilityStatus('nuclear-strike'), unlocked: true, charges: 1 }, lockedAbilityStatus('emp')],
    });
    expect(service.tip()).toMatchObject({ title: 'Use an ability', keys: [{ key: 'K', description: 'Nuclear Strike' }] });
    bus.emit({ type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 1, target: { lat: 0, lon: 0 }, radiusM: 25, warningMs: 1500 });
    expect(service.tip()).toBeNull();
  });

  it('shows the hero tip once he can be hired, and ends the tips when he is', () => {
    storeCompleted('build-tower', 'start-wave', 'upgrade-tower', 'research-center', 'start-research', 'use-ability');
    start();
    bus.emit({ type: 'hero:state-changed', hero: heroStatus(true, false, 0, 'standard', 'hold') });
    expect(service.tip()).toMatchObject({ title: 'Hire the Mercenary', index: 7 });
    bus.emit({ type: 'hero:state-changed', hero: heroStatus(true, true, 0, 'standard', 'hold') });
    expect(service.tip()).toBeNull();
    expect(service.state().done).toBe(true);
  });

  it('a new game starts the progress over', () => {
    storeCompleted('build-tower', 'start-wave');
    start();
    bus.emit(waveCompleted(1));
    expect(service.tip()).not.toBeNull();
    bus.emit({ type: 'game:reset' });
    expect(service.tip()).toBeNull();
  });

  it('skip takes the tip on screen', () => {
    service.skip();
    expect(service.state().completed).toEqual(['build-tower']);
  });

  it('hide ends the tips, restart brings them back', () => {
    service.hide();
    expect(service.tip()).toBeNull();
    service.restart();
    expect(service.tip()?.index).toBe(1);
  });

  it('restart in a running game starts at the first step it has not done', () => {
    bus.emit({ type: 'tower:placed', tower: tower('archer'), position: { lat: 0, lon: 0 }, cost: 0 });
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
    bus.emit(waveCompleted(1));
    bus.emit({ type: 'tower:upgraded', tower: tower('archer'), level: 1, cost: 0 });
    bus.emit({ type: 'wave:started', wave: 2, enemyCount: 5 });
    bus.emit(waveCompleted(2));
    bus.emit({ type: 'wave:started', wave: 3, enemyCount: 5 });
    bus.emit(waveCompleted(3));
    service.hide();
    service.restart();
    expect(service.tip()).toMatchObject({ title: 'Build a research center', index: 4 });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!)).toEqual({
      done: false, completed: ['build-tower', 'start-wave', 'upgrade-tower'],
    });
  });

  it('restart keeps skipped steps out of the running game', () => {
    service.skip();
    service.skip();
    service.restart();
    expect(service.tip()).toMatchObject({ title: 'Build a tower', index: 1 });
  });

  it('restart in a new game starts at the first tip', () => {
    bus.emit({ type: 'tower:placed', tower: tower('archer'), position: { lat: 0, lon: 0 }, cost: 0 });
    bus.emit({ type: 'game:reset' });
    service.restart();
    expect(service.tip()).toMatchObject({ title: 'Build a tower', index: 1 });
  });

  it('a new service picks up the stored state', () => {
    service.skip();
    expect(new OnboardingService().tip()?.title).toBe('Start the first wave');
  });

  it('stops listening after disconnect', () => {
    service.disconnect();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
    expect(service.state().completed).toEqual([]);
  });
});
