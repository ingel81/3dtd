import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

// inject() hands out the fakes below by class name, as in
// ability-targeting.service.spec.ts; effects are collected so a test can run them
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
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));

import { AbilityTargetingService } from './ability-targeting.service';
import { RefusalHintService } from './refusal-hint.service';
import { UPGRADE_HINT_MS } from './upgrade-hint.service';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { HeroManager, type HeroWorld } from '../managers/hero.manager';
import { GameCommandsHandler } from '../managers/game-commands.handler';
import type { GameStateManager } from '../managers/game-state.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { ABILITIES, type AbilityId, type AbilityStatus } from '../configs/abilities.config';
import { HERO, initialHeroStatus } from '../configs/hero.config';
import type { ResearchId } from '../configs/research/research.types';
import type { GamePhase, GeoPosition } from '../models/game.types';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { singlePlayer } from '../integration/single-player-parts';

const HQ: GeoPosition = { lat: 48.7758, lon: 9.1829 };
/** A straight route from 300 m south up to the HQ, for the hero to stand on */
const ROUTE: GeoPosition[] = [{ lat: HQ.lat - 300 / METERS_PER_DEGREE_LAT, lon: HQ.lon }, HQ];
/** Where a strike aimed at the route lands */
const ON_ROUTE: GeoPosition = { lat: HQ.lat - 100 / METERS_PER_DEGREE_LAT, lon: HQ.lon };

/**
 * Open point 13 of the fix handover (docs/archive/REVIEW_FIX_2026-09-14.md): a
 * refused hire or ability said nothing. Replayed on the real ability and
 * hero managers on one bus, the commands through GameCommandsHandler, the
 * presses through the real AbilityTargetingService (K and the bar's button
 * both call toggle: HotkeyService.toggleAbility, AbilityBarComponent.press),
 * the hire as HeroControlService.hire sends it, and the RefusalHintService
 * connected as TowerDefenseFacadeService connects it. What it holds is what
 * the context hint box shows (tower-defense.component.html).
 */
