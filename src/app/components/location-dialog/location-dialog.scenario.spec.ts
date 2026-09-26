/**
 * The location dialog after the rework (docs/COOP_UI_REWORK_PLAN.md, P3):
 * the title and the tabs at a start and with a place, no Cancel at a start,
 * "Load place" only once the search picked a place, moving only the spawn
 * (the former Spawn Only tab), and the Coop tab closing with the host's
 * place. Real template read from disk (the vitest build has no templateUrl
 * loader); icons, the address search and the coop entry are stubs.
 * Not covered: the fixed height and the scrolling (CSS), the address search.
 */
// The dialog's Material modules are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, Output, input, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BestWaveService } from '../../services/location/best-wave.service';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../services/location/geocoding.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { COOP } from '../../services/coop.token';
import type { LocationDialogData } from '../../models/location.types';
import { LocationDialogComponent } from './location-dialog.component';

const template = readFileSync(resolve('src/app/components/location-dialog/location-dialog.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}

@Component({ selector: 'app-td-address-autocomplete', standalone: true, template: '' })
class AutocompleteStub {
  readonly placeholder = input('');
  readonly currentValue = input<unknown>(null);
  readonly locationSelected = output<unknown>();
  readonly locationCleared = output<void>();
}

@Component({ selector: 'app-coop-entry', standalone: true, template: '' })
class CoopEntryStub {
  readonly coop = input<unknown>(null);
  readonly canHost = input(true);
}

/** The @Input annotation the JIT transform adds for every input(); plain vitest runs without it */
function markSignalInputs(type: { prototype: object }, names: string[]): void {
  for (const name of names) Input({ alias: name, isSignal: true } as Input)(type.prototype, name);
}
markSignalInputs(IconStub, ['name', 'size']);
// Same for output(): without the annotation the template's (locationSelected) binds to nothing
for (const name of ['locationSelected', 'locationCleared']) Output(name)(AutocompleteStub.prototype, name);
markSignalInputs(AutocompleteStub, ['placeholder', 'currentValue']);
markSignalInputs(CoopEntryStub, ['coop', 'canHost']);

const HEILBRONN = { lat: 49.1427, lon: 9.2109 };

function stubCoop() {
  return { lanAvailable: false, lobby: signal({ name: 'EU', url: 'wss://example.test' }), hostPlace: signal<unknown>(null) };
}

describe('Location dialog, reworked', () => {
  let close: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(data: Partial<LocationDialogData>, coop: ReturnType<typeof stubCoop> | null = null): ComponentFixture<LocationDialogComponent> {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocationManagementService, useValue: { recents: signal([]) } },
        { provide: BestWaveService, useValue: { records: signal([]) } },
        {
          provide: GeocodingService,
          useValue: { extractLocationName: (a: NominatimAddress) => a.city ?? UNKNOWN_LOCATION_NAME },
        },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { currentLocation: null, currentSpawn: null, isGameInProgress: false, ...data } },
        ...(coop ? [{ provide: COOP, useValue: coop }] : []),
      ],
    });
    TestBed.overrideComponent(LocationDialogComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub, AutocompleteStub, CoopEntryStub] },
    });
    const fixture = TestBed.createComponent(LocationDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: ComponentFixture<unknown>) => fixture.nativeElement as HTMLElement;
  const text = (fixture: ComponentFixture<unknown>) => el(fixture).textContent!.replace(/\s+/g, ' ');
  const tabs = (fixture: ComponentFixture<unknown>) =>
    Array.from(el(fixture).querySelectorAll('.mode-tab')).map((t) => t.textContent!.trim());
  const button = (fixture: ComponentFixture<unknown>, label: string) =>
    Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === label) ?? null;
  const pickPlace = (fixture: ComponentFixture<unknown>, placeholder: string, place: object) => {
    const search = fixture.debugElement.queryAll((d) => d.componentInstance instanceof AutocompleteStub)
      .map((d) => d.componentInstance as AutocompleteStub)
      .find((a) => a.placeholder() === placeholder)!;
    search.locationSelected.emit(place);
    fixture.detectChanges();
  };

  it('a start without a place: "Choose a place", Place and World, no Cancel, no confirm before a pick', () => {
    const fixture = open({});
    expect(el(fixture).querySelector('h2')!.textContent).toBe('Choose a place');
    expect(tabs(fixture)).toEqual(['Place', 'World']);
    expect(el(fixture).querySelector('.dialog-actions')).toBeNull();
    expect(text(fixture)).not.toContain('Move the spawn');
  });

  it('with a place: "Change place", Close until the search picks one, then Cancel and "Load place"', () => {
    const fixture = open({ currentLocation: { ...HEILBRONN, name: 'Heilbronn', displayName: 'Heilbronn' } });
    expect(el(fixture).querySelector('h2')!.textContent).toBe('Change place');
    expect(button(fixture, 'Close')).not.toBeNull();
    expect(button(fixture, 'Load place')).toBeNull();

    pickPlace(fixture, 'City, street or address…', { lat: 48.78, lon: 9.18, name: 'Stuttgart', address: { city: 'Stuttgart' } });
    expect(button(fixture, 'Cancel')).not.toBeNull();
    expect(text(fixture)).toContain('Spawn: random, 0.5 to 1 km from the HQ');

    button(fixture, 'Load place')!.click();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true,
      hq: expect.objectContaining({ lat: 48.78, lon: 9.18, name: 'Stuttgart' }),
      spawn: { id: 'spawn_random', lat: 0, lon: 0, isRandom: true },
    }));
  });

  it('moves only the spawn by address: the HQ stays, too far is refused, "Move spawn" closes with the new spawn', () => {
    const fixture = open({ currentLocation: { ...HEILBRONN, name: 'Heilbronn', displayName: 'Heilbronn' }, isGameInProgress: true });
    button(fixture, 'Move the spawn by address…')!.click();
    fixture.detectChanges();
    expect(text(fixture)).toContain('HQ stays');
    // Moving the spawn ends no game
    expect(text(fixture)).not.toContain('The current game will be ended');
    const confirm = () => button(fixture, 'Move spawn')!;
    expect(confirm().disabled).toBe(true);

    pickPlace(fixture, 'Spawn address…', { lat: HEILBRONN.lat + 0.03, lon: HEILBRONN.lon, name: 'Far away' });
    expect(text(fixture)).toContain('at most 1.5 km');
    expect(confirm().disabled).toBe(true);

    pickPlace(fixture, 'Spawn address…', { lat: HEILBRONN.lat + 0.005, lon: HEILBRONN.lon, name: 'Allee' });
    expect(confirm().disabled).toBe(false);
    confirm().click();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      hq: expect.objectContaining({ lat: HEILBRONN.lat, lon: HEILBRONN.lon }),
      spawn: expect.objectContaining({ id: 'spawn_manual', lat: HEILBRONN.lat + 0.005, isRandom: false }),
    }));
  });

  it('the Coop tab at a start closes with the host place once it comes, with every spawn', () => {
    const coop = stubCoop();
    const fixture = open({}, coop);
    expect(tabs(fixture)).toEqual(['Place', 'World', 'Coop']);
    fixture.componentInstance.setEditMode('coop');
    fixture.detectChanges();
    expect(text(fixture)).toContain('To host, pick a place first');

    coop.hostPlace.set({ hq: HEILBRONN, spawns: [{ lat: 49.15, lon: 9.21 }, { lat: 49.13, lon: 9.2 }] });
    TestBed.tick();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true,
      spawns: [{ lat: 49.15, lon: 9.21 }, { lat: 49.13, lon: 9.2 }],
    }));
  });

  it('no Coop tab once a place is loaded', () => {
    const fixture = open({ currentLocation: { ...HEILBRONN, name: 'Heilbronn', displayName: 'Heilbronn' } }, stubCoop());
    expect(tabs(fixture)).toEqual(['Place', 'World']);
  });
});
