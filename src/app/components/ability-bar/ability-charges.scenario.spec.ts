// The bar's tooltip directive is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only its DI token is needed; the real module pulls in the placement services
vi.mock('../../services/ability-targeting.service', () => ({
  AbilityTargetingService: class AbilityTargetingService {},
}));

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { AbilityBarComponent } from './ability-bar.component';
import { AbilityTargetingService } from '../../services/ability-targeting.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { ResearchManager } from '../../managers/research.manager';
import { AbilityManager, type AbilityWorld } from '../../managers/ability.manager';
import { GameCommandsHandler } from '../../managers/game-commands.handler';
import type { GameStateManager } from '../../managers/game-state.manager';
import { ABILITY_IDS, type AbilityId, type AbilityStatus } from '../../configs/abilities.config';
import type { GeoPosition } from '../../models/game.types';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
/** 6500 ms of warning in sub-steps */
const WARNING_STEPS = 390;

/**
 * Playtest 318 and the logic of 319 (night 2, docs/archive/REVIEW_SPRINT_2026-09-14.md)
 * replayed: Cheat Abilities, a nuclear strike in a wave and its recharge over
 * the next waves. The real research and ability managers on one bus, the
 * cheat and the click through GameCommandsHandler, the buttons as
 * AbilityBarComponent derives them from the GameStore snapshot. The
 * targeting mode is the UIStore signal AbilityTargetingService sets.
 */
describe('Ability buttons through a strike and its recharge, playtest 318 and 319 replayed', () => {
  let bus: GameEventBus;
  let abilities: AbilityManager;
  let bar: AbilityBarComponent;
  const abilityStatuses = signal({} as Record<AbilityId, AbilityStatus>);
  const waveActive = signal(false);
  const targeting = signal<AbilityId | null>(null);

  beforeEach(() => {
    bus = new GameEventBus();
    waveActive.set(false);
    targeting.set(null);
    const research = new ResearchManager(bus);
    abilities = new AbilityManager(bus, {
      snapToRoute: (target: GeoPosition) => ({ ...target }),
      enemiesInRadius: (_center: GeoPosition, _radius: number, out: unknown[]) => {
        out.length = 0;
        return out;
      },
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => ({ towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } }),
    } as unknown as AbilityWorld);
    abilities.setPhaseProvider(() => (waveActive() ? 'wave' : 'setup'));
    new GameCommandsHandler(
      { researchManager: research, abilityManager: abilities } as unknown as GameStateManager,
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
        { provide: AbilityTargetingService, useValue: { targeting, toggle: vi.fn() } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    bar = runInInjectionContext(injector, () => new AbilityBarComponent());
  });

  /** DebugFacadeService.readyAbilities: one deferred event per ability, the next sub-step runs them */
  const cheatAbilities = () => {
    for (const abilityId of ABILITY_IDS) bus.emitDeferred({ type: 'debug:ready-ability', abilityId });
    bus.processQueue();
  };
  const nuke = () => bar.buttons().find((b) => b.id === 'nuclear-strike')!;
  /** The wave ends: WaveManager's wave:completed, the phase back to setup */
  const completeWave = (wave: number) => {
    waveActive.set(false);
    bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
  };

  it('318: between the waves every button waits with three lit pips, READY, FIRES DURING A WAVE, CHARGES 1/1, RECHARGE 3 waves', () => {
    cheatAbilities();
    expect(bar.buttons().map((b) => b.id)).toEqual(ABILITY_IDS);
    for (const button of bar.buttons()) {
      expect(button.view, button.id).toMatchObject({ state: 'waiting', enabled: false, pips: [true, true, true] });
      expect(button.tooltip.category).toBe('READY, FIRES DURING A WAVE');
      expect(button.tooltip.stats).toEqual([
        { label: 'CHARGES', value: '1/1' },
        { label: 'RECHARGE', value: '3 waves' },
      ]);
    }
  });

  it('319: armed on K, incoming after the click, then three grey pips that light one per completed wave', () => {
    cheatAbilities();
    waveActive.set(true);
    expect(nuke().view).toMatchObject({ state: 'ready', enabled: true });

    // K or the button: AbilityTargetingService.toggle arms the targeting mode
    targeting.set('nuclear-strike');
    expect(nuke().view).toMatchObject({ state: 'armed', enabled: true });

    // The click on the route: command:use-ability, and the service leaves the mode
    bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: { lat: 48.7758, lon: 9.1829, height: 0 } });
    targeting.set(null);
    expect(nuke().view).toMatchObject({ state: 'pending', enabled: false, pips: [false, false, false] });

    for (let i = 0; i < WARNING_STEPS; i++) abilities.update(STEP_MS);
    expect(nuke().view).toMatchObject({
      state: 'recharging',
      enabled: false,
      pips: [false, false, false],
      label: 'Nuclear Strike: recharges in 3 waves',
    });
    expect(nuke().tooltip.stats?.[0]).toEqual({ label: 'CHARGES', value: '0/1' });

    // The wave of the use counts: one pip per completed wave
    completeWave(1);
    expect(nuke().view.pips).toEqual([true, false, false]);
    waveActive.set(true);
    completeWave(2);
    expect(nuke().view.pips).toEqual([true, true, false]);
    waveActive.set(true);
    completeWave(3);
    expect(nuke().view).toMatchObject({ state: 'waiting', pips: [true, true, true] });
    waveActive.set(true);
    expect(nuke().view.state).toBe('ready');

    // The other three kept their charges all along
    for (const button of bar.buttons().filter((b) => b.id !== 'nuclear-strike')) {
      expect(button.view.state, button.id).toBe('ready');
    }
  });
});
