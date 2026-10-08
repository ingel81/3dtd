/**
 * The menu's Extras page: replay file in and out (a replay that starts
 * leaves the menu, a refused one says why), runs and run log, the reference
 * dialogs over the menu, the benchmark asked first and not in coop, and the
 * Legal & privacy and GitHub links opening outside the game (E119). The real
 * template is read from disk; the services are fakes, the dialog openers
 * are spied on.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_ERRORS_SCHEMA, ViewChild, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog } from '@angular/material/dialog';

const openers = vi.hoisted(() => ({ runs: vi.fn(), keys: vi.fn(), attributions: vi.fn(), matrix: vi.fn() }));
vi.mock('../../../runs-dialog/open-runs-dialog', () => ({ openRunsDialog: openers.runs }));
vi.mock('../../../hotkey-help-dialog/open-hotkey-help-dialog', () => ({ openHotkeyHelpDialog: openers.keys }));
vi.mock('../../../attributions-dialog/open-attributions-dialog', () => ({ openAttributionsDialog: openers.attributions }));
vi.mock('../../../damage-matrix-dialog/open-damage-matrix-dialog', () => ({ openDamageMatrixDialog: openers.matrix }));

import { GameStore } from '../../../../store/game.store';
import { COOP } from '../../../../services/coop.token';
import { WhatsNewService } from '../../../../services/onboarding/whats-new.service';
import { RunLogFacade } from '../../../../run-log/run-log.facade';
import { ReplayService } from '../../../../services/replay.service';
import { BenchmarkService } from '../../../../benchmark/benchmark.service';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { ExtrasListComponent, LEGAL_URL } from './extras-list.component';

const template = readFileSync(resolve('src/app/components/main-menu/pages/extras/extras-list.component.html'), 'utf8');

// The annotation the JIT transform adds for viewChild(); plain vitest runs without it
ViewChild('replayInput', { isSignal: true } as unknown as ViewChild)(ExtrasListComponent.prototype, 'replayInput');

interface Setup {
  inCoop?: boolean;
  recorded?: boolean;
  place?: boolean;
  replayStarts?: boolean;
}

describe('Extras page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  async function setup({ inCoop = false, recorded = false, place = true, replayStarts = true }: Setup = {}) {
    const active = signal(false);
    const fileProblem = signal<string | null>(null);
    const replay = {
      active,
      fileProblem,
      recordedWave: signal(recorded ? 3 : null),
      saveFile: vi.fn(async () => true),
      loadFile: vi.fn(async () => {
        if (replayStarts) active.set(true);
        else fileProblem.set('This replay was played on another world.');
      }),
    };
    const benchmark = { start: vi.fn() };
    const runLog = { export: vi.fn(() => true) };
    const whatsNew = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: {} },
        { provide: ReplayService, useValue: replay },
        { provide: BenchmarkService, useValue: benchmark },
        { provide: RunLogFacade, useValue: runLog },
        { provide: WhatsNewService, useValue: whatsNew },
        { provide: LocationManagementService, useValue: { hq: signal(place ? { lat: 1, lon: 2 } : null) } },
        { provide: COOP, useValue: { inGame: signal(inCoop), room: signal(null) } },
      ],
    });
    TestBed.overrideComponent(ExtrasListComponent, {
      // The icon's signal inputs need the AOT compiler; the icon is no part of this test
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    TestBed.inject(GameStore);
    const fixture = TestBed.createComponent(ExtrasListComponent);
    const leave = vi.fn();
    fixture.componentInstance.leave.subscribe(leave);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const row = (name: string) =>
      [...el.querySelectorAll<HTMLElement>('.mp-row')].find((r) => r.querySelector('.mp-name')!.textContent!.trim() === name)!;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((done) => setTimeout(done, 0));
      fixture.detectChanges();
    };
    const pickFile = async () => {
      const input = el.querySelector<HTMLInputElement>('input.mp-file')!;
      Object.defineProperty(input, 'files', { value: [new File(['{}'], 'replay.json.gz')], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle();
    };
    return { el, row, settle, pickFile, leave, replay, benchmark, runLog, whatsNew };
  }

  it('a replay file that starts leaves the menu; one refused says why and stays', async () => {
    const started = await setup();
    const click = vi.spyOn(started.el.querySelector<HTMLInputElement>('input.mp-file')!, 'click').mockImplementation(() => undefined);
    started.row('Load a replay file').click();
    expect(click).toHaveBeenCalledTimes(1);
    await started.pickFile();
    expect(started.replay.loadFile).toHaveBeenCalledTimes(1);
    expect(started.leave).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const refused = await setup({ replayStarts: false });
    await refused.pickFile();
    expect(refused.leave).not.toHaveBeenCalled();
    expect(refused.el.querySelector('.mp-status')!.textContent).toContain('another world');
  });

  it('no replay file without a place or in coop; the replay saves once a wave is recorded', async () => {
    const empty = await setup({ place: false });
    expect((empty.row('Load a replay file') as HTMLButtonElement).disabled).toBe(true);
    expect(empty.row('Load a replay file').textContent).toContain('Load a place first.');
    expect((empty.row('Save the replay') as HTMLButtonElement).disabled).toBe(true);

    TestBed.resetTestingModule();
    const coop = await setup({ inCoop: true, recorded: true });
    expect(coop.row('Load a replay file').textContent).toContain('Replays are off in a coop game.');
    coop.row('Save the replay').click();
    await coop.settle();
    expect(coop.replay.saveFile).toHaveBeenCalledTimes(1);
    expect(coop.el.querySelector('.mp-status')!.textContent).toContain('Replay saved.');
  });

  it('runs, run log and the reference dialogs open over the menu', async () => {
    const { row, settle, el, runLog, whatsNew, leave } = await setup();
    row('Runs').click();
    row('Save the run log').click();
    await settle();
    expect(el.querySelector('.mp-status')!.textContent).toContain('Run log saved.');
    row("What's new").click();
    row('Keyboard shortcuts').click();
    row('Damage vs armor').click();
    row('Attributions').click();
    expect(openers.runs).toHaveBeenCalledTimes(1);
    expect(runLog.export).toHaveBeenCalledTimes(1);
    expect(whatsNew.open).toHaveBeenCalledTimes(1);
    expect(openers.keys).toHaveBeenCalledTimes(1);
    expect(openers.matrix).toHaveBeenCalledTimes(1);
    expect(openers.attributions).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();
  });

  it('asks before the benchmark; Cancel stays; none in coop', async () => {
    const { row, settle, el, benchmark } = await setup();
    row('Benchmark').click();
    await settle();
    expect(benchmark.start).not.toHaveBeenCalled();
    expect(el.textContent).toContain('The page reloads into a test world');
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel')!.click();
    await settle();
    expect(el.textContent).not.toContain('The page reloads into a test world');
    row('Benchmark').click();
    await settle();
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Run')!.click();
    expect(benchmark.start).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const coop = await setup({ inCoop: true });
    expect(coop.row('Benchmark')).toBeUndefined();
  });

  it('Legal & privacy and GitHub open outside the game (E119)', async () => {
    const { row } = await setup();
    const legal = row('Legal & privacy') as HTMLAnchorElement;
    expect(legal.href).toBe(LEGAL_URL);
    expect(LEGAL_URL).toBe('https://3dtd.sgeht.net/legal.html');
    expect(legal.target).toBe('_blank');
    expect(legal.rel).toBe('noopener');
    const repo = row('Source on GitHub') as HTMLAnchorElement;
    expect(repo.href).toBe('https://github.com/ingel81/3dtd');
    expect(repo.target).toBe('_blank');
  });
});
