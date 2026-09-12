import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { DebugFacadeService } from './debug-facade.service';
import { UIStore } from '../../store/ui.store';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { CombatEffectService } from '../combat/combat-effect.service';
import type { ThreeTilesEngine } from '../../three-engine';
import { LEGACY_FPS_LIMIT_KEY, STORAGE_KEY } from '../../utils/display-options.storage';

function createFacade(): DebugFacadeService {
  const injector = Injector.create({
    providers: [
      { provide: UIStore, useValue: {} },
      { provide: EnemyDebugService, useValue: {} },
      { provide: MarkerVisualizationService, useValue: {} },
      { provide: CombatEffectService, useValue: {} },
    ],
  });
  return runInInjectionContext(injector, () => new DebugFacadeService());
}

function fakeEngine() {
  const engine = { setFpsLimit: vi.fn() };
  return { engine, asEngine: engine as unknown as ThreeTilesEngine };
}

function store(options: object): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

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
    expect(engine.setFpsLimit).toHaveBeenCalledWith(30);
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
    expect(engine.setFpsLimit).toHaveBeenCalledWith(60);
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
