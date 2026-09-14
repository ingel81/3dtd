import { Injectable } from '@angular/core';
import type { SavedSpawn } from '../../models/location.types';

/**
 * URL Location Service
 *
 * URL is the single source of truth for location.
 * Format: ?l=49.17327,9.26859&s=49.17555,9.26387,187.5;49.18000,9.27000
 * - l = HQ (lat,lon) - 5 decimal places
 * - s = Spawns (semicolon-separated): lat,lon and, for a portal the player
 *   turned, its compass bearing in degrees (SavedSpawn.portalBearing, 1
 *   decimal place). A spawn without one faces along its route, as every
 *   spawn in URLs from before the bearing.
 */
@Injectable({ providedIn: 'root' })
export class UrlLocationService {
  private readonly PRECISION = 5;
  private readonly BEARING_PRECISION = 1;

  /**
   * Parse location from current URL
   */
  parseFromUrl(): { hq: { lat: number; lon: number }; spawns: SavedSpawn[] } | null {
    const params = new URLSearchParams(window.location.search);
    const hqParam = params.get('l');
    const spawnsParam = params.get('s');

    if (!hqParam) {
      return null;
    }

    const hq = this.parseCoordPair(hqParam);
    if (!hq) {
      return null;
    }

    const spawns: SavedSpawn[] = [];
    if (spawnsParam) {
      for (const part of spawnsParam.split(';')) {
        const spawn = this.parseSpawn(part);
        if (spawn) spawns.push(spawn);
      }
    }

    return { hq, spawns };
  }

  /**
   * Update browser URL without reload (replaceState)
   */
  updateUrl(hq: { lat: number; lon: number }, spawns: readonly SavedSpawn[]): void {
    const hqStr = `${hq.lat.toFixed(this.PRECISION)},${hq.lon.toFixed(this.PRECISION)}`;

    let url = `${window.location.pathname}?l=${hqStr}`;

    if (spawns.length > 0) {
      url += `&s=${spawns.map((s) => this.formatSpawn(s)).join(';')}`;
    }

    window.history.replaceState({}, '', url);
  }

  /**
   * Get current URL for sharing (just returns current URL)
   */
  getShareUrl(): string {
    return window.location.href;
  }

  /**
   * Check if URL has location params
   */
  hasLocationParams(): boolean {
    return new URLSearchParams(window.location.search).has('l');
  }

  private formatSpawn(spawn: SavedSpawn): string {
    const at = `${spawn.lat.toFixed(this.PRECISION)},${spawn.lon.toFixed(this.PRECISION)}`;
    return spawn.portalBearing === undefined ? at : `${at},${spawn.portalBearing.toFixed(this.BEARING_PRECISION)}`;
  }

  /**
   * A spawn from "lat,lon" or "lat,lon,bearing". A bearing that is no number
   * is left out: the spawn stays and faces along its route.
   */
  private parseSpawn(str: string): SavedSpawn | null {
    const parts = str.split(',');
    if (parts.length !== 3) return this.parseCoordPair(str);

    const at = this.parseCoordPair(`${parts[0]},${parts[1]}`);
    if (!at) return null;
    const portalBearing = parseFloat(parts[2].trim());
    return Number.isFinite(portalBearing) ? { ...at, portalBearing } : at;
  }

  private parseCoordPair(str: string): { lat: number; lon: number } | null {
    const parts = str.split(',');
    if (parts.length !== 2) return null;

    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }

    return { lat, lon };
  }
}
