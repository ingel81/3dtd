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
import { AbilityTargetingService } from '../../services/ability-targeting.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { ResearchManager } from '../../managers/research.manager';
import { AbilityManager, type AbilityWorld } from '../../managers/ability.manager';
import { HeroManager, type HeroWorld } from '../../managers/hero.manager';
import { GameCommandsHandler } from '../../managers/game-commands.handler';
import type { GameStateManager } from '../../managers/game-state.manager';
import { ABILITY_IDS, type AbilityId, type AbilityStatus } from '../../configs/abilities.config';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';
import type { GeoPosition } from '../../models/game.types';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { singlePlayer } from '../../integration/single-player-parts';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
const HQ: GeoPosition = { lat: 48.7758, lon: 9.1829 };
/** A straight route from 300 m south up to the HQ, for the hero to stand on */
const ROUTE: GeoPosition[] = [{ lat: HQ.lat - 300 / METERS_PER_DEGREE_LAT, lon: HQ.lon }, HQ];

/**
 * Playtest 510, 511 and 513 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: the
 * real research, ability and hero managers on one bus, the cheats through
 * GameCommandsHandler, the bar's buttons as AbilityBarComponent derives them
 * from the GameStore snapshot. The hero button is heroBarView, which the game
 * component hands to the bar.
 */
describe('Ability bar after the research, playtest 510, 511 and 513 replayed', () => {
  let bus: GameEventBus;
  let research: ResearchManager;
  let abilities: AbilityManager;
  let hero: HeroManager;
  let bar: AbilityBarComponent;
  const abilityStatuses = signal({} as Record<AbilityId, AbilityStatus>);
  /** A missile silo stands, as the tower list has it */
  let siloStands: boolean;
  const waveActive = signal(false);

  beforeEach(() => {
    bus = new GameEventBus();
    waveActive.set(false);
    research = new ResearchManager(bus);
    siloStands = true;
    const abilityWorld = {
      snapToRoute: () => null,
      enemiesInRadius: (_center: GeoPosition, _radius: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => (siloStands ? { towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } } : null),
    } as unknown as AbilityWorld;
    abilities = new AbilityManager(bus, abilityWorld);
    abilities.setPhaseProvider(() => (waveActive() ? 'wave' : 'setup'));
    const heroWorld = {
      routes: () => new Map([['spawn-1', ROUTE]]),
      base: () => HQ,
      enemiesInRadius: (_center: GeoPosition, _radius: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      bodyContact: () => null,
      groundHeight: () => 100,
      fire: () => undefined,
      spend: () => true,
    } as unknown as HeroWorld;
    hero = new HeroManager(bus, heroWorld);
    new GameCommandsHandler(
      singlePlayer({ researchManager: research, abilityManager: abilities, heroManager: hero }) as unknown as GameStateManager,
      bus,
    );

    // GameStore.abilities: the snapshot of every ability by id
    const mirror = () => abilityStatuses.set(
      Object.fromEntries(abilities.getStatuses().map((s) => [s.id, s])) as Record<AbilityId, AbilityStatus>,
    );
    mirror();
    bus.on('ability:state-changed', mirror);

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: { abilities: abilityStatuses, waveActive } },
        { provide: AbilityTargetingService, useValue: { targeting: signal<AbilityId | null>(null), toggle: vi.fn() } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    bar = runInInjectionContext(injector, () => new AbilityBarComponent());
  });

  /** Research `id` at the Research Center in game-time sub-steps */
  const researchNow = (id: ResearchId) => {
    expect(research.canStartResearch(id, Infinity).canStart).toBe(true);
    research.startResearch(id);
    const steps = Math.ceil((getResearch(id)!.duration * 1000) / STEP_MS) + 1;
    for (let i = 0; i < steps; i++) research.update(STEP_MS);
    expect(research.isCompleted(id)).toBe(true);
  };
  /** The hero button the game component hands to the bar (tower-defense.component.ts heroBar) */
  const heroButton = () => heroBarView(hero.getStatus(), false, 0);

  it('510: a new game has no bar, and no ability can be armed even in a wave', () => {
    expect(bar.buttons()).toEqual([]);
    expect(heroButton()).toBeNull();
    // The hero input stays null while heroButton() is null
    expect(bar.visible()).toBe(false);

    waveActive.set(true);
    for (const id of ABILITY_IDS) expect(abilities.checkUse(id)).toBe('locked');
  });

  it('511: Ice Magic and Arcane Studies bring no button, Frost Bomb brings exactly its own', () => {
    research.onCenterPlaced();
    researchNow('ice-magic');
    researchNow('arcane-studies');
    expect(bar.buttons()).toEqual([]);

    researchNow('frost-bomb');
    const buttons = bar.buttons();
    expect(buttons.map((b) => b.id)).toEqual(['frost-bomb']);
    expect(buttons[0]).toMatchObject({ icon: 'snowflake', hotkey: 'F' });
    expect(buttons[0].tooltip.category).not.toContain('LOCKED');
    expect(buttons[0].tooltip.stats).toEqual([
      { label: 'CHARGES', value: '1/1' },
      { label: 'RECHARGE', value: '3 waves' },
    ]);
    expect(bar.visible()).toBe(true);
  });

  it('513: the hero cheat gives the bar only his button, the ability cheat adds the four after it', () => {
    // DebugFacadeService.readyHero sends it deferred, the next sub-step runs the queue
    bus.emitDeferred({ type: 'debug:ready-hero' });
    bus.processQueue();
    expect(heroButton()).toMatchObject({ action: 'summon', icon: 'user', hotkey: 'G' });
    // ability-bar.component.html: the rule under the hero only with a button after it
    expect(bar.buttons()).toEqual([]);

    // DebugFacadeService.readyAbilities: one event per ability
    for (const abilityId of ABILITY_IDS) bus.emitDeferred({ type: 'debug:ready-ability', abilityId });
    bus.processQueue();
    expect(bar.buttons().map((b) => [b.id, b.hotkey])).toEqual([
      ['nuclear-strike', 'K'],
      ['frost-bomb', 'F'],
      ['emp', 'E'],
      ['orbital-laser', 'L'],
    ]);
  });

  it('the strike has a button only while a missile silo stands; built or sold, the bar follows at once', () => {
    siloStands = false;
    for (const abilityId of ABILITY_IDS) bus.emitDeferred({ type: 'debug:ready-ability', abilityId });
    bus.processQueue();
    expect(bar.buttons().map((b) => b.id)).toEqual(['frost-bomb', 'emp', 'orbital-laser']);

    // TowerLifecycle.place: the silo is in the tower list, then the manager hears of it
    siloStands = true;
    abilities.buildingChanged('missile-silo');
    expect(bar.buttons().map((b) => b.id)).toEqual(['nuclear-strike', 'frost-bomb', 'emp', 'orbital-laser']);
    expect(bar.buttons()[0].view.state).toBe('waiting');

    // TowerLifecycle.sell: the charge stays, the button goes
    siloStands = false;
    abilities.buildingChanged('missile-silo');
    expect(bar.buttons().map((b) => b.id)).toEqual(['frost-bomb', 'emp', 'orbital-laser']);
    expect(abilities.getStatus('nuclear-strike').charges).toBe(1);
  });
});
