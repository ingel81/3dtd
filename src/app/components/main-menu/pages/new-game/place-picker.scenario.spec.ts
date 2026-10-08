/**
 * The place picker of the menu's New game page, ported from the location
 * dialog's scenarios: no spawn move at a start without a place, "Load place"
 * once the search picked one, moving only the spawn, the warning for a run
 * under way, the one-click lists (recent, favorites, showcase) with the
 * spawn they keep, a pasted link, "Use my location" asked only on its click,
 * and the dice. Real template read from disk (the vitest build has no
 * templateUrl loader); icons, the address search and the globe are stubs.
 * Not covered: the address search itself, the layout.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, Output, input, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { BestWaveService } from '../../../../services/location/best-wave.service';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../../../services/location/geocoding.service';
import { GeolocationService } from '../../../../services/location/geolocation.service';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import { UrlLocationService } from '../../../../services/location/url-location.service';
import { GameStore } from '../../../../store/game.store';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import type { FavoriteLocation } from '../../../../models/location.types';
import type { RecentLocation } from '../../../../services/location/recent-locations';
import { PlacePickerComponent } from './place-picker.component';

const template = readFileSync(resolve('src/app/components/main-menu/pages/new-game/place-picker.component.html'), 'utf8');

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

@Component({ selector: 'app-world-globe', standalone: true, template: '' })
class GlobeStub {
  readonly records = input<unknown>([]);
  readonly current = input<unknown>(null);
  readonly highlight = input<unknown>(null);
  readonly size = input(300);
  readonly picked = output<unknown>();
}

/** The @Input annotation the JIT transform adds for every input(); plain vitest runs without it */
function markSignalInputs(type: { prototype: object }, names: string[]): void {
  for (const name of names) Input({ alias: name, isSignal: true } as Input)(type.prototype, name);
}
markSignalInputs(IconStub, ['name', 'size']);
markSignalInputs(AutocompleteStub, ['placeholder', 'currentValue']);
markSignalInputs(GlobeStub, ['records', 'current', 'highlight', 'size']);
// Same for output(): without the annotation the template's (locationSelected) binds to nothing
for (const name of ['locationSelected', 'locationCleared']) Output(name)(AutocompleteStub.prototype, name);

const HEILBRONN = { lat: 49.1427, lon: 9.2109 };

interface Setup {
  hq?: { lat: number; lon: number; name?: string } | null;
  recents?: RecentLocation[];
  favorites?: FavoriteLocation[];
  waveNumber?: number;
  located?: { lat: number; lon: number } | null;
}

