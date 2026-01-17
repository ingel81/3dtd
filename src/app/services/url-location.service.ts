import { Injectable } from '@angular/core';

/**
 * URL Location Service
 *
 * URL is the single source of truth for location.
 * Format: ?l=49.17327,9.26859&s=49.17555,9.26387;49.18000,9.27000
 * - l = HQ (lat,lon) - 5 decimal places
 * - s = Spawns (semicolon-separated)
 */
@Injectable({ providedIn: 'root' })
export class UrlLocationService {
  private readonly PRECISION = 5;

  /**
   * Parse location from current URL
   */
  parseFromUrl(): { hq: { lat: number; lon: number }; spawns: { lat: number; lon: number }[] } | null {
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

    const spawns: { lat: number; lon: number }[] = [];
    if (spawnsParam) {
      for (const part of spawnsParam.split(';')) {
        const spawn = this.parseCoordPair(part);
        if (spawn) spawns.push(spawn);
      }
    }

    return { hq, spawns };
  }

  /**
   * Update browser URL without reload (replaceState)
   */
  updateUrl(hq: { lat: number; lon: number }, spawns: { lat: number; lon: number }[]): void {
    const hqStr = `${hq.lat.toFixed(this.PRECISION)},${hq.lon.toFixed(this.PRECISION)}`;

    let url = `${window.location.pathname}?l=${hqStr}`;

    if (spawns.length > 0) {
      const spawnStrs = spawns.map(s => `${s.lat.toFixed(this.PRECISION)},${s.lon.toFixed(this.PRECISION)}`);
      url += `&s=${spawnStrs.join(';')}`;
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
