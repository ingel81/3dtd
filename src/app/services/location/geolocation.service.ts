import { Injectable, isDevMode } from '@angular/core';

export type GeolocationSource = 'browser';

export interface GeolocationResult {
  lat: number;
  lon: number;
  source: GeolocationSource;
}

/**
 * GeolocationService - the browser's location, asked only from "Use my
 * location" on the menu's New game page; null when it gives none.
 *
 * There used to be an IP lookup via ip-api.com in between. It has been removed:
 * the free tier is plain http, so the browser blocks it as mixed content on the
 * deployed https site anyway, and it handed every player's IP to a third party
 * for a city-level guess the dialog gets right in one click.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /**
   * Detects the user's location, returns null if the browser denies it
   */
  async detectLocation(): Promise<GeolocationResult | null> {
    // Browser Geolocation API (15s timeout for permission dialog)
    const browser = await this.tryBrowserGeolocation();
    if (browser) {
      if (isDevMode()) console.log('[Geolocation] Browser API successful');
      return { ...browser, source: 'browser' };
    }

    if (isDevMode()) console.log('[Geolocation] No location detection possible');
    return null;
  }

  /**
   * Browser Geolocation API (requires user permission)
   */
  private tryBrowserGeolocation(): Promise<{ lat: number; lon: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        if (isDevMode()) console.log('[Geolocation] Browser API not available');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        pos => {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          });
        },
        error => {
          if (isDevMode()) console.log('[Geolocation] Browser API error:', error.message);
          resolve(null);
        },
        {
          timeout: 15000,  // 15 seconds - gives user time for permission dialog
          enableHighAccuracy: false,
          maximumAge: 3600000  // 1 hour cache
        }
      );
    });
  }
}
