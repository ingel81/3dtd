/**
 * Playtest 340 to 343, 345 and 346 (docs/archive/REVIEW_SPRINT_2026-09-14.md, world
 * map). The waves go over the main bus into the real BestWaveService
 * and its localStorage key; the place picker of the menu's New game page
 * and the game-over hint are rendered with their real templates (read from disk, the vitest build has
 * no templateUrl loader). The globe, the icons and the address search are
 * stubs that keep the inputs they get: the globe draws on a canvas jsdom
 * does not have. Not covered: how the globe turns and looks, the layout
 * under Restart, the 1.2 s fade-in (CSS), the size of the globe chunk.
 */
// The components are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMainEventBus, type MainEventBus } from '../../../../sim/client/view-events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { BestWaveService } from '../../../../services/location/best-wave.service';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../../../services/location/geocoding.service';
import { GeolocationService } from '../../../../services/location/geolocation.service';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import { GameStore } from '../../../../store/game.store';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { BEST_WAVES_KEY, type BestWave } from '../../../../services/location/best-waves';
import { PlacePickerComponent } from './place-picker.component';
import { WorldRecordComponent } from '../../../world-globe/world-record.component';
import type { NewRecord } from '../../../../services/location/best-wave.service';

const template = (path: string) => readFileSync(resolve(path), 'utf8');

@Component({ selector: 'app-world-globe', standalone: true, template: '' })
class GlobeStub {
  readonly records = input<readonly BestWave[]>([]);
  readonly current = input<{ lat: number; lon: number } | null>(null);
  readonly highlight = input<{ lat: number; lon: number } | null>(null);
  readonly size = input(300);
  readonly selectable = input(true);
  readonly picked = output<BestWave>();
}

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
  readonly strokeWidth = input(1.5);
}

@Component({ selector: 'app-td-address-autocomplete', standalone: true, template: '' })
class AutocompleteStub {
  readonly placeholder = input('');
  readonly currentValue = input<unknown>(null);
  readonly locationSelected = output<unknown>();
  readonly locationCleared = output<void>();
}

/**
 * The @Input annotation the Angular compiler's JIT transform adds for every
 * input() (`isSignal`, read by the JIT directive compiler). Plain vitest runs
 * without that transform, so signal inputs would stay unbound.
 */
function markSignalInputs(type: { prototype: object }, names: string[], required: string[] = []): void {
  for (const name of names) {
    Input({ alias: name, required: required.includes(name), isSignal: true } as Input)(type.prototype, name);
  }
}
markSignalInputs(GlobeStub, ['records', 'current', 'highlight', 'size', 'selectable']);
markSignalInputs(IconStub, ['name', 'size', 'strokeWidth']);
markSignalInputs(AutocompleteStub, ['placeholder', 'currentValue']);
markSignalInputs(WorldRecordComponent, ['record', 'records'], ['record', 'records']);

const HEILBRONN = { lat: 49.1427, lon: 9.2109 };
const PARIS = { lat: 48.8584, lon: 2.2945 };

/** The place being played, as LocationManagementService holds it */
function makeLocation() {
  const hq = signal<{ lat: number; lon: number } | null>(HEILBRONN);
  return {
    hq,
    editableHqLocation: hq,
    getLocationDisplayName: () => 'Heilbronn',
    favorites: signal([]),
    spawns: signal([{ lat: 49.15, lon: 9.21 }]),
    displayName: signal('Marktplatz 1, Heilbronn'),
    address: signal<NominatimAddress | null>({ city: 'Heilbronn' } as NominatimAddress),
    recents: signal([]),
  };
}

