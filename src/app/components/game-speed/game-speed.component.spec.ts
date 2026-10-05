/**
 * The speed and pause buttons over the map: the speed steps through
 * GAME_SPEEDS and wraps, the pause toggles and shows the chip; in coop a
 * guest cannot set the speed and pauses only where the room lets them.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GameSpeedComponent } from './game-speed.component';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { GAME_SPEEDS } from '../../configs/game-speed.config';

interface Coop {
  inGame: boolean;
  host: boolean;
  mayPause: boolean;
}

function setup(coop: Coop | null = null) {
  TestBed.configureTestingModule({
    providers: coop
      ? [{ provide: COOP, useValue: { inGame: signal(coop.inGame), isHost: signal(coop.host), mayPause: signal(coop.mayPause) } }]
      : [],
  });
  TestBed.overrideComponent(GameSpeedComponent, {
    // The icon's signal inputs need the AOT compiler; the icon is no part of this test
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const store = TestBed.inject(GameStore);
  const fixture = TestBed.createComponent(GameSpeedComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const pause = el.querySelector<HTMLButtonElement>('.pause-btn')!;
  const speed = el.querySelector<HTMLButtonElement>('.speed-btn')!;
  const click = (button: HTMLButtonElement) => {
    button.click();
    fixture.detectChanges();
  };
  return { store, el, pause, speed, click };
}

describe('GameSpeedComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('steps the speed through every game speed and back to the first', () => {
    const { store, speed, click } = setup();
    const seen: number[] = [];
    for (const _ of GAME_SPEEDS) {
      click(speed);
      seen.push(store.gameSpeed());
    }
    expect(seen).toEqual([...GAME_SPEEDS.slice(1), GAME_SPEEDS[0]]);
    store.gameSpeed.set(GAME_SPEEDS.at(-1)!);
    click(speed);
    expect(speed.textContent).toContain(`${GAME_SPEEDS[0]}x`);
    expect(speed.getAttribute('aria-label')).toBe(`Game speed ${GAME_SPEEDS[0]}x`);
  });

  it('pauses and resumes, with the chip and the pressed state while paused', () => {
    const { store, el, pause, click } = setup();
    expect(el.querySelector('.paused-chip')).toBeNull();
    click(pause);
    expect(store.paused()).toBe(true);
    expect(el.querySelector('.paused-chip')?.textContent).toBe('Paused');
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.getAttribute('aria-label')).toBe('Resume game');
    click(pause);
    expect(store.paused()).toBe(false);
    expect(el.querySelector('.paused-chip')).toBeNull();
  });

  it('leaves the speed to the host in coop, and the pause to the room', () => {
    const { store, pause, speed, click } = setup({ inGame: true, host: false, mayPause: false });
    click(speed);
    click(pause);
    expect(store.gameSpeed()).toBe(1);
    expect(store.paused()).toBe(false);
    expect(speed.getAttribute('aria-disabled')).toBe('true');
    expect(pause.getAttribute('aria-disabled')).toBe('true');
  });

  it('lets a coop guest pause where the room allows it, and the host set the speed', () => {
    const guest = setup({ inGame: true, host: false, mayPause: true });
    guest.click(guest.pause);
    expect(guest.store.paused()).toBe(true);
    TestBed.resetTestingModule();
    const host = setup({ inGame: true, host: true, mayPause: true });
    host.click(host.speed);
    expect(host.store.gameSpeed()).toBe(GAME_SPEEDS[1]);
  });
});
