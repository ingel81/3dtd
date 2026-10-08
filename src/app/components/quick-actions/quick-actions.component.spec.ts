/**
 * The quick actions: the per-tower LOS button names the mode and the next.
 * Display and audio settings moved to the menu's Settings page; the bar
 * keeps a Settings button and photo mode, the layers and the dev menu.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { QuickActionsComponent } from './quick-actions.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
import { CellReportService } from '../../services/debug/cell-report.service';
import { CorridorSnapshotService } from '../../services/debug/corridor-snapshot.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { UIStore } from '../../store/ui.store';

const template = readFileSync(resolve('src/app/components/quick-actions/quick-actions.component.html'), 'utf8');

describe('QuickActionsComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DebugWindowService, useValue: {} },
        { provide: DebugStateDumpService, useValue: {} },
        { provide: CellReportService, useValue: {} },
        { provide: CorridorSnapshotService, useValue: {} },
        { provide: DevWorldService, useValue: {} },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  const actions = () => TestBed.runInInjectionContext(() => new QuickActionsComponent());

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

  it('has no display or audio menu any more, a Settings button and photo mode instead', () => {
    expect(template).not.toMatch(/displayMenuExpanded|audioMenuExpanded|toggleMenu\('(display|audio)'\)/);
    expect(template).toContain('(click)="settingsRequested.emit()"');
    expect(template).toContain('(click)="photoModeRequested.emit()"');
    expect(template).toContain("toggleMenu('layers')");
    expect(template).toContain("toggleMenu('dev')");
  });

});
