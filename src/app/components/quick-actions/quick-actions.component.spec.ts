/**
 * The audio menu of the quick actions: a slider sets its volume and lifts
 * its mute, the buttons toggle the mutes, the menu's icon says whether
 * anything is muted; the per-tower LOS button names the mode and the next.
 * The store carries it all to the audio (TowerDefenseComponent).
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { QuickActionsComponent } from './quick-actions.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
import { CellReportService } from '../../services/debug/cell-report.service';
import { CorridorSnapshotService } from '../../services/debug/corridor-snapshot.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { UIStore } from '../../store/ui.store';

describe('QuickActionsComponent, audio and the LOS filter', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    localStorage.clear();
    const facade = {
      screenShakeEnabled: signal(true), healthBarsVisible: signal(true), damageNumbersVisible: signal(true),
      bossIntroEnabled: signal(true), fpsLimit: signal(0), vfx: signal({}),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DebugWindowService, useValue: {} },
        { provide: DebugFacadeService, useValue: facade },
        { provide: DebugStateDumpService, useValue: {} },
        { provide: CellReportService, useValue: {} },
        { provide: CorridorSnapshotService, useValue: {} },
        { provide: DevWorldService, useValue: {} },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  const actions = () => TestBed.runInInjectionContext(() => new QuickActionsComponent());
  const slider = (value: number) => ({ target: { valueAsNumber: value } }) as unknown as Event;

  it('mutes and unmutes each channel and says on its icon when any is muted', () => {
    const quick = actions();
    const ui = TestBed.inject(UIStore);
    expect(quick.anyMuted()).toBe(false);
    for (const [toggle, muted] of [
      [() => quick.toggleMasterMute(), ui.masterMuted],
      [() => quick.toggleMusicMute(), ui.musicMuted],
      [() => quick.toggleSfxMute(), ui.sfxMuted],
      [() => quick.toggleUiMute(), ui.uiMuted],
    ] as const) {
      toggle();
      expect(muted()).toBe(true);
      expect(quick.anyMuted()).toBe(true);
      toggle();
      expect(muted()).toBe(false);
    }
    expect(quick.anyMuted()).toBe(false);
  });

  it('sets a volume from its slider and lifts that mute, not the others', () => {
    const quick = actions();
    const ui = TestBed.inject(UIStore);
    ui.masterMuted.set(true);
    ui.musicMuted.set(true);
    ui.sfxMuted.set(true);
    ui.uiMuted.set(true);
    quick.onMusicSlider(slider(40));
    expect(ui.musicVolume()).toBe(0.4);
    expect(ui.musicMuted()).toBe(false);
    expect(ui.masterMuted()).toBe(true);
    quick.onSfxSlider(slider(70));
    quick.onUiSlider(slider(10));
    quick.onMasterSlider(slider(90));
    expect([ui.sfxVolume(), ui.uiVolume(), ui.masterVolume()]).toEqual([0.7, 0.1, 0.9]);
    expect([ui.sfxMuted(), ui.uiMuted(), ui.masterMuted()]).toEqual([false, false, false]);
  });

  it('names the per-tower LOS mode on its button and what a click turns it to', () => {
    const quick = actions();
    const ui = TestBed.inject(UIStore);
    const seen = (['both', 'ground', 'air'] as const).map((mode) => {
      ui.perTowerLosFilter.set(mode);
      return [quick.perTowerLosFilterIcon(), quick.perTowerLosFilterTooltip()];
    });
    expect(seen).toEqual([
      ['layers', 'Per-tower LOS: Both layers (click → Ground only)'],
      ['grid', 'Per-tower LOS: Ground only (click → Air only)'],
      ['gridAir', 'Per-tower LOS: Air only (click → Both layers)'],
    ]);
  });
});
