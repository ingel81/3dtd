/**
 * The New game page hands the picker's choice on to the coordinator (the
 * waiting start, or a change in a game), the menu on its start list where
 * the load shows and Play waits; a map of a place goes to its frame on the
 * globes, the game held behind them. On a map it leads to the worlds. A coop
 * guest gets no picker. The picker is a stub here (its own scenarios cover it).
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Input, Output, output, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { MenuNewGameComponent } from './menu-new-game.component';
import { WorldContext } from '../../../../world/world-context.service';
import { fakeWorldContext } from '../../../../../test/world-context-fake';
import type { OsmFrameRequest } from '../../../osm-frame/osm-frame-request';

@Component({ selector: 'app-place-picker', standalone: true, template: '' })
class PickerStub {
  readonly chosen = output<PlaceChoice>();
  readonly mapOfPlace = output<OsmFrameRequest>();
}

// The annotations the JIT transform adds for input() and output(); plain vitest runs without them
Output('chosen')(PickerStub.prototype, 'chosen');
Output('mapOfPlace')(PickerStub.prototype, 'mapOfPlace');
Input({ alias: 'layer', required: true, isSignal: true } as Input)(MenuNewGameComponent.prototype, 'layer');

describe('New game page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(waiting: boolean, locked = false, onMap = false) {
    const menu = {
      home: vi.fn(), close: vi.fn(), makeMapOf: vi.fn(), leaveTo: vi.fn(),
      leaveWhy: signal<string | null>(null), worldMenuLabel: signal('Built Worlds'),
    };
    const coordinator = { awaitingStartChoice: signal(waiting), choosePlace: vi.fn(async () => true) };
    const world = fakeWorldContext();
    if (onMap) world.useCustomMap('demo-valley', 'Demo Valley');
    TestBed.configureTestingModule({
      providers: [
        { provide: MainMenuService, useValue: menu },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: WorldContext, useValue: world },
      ],
    });
    TestBed.overrideComponent(MenuNewGameComponent, { set: { imports: [PickerStub] } });
    TestBed.inject(UIStore).coopMapLocked.set(locked);
    const fixture = TestBed.createComponent(MenuNewGameComponent);
    fixture.componentRef.setInput('layer', waiting ? 'start' : 'pause');
    fixture.detectChanges();
    const picker = fixture.debugElement.query((d) => d.componentInstance instanceof PickerStub)?.componentInstance as PickerStub | undefined;
    return { fixture, menu, coordinator, picker };
  }

  const CHOICE: PlaceChoice = { kind: 'place', hq: { lat: 48.78, lon: 9.18, name: 'Stuttgart' }, spawn: null };

  it('before the first place: the start takes the choice, the menu goes to its start list', () => {
    const { picker, menu, coordinator } = open(true);
    picker!.chosen.emit(CHOICE);
    expect(coordinator.choosePlace).toHaveBeenCalledWith(CHOICE);
    expect(menu.home).toHaveBeenCalledWith('start');
    expect(menu.close).not.toHaveBeenCalled();
  });

  it('in a game: the place changes behind the start list, the menu does not close and open again', () => {
    const { picker, menu, coordinator } = open(false);
    picker!.chosen.emit({ kind: 'dice' });
    expect(menu.home).toHaveBeenCalledWith('start');
    expect(menu.close).not.toHaveBeenCalled();
    expect(coordinator.choosePlace).toHaveBeenCalledWith({ kind: 'dice' });
  });

  it('has no tabs for the maps any more: a map of a place goes to its frame on the globes', () => {
    const { fixture, picker, menu } = open(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=tab]')).toBeNull();
    const request: OsmFrameRequest = { place: { lat: 49.7, lon: 9.26, name: 'Miltenberg', address: 'Miltenberg, Bayern' }, spawnsAt: [] };
    picker!.mapOfPlace.emit(request);
    expect(menu.makeMapOf).toHaveBeenCalledWith(request);
  });

  it('on a map: no place picker, the ways to its world menu and to all worlds', () => {
    const { fixture, menu, picker } = open(false, false, true);
    const root = fixture.nativeElement as HTMLElement;
    expect(picker).toBeUndefined();
    const button = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === label)!;
    button('Built Worlds').click();
    expect(menu.leaveTo).toHaveBeenCalledWith('world');
    button('All worlds').click();
    expect(menu.leaveTo).toHaveBeenCalledWith('globes');
  });

  it('a coop guest gets no picker: the host picks the place', () => {
    const { fixture, picker } = open(false, true);
    expect(picker).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The host picks the place of this room.');
  });
});
