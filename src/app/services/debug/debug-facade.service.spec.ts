import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { DebugFacadeService } from './debug-facade.service';
import { UIStore } from '../../store/ui.store';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { CombatEffectService } from '../combat/combat-effect.service';
import type { ThreeTilesEngine } from '../../three-engine';
import { DEFAULT_VFX_SETTINGS, matchingVfxPreset } from '../../three-engine/vfx-settings';
import { LEGACY_FPS_LIMIT_KEY, STORAGE_KEY } from '../../utils/display-options.storage';
import { GameEventBus } from '../../game-engine/game-event-bus';
import type { GameStateManager } from '../../managers/game-state.manager';

function createFacade(uiStore: object = {}): DebugFacadeService {
  const injector = Injector.create({
    providers: [
      { provide: UIStore, useValue: uiStore },
      { provide: EnemyDebugService, useValue: {} },
      { provide: MarkerVisualizationService, useValue: {} },
      { provide: CombatEffectService, useValue: {} },
    ],
  });
  return runInInjectionContext(injector, () => new DebugFacadeService());
}

function fakeEngine() {
  const engine = { renderLoop: { setFpsLimit: vi.fn() }, applyVfxSettings: vi.fn() };
  return { engine, asEngine: engine as unknown as ThreeTilesEngine };
}

function store(options: object): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

describe('DebugFacadeService cheats', () => {
  it('readies the Nuclear Strike through a deferred debug event, for the next sub-step', () => {
    const appendDebugLog = vi.fn();
    const facade = createFacade({ appendDebugLog });
    const bus = new GameEventBus();
    const received = vi.fn();
    bus.on('debug:ready-ability', received);

    facade.readyNuclearStrike({ getEventBus: () => bus } as unknown as GameStateManager);
    expect(received).not.toHaveBeenCalled();
    bus.processQueue();
    expect(received).toHaveBeenCalledWith({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
    expect(appendDebugLog).toHaveBeenCalledWith('Nuclear Strike ready (Debug)');
  });
});

describe('DebugFacadeService frame cap', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to unlimited', () => {
    expect(createFacade().fpsLimit()).toBe(0);
  });

  it('restores a stored cap and hands it to the engine', () => {
    store({ fpsLimit: 30 });
    const facade = createFacade();
    expect(facade.fpsLimit()).toBe(30);

    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);
    facade.applyDisplayOptions();
    expect(engine.renderLoop.setFpsLimit).toHaveBeenCalledWith(30);
  });

  it('takes the cap from the key it had before', () => {
    localStorage.setItem(LEGACY_FPS_LIMIT_KEY, '60');
    expect(createFacade().fpsLimit()).toBe(60);
    expect(stored()).toEqual({ fpsLimit: 60 });
  });

  it('treats a value it does not offer as unlimited', () => {
    for (const value of [45, 'abc', -30, null]) {
      store({ fpsLimit: value });
      expect(createFacade().fpsLimit()).toBe(0);
    }
  });

  it('applies and persists a new cap', () => {
    store({ damageNumbers: false });
    const facade = createFacade();
    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);

    facade.onFpsLimitChanged(60);

    expect(facade.fpsLimit()).toBe(60);
    expect(engine.renderLoop.setFpsLimit).toHaveBeenCalledWith(60);
    expect(stored()).toEqual({ damageNumbers: false, fpsLimit: 60 });
  });
});

describe('DebugFacadeService display options', () => {
  beforeEach(() => localStorage.clear());

  it('starts the shared signals from the stored options', () => {
    store({ healthBars: false, screenShake: false });
    const facade = createFacade();
    expect(facade.healthBarsVisible()).toBe(false);
    expect(facade.screenShakeEnabled()).toBe(false);
    expect(facade.damageNumbersVisible()).toBe(true);
  });
});

describe('DebugFacadeService VFX settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the stored switches, the defaults for the rest', () => {
    store({ projectileTrails: false, colorGrading: 'noir', bloom: 'yes' });
    expect(createFacade().vfx()).toEqual({ ...DEFAULT_VFX_SETTINGS, projectileTrails: false, colorGrading: 'noir' });
  });

  it('hands them to the engine with the other display options', () => {
    store({ groundMarks: false });
    const facade = createFacade();
    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);
    facade.applyDisplayOptions();
    expect(engine.applyVfxSettings).toHaveBeenCalledWith({ ...DEFAULT_VFX_SETTINGS, groundMarks: false });
  });

  it('applies a changed switch at once and persists it next to the other options', () => {
    store({ healthBars: false });
    const facade = createFacade();
    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);

    facade.onVfxSettingsChanged({ impactEffects: false });

    const expected = { ...DEFAULT_VFX_SETTINGS, impactEffects: false };
    expect(facade.vfx()).toEqual(expected);
    expect(engine.applyVfxSettings).toHaveBeenLastCalledWith(expected);
    expect(stored()).toEqual({ healthBars: false, ...expected });
    expect(createFacade().vfx()).toEqual(expected); // after a reload
  });

  it('sets the preset switches and leaves the freeze tint alone', () => {
    const facade = createFacade();
    facade.onVfxSettingsChanged({ freezeTint: false });

    facade.onVfxPresetSelected('low');

    expect(matchingVfxPreset(facade.vfx())).toBe('low');
    expect(facade.vfx().freezeTint).toBe(false);
  });

  it('takes the color grading of the debug window as a VFX setting', () => {
    const facade = createFacade();
    facade.onColorGradingChanged('warm-sunset');
    expect(facade.vfx().colorGrading).toBe('warm-sunset');
    expect(stored()['colorGrading']).toBe('warm-sunset');
  });
});
