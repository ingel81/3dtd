import { Injectable, inject, signal } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { DEV_WORLD_ORIGIN } from '../../devworld/devworld.service';
import { GeocodingService, UNKNOWN_LOCATION_NAME } from './geocoding.service';
import { LOADING_NAME, LocationManagementService, NO_LOCATION_NAME } from './location-management.service';
import { BestWave, findBestWave, loadBestWaves, recordBestWave, saveBestWaves } from './best-waves';

/** A run that beat the stored best of its place, shown on the game-over screen */
export interface NewRecord {
  hq: { lat: number; lon: number };
  name: string;
  wave: number;
  /** Best wave of the place before this run, 0 on the first run there */
  previous: number;
}

/**
 * Best wave per place, for the world map (localStorage td_best_waves_v1).
 *
 * A record is written when a wave starts, not only at game over: a run that
 * is abandoned (restart, another place, reload, closed tab) keeps the wave it
 * got to without a hook for each of those ways out. At game over `newRecord`
 * says whether the run beat what the place had before it began.
 */
@Injectable({ providedIn: 'root' })
export class BestWaveService {
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly geocoding = inject(GeocodingService);
  private readonly subs = new SubscriptionBag();

  /** Every place with its best wave, unsorted */
  readonly records = signal<readonly BestWave[]>(loadBestWaves());

  /** Set at game over when the run beat the place's record, null otherwise */
  readonly newRecord = signal<NewRecord | null>(null);

  /** The place's record when the run's first wave started; null before that or when the run does not count */
  private bestBeforeRun: number | null = null;
  private runWave = 0;
  private counts: () => boolean = () => true;

  /**
   * Follow the waves of a game session.
   * @param counts false while the run is not the player's own (the bot plays), such runs record nothing
   */
  connect(bus: GameEventBus, counts: () => boolean = () => true): void {
    this.subs.disposeAll();
    this.counts = counts;
    this.resetRun();
    this.subs.add(bus.on('wave:started', (e) => this.onWaveStarted(e.wave)));
    this.subs.add(bus.on('game:over', () => this.onGameOver()));
    this.subs.add(bus.on('game:reset', () => this.resetRun()));
  }

  disconnect(): void {
    this.subs.disposeAll();
  }

  /** Hide the game-over hint of the new record. */
  dismissRecord(): void {
    this.newRecord.set(null);
  }

  private onWaveStarted(wave: number): void {
    const place = this.currentPlace();
    if (!place || !this.counts()) return;
    this.bestBeforeRun ??= findBestWave(this.records(), place.hq)?.bestWave ?? 0;
    this.runWave = Math.max(this.runWave, wave);

    const current = this.records();
    const next = recordBestWave(current, { ...place, bestWave: wave, reachedAt: Date.now() });
    if (next === current) return;
    this.records.set(next);
    saveBestWaves(next);
  }

  private onGameOver(): void {
    const place = this.currentPlace();
    const before = this.bestBeforeRun;
    if (!place || before === null || this.runWave <= before) return;
    this.newRecord.set({ hq: place.hq, name: place.name, wave: this.runWave, previous: before });
  }

  private resetRun(): void {
    this.bestBeforeRun = null;
    this.runWave = 0;
    this.newRecord.set(null);
  }

  /** The place being played, without the wave; null without an HQ and in DevWorld. */
  private currentPlace(): Omit<BestWave, 'bestWave' | 'reachedAt'> | null {
    const hq = this.locationMgmt.hq();
    if (!hq || (hq.lat === DEV_WORLD_ORIGIN.lat && hq.lon === DEV_WORLD_ORIGIN.lon)) return null;

    const display = this.locationMgmt.displayName();
    const resolved = display !== NO_LOCATION_NAME && display !== LOADING_NAME;
    const address = this.locationMgmt.address();
    const town = address ? this.geocoding.extractLocationName(address) : UNKNOWN_LOCATION_NAME;
    const coords = `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`;
    return {
      hq: { lat: hq.lat, lon: hq.lon },
      spawns: this.locationMgmt.spawns().map((s) => ({ lat: s.lat, lon: s.lon })),
      name: town !== UNKNOWN_LOCATION_NAME ? town : resolved ? display : coords,
      detail: resolved ? display : coords,
    };
  }
}
