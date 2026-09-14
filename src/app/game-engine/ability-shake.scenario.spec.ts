import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { ScreenShakeService } from './screen-shake.service';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { DebugFacadeService } from '../services/debug/debug-facade.service';
import { UIStore } from '../store/ui.store';
import { EnemyDebugService } from '../services/debug/enemy-debug.service';
import { MarkerVisualizationService } from '../services/world/marker-visualization.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import { ABILITIES } from '../configs/abilities.config';
import { SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import { loadDisplayOptions } from '../utils/display-options.storage';
import type { GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS */
const STEP_MS = 16.667;
const NUKE = ABILITIES['nuclear-strike'];
/** 1500 ms of warning in sub-steps */
const WARNING_STEPS = 90;

/**
 * Playtest 320 (night 2, docs/REVIEW_SPRINT_2026-09-14.md), the shake:
 * Display, "Screen Shake" off, then fire the nuclear strike again. The
 * switch goes through DebugFacadeService.onScreenShakeToggled to the game
 * state's ScreenShakeService; the strike is the real AbilityManager's, its
 * impact comes over the real bus. The camera stands on the impact point.
 */
describe('Nuclear strike with Screen Shake switched off, playtest 320 replayed', () => {
  let bus: GameEventBus;
  let abilities: AbilityManager;
  let facade: DebugFacadeService;
  let engine: { triggerScreenShake: ReturnType<typeof vi.fn> };
  let impacts: number;

  beforeEach(() => {
    localStorage.clear();
    bus = new GameEventBus();
    impacts = 0;
    bus.on('ability:impact', () => impacts++);
    engine = { triggerScreenShake: vi.fn() };
    const shakeEngine = {
      ...engine,
      sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: Vector3) => target.set(0, 0, 0) },
      getCamera: () => ({ position: new Vector3() }),
    };
    const shake = new ScreenShakeService(bus, shakeEngine as unknown as ThreeTilesEngine);

    abilities = new AbilityManager(bus, {
      snapToRoute: (target: GeoPosition) => ({ ...target }),
      enemiesInRadius: (_c: unknown, _r: number, out: unknown[]) => out,
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
    } as unknown as AbilityWorld);
    abilities.setPhaseProvider(() => 'wave');
    bus.emit({
      type: 'research:completed',
      researchId: NUKE.researchId,
      effects: [{ kind: 'global-perk', perkId: NUKE.perkId, description: '' }],
    });

    const injector = Injector.create({
      providers: [
        { provide: UIStore, useValue: {} },
        { provide: EnemyDebugService, useValue: {} },
        { provide: MarkerVisualizationService, useValue: {} },
        { provide: CombatEffectService, useValue: {} },
      ],
    });
    facade = runInInjectionContext(injector, () => new DebugFacadeService());
    facade.setEngine(null, { screenShakeService: shake } as unknown as GameStateManager);
  });

  /** Fire at the camera's feet and run the warning out in sub-steps */
  const strike = () => {
    expect(abilities.use('nuclear-strike', { lat: 0, lon: 0, height: 0 }).ok).toBe(true);
    impacts = 0;
    for (let i = 0; i < WARNING_STEPS; i++) abilities.update(STEP_MS);
    expect(impacts).toBe(1);
  };

  it('does not shake once the switch is off, and keeps it off after a reload', () => {
    facade.onScreenShakeToggled(false);
    strike();
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();
    expect(loadDisplayOptions().screenShake).toBe(false);
  });

  it('counter-check: switched back on, the next strike shakes with its own preset', () => {
    facade.onScreenShakeToggled(false);
    facade.onScreenShakeToggled(true);
    strike();
    const { amplitude, duration } = SCREEN_SHAKE_CONFIG.presets.nuclearStrike;
    expect(engine.triggerScreenShake.mock.calls).toEqual([[amplitude, duration]]);
  });
});
