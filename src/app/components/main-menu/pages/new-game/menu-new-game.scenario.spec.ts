/**
 * The New game page hands the picker's choice on: before the first place to
 * the waiting start, the menu back on its list where the load shows; in a
 * game the menu steps aside and the coordinator goes there. A coop guest
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

@Component({ selector: 'app-place-picker', standalone: true, template: '' })
class PickerStub {
  readonly chosen = output<PlaceChoice>();
}
// The annotations the JIT transform adds for input() and output(); plain vitest runs without them
Output('chosen')(PickerStub.prototype, 'chosen');
Input({ alias: 'layer', required: true, isSignal: true } as Input)(MenuNewGameComponent.prototype, 'layer');

describe('New game page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(waiting: boolean, locked = false) {
    const menu = { back: vi.fn(), close: vi.fn() };
    const coordinator = { awaitingStartChoice: signal(waiting), choosePlace: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: MainMenuService, useValue: menu },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
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

  it('before the first place: the start takes the choice, the menu goes back to its list', () => {
    const { picker, menu, coordinator } = open(true);
    picker!.chosen.emit(CHOICE);
    expect(coordinator.choosePlace).toHaveBeenCalledWith(CHOICE);
    expect(menu.back).toHaveBeenCalledTimes(1);
    expect(menu.close).not.toHaveBeenCalled();
  });

  it('in a game: the menu steps aside and the place changes', () => {
    const { picker, menu, coordinator } = open(false);
    picker!.chosen.emit({ kind: 'dice' });
    expect(menu.close).toHaveBeenCalledTimes(1);
    expect(coordinator.choosePlace).toHaveBeenCalledWith({ kind: 'dice' });
  });

  it('a coop guest gets no picker: the host picks the place', () => {
    const { fixture, picker } = open(false, true);
    expect(picker).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The host picks the place of this room.');
  });
});
