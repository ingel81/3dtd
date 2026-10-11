import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

vi.mock('../../../services/facade/location-facade.service', () => ({ LocationFacadeService: class LocationFacadeService {} }));
vi.mock('../../../services/infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('../../../store/tower-defense.store', () => ({ TowerDefenseStore: class TowerDefenseStore {} }));

import { LaneChoiceComponent } from './lane-choice.component';
import { LocationFacadeService } from '../../../services/facade/location-facade.service';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { UIStore } from '../../../store/ui.store';
import { WorldContext } from '../../../world/world-context.service';
import { laneChoiceOf } from '../../../world/custom-map/lane-choice';
import type { WorldLanes } from '../../../world/world-provider';

/** Three spawns, the first always open, at most two open */
function lanesOf(): WorldLanes {
  const choice = laneChoiceOf([
    { id: 'a', name: 'North', x: 0, y: 0 },
    { id: 'b', name: 'East', x: 0, y: 0, optional: true },
    { id: 'c', name: 'South', x: 0, y: 0, optional: true },
  ], { lanes: { max: 2 } });
  let open = ['a', 'b'];
  return { choice, open: () => open, setOpen: (ids) => ((open = [...ids]), true) };
}

describe('LaneChoiceComponent (TODO E130)', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup(opts: { started?: boolean; locked?: boolean } = {}) {
    const lanes = lanesOf();
    const setOpenLanes = vi.fn(async (ids: readonly string[]) => lanes.setOpen(ids));
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldContext, useValue: { provider: signal({ lanes: () => lanes }) } },
        { provide: LocationFacadeService, useValue: { setOpenLanes } },
        { provide: TowerDefenseStore, useValue: { gameStarted: signal(opts.started ?? false) } },
        { provide: UIStore, useValue: { coopMapLocked: signal(opts.locked ?? false) } },
        { provide: EngineInitializationService, useValue: { loading: signal(false) } },
      ],
    });
    const fixture = TestBed.createComponent(LaneChoiceComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = (id: string) => el.querySelector<HTMLInputElement>(`[data-lane="${id}"] input`)!;
    return { fixture, el, box, setOpenLanes };
  }

  it('lists the lanes with their switches before wave 1 and says what the open ones bring', () => {
    const { el, box } = setup();
    expect([...el.querySelectorAll('.lc-name')].map((n) => n.textContent)).toEqual(['North', 'East', 'South']);
    expect([box('a').checked, box('b').checked, box('c').checked]).toEqual([true, true, false]);
    // Always open; at most two, so South cannot open while East is
    expect(box('a').disabled).toBe(true);
    expect(box('b').disabled).toBe(false);
    expect(box('c').disabled).toBe(true);
    expect(el.textContent).toContain('2 lanes open: each brings a full wave, 2 times the enemies');
  });

  it('closes a lane through the facade and reads the lanes again', async () => {
    const { fixture, el, box, setOpenLanes } = setup();
    box('b').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(setOpenLanes).toHaveBeenCalledWith(['a']);
    expect(box('b').checked).toBe(false);
    expect(box('c').disabled).toBe(false);
    expect(el.textContent).toContain('1 lane open: one wave at a time');
  });

  it('stays away once a wave was played and for a coop guest', () => {
    expect(setup({ started: true }).el.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();
    expect(setup({ locked: true }).el.querySelector('section')).toBeNull();
  });
});
