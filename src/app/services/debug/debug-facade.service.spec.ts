import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { DebugFacadeService } from './debug-facade.service';
import { UIStore } from '../../store/ui.store';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { CombatEffectService } from '../combat/combat-effect.service';
import type { ThreeTilesEngine } from '../../three-engine';

const FPS_LIMIT_KEY = '3dtd-fps-limit';

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

describe('DebugFacadeService frame cap', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to unlimited', () => {
    expect(createFacade().fpsLimit()).toBe(0);
  });

  it('restores a stored cap and hands it to the engine', () => {
    localStorage.setItem(FPS_LIMIT_KEY, '30');
    const facade = createFacade();
    expect(facade.fpsLimit()).toBe(30);

    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);
    facade.applyDisplayOptions();
    expect(engine.setFpsLimit).toHaveBeenCalledWith(30);
  });

  it('treats a value it does not offer as unlimited', () => {
    for (const stored of ['45', 'abc', '-30']) {
      localStorage.setItem(FPS_LIMIT_KEY, stored);
      expect(createFacade().fpsLimit()).toBe(0);
    }
  });

  it('applies and persists a new cap', () => {
    const facade = createFacade();
    const { engine, asEngine } = fakeEngine();
    facade.setEngine(asEngine);

    facade.onFpsLimitChanged(60);

    expect(facade.fpsLimit()).toBe(60);
    expect(engine.setFpsLimit).toHaveBeenCalledWith(60);
    expect(localStorage.getItem(FPS_LIMIT_KEY)).toBe('60');
  });
});
