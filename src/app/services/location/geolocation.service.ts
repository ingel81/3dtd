import { Injectable } from '@angular/core';

export type GeolocationSource = 'browser' | 'ip';

export interface GeolocationResult {
  lat: number;
  lon: number;
  source: GeolocationSource;
}

/**
 * GeolocationService - Automatic location detection
 *
 * Fallback cascade:
 * 1. Browser Geolocation API (GPS/WiFi, precise)
 * 2. ip-api.com (IP-based, city-level accuracy)
 * 3. null - Location dialog will be shown
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Callback for step detail updates (set by component) */
  onStepDetail: ((detail: string) => void) | null = null;

  /**
   * Detects the user's location with fallback cascade
   * Returns null if no geolocation is possible
   */
  async detectLocation(): Promise<GeolocationResult | null> {
    // 1. Try Browser Geolocation API (15s timeout for permission dialog)
    this.updateDetail('Checking browser location...');
    const browser = await this.tryBrowserGeolocation();
    if (browser) {
      console.log('[Geolocation] Browser API successful');
      return { ...browser, source: 'browser' };
    }

    // 2. Try ip-api.com (5s timeout)
    this.updateDetail('Browser denied, checking IP...');
    const ip = await this.tryIpApi();
    if (ip) {
      console.log('[Geolocation] IP-API successful');
      return { ...ip, source: 'ip' };
    }

    // 3. No geolocation possible
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

  /**
   * IP-based geolocation via ip-api.com (free, no API key)
   */
  private async tryIpApi(): Promise<{ lat: number; lon: number } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // http instead of https - ip-api.com free tier only supports http
      const response = await fetch('http://ip-api.com/json/?fields=status,lat,lon', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log('[Geolocation] IP-API HTTP error:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.status === 'success' && typeof data.lat === 'number' && typeof data.lon === 'number') {
        return { lat: data.lat, lon: data.lon };
      }

      console.log('[Geolocation] IP-API invalid response:', data);
      return null;
    } catch (error) {
      console.log('[Geolocation] IP-API error:', error);
      return null;
    }
  }

  private updateDetail(detail: string): void {
    if (this.onStepDetail) {
      this.onStepDetail(detail);
    }
  }
}
