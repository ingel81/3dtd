import { Injectable, signal } from '@angular/core';
import {
  GeoCoord,
  GeoCoordWithHeight,
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

  /** Street count in loaded network */
  readonly streetCount = signal<number>(0);

  resetAll(): void {
    this.baseCoords.set({ lat: 0, lon: 0 });
    this.centerCoords.set({ lat: 0, lon: 0, height: 400 });
    this.spawnPoints.set([]);
    this.streetCount.set(0);
  }
}
