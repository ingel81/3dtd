import { Injectable, signal } from '@angular/core';
import { DEFAULT_HQ } from './location-management.service';

export type GeolocationSource = 'browser' | 'ip' | 'default';

export interface GeolocationResult {
  lat: number;
  lon: number;
  source: GeolocationSource;
}

/**
 * GeolocationService - Automatische Standortermittlung
 *
 * Fallback-Kaskade:
 * 1. Browser Geolocation API (GPS/WLAN, präzise)
 * 2. ip-api.com (IP-basiert, Stadt-Genauigkeit)
 * 3. Default-Standort (Erlenbach)
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Callback für Step-Detail Updates (wird von Component gesetzt) */
  onStepDetail: ((detail: string) => void) | null = null;

  /**
   * Ermittelt den Standort des Nutzers mit Fallback-Kaskade
   */
  async detectLocation(): Promise<GeolocationResult> {
    // 1. Browser Geolocation API versuchen (5s Timeout)
    this.updateDetail('Prüfe Browser-Standort...');
    const browser = await this.tryBrowserGeolocation();
    if (browser) {
      console.log('[Geolocation] Browser API erfolgreich');
      return { ...browser, source: 'browser' };
    }

    // 2. ip-api.com versuchen (5s Timeout)
    this.updateDetail('Browser verweigert, prüfe IP...');
    const ip = await this.tryIpApi();
    if (ip) {
      console.log('[Geolocation] IP-API erfolgreich');
      return { ...ip, source: 'ip' };
    }

    // 3. Default-Standort
    console.log('[Geolocation] Verwende Default-Standort');
    this.updateDetail('Standard-Standort');
    return { lat: DEFAULT_HQ.lat, lon: DEFAULT_HQ.lon, source: 'default' };
  }

  /**
   * Browser Geolocation API (benötigt User-Permission)
   */
  private tryBrowserGeolocation(): Promise<{ lat: number; lon: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        console.log('[Geolocation] Browser API nicht verfügbar');
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
          console.log('[Geolocation] Browser API Fehler:', error.message);
          resolve(null);
        },
        {
          timeout: 15000,  // 15 Sekunden - gibt dem User Zeit für Permission-Dialog
          enableHighAccuracy: false,
          maximumAge: 3600000  // 1 Stunde Cache
        }
      );
    });
  }

  /**
   * IP-basierte Geolocation via ip-api.com (kostenlos, keine API-Key)
   */
  private async tryIpApi(): Promise<{ lat: number; lon: number } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // http statt https - ip-api.com free tier unterstützt nur http
      const response = await fetch('http://ip-api.com/json/?fields=status,lat,lon', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log('[Geolocation] IP-API HTTP Fehler:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.status === 'success' && typeof data.lat === 'number' && typeof data.lon === 'number') {
        return { lat: data.lat, lon: data.lon };
      }

      console.log('[Geolocation] IP-API ungültige Antwort:', data);
      return null;
    } catch (error) {
      console.log('[Geolocation] IP-API Fehler:', error);
      return null;
    }
  }

  private updateDetail(detail: string): void {
    if (this.onStepDetail) {
      this.onStepDetail(detail);
    }
  }
}
