import { Injectable, signal } from '@angular/core';
import {
  GeoCoord,
  GeoCoordWithHeight,
  StoreFavoriteLocation,
  StoreSpawnPoint,
} from './tower-defense.store.types';

@Injectable({ providedIn: 'root' })
export class LocationStore {
  /** HQ / base coordinates */
  readonly baseCoords = signal<GeoCoord>({ lat: 0, lon: 0 });

  /** Camera center coordinates (with height) */
  readonly centerCoords = signal<GeoCoordWithHeight>({ lat: 0, lon: 0, height: 400 });

  /** Active spawn points */
  readonly spawnPoints = signal<StoreSpawnPoint[]>([]);

  /** Current location display name */
  readonly currentLocationName = signal<string>('');

  /** Saved favorite locations */
  readonly favorites = signal<StoreFavoriteLocation[]>([]);

  /** Favorite names lookup map */
  readonly favoriteNamesMap = signal<Map<string, string>>(new Map());

  /** Street count in loaded network */
  readonly streetCount = signal<number>(0);

  /** Location being applied (disables certain UI) */
  readonly isApplyingLocation = signal<boolean>(false);

  resetAll(): void {
    this.baseCoords.set({ lat: 0, lon: 0 });
    this.centerCoords.set({ lat: 0, lon: 0, height: 400 });
    this.spawnPoints.set([]);
    this.currentLocationName.set('');
    this.favorites.set([]);
    this.favoriteNamesMap.set(new Map());
    this.streetCount.set(0);
    this.isApplyingLocation.set(false);
  }
}
