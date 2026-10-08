import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { COOP } from '../../../services/coop.token';
import { SAVE_GAME, type StartPlace } from '../../../services/save-game/save-game.port';
import { LocationChangeCoordinatorService } from '../../../services/location/location-change-coordinator.service';
import { followStartPlaces } from './start-places';

/** The host's place of a coop join and the place of a save reach a start that waits for a place (E30, E110) */
describe('followStartPlaces', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup(waiting: boolean) {
    const coordinator = { awaitingStartChoice: signal(waiting), choosePlace: vi.fn(async () => true) };
    const startPlace = signal<StartPlace | null>(null);
    const hostPlace = signal<StartPlace | null>(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: SAVE_GAME, useValue: { startPlace } },
        { provide: COOP, useValue: { hostPlace } },
      ],
    });
    TestBed.runInInjectionContext(() => followStartPlaces());
    TestBed.tick();
    return { coordinator, startPlace, hostPlace };
  }

  const HQ = { lat: 49.14, lon: 9.21 };
  const SPAWNS = [{ lat: 49.15, lon: 9.22 }, { lat: 49.13, lon: 9.2 }];

  it('hands the host place of a coop join to the waiting start, with every spawn', () => {
    const { coordinator, hostPlace } = setup(true);
    hostPlace.set({ hq: HQ, spawns: SPAWNS });
    TestBed.tick();
    expect(coordinator.choosePlace).toHaveBeenCalledWith({ kind: 'stored', hq: HQ, spawns: SPAWNS });
  });

  it('hands the place of a save loaded before the first one to the waiting start', () => {
    const { coordinator, startPlace } = setup(true);
    startPlace.set({ hq: HQ, spawns: [SPAWNS[0]] });
    TestBed.tick();
    expect(coordinator.choosePlace).toHaveBeenCalledWith({ kind: 'stored', hq: HQ, spawns: [SPAWNS[0]] });
  });

  it('leaves the place alone once one is loaded: the coop service and the save game go there themselves', () => {
    const { coordinator, hostPlace } = setup(false);
    hostPlace.set({ hq: HQ, spawns: SPAWNS });
    TestBed.tick();
    expect(coordinator.choosePlace).not.toHaveBeenCalled();
  });
});