describe('Refused hires and abilities in the context hint box, open point 13 replayed', () => {
  let bus: GameEventBus;
  let abilities: AbilityManager;
  let hero: HeroManager;
  let targeting: AbilityTargetingService;
  let refusals: RefusalHintService;
  /** RefusalHintService's effect, run where Angular would run it */
  let refusalEffect: () => void;
  let phase: GamePhase;
  let credits: number;
  let bot: boolean;
  let siloStands: boolean;
  const aiming = signal<AbilityId | null>(null);
  const abilityStatuses = signal({} as Record<AbilityId, AbilityStatus>);
  const storeCredits = signal(0);
  const storeHero = signal(initialHeroStatus());

  /** The research of `perkId` is done (ResearchManager's research:completed) */
  const research = (perkId: string) => bus.emit({
    type: 'research:completed',
    researchId: perkId as ResearchId,
    effects: [{ kind: 'global-perk', perkId, description: '' }],
  });

  beforeEach(() => {
    vi.useFakeTimers();
    effects.length = 0;
    bus = new GameEventBus();
    phase = 'setup';
    credits = 400;
    bot = false;
    siloStands = true;
    abilities = new AbilityManager(bus, {
      snapToRoute: () => ON_ROUTE,
      enemiesInRadius: (_c: GeoPosition, _r: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => (siloStands ? { towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } } : null),
    } as unknown as AbilityWorld);
    abilities.setPhaseProvider(() => phase);
    hero = new HeroManager(bus, {
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
    } as unknown as HeroWorld);
    new GameCommandsHandler(singlePlayer({ abilityManager: abilities, heroManager: hero }) as unknown as GameStateManager, bus);

    // GameStateSyncService: GameStore.abilities, the hero and the credits follow the managers
    const mirror = () => abilityStatuses.set(
      Object.fromEntries(abilities.getStatuses().map((s) => [s.id, s])) as Record<AbilityId, AbilityStatus>,
    );
    mirror();
    bus.on('ability:state-changed', mirror);
    storeHero.set(initialHeroStatus());
    bus.on('hero:state-changed', (event) => storeHero.set(event.hero));
    storeCredits.set(credits);
    aiming.set(null);

    injections['UIStore'] = {
      buildMode: signal(false),
      mapPlacementMode: signal(null),
      abilityTargeting: aiming,
      heroSelected: signal(false),
    };
    injections['TowerDefenseStore'] = { waveActive: signal(false), abilities: abilityStatuses, credits: storeCredits, hero: storeHero };
    injections['TowerPlacementService'] = { exitBuildMode: vi.fn() };
    injections['MapPlacementService'] = { exitPlacementMode: vi.fn() };
    refusals = new RefusalHintService();
    refusalEffect = effects[effects.length - 1];
    injections['RefusalHintService'] = refusals;
    targeting = new AbilityTargetingService();
    targeting.initialize(
      { abilityMarkers: { hideAim: vi.fn(), showAim: vi.fn() } } as never,
      { abilityManager: abilities, getEventBus: () => bus } as never,
    );
    refusals.connect(bus, () => !bot);
  });

  afterEach(() => vi.useRealTimers());

  it('K or the button between waves: nothing arms, "Nuclear Strike" over "Only during a wave" for 2.5 s', () => {
    research(ABILITIES['nuclear-strike'].perkId);
    targeting.toggle('nuclear-strike');
    expect(targeting.targeting()).toBeNull();
    expect(refusals.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'Only during a wave' });

    vi.advanceTimersByTime(UPGRADE_HINT_MS);
    expect(refusals.refusal()).toBeNull();
  });

  it('K or the button in a wave without a missile silo: nothing arms, "Build a Missile Silo first"', () => {
    research(ABILITIES['nuclear-strike'].perkId);
    siloStands = false;
    phase = 'wave';
    targeting.toggle('nuclear-strike');
    expect(targeting.targeting()).toBeNull();
    expect(refusals.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'Build a Missile Silo first' });
    // Between waves too: the missing silo comes first
    phase = 'setup';
    targeting.toggle('nuclear-strike');
    expect(refusals.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'Build a Missile Silo first' });
    expect(abilities.getStatus('nuclear-strike').charges).toBe(1);
  });

  it('after the strike, K again in the same wave: "No charges, recharges in 3 waves"', () => {
    research(ABILITIES['nuclear-strike'].perkId);
    phase = 'wave';
    targeting.toggle('nuclear-strike');
    expect(targeting.targeting()).toBe('nuclear-strike');
    targeting.click(ON_ROUTE.lat, ON_ROUTE.lon, 0);
    expect(abilities.getStatus('nuclear-strike')).toMatchObject({ charges: 0, pending: true });
    expect(refusals.refusal()).toBeNull();

    targeting.toggle('nuclear-strike');
    expect(targeting.targeting()).toBeNull();
    expect(refusals.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'No charges, recharges in 3 waves' });
  });

  it('a command the manager refuses after the click says why too (the wave ended in between)', () => {
    research(ABILITIES['nuclear-strike'].perkId);
    phase = 'wave';
    targeting.toggle('nuclear-strike');
    phase = 'setup';
    targeting.click(ON_ROUTE.lat, ON_ROUTE.lon, 0);
    expect(abilities.getStatus('nuclear-strike').charges).toBe(1);
    expect(refusals.refusal()).toEqual({ subject: 'Nuclear Strike', reason: 'Only during a wave' });
  });

  it('K once the wave runs arms, and the refusal goes as the aim box comes up', () => {
    research(ABILITIES['nuclear-strike'].perkId);
    targeting.toggle('nuclear-strike');
    expect(refusals.refusal()).not.toBeNull();

    phase = 'wave';
    targeting.toggle('nuclear-strike');
    expect(targeting.targeting()).toBe('nuclear-strike');
    // Angular runs the effect once UIStore.abilityTargeting changed
    refusalEffect();
    expect(refusals.refusal()).toBeNull();
  });

  it('a hire short of credits: "Hire Mercenary" over "Need 600 credits", nothing taken', () => {
    research(HERO.perkId);
    bus.emit({ type: 'command:hire-hero' });
    expect(hero.getHero()).toBeNull();
    expect(credits).toBe(400);
    expect(refusals.refusal()).toEqual({ subject: 'Hire Mercenary', reason: 'Need 600 credits' });
  });

  it("the bot's refused strike shows nothing", () => {
    research(ABILITIES['nuclear-strike'].perkId);
    bot = true;
    // BotSession sends the bot's use-ability as command:use-ability
    bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: ON_ROUTE });
    expect(abilities.getStatus('nuclear-strike').charges).toBe(1);
    expect(refusals.refusal()).toBeNull();
  });
});
