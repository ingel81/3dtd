// The panel imports partially compiled @angular/material, which needs the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';

// The panel's effects (enemy previews, air alert tone) are not under test here
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => undefined }) };
});
// Only its DI token is needed; the real module pulls in the game state manager
vi.mock('../../../services/replay.service', () => ({ ReplayService: class ReplayService {} }));

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { SidebarWavePanelComponent } from './wave-panel.component';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { UIStore } from '../../../store/ui.store';
import { ResearchStore } from '../../../store/research.store';
import { GameStateManager } from '../../../managers/game-state.manager';
import { ModelPreviewService } from '../../../services/infrastructure/model-preview.service';
import { WaveDebugService } from '../../../services/debug/wave-debug.service';
import { EnemyDebugService } from '../../../services/debug/enemy-debug.service';
import { DebugFacadeService } from '../../../services/debug/debug-facade.service';
import { ReplayService } from '../../../services/replay.service';
import { Tower } from '../../../entities/tower.entity';
import { calculateTotalDPS } from '../../../director/defense-analyzer';

/**
 * The tower DPS the NEXT timeline sizes the coming waves by (towerDps). The
 * towers carry no signals; the store's counters tell the panel when to
 * count again. GameStateSyncService raises towerUpgrades on every
 * tower:upgraded, the one of a tower that is not selected included.
 */
function setup() {
  const towers = [
    new Tower({ lat: 48.77, lon: 9.18, height: 0 }, 'archer'),
    new Tower({ lat: 48.771, lon: 9.18, height: 0 }, 'archer'),
  ];
  const store = {
    towerCount: signal(towers.length),
    towerUpgrades: signal(0),
    selectedTowerRevision: signal(0),
    waveNumber: signal(0),
  };
  const injector = Injector.create({
    providers: [
      { provide: TowerDefenseStore, useValue: store },
      { provide: UIStore, useValue: { autoStartWaves: signal(false) } },
      { provide: ResearchStore, useValue: { completedResearches: signal(new Set()), airTargetingUnlocked: signal(false) } },
      { provide: GameStateManager, useValue: { towerManager: { getAll: () => towers } } },
      { provide: ModelPreviewService, useValue: {} },
      { provide: WaveDebugService, useValue: { currentWaveGroups: signal([]) } },
      { provide: EnemyDebugService, useValue: {} },
      { provide: DebugFacadeService, useValue: { vfx: signal({ bloodMoon: false }) } },
      { provide: ReplayService, useValue: {} },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
    ],
  });
  const panel = runInInjectionContext(injector, () => new SidebarWavePanelComponent());
  return { towers, store, towerDps: () => panel['towerDps']() };
}

describe('SidebarWavePanelComponent, the tower DPS behind NEXT', () => {
  it('counts again after an upgrade of a tower that is not selected (debug "Max Upgrade All", training bot)', () => {
    const { towers, store, towerDps } = setup();
    const before = towerDps();
    expect(before).toBe(calculateTotalDPS(towers));

    // TowerLifecycle.maxUpgradeAll upgrades each tower and emits tower:upgraded for it
    expect(towers[1].applyUpgrade('damage')).toBe(true);
    store.towerUpgrades.update((n) => n + 1);

    expect(towerDps()).toBeGreaterThan(before);
    expect(towerDps()).toBe(calculateTotalDPS(towers));
  });
});
