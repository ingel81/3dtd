/**
 * Playtest 340 to 343, 345 and 346 (docs/REVIEW_SPRINT_2026-09-14.md, world
 * map). The waves go over a real GameEventBus into the real BestWaveService
 * and its localStorage key; the location dialog and the game-over hint are
 * rendered with their real templates (read from disk, the vitest build has
 * no templateUrl loader). The globe, the icons and the address search are
 * stubs that keep the inputs they get: the globe draws on a canvas jsdom
 * does not have. Not covered: how the globe turns and looks, the layout
 * under Restart, the 1.2 s fade-in (CSS), the size of the globe chunk.
 */
// The dialog's Material modules are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Component, Input, input, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { BestWaveService } from '../../services/location/best-wave.service';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../services/location/geocoding.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { BEST_WAVES_KEY, type BestWave } from '../../services/location/best-waves';
import type { LocationDialogData } from '../../models/location.types';
import { LocationDialogComponent } from './location-dialog.component';
import { WorldRecordComponent } from '../world-globe/world-record.component';
import type { NewRecord } from '../../services/location/best-wave.service';

const template = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

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
  return {
    hq: signal<{ lat: number; lon: number } | null>(HEILBRONN),
    spawns: signal([{ lat: 49.15, lon: 9.21 }]),
    displayName: signal('Marktplatz 1, Heilbronn'),
    address: signal<NominatimAddress | null>({ city: 'Heilbronn' } as NominatimAddress),
    recents: signal([]),
  };
}

describe('World map, playtest 340 to 346', () => {
  let location: ReturnType<typeof makeLocation>;
  let bus: GameEventBus;
  let bestWaves: BestWaveService;
  let close: ReturnType<typeof vi.fn>;

  /** What the coordinator hands the dialog, read when the dialog is created */
  let dialogData: LocationDialogData;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  /** Real templates, stub children; the overrides live as long as one testing module */
  function overrideTemplates(): void {
    TestBed.overrideComponent(LocationDialogComponent, {
      set: {
        template: template('./location-dialog.component.html'),
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [IconStub, GlobeStub, AutocompleteStub],
      },
    });
    TestBed.overrideComponent(WorldRecordComponent, {
      set: {
        template: template('../world-globe/world-record.component.html'),
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
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: LocationManagementService, useValue: location },
        {
          provide: GeocodingService,
          useValue: { extractLocationName: (a: NominatimAddress) => a.city ?? UNKNOWN_LOCATION_NAME },
        },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
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

  async function openWorld(data: Partial<LocationDialogData> = {}): Promise<ComponentFixture<LocationDialogComponent>> {
    dialogData = {
      currentLocation: { ...HEILBRONN, name: 'Heilbronn', displayName: 'Marktplatz 1, Heilbronn' },
      currentSpawn: null,
      isGameInProgress: true,
      initialMode: 'world',
      ...data,
    };
    const fixture = TestBed.createComponent(LocationDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const rows = (fixture: ComponentFixture<unknown>) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.world-list .quick-item'));
  const rowText = (row: HTMLElement) =>
    `${row.querySelector('.quick-name')!.textContent!.trim()} | ${row.querySelector('.quick-hint')!.textContent!.trim()}`;
  const globe = (fixture: ComponentFixture<unknown>) =>
    fixture.debugElement.query((d) => d.componentInstance instanceof GlobeStub).componentInstance as GlobeStub;
  const text = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  beforeEach(() => {
    localStorage.clear();
    location = makeLocation();
    bus = new GameEventBus();
    loadPage();
  });

  afterEach(() => {
    bestWaves.disconnect();
    bus.clear();
    TestBed.resetTestingModule();
  });

  it('340: after wave 2 the place being played is greyed, "playing now · wave 2", and a click does nothing', async () => {
    waves(2);
    const fixture = await openWorld();

    const [row] = rows(fixture);
    expect(rows(fixture)).toHaveLength(1);
    expect(rowText(row)).toBe('Heilbronn | playing now · wave 2');
    expect(row.disabled).toBe(true);
    // The disabled button gets no click; the handler refuses the place as well
    row.click();
    fixture.componentInstance.loadRecord(bestWaves.records()[0]);
    expect(close).not.toHaveBeenCalled();
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
    const fixture = await openWorld();

    expect(rows(fixture).map(rowText)).toEqual(['Paris | wave 3', 'Heilbronn | playing now · wave 2']);
    expect(text(fixture)).toContain('Warning! The current game will be ended.');

    const paris = rows(fixture)[0];
    paris.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(globe(fixture).highlight()).toEqual(PARIS);
    paris.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(globe(fixture).highlight()).toBeNull();

    paris.click();
    expect(close).toHaveBeenCalledWith({
      hq: { ...PARIS, name: 'Paris', displayName: 'Main St, Paris' },
      spawn: { id: 'spawn_world', ...spawnB, isRandom: false },
      confirmed: true,
    });
  });

  it('343: no warning when no game is running', async () => {
    waves(1);
    const fixture = await openWorld({ isGameInProgress: false });
    expect(text(fixture)).not.toContain('The current game will be ended');
  });

  it('345: wave 5 reached, a reload without game over: the world tab shows wave 5 for the place', async () => {
    waves(5);
    loadPage();
    const fixture = await openWorld({ currentLocation: null, isGameInProgress: false });

    expect(rows(fixture).map(rowText)).toEqual(['Heilbronn | wave 5']);
    expect(rows(fixture)[0].disabled).toBe(false);
  });

  it('346: with td_best_waves_v1 gone the world tab says "None yet" and has no list', async () => {
    waves(3);
    localStorage.removeItem(BEST_WAVES_KEY);
    loadPage();
    const fixture = await openWorld({ currentLocation: null, isGameInProgress: false });

    const hint = (fixture.nativeElement as HTMLElement).querySelector('.world-section .section-hint')!;
    expect(hint.textContent!.trim()).toBe('None yet');
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
