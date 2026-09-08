import { Injectable } from '@angular/core';

export type GeolocationSource = 'browser';

export interface GeolocationResult {
  lat: number;
  lon: number;
  source: GeolocationSource;
}

/**
 * GeolocationService - Automatic location detection
 *
 * Fallback cascade:
 * 1. Browser Geolocation API (GPS/WiFi, precise, needs permission)
 * 2. null - Location dialog will be shown
 *
 * There used to be an IP lookup via ip-api.com in between. It has been removed:
 * the free tier is plain http, so the browser blocks it as mixed content on the
 * deployed https site anyway, and it handed every player's IP to a third party
 * for a city-level guess the dialog gets right in one click.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Callback for step detail updates (set by component) */
  onStepDetail: ((detail: string) => void) | null = null;

  /**
   * Detects the user's location, returns null if the browser denies it
   */
  async detectLocation(): Promise<GeolocationResult | null> {
    // Browser Geolocation API (15s timeout for permission dialog)
    this.updateDetail('Checking browser location...');
    const browser = await this.tryBrowserGeolocation();
    if (browser) {
      console.log('[Geolocation] Browser API successful');
      return { ...browser, source: 'browser' };
    }

    console.log('[Geolocation] No location detection possible');
    this.updateDetail('No location found');
    return null;
  }

  /**
   * Browser Geolocation API (requires user permission)
   */
  private tryBrowserGeolocation(): Promise<{ lat: number; lon: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        console.log('[Geolocation] Browser API not available');
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
          console.log('[Geolocation] Browser API error:', error.message);
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

  private updateDetail(detail: string): void {
    if (this.onStepDetail) {
      this.onStepDetail(detail);
    }
  }
}
