// The bar's tooltip directive is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only its DI token is needed; the real module pulls in the placement services
vi.mock('../../services/ability-targeting.service', () => ({
  AbilityTargetingService: class AbilityTargetingService {},
}));

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { AbilityBarComponent } from './ability-bar.component';
import { heroBarView } from './hero-bar';
import { heroTooltip } from './ability-button';
import { AbilityTargetingService } from '../../services/ability-targeting.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameEventBus, type GameEvent } from '../../game-engine/game-event-bus';
import { ResearchManager } from '../../managers/research.manager';
import { AbilityManager, type AbilityWorld } from '../../managers/ability.manager';
import { HeroManager, type HeroWorld } from '../../managers/hero.manager';
import { GameCommandsHandler } from '../../managers/game-commands.handler';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { AbilityId, AbilityStatus } from '../../configs/abilities.config';
import { HERO } from '../../configs/hero.config';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';
import type { GeoPosition } from '../../models/game.types';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
const HQ: GeoPosition = { lat: 48.7758, lon: 9.1829 };
/** A straight route from 300 m south up to the HQ, for the hero to stand on */
const ROUTE: GeoPosition[] = [{ lat: HQ.lat - 300 / METERS_PER_DEGREE_LAT, lon: HQ.lon }, HQ];

/**
 * Playtest 384 and 385 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed: the
 * Mercenary Contract researched at the Research Center in game-time
 * sub-steps, the hero button as the game component derives it
 * (tower-defense.component.ts heroBar), its press as HeroControlService.hire
 * sends it (command:hire-hero), the real HeroManager answering.
 *
 * Since 586f493e the rule under the hero stands only when an ability button
 * follows (ability-bar.component.html); with the contract alone there is none.
 */
describe('Hero button after the Mercenary Contract, playtest 384 and 385 replayed', () => {
  let bus: GameEventBus;
  let research: ResearchManager;
  let hero: HeroManager;
  let bar: AbilityBarComponent;
  let credits: number;
  let events: GameEvent[];
  const abilityStatuses = signal({} as Record<AbilityId, AbilityStatus>);

  beforeEach(() => {
    bus = new GameEventBus();
    credits = 0;
    events = [];
    research = new ResearchManager(bus);
    const abilities = new AbilityManager(bus, {
      snapToRoute: () => null,
      enemiesInRadius: (_c: GeoPosition, _r: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => ({ towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } }),
    } as unknown as AbilityWorld);
    abilities.setPhaseProvider(() => 'setup');
    const heroWorld = {
      routes: () => new Map([['spawn-1', ROUTE]]),
      base: () => HQ,
      enemiesInRadius: (_c: GeoPosition, _r: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      bodyContact: () => null,
      groundHeight: () => 100,
      fire: () => undefined,
      // GameStateManager's HeroWorld.spend: spendCredits
      spend: (cost: number) => {
        if (credits < cost) return false;
        credits -= cost;
        return true;
      },
    } as unknown as HeroWorld;
    hero = new HeroManager(bus, heroWorld);
    new GameCommandsHandler(
      { researchManager: research, abilityManager: abilities, heroManager: hero } as unknown as GameStateManager,
      bus,
    );

    const mirror = () => abilityStatuses.set(
      Object.fromEntries(abilities.getStatuses().map((s) => [s.id, s])) as Record<AbilityId, AbilityStatus>,
    );
    mirror();
    bus.on('ability:state-changed', mirror);
    bus.onAny((event) => events.push(event));

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: { abilities: abilityStatuses, waveActive: signal(false) } },
        { provide: AbilityTargetingService, useValue: { targeting: signal<AbilityId | null>(null), toggle: vi.fn() } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    bar = runInInjectionContext(injector, () => new AbilityBarComponent());
    research.onCenterPlaced();
  });

  /** Run `seconds` of game time in sub-steps */
  const runSeconds = (seconds: number) => {
    const steps = Math.floor((seconds * 1000) / STEP_MS);
    for (let i = 0; i < steps; i++) research.update(STEP_MS);
  };
  /** Research `id` at the Research Center in game-time sub-steps */
  const researchNow = (id: ResearchId) => {
    expect(research.canStartResearch(id, Infinity).canStart).toBe(true);
    research.startResearch(id);
    runSeconds(getResearch(id)!.duration + 0.1);
    expect(research.isCompleted(id)).toBe(true);
  };
  /** The button the game component hands to the bar */
  const heroButton = () => heroBarView(hero.getStatus(), false, credits);

  it('384: the contract follows Siege Engineering, costs 600 and takes 30 s of game time', () => {
    const contract = getResearch(HERO.researchId)!;
    expect(contract).toMatchObject({ name: 'Mercenary Contract', cost: 600, duration: 30, prerequisites: ['siege-engineering'] });
    expect(research.canStartResearch(HERO.researchId, Infinity).canStart).toBe(false);

    researchNow('gatling-tech');
    researchNow('siege-engineering');
    research.startResearch(HERO.researchId);
    runSeconds(29.9);
    expect(research.isCompleted(HERO.researchId)).toBe(false);
    expect(heroButton()).toBeNull();
    runSeconds(0.2);
    expect(research.isCompleted(HERO.researchId)).toBe(true);
  });

  it('384: then a coin without a key cap, "Hire Mercenary", "1,000 credits, N short.", and no rule under it', () => {
    researchNow('gatling-tech');
    researchNow('siege-engineering');
    researchNow(HERO.researchId);

    credits = 400;
    const button = heroButton()!;
    expect(button).toMatchObject({ action: 'hire', icon: 'coin', hotkey: null, selected: false });
    const tooltip = heroTooltip(button);
    expect(tooltip.title).toBe('Hire Mercenary');
    expect(tooltip.hotkey).toBeUndefined();
    expect(tooltip.flavor).toBe('1,000 credits, 600 short.');
    // ability-bar.component.html: the rule only with an ability button after the hero
    expect(bar.buttons()).toEqual([]);
  });

  it('384: a press short of credits hires nobody, takes nothing and answers only with hero:rejected', () => {
    researchNow('gatling-tech');
    researchNow('siege-engineering');
    researchNow(HERO.researchId);
    credits = 400;
    events.length = 0;

    bus.emit({ type: 'command:hire-hero' });
    expect(events.map((e) => e.type)).toEqual(['command:hire-hero', 'hero:rejected']);
    expect(events[1]).toEqual({ type: 'hero:rejected', reason: 'credits' });
    expect(credits).toBe(400);
    expect(hero.getHero()).toBeNull();
    expect(heroButton()!.action).toBe('hire');
  });

  it('385: with 1,000 credits the press takes 1,000, he stands on the route point by the HQ, the button shows him with G', () => {
    researchNow('gatling-tech');
    researchNow('siege-engineering');
    researchNow(HERO.researchId);
    credits = 1000;

    bus.emit({ type: 'command:hire-hero' });
    expect(credits).toBe(0);
    expect(hero.getStatus()).toMatchObject({ hired: true, mode: 'hold', level: 1, kills: 0 });
    const at = hero.getHero()!.position;
    expect(at.lat).toBeCloseTo(HQ.lat, 9);
    expect(at.lon).toBeCloseTo(HQ.lon, 9);

    const button = heroButton()!;
    expect(button).toMatchObject({ action: 'summon', icon: 'user', hotkey: 'G' });
    expect(heroTooltip(button).hotkey).toBe('G');
  });
});
