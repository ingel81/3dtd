/**
 * The continue bar (docs/SAVE_LOAD_PLAN.md, decision 3): "Continue: <place>,
 * wave N" once a session, while the new run has not begun, alone, with an
 * autosave there. A stand-in save port and store; the icon is a stub.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CONTINUE_OFFERED_KEY, ContinueBarComponent } from './continue-bar.component';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { UIStore } from '../../store/ui.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_SLOT, SAVE_GAME, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';

const AUTOSAVE: SaveSlotInfo = {
  id: AUTOSAVE_SLOT, name: 'Heilbronn, wave 12', autosave: true, wave: 12, location: 'Heilbronn',
  savedAt: '2026-10-05T14:32:00Z', gameVersion: '0.6.0', note: null,
};

interface Setup {
  autosave?: boolean;
  inCoop?: boolean;
  result?: LoadResult;
}

async function setup({ autosave = true, inCoop = false, result = { ok: true, note: null } }: Setup = {}) {
  const store = {
    loading: signal(false),
    error: signal<string | null>(null),
    gameStarted: signal(false),
    towerCount: signal(0),
  };
  const saves = {
    hasAutosave: signal(autosave),
    slots: signal(autosave ? [AUTOSAVE] : []),
    continueAutosave: vi.fn(async () => result),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: TowerDefenseStore, useValue: store },
      { provide: SAVE_GAME, useValue: saves },
      { provide: COOP, useValue: { inGame: signal(inCoop) } },
    ],
  });
  TestBed.overrideComponent(ContinueBarComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(ContinueBarComponent);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((done) => setTimeout(done, 0));
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const bar = () => el.querySelector('.cb');
  return { store, saves, fixture, settle, el, bar };
}

describe('ContinueBarComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => sessionStorage.clear());

  afterEach(() => TestBed.resetTestingModule());

  it('offers the autosave with its place and wave', async () => {
    const { bar } = await setup();
    expect(bar()!.querySelector('.cb-go')!.getAttribute('aria-label')).toBe('Continue: Heilbronn, wave 12');
    expect(bar()!.querySelector('.cb-where')!.textContent).toBe('Heilbronn, wave 12');
  });

  it('offers nothing without an autosave, in coop, or while the game loads', async () => {
    expect((await setup({ autosave: false })).bar()).toBeNull();
    TestBed.resetTestingModule();
    expect((await setup({ inCoop: true })).bar()).toBeNull();
    TestBed.resetTestingModule();
    const loading = await setup();
    loading.store.loading.set(true);
    await loading.settle();
    expect(loading.bar()).toBeNull();
  });

  it('loads the autosave on a click and goes away', async () => {
    const { bar, saves, settle } = await setup();
    bar()!.querySelector<HTMLButtonElement>('.cb-go')!.click();
    await settle();
    expect(saves.continueAutosave).toHaveBeenCalledTimes(1);
    expect(bar()).toBeNull();
  });

  it('puts the version note of an older save into the notice banner', async () => {
    const note = 'Saved with version 0.5.0, values may differ.';
    const { bar, settle } = await setup({ result: { ok: true, note } });
    bar()!.querySelector<HTMLButtonElement>('.cb-go')!.click();
    await settle();
    expect(TestBed.inject(UIStore).notice()?.text).toBe(note);
  });

  it('stays and says why when the load failed', async () => {
    const { bar, el, settle } = await setup({ result: { ok: false, reason: 'The save is damaged.' } });
    bar()!.querySelector<HTMLButtonElement>('.cb-go')!.click();
    await settle();
    expect(bar()).not.toBeNull();
    expect(el.querySelector('.cb-problem')!.textContent).toBe('The save is damaged.');
  });

  it('goes away for this tab once the run begins, and does not come back', async () => {
    const { bar, store, settle } = await setup();
    store.towerCount.set(1);
    await settle();
    expect(bar()).toBeNull();
    store.towerCount.set(0);
    await settle();
    expect(bar()).toBeNull();
    expect(sessionStorage.getItem(CONTINUE_OFFERED_KEY)).toBe('1');

    TestBed.resetTestingModule();
    expect((await setup()).bar()).toBeNull();
  });

  it('the cross sends it away for this tab', async () => {
    const { bar, settle } = await setup();
    bar()!.querySelector<HTMLButtonElement>('.cb-close')!.click();
    await settle();
    expect(bar()).toBeNull();
    expect(sessionStorage.getItem(CONTINUE_OFFERED_KEY)).toBe('1');
  });
});
