/**
 * The New game page hands the picker's choice on to the coordinator (the
 * waiting start, or a change in a game), the menu on its start list where
 * the load shows and Play waits. A coop guest
 * gets no picker. The picker is a stub here (its own scenarios cover it).
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
import { CUSTOM_MAPS_OPEN } from '../../../../world/custom-maps-open';
import { WorldChoiceService } from '../../../../world/world-choice.service';
import { fakeWorldContext } from '../../../../../test/world-context-fake';
import type { OsmFrameRequest } from '../../../osm-frame/osm-frame-request';
import type { MapSummary } from '../../../../world/custom-map/map-store';

@Component({ selector: 'app-place-picker', standalone: true, template: '' })
class PickerStub {
  readonly chosen = output<PlaceChoice>();
  readonly mapOfPlace = output<OsmFrameRequest>();
}
@Component({ selector: 'app-map-picker', standalone: true, template: '' })
class MapPickerStub {
  readonly toPlaces = output<void>();
}
@Component({ selector: 'app-osm-frame', standalone: true, template: '' })
class FrameStub {
  @Input() place: OsmFrameRequest['place'] | null = null;
  @Input() spawnsAt: OsmFrameRequest['spawnsAt'] = [];
  readonly back = output<void>();
  readonly done = output<{ summary: MapSummary; then: 'play' | 'edit' }>();
}
@Component({ selector: 'app-td-address-autocomplete', standalone: true, template: '' })
class SearchStub {
  @Input() placeholder = '';
  @Input() currentValue: unknown = null;
  readonly locationSelected = output<{ lat: number; lon: number; name: string }>();
}

// The annotations the JIT transform adds for input() and output(); plain vitest runs without them
Output('chosen')(PickerStub.prototype, 'chosen');
Output('mapOfPlace')(PickerStub.prototype, 'mapOfPlace');
Output('toPlaces')(MapPickerStub.prototype, 'toPlaces');
Output('back')(FrameStub.prototype, 'back');
Output('done')(FrameStub.prototype, 'done');
Output('locationSelected')(SearchStub.prototype, 'locationSelected');
Input({ alias: 'layer', required: true, isSignal: true } as Input)(MenuNewGameComponent.prototype, 'layer');

describe('New game page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(waiting: boolean, locked = false, onMap = false) {
    const menu = { home: vi.fn(), close: vi.fn(), tabsShown: () => false, tab: () => 'real' };
    const coordinator = { awaitingStartChoice: signal(waiting), choosePlace: vi.fn(async () => true) };
    const world = fakeWorldContext();
    if (onMap) world.useCustomMap('demo-valley', 'Demo Valley');
    const worlds = { playRealPlaces: vi.fn(), playMap: vi.fn(), editMap: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: MainMenuService, useValue: menu },
        { provide: CUSTOM_MAPS_OPEN, useValue: true },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: WorldContext, useValue: world },
        { provide: WorldChoiceService, useValue: worlds },
      ],
    });
    TestBed.overrideComponent(MenuNewGameComponent, { set: { imports: [PickerStub, MapPickerStub, FrameStub, SearchStub] } });
    TestBed.inject(UIStore).coopMapLocked.set(locked);
    const fixture = TestBed.createComponent(MenuNewGameComponent);
    fixture.componentRef.setInput('layer', waiting ? 'start' : 'pause');
    fixture.detectChanges();
    const picker = fixture.debugElement.query((d) => d.componentInstance instanceof PickerStub)?.componentInstance as PickerStub | undefined;
    return { fixture, menu, coordinator, picker, worlds };
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

  it('switches between the real places and the maps', () => {
    const { fixture } = open(true);
    const root = fixture.nativeElement as HTMLElement;
    const tab = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent!.trim() === label)!;
    expect(tab('Real places').getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('app-map-picker')).toBeNull();
    tab('Maps').click();
    fixture.detectChanges();
    expect(root.querySelector('app-map-picker')).not.toBeNull();
    expect(root.querySelector('app-place-picker')).toBeNull();
  });

  it('on a map: the maps first, and the way back to the real places instead of the place picker', () => {
    const { fixture, worlds } = open(false, false, true);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-map-picker')).not.toBeNull();
    Array.from(root.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent!.trim() === 'Real places')!.click();
    fixture.detectChanges();
    expect(root.querySelector('app-place-picker')).toBeNull();
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === 'Play on real places')!.click();
    expect(worlds.playRealPlaces).toHaveBeenCalled();
  });

  it('a place to make a map of opens its frame in place of the lists; the map made plays or goes to the editor', () => {
    const { fixture, picker, worlds } = open(true);
    const root = fixture.nativeElement as HTMLElement;
    const request: OsmFrameRequest = { place: { lat: 49.7, lon: 9.26, name: 'Miltenberg', address: 'Miltenberg, Bayern' }, spawnsAt: [] };
    picker!.mapOfPlace.emit(request);
    fixture.detectChanges();
    expect(root.querySelector('app-place-picker')).toBeNull();
    const frame = fixture.debugElement.query((d) => d.componentInstance instanceof FrameStub).componentInstance as FrameStub;
    expect(frame.place).toEqual(request.place);
    const summary = { id: 'osm-miltenberg' } as MapSummary;
    frame.done.emit({ summary, then: 'play' });
    expect(worlds.playMap).toHaveBeenCalledWith('osm-miltenberg');
    frame.done.emit({ summary, then: 'edit' });
    expect(worlds.editMap).toHaveBeenCalledWith('osm-miltenberg');
    frame.back.emit();
    fixture.detectChanges();
    expect(root.querySelector('app-place-picker')).not.toBeNull();
  });

  it('on a map without the tiles: a searched place opens the frame of its map', () => {
    const { fixture } = open(false, false, true);
    const root = fixture.nativeElement as HTMLElement;
    Array.from(root.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent!.trim() === 'Real places')!.click();
    fixture.detectChanges();
    const search = fixture.debugElement.query((d) => d.componentInstance instanceof SearchStub).componentInstance as SearchStub;
    search.locationSelected.emit({ lat: 48.78, lon: 9.18, name: 'Stuttgart, Baden-Württemberg' });
    fixture.detectChanges();
    const frame = fixture.debugElement.query((d) => d.componentInstance instanceof FrameStub).componentInstance as FrameStub;
    expect(frame.place).toEqual({ lat: 48.78, lon: 9.18, name: 'Stuttgart', address: 'Stuttgart, Baden-Württemberg' });
  });

  it('a coop guest gets no picker: the host picks the place', () => {
    const { fixture, picker } = open(false, true);
    expect(picker).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The host picks the place of this room.');
  });
});
