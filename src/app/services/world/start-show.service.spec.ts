/**
 * The show of a place that stood up (build music, route animation, intro
 * flight) waits for the main menu to close (StartShowService).
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { StartShowService } from './start-show.service';
import { UIStore } from '../../store/ui.store';

describe('StartShowService', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('plays at once without the menu', () => {
    const show = vi.fn();
    TestBed.inject(StartShowService).whenPlayed('place', show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits while the menu stands and plays each kind once it closes, in the order they came', () => {
    const ui = TestBed.inject(UIStore);
    const shows = TestBed.inject(StartShowService);
    ui.mainMenu.set({ open: true, layer: 'start', page: 'home' });
    const order: string[] = [];
    shows.whenPlayed('music', () => order.push('music'));
    shows.whenPlayed('place', () => order.push('place'));
    TestBed.tick();
    expect(order).toEqual([]);

    ui.mainMenu.set({ open: false, layer: 'start', page: 'home' });
    TestBed.tick();
    expect(order).toEqual(['music', 'place']);

    // Played once
    ui.mainMenu.set({ open: true, layer: 'pause', page: 'home' });
    TestBed.tick();
    ui.mainMenu.set({ open: false, layer: 'pause', page: 'home' });
    TestBed.tick();
    expect(order).toEqual(['music', 'place']);
  });

  it('a second place loaded behind the menu replaces the first one’s show: one flight, over the place that stands', () => {
    const ui = TestBed.inject(UIStore);
    const shows = TestBed.inject(StartShowService);
    ui.mainMenu.set({ open: true, layer: 'start', page: 'home' });
    const played: string[] = [];
    shows.whenPlayed('music', () => played.push('music'));
    shows.whenPlayed('place', () => played.push('Heilbronn'));
    shows.whenPlayed('place', () => played.push('Paris'));

    ui.mainMenu.set({ open: false, layer: 'start', page: 'home' });
    TestBed.tick();
    expect(played).toEqual(['music', 'Paris']);
  });

  it('sets the stage first, on the render after the menu closed: the shows then fit the game width', () => {
    const ui = TestBed.inject(UIStore);
    const shows = TestBed.inject(StartShowService);
    const order: string[] = [];
    shows.setStage(() => order.push('stage'));
    ui.mainMenu.set({ open: true, layer: 'start', page: 'home' });
    shows.whenPlayed('place', () => order.push('intro'));
    ui.mainMenu.set({ open: false, layer: 'start', page: 'home' });
    TestBed.tick();
    expect(order).toEqual(['stage', 'intro']);
  });

  it('a show played at once needs no stage', () => {
    const shows = TestBed.inject(StartShowService);
    const stage = vi.fn();
    shows.setStage(stage);
    shows.whenPlayed('place', () => undefined);
    expect(stage).not.toHaveBeenCalled();
  });
});
