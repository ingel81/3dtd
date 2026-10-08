/**
 * The main menu's ways (MainMenuService): open, go to a page, Back, close,
 * and the pause rule: alone the menu pauses the game, in coop never.
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MainMenuService } from './main-menu.service';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';

function setup(inCoop = false) {
  const coopInGame = signal(inCoop);
  TestBed.configureTestingModule({
    providers: [MainMenuService, { provide: COOP, useValue: { inGame: coopInGame } }],
  });
  const menu = TestBed.inject(MainMenuService);
  const ui = TestBed.inject(UIStore);
  const store = TestBed.inject(GameStore);
  const flush = () => TestBed.tick();
  return { menu, ui, store, coopInGame, flush };
}

describe('MainMenuService', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('opens on the list in the pause layer by default, and mirrors it in the UIStore', () => {
    const { menu, ui } = setup();
    menu.open();
    expect(ui.mainMenuOpen()).toBe(true);
    expect(menu.layer()).toBe('pause');
    expect(menu.page()).toBe('home');
  });

  it('goes to pages and back the way it came, then closes from the pause list', () => {
    const { menu } = setup();
    menu.open('home', 'pause');
    menu.open('settings');
    menu.open('extras');
    expect(menu.back()).toBe(true);
    expect(menu.page()).toBe('settings');
    expect(menu.back()).toBe(true);
    expect(menu.page()).toBe('home');
    expect(menu.back()).toBe(true);
    expect(menu.isOpen()).toBe(false);
  });

  it('a page opened directly goes back to the list', () => {
    const { menu } = setup();
    menu.open('coop', 'pause');
    expect(menu.back()).toBe(true);
    expect(menu.page()).toBe('home');
    expect(menu.isOpen()).toBe(true);
  });

  it('Back on the start list does nothing: there is no game behind it', () => {
    const { menu } = setup();
    menu.open('home', 'start');
    expect(menu.back()).toBe(false);
    expect(menu.isOpen()).toBe(true);
  });

  it('an open menu keeps its layer when it goes to a page', () => {
    const { menu } = setup();
    menu.open('home', 'start');
    menu.open('load');
    expect(menu.layer()).toBe('start');
  });

  it('alone it pauses the game while open and lets it go on when it closes', () => {
    const { menu, store, flush } = setup();
    menu.open();
    flush();
    expect(store.paused()).toBe(true);
    menu.close();
    flush();
    expect(store.paused()).toBe(false);
  });

  it('a game paused before stays paused after the menu', () => {
    const { menu, store, flush } = setup();
    store.paused.set(true);
    menu.open();
    flush();
    menu.close();
    flush();
    expect(store.paused()).toBe(true);
  });

  it('in coop it never pauses', () => {
    const { menu, store, flush } = setup(true);
    menu.open('home', 'start');
    flush();
    expect(store.paused()).toBe(false);
  });
});
