import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

// inject() hands out the fakes below by class name; effects are collected
// so a test can run them
const injections: Record<string, unknown> = {};
const effects: (() => void)[] = [];
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injections[token?.name ?? ''],
    effect: (fn: () => void) => { effects.push(fn); },
  };
});

import { RefusalHintService, abilityNoRouteText, abilityRefusalText, heroRefusalText } from './refusal-hint.service';
import { UPGRADE_HINT_MS } from './upgrade-hint.service';
import { GameEventBus } from '../game-engine/game-event-bus';
import { lockedAbilityStatus, type AbilityStatus } from '../configs/abilities.config';
import { initialHeroStatus, type HeroStatus } from '../configs/hero.config';

describe('abilityRefusalText', () => {
  it('says what the player can act on', () => {
    expect(abilityRefusalText('nuclear-strike', 'no-wave')).toBe('Only during a wave');
    expect(abilityRefusalText('nuclear-strike', 'no-charge', 3)).toBe('No charges, recharges in 3 waves');
    expect(abilityRefusalText('frost-bomb', 'no-charge', 1)).toBe('No charges, recharges in 1 wave');
    expect(abilityRefusalText('emp', 'no-charge')).toBe('No charges');
    expect(abilityRefusalText('orbital-laser', 'no-route')).toBe('No route within 30 m');
    expect(abilityNoRouteText('orbital-laser')).toBe('No route within 30 m');
  });

  it('names the building a strike launches from when none stands', () => {
    expect(abilityRefusalText('nuclear-strike', 'no-launch-site')).toBe('Build a Missile Silo first');
    // An ability without a launch site never gets this reason; nothing to say
    expect(abilityRefusalText('emp', 'no-launch-site')).toBeNull();
  });

  it('keeps quiet before the research and for an unknown ability', () => {
    expect(abilityRefusalText('nuclear-strike', 'locked')).toBeNull();
    expect(abilityRefusalText('nuclear-strike', 'unknown')).toBeNull();
  });
});

describe('heroRefusalText', () => {
  it('names the missing credits like the U key does for an upgrade', () => {
    expect(heroRefusalText('credits', 400, false)).toBe('Need 600 credits');
    expect(heroRefusalText('credits', 0, false)).toBe('Need 1,000 credits');
  });

  it('tells a hire without a route to stand on from an order no route leads to', () => {
    expect(heroRefusalText('no-route', 0, false)).toBe('No route to stand on');
    expect(heroRefusalText('no-route', 0, true)).toBe('No way there along the routes');
  });

  it('keeps quiet for what no button or key runs into', () => {
    for (const reason of ['locked', 'hired', 'no-hero', 'unknown-ammo'] as const) {
      expect(heroRefusalText(reason, 0, false), reason).toBeNull();
    }
  });
});

describe('RefusalHintService', () => {
  let ui: {
    buildMode: ReturnType<typeof signal<boolean>>;
    mapPlacementMode: ReturnType<typeof signal<string | null>>;
    abilityTargeting: ReturnType<typeof signal<string | null>>;
    heroSelected: ReturnType<typeof signal<boolean>>;
  };
  let store: {
    abilities: ReturnType<typeof signal<Record<string, AbilityStatus>>>;
    credits: ReturnType<typeof signal<number>>;
    hero: ReturnType<typeof signal<HeroStatus>>;
  };
  let bus: GameEventBus;
  let player: boolean;
  let service: RefusalHintService;

  const runEffects = () => effects.forEach((fn) => fn());

  beforeEach(() => {
    vi.useFakeTimers();
    effects.length = 0;
    ui = { buildMode: signal(false), mapPlacementMode: signal(null), abilityTargeting: signal(null), heroSelected: signal(false) };
    store = {
      abilities: signal({ 'nuclear-strike': { ...lockedAbilityStatus('nuclear-strike'), unlocked: true, wavesUntilCharge: 2 } }),
      credits: signal(400),
      hero: signal(initialHeroStatus()),
    };
    injections['UIStore'] = ui;
    injections['TowerDefenseStore'] = store;
    bus = new GameEventBus();
    player = true;
    service = new RefusalHintService();
    service.connect(bus, () => player);
  });

  afterEach(() => vi.useRealTimers());

  it("shows a manager's refusal, the name over the reason, for as long as the U key's", () => {
    bus.emit({ type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'no-wave' });
    expect(service.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'Only during a wave' });

    vi.advanceTimersByTime(UPGRADE_HINT_MS - 1);
    expect(service.refusal()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(service.refusal()).toBeNull();
  });

  it('reads the waves to the next charge from the store', () => {
    bus.emit({ type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'no-charge' });
    expect(service.refusal()?.reason).toBe('No charges, recharges in 2 waves');
  });

  it('a hire short of credits: "Hire Mercenary", the credits missing now', () => {
    bus.emit({ type: 'hero:rejected', reason: 'credits' });
    expect(service.refusal()).toEqual({ subject: 'Hire Mercenary', reason: 'Need 600 credits' });

    bus.emit({ type: 'hero:rejected', reason: 'no-route' });
    expect(service.refusal()).toEqual({ subject: 'Hire Mercenary', reason: 'No route to stand on' });
  });

  it('an order of the hired hero no route leads to: "Mercenary", no way there', () => {
    store.hero.set({ ...initialHeroStatus(), unlocked: true, hired: true });
    bus.emit({ type: 'hero:rejected', reason: 'no-route' });
    expect(service.refusal()).toEqual({ subject: 'Mercenary', reason: 'No way there along the routes' });
  });

  it('a second refusal replaces the first and runs its own time', () => {
    service.ability('nuclear-strike', 'no-wave');
    vi.advanceTimersByTime(2000);
    service.hero('credits');
    vi.advanceTimersByTime(UPGRADE_HINT_MS - 1);
    expect(service.refusal()?.subject).toBe('Hire Mercenary');
    vi.advanceTimersByTime(1);
    expect(service.refusal()).toBeNull();
  });

  it("shows nothing for a bot's commands and for reasons the player cannot act on", () => {
    player = false;
    bus.emit({ type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'no-wave' });
    bus.emit({ type: 'hero:rejected', reason: 'credits' });
    expect(service.refusal()).toBeNull();

    player = true;
    bus.emit({ type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'locked' });
    bus.emit({ type: 'hero:rejected', reason: 'unknown-ammo' });
    expect(service.refusal()).toBeNull();
  });

  it('a pointer mode that starts ends it at once', () => {
    runEffects();
    for (const start of [
      () => ui.buildMode.set(true),
      () => ui.mapPlacementMode.set('hq'),
      () => ui.abilityTargeting.set('frost-bomb'),
      () => ui.heroSelected.set(true),
    ]) {
      ui.buildMode.set(false);
      ui.mapPlacementMode.set(null);
      ui.abilityTargeting.set(null);
      ui.heroSelected.set(false);
      service.ability('nuclear-strike', 'no-wave');
      // Angular runs the effect when a signal it read changes
      start();
      runEffects();
      expect(service.refusal()).toBeNull();
    }
  });

  it('a restart and the end of the session clear it; after disconnect nothing comes', () => {
    service.ability('nuclear-strike', 'no-wave');
    bus.emit({ type: 'game:reset' });
    expect(service.refusal()).toBeNull();

    service.ability('nuclear-strike', 'no-wave');
    service.disconnect();
    expect(service.refusal()).toBeNull();
    bus.emit({ type: 'ability:rejected', abilityId: 'nuclear-strike', reason: 'no-wave' });
    expect(service.refusal()).toBeNull();
  });
});
