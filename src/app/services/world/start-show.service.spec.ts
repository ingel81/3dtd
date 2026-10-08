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
    TestBed.inject(StartShowService).whenPlayed(show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits while the menu stands and plays every show once it closes, in order', () => {
    const ui = TestBed.inject(UIStore);
    const shows = TestBed.inject(StartShowService);
    ui.mainMenu.set({ open: true, layer: 'start', page: 'home' });
    const order: string[] = [];
    shows.whenPlayed(() => order.push('first'));
    shows.whenPlayed(() => order.push('second'));
    TestBed.tick();
    expect(order).toEqual([]);

    ui.mainMenu.set({ open: false, layer: 'start', page: 'home' });
    TestBed.tick();
    expect(order).toEqual(['first', 'second']);

    // Played once
    ui.mainMenu.set({ open: true, layer: 'pause', page: 'home' });
    TestBed.tick();
    ui.mainMenu.set({ open: false, layer: 'pause', page: 'home' });
    TestBed.tick();
    expect(order).toEqual(['first', 'second']);
  });
});