describe('Place picker of New game', () => {
  let chosen: PlaceChoice[];
  let detectLocation: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(setup: Setup = {}): ComponentFixture<PlacePickerComponent> {
    chosen = [];
    detectLocation = vi.fn(async () => (setup.located === undefined ? null : setup.located && { ...setup.located, source: 'browser' }));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LocationManagementService,
          useValue: {
            editableHqLocation: signal(setup.hq ?? null),
            getLocationDisplayName: () => 'Heilbronn',
            recents: signal(setup.recents ?? []),
            favorites: signal(setup.favorites ?? []),
          },
        },
        { provide: LocationChangeCoordinatorService, useValue: { favoriteNamesMap: signal({ b: 'Paris, Trocadéro' }) } },
        { provide: BestWaveService, useValue: { records: signal([]) } },
        { provide: GeolocationService, useValue: { detectLocation } },
        { provide: UrlLocationService, useValue: new UrlLocationService() },
        {
          provide: GeocodingService,
          useValue: {
            extractLocationName: (a: NominatimAddress) => a.city ?? UNKNOWN_LOCATION_NAME,
            reverseGeocodeDetailed: vi.fn(async () => ({ displayName: 'Marktplatz, Ulm', address: { city: 'Ulm' } })),
          },
        },
        { provide: GameStore, useValue: { gameStarted: signal((setup.waveNumber ?? 0) > 0), towerCount: signal(0) } },
      ],
    });
    TestBed.overrideComponent(PlacePickerComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub, AutocompleteStub, GlobeStub] },
    });
    const fixture = TestBed.createComponent(PlacePickerComponent);
    fixture.componentInstance.chosen.subscribe((c) => chosen.push(c));
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<unknown>) => el(f).textContent!.replace(/\s+/g, ' ');
  const button = (f: ComponentFixture<unknown>, label: string) =>
    Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === label) ?? null;
  const click = (f: ComponentFixture<unknown>, label: string) => {
    button(f, label)!.click();
    f.detectChanges();
  };
  const pickPlace = (f: ComponentFixture<unknown>, placeholder: string, place: object) => {
    const search = f.debugElement.queryAll((d) => d.componentInstance instanceof AutocompleteStub)
      .map((d) => d.componentInstance as AutocompleteStub)
      .find((a) => a.placeholder() === placeholder)!;
    search.locationSelected.emit(place);
    f.detectChanges();
  };

  it('a start without a place: no spawn move, no warning, no "Load place" before a pick; the showcase when nothing was played', () => {
    const fixture = open();
    expect(text(fixture)).not.toContain('Move the spawn');
    expect(text(fixture)).not.toContain('ends when a new place loads');
    expect(button(fixture, 'Load place')).toBeNull();
    expect(el(fixture).querySelector('[role="tab"][aria-selected="true"]')!.textContent!.trim()).toBe('Showcase');
  });

  it('a searched place loads with "Load place", a random spawn unless one is picked by address', () => {
    const fixture = open({ hq: HEILBRONN });
    pickPlace(fixture, 'City, street or address…', { lat: 48.78, lon: 9.18, name: 'Stuttgart, Germany', address: { city: 'Stuttgart' } });
    expect(text(fixture)).toContain('Spawn: random, 0.5 to 1 km from the HQ');

    click(fixture, 'Load place');
    expect(chosen).toEqual([{
      kind: 'place',
      hq: { lat: 48.78, lon: 9.18, name: 'Stuttgart, Germany', address: { city: 'Stuttgart' } },
      spawn: null,
    }]);
  });

  it('warns that the run under way ends, not while only the spawn moves', () => {
    const fixture = open({ hq: HEILBRONN, waveNumber: 4 });
    expect(text(fixture)).toContain('The run at Heilbronn ends when a new place loads.');
    click(fixture, 'Move the spawn by address…');
    expect(text(fixture)).not.toContain('ends when a new place loads');
  });

  it('moves only the spawn by address: the HQ stays, too far is refused, "Move spawn" hands on the new spawn', () => {
    const fixture = open({ hq: HEILBRONN });
    click(fixture, 'Move the spawn by address…');
    expect(text(fixture)).toContain('HQ stays at Heilbronn');
    const confirm = () => button(fixture, 'Move spawn')!;
    expect(confirm().disabled).toBe(true);

    pickPlace(fixture, 'Spawn address…', { lat: HEILBRONN.lat + 0.03, lon: HEILBRONN.lon, name: 'Far away' });
    expect(text(fixture)).toContain('at most 1.5 km');
    expect(confirm().disabled).toBe(true);

    pickPlace(fixture, 'Spawn address…', { lat: HEILBRONN.lat + 0.005, lon: HEILBRONN.lon, name: 'Allee' });
    click(fixture, 'Move spawn');
    expect(chosen).toEqual([{
      kind: 'place',
      hq: { ...HEILBRONN, name: 'Heilbronn' },
      spawn: { lat: HEILBRONN.lat + 0.005, lon: HEILBRONN.lon, name: 'Allee' },
    }]);
  });

  it('a showcase place loads with one click: with its fixed spawn and bearing, random without one', () => {
    const fixture = open();
    const picker = fixture.componentInstance;
    picker.loadShowcase({ id: 'nyc', name: 'New York, Times Square', hint: 'Midtown grid', lat: 40.75701, lon: -73.98597 });
    picker.loadShowcase({
      id: 'rio', name: 'Rio de Janeiro, Copacabana', hint: 'Beachfront avenue', lat: -22.96889, lon: -43.18085,
      spawn: { lat: -22.96421, lon: -43.17463, portalBearing: 187.5 },
    });
    expect(chosen).toEqual([
      { kind: 'place', hq: { lat: 40.75701, lon: -73.98597, name: 'New York, Times Square' }, spawn: null },
      {
        kind: 'place',
        hq: { lat: -22.96889, lon: -43.18085, name: 'Rio de Janeiro, Copacabana' },
        spawn: { lat: -22.96421, lon: -43.17463, portalBearing: 187.5 },
      },
    ]);
  });

  it('recent places leave out the one loaded and load with the spawn they were played with', () => {
    const recents = [
      { hq: HEILBRONN, spawns: [{ lat: 49.15, lon: 9.21 }], name: 'Heilbronn', visitedAt: 2 },
      { hq: { lat: 48.78, lon: 9.18 }, spawns: [{ lat: 48.79, lon: 9.19 }], name: 'Stuttgart', visitedAt: 1 },
    ] as RecentLocation[];
    const fixture = open({ hq: HEILBRONN, recents });
    const rows = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.mp-row'));
    expect(rows.map((r) => r.querySelector('.mp-name')!.textContent!.trim())).toEqual(['Stuttgart']);
    rows[0].click();
    expect(chosen).toEqual([{ kind: 'place', hq: { lat: 48.78, lon: 9.18, name: 'Stuttgart' }, spawn: { lat: 48.79, lon: 9.19 } }]);
  });

  it('a favorite loads with every spawn it was saved with; the one loaded is greyed', () => {
    const favorites = [
      { id: 'a', hq: HEILBRONN, spawns: [{ lat: 49.15, lon: 9.21 }], createdAt: 1, name: 'Home' },
      { id: 'b', hq: { lat: 48.86, lon: 2.29 }, spawns: [{ lat: 48.87, lon: 2.3, portalBearing: 90 }, { lat: 48.85, lon: 2.28 }], createdAt: 2 },
    ] as FavoriteLocation[];
    const fixture = open({ hq: HEILBRONN, favorites });
    click(fixture, 'Favorites');
    const rows = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.mp-row'));
    const line = (r: HTMLElement) => `${r.querySelector('.mp-name')!.textContent!.trim()} | ${r.querySelector('.mp-meta')!.textContent!.trim()}`;
    expect(rows.map(line)).toEqual(['Home | playing now', 'Paris, Trocadéro | 2 spawns']);
    expect(rows[0].disabled).toBe(true);
    rows[1].click();
    expect(chosen).toEqual([{
      kind: 'stored',
      hq: { lat: 48.86, lon: 2.29 },
      spawns: [{ lat: 48.87, lon: 2.3, portalBearing: 90 }, { lat: 48.85, lon: 2.28 }],
    }]);
  });

  it('a 3DTD link pasted into the coordinates loads that place with its spawns; coordinates fill both fields', () => {
    const fixture = open();
    click(fixture, 'Coordinates or link');
    const [lat] = Array.from(el(fixture).querySelectorAll<HTMLInputElement>('.mp-coords input'));
    const paste = (value: string) => {
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => value } });
      lat.dispatchEvent(event);
      fixture.detectChanges();
    };

    paste('48.8584, 2.2945');
    expect(fixture.componentInstance.coordLat()).toBe(48.8584);
    expect(fixture.componentInstance.coordLon()).toBe(2.2945);
    expect(chosen).toEqual([]);

    paste('https://3dtd.sgeht.net/play/?l=48.8735,2.29588&s=48.87832,2.29851');
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toMatchObject({ kind: 'stored', hq: { lat: 48.8735, lon: 2.29588 } });
  });

  it('"Use my location" asks the browser only on its click and loads there with a random spawn', async () => {
    const fixture = open({ located: { lat: 48.4, lon: 9.99 } });
    expect(detectLocation).not.toHaveBeenCalled();
    click(fixture, 'Use my location');
    await vi.waitFor(() => expect(chosen).toHaveLength(1));
    expect(detectLocation).toHaveBeenCalledTimes(1);
    expect(chosen).toEqual([{ kind: 'place', hq: { lat: 48.4, lon: 9.99, name: 'Marktplatz, Ulm', address: { city: 'Ulm' } }, spawn: null }]);
  });

  it('"Use my location" says so when the browser gives none', async () => {
    const fixture = open({ located: null });
    click(fixture, 'Use my location');
    await vi.waitFor(() => expect(fixture.componentInstance.locating()).toBe('failed'));
    fixture.detectChanges();
    expect(text(fixture)).toContain('The browser gave no location');
    expect(chosen).toEqual([]);
  });

  it('the dice hands on a roll', () => {
    const fixture = open();
    click(fixture, 'Roll a random city');
    expect(chosen).toEqual([{ kind: 'dice' }]);
  });
});