describe('World map, playtest 340 to 346', () => {
  let location: ReturnType<typeof makeLocation>;
  let bus: MainEventBus;
  let bestWaves: BestWaveService;
  let chosen: PlaceChoice[];

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  /** Real templates, stub children; the overrides live as long as one testing module */
  function overrideTemplates(): void {
    TestBed.overrideComponent(PlacePickerComponent, {
      set: {
        template: template('src/app/components/main-menu/pages/new-game/place-picker.component.html'),
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [IconStub, GlobeStub, AutocompleteStub],
      },
    });
    TestBed.overrideComponent(WorldRecordComponent, {
      set: {
        template: template('src/app/components/world-globe/world-record.component.html'),
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [GlobeStub],
      },
    });
  }

  /** A fresh BestWaveService on the stored records, as after a page load. */
  function loadPage(): void {
    bestWaves?.disconnect();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocationManagementService, useValue: location },
        {
          provide: GeocodingService,
          useValue: { extractLocationName: (a: NominatimAddress) => a.city ?? UNKNOWN_LOCATION_NAME },
        },
        { provide: GeolocationService, useValue: {} },
        { provide: LocationChangeCoordinatorService, useValue: { favoriteNamesMap: signal({}) } },
        { provide: GameStore, useFactory: () => ({ gameStarted: signal(running), towerCount: signal(0) }) },
      ],
    });
    overrideTemplates();
    bestWaves = TestBed.inject(BestWaveService);
    bestWaves.connect(bus);
  }

  const wave = (n: number) => bus.emit({ type: 'wave:started', wave: n, enemyCount: 10 });
  const waves = (to: number) => { for (let n = 1; n <= to; n++) wave(n); };
  const gameOver = () => bus.emit({ type: 'game:over', reason: 'base-destroyed' });
  const restart = () => bus.emit({ type: 'game:reset' });

  /** Load the place `hq` with spawn `spawn`, named `town`, as the location change does. */
  function playAt(hq: { lat: number; lon: number }, town: string, spawn = { lat: hq.lat + 0.005, lon: hq.lon }): void {
    restart();
    location.hq.set(hq);
    location.spawns.set([spawn]);
    location.displayName.set(`Main St, ${town}`);
    location.address.set({ city: town } as NominatimAddress);
  }

  /** A run under way at the place loaded */
  let running = true;

  async function openWorld(setup: { place?: boolean; running?: boolean } = {}): Promise<ComponentFixture<PlacePickerComponent>> {
    running = setup.running ?? true;
    if (setup.place === false) location.hq.set(null);
    const fixture = TestBed.createComponent(PlacePickerComponent);
    chosen = [];
    fixture.componentInstance.chosen.subscribe((choice) => chosen.push(choice));
    fixture.componentInstance.list.set('world');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const rows = (fixture: ComponentFixture<unknown>) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.mp-world .mp-row'));
  const rowText = (row: HTMLElement) =>
    `${row.querySelector('.mp-name')!.textContent!.trim()} | ${row.querySelector('.mp-meta')!.textContent!.trim()}`;
  const globe = (fixture: ComponentFixture<unknown>) =>
    fixture.debugElement.query((d) => d.componentInstance instanceof GlobeStub).componentInstance as GlobeStub;
  const text = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  beforeEach(() => {
    localStorage.clear();
    location = makeLocation();
    bus = createMainEventBus();
    loadPage();
  });

  afterEach(() => {
    bestWaves.disconnect();
    bus.clear();
    TestBed.resetTestingModule();
  });

  it('340: after wave 2 the place being played is greyed, "playing now, wave 2", and a click does nothing', async () => {
    waves(2);
    const fixture = await openWorld();

    const [row] = rows(fixture);
    expect(rows(fixture)).toHaveLength(1);
    expect(rowText(row)).toBe('Heilbronn | playing now, wave 2');
    expect(row.disabled).toBe(true);
    // The disabled button gets no click; the handler refuses the place as well
    row.click();
    fixture.componentInstance.loadRecord(bestWaves.records()[0]);
    expect(chosen).toEqual([]);
    // The globe gets the place as current: grey ring, not clickable (world-globe.component.ts:226, :354)
    expect(globe(fixture).current()).toEqual(HEILBRONN);
  });

  it('343: two places, the highest wave first; hover hands the row to the globe; the warning; a click loads the record run\'s spawn', async () => {
    const spawnA = { lat: 48.862, lon: 2.3 };
    const spawnB = { lat: 48.855, lon: 2.29 };
    waves(2);
    playAt(PARIS, 'Paris', spawnA);
    waves(1);
    // A later run at Paris with another spawn beats the record: the record takes its spawn
    playAt(PARIS, 'Paris', spawnB);
    waves(3);
    // Back at Heilbronn with a run under way there
    location.hq.set(HEILBRONN);
    const fixture = await openWorld();

    expect(rows(fixture).map(rowText)).toEqual(['Paris | wave 3', 'Heilbronn | playing now, wave 2']);
    expect(text(fixture)).toContain('The run at Heilbronn ends when a new place loads.');

    const paris = rows(fixture)[0];
    paris.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(globe(fixture).highlight()).toEqual(PARIS);
    paris.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(globe(fixture).highlight()).toBeNull();

    paris.click();
    expect(chosen).toEqual([{ kind: 'place', hq: { ...PARIS, name: 'Main St, Paris' }, spawn: spawnB }]);
  });

  it('343: no warning when no game is running', async () => {
    waves(1);
    const fixture = await openWorld({ running: false });
    expect(text(fixture)).not.toContain('The current game will be ended');
  });

  it('345: wave 5 reached, a reload without game over: the world list shows wave 5 for the place', async () => {
    waves(5);
    loadPage();
    const fixture = await openWorld({ place: false, running: false });

    expect(rows(fixture).map(rowText)).toEqual(['Heilbronn | wave 5']);
    expect(rows(fixture)[0].disabled).toBe(false);
  });

  it('346: with td_best_waves_v1 gone the world list is empty and says how it fills', async () => {
    waves(3);
    localStorage.removeItem(BEST_WAVES_KEY);
    loadPage();
    const fixture = await openWorld({ place: false, running: false });

    expect(rows(fixture)).toHaveLength(0);
    expect(text(fixture)).toContain('Every place you defend shows up here with the best wave you reached.');
  });

  describe('game-over hint', () => {
    function hint(record: NewRecord): ComponentFixture<WorldRecordComponent> {
      const fixture = TestBed.createComponent(WorldRecordComponent);
      fixture.componentRef.setInput('record', record);
      fixture.componentRef.setInput('records', bestWaves.records());
      fixture.componentInstance.dismissed.subscribe(() => bestWaves.dismissRecord());
      fixture.detectChanges();
      return fixture;
    }

    it('341: the first run at a place: "New record for Heilbronn: wave 3", "First run here"; Skip hides it', () => {
      waves(3);
      gameOver();
      const fixture = hint(bestWaves.newRecord()!);

      expect(text(fixture)).toContain('New record for Heilbronn: wave 3');
      expect(text(fixture)).toContain('First run here');
      expect(globe(fixture).highlight()).toEqual(HEILBRONN);

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.record-skip')!.click();
      expect(bestWaves.newRecord()).toBeNull();
    });

    it('649: game over before wave 1 (HQ drained by the +HP cheat): no hint, no record; after wave 1: "First run here"', () => {
      // Round 13 went down this way: WAVE 0 on the summary, so no wave had started
      gameOver();
      expect(bestWaves.newRecord()).toBeNull();
      expect(bestWaves.records()).toEqual([]);

      restart();
      wave(1);
      gameOver();
      const fixture = hint(bestWaves.newRecord()!);
      expect(text(fixture)).toContain('New record for Heilbronn: wave 1');
      expect(text(fixture)).toContain('First run here');
    });

    it('342: restart and die earlier: no hint; again and die later: "Best before: wave 3"', () => {
      waves(3);
      gameOver();
      restart();
      waves(2);
      gameOver();
      expect(bestWaves.newRecord()).toBeNull();

      restart();
      waves(4);
      gameOver();
      const fixture = hint(bestWaves.newRecord()!);
      expect(text(fixture)).toContain('New record for Heilbronn: wave 4');
      expect(text(fixture)).toContain('Best before: wave 3');
      expect(text(fixture)).not.toContain('First run here');
    });
  });
});
