import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { BestWaveService } from './best-wave.service';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from './geocoding.service';
import { LocationManagementService } from './location-management.service';
import { BEST_WAVES_KEY, BestWave } from './best-waves';

const HEILBRONN = { lat: 49.1427, lon: 9.2109 };

function makeLocation() {
  return {
    hq: signal<{ lat: number; lon: number } | null>(HEILBRONN),
    spawns: signal([{ lat: 49.15, lon: 9.21 }]),
    displayName: signal('Marktplatz 1, Heilbronn'),
    address: signal<NominatimAddress | null>({ city: 'Heilbronn' } as NominatimAddress),
  };
}

describe('BestWaveService', () => {
  let location: ReturnType<typeof makeLocation>;
  let bus: GameEventBus;
  let service: BestWaveService;
  let playerRun: boolean;

  function create(): BestWaveService {
    const injector = Injector.create({
      providers: [
        { provide: LocationManagementService, useValue: location },
        {
          provide: GeocodingService,
          useValue: { extractLocationName: (a: NominatimAddress) => a.city ?? UNKNOWN_LOCATION_NAME },
        },
      ],
    });
    return runInInjectionContext(injector, () => new BestWaveService());
  }

  const wave = (n: number) => bus.emit({ type: 'wave:started', wave: n, enemyCount: 10 });
  const gameOver = () => bus.emit({ type: 'game:over', reason: 'base-destroyed' });

  beforeEach(() => {
    localStorage.clear();
    location = makeLocation();
    bus = new GameEventBus();
    playerRun = true;
    service = create();
    service.connect(bus, () => playerRun);
  });

  afterEach(() => {
    service.disconnect();
    bus.clear();
  });

  it('records the wave as it starts, named after the town', () => {
    wave(1);
    wave(2);
    expect(service.records()).toEqual([
      expect.objectContaining({
        hq: HEILBRONN,
        spawns: [{ lat: 49.15, lon: 9.21 }],
        name: 'Heilbronn',
        detail: 'Marktplatz 1, Heilbronn',
        bestWave: 2,
      }),
    ]);
    expect(JSON.parse(localStorage.getItem(BEST_WAVES_KEY)!)[0].bestWave).toBe(2);
  });

  it('keeps a higher record when a later run falls earlier', () => {
    wave(1); wave(2); wave(3);
    bus.emit({ type: 'game:reset' });
    wave(1);
    expect(service.records()[0].bestWave).toBe(3);
  });

  it('reports a new record at game over with the best before the run', () => {
    wave(1); wave(2);
    bus.emit({ type: 'game:reset' });
    wave(1); wave(2); wave(3); wave(4);
    gameOver();
    expect(service.newRecord()).toEqual({ hq: HEILBRONN, name: 'Heilbronn', wave: 4, previous: 2 });
  });

  it('reports the first run at a place as a record over 0', () => {
    wave(1);
    gameOver();
    expect(service.newRecord()).toEqual(expect.objectContaining({ wave: 1, previous: 0 }));
  });

  it('reports nothing when the run does not beat the record', () => {
    wave(1); wave(2); wave(3);
    bus.emit({ type: 'game:reset' });
    wave(1); wave(2);
    gameOver();
    expect(service.newRecord()).toBeNull();
  });

  it('clears the record on reset and on dismiss', () => {
    wave(1);
    gameOver();
    service.dismissRecord();
    expect(service.newRecord()).toBeNull();

    bus.emit({ type: 'game:reset' });
    wave(1); wave(2);
    gameOver();
    expect(service.newRecord()).not.toBeNull();
    bus.emit({ type: 'game:reset' });
    expect(service.newRecord()).toBeNull();
  });

  it('records nothing while the bot plays', () => {
    playerRun = false;
    wave(1); wave(2);
    gameOver();
    expect(service.records()).toEqual([]);
    expect(service.newRecord()).toBeNull();
  });

  it('records nothing in DevWorld or without an HQ', () => {
    location.hq.set({ lat: 0, lon: 0 });
    wave(1);
    location.hq.set(null);
    wave(2);
    expect(service.records()).toEqual([]);
  });

  it('falls back to the header text, then to coordinates, while the town is unknown', () => {
    location.address.set(null);
    wave(1);
    expect(service.records()[0].name).toBe('Marktplatz 1, Heilbronn');

    localStorage.clear();
    service.disconnect();
    service = create();
    service.connect(bus, () => true);
    location.displayName.set('Loading...');
    wave(1);
    expect(service.records()[0]).toEqual(expect.objectContaining({ name: '49.1427, 9.2109', detail: '49.1427, 9.2109' }));
  });

  it('loads the stored records on construction', () => {
    wave(1); wave(5);
    const stored: BestWave[] = [...service.records()];
    expect(create().records()).toEqual(stored);
  });
});
