import { computed, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Shape of the optional `runtime-config.json` next to `index.html`. */
interface RuntimeConfig {
  tileProvider?: 'cesium' | 'google';
  googleMapsApiKey?: string;
  cesiumIonToken?: string;
  cesiumAssetId?: string;
}

/**
 * Tile provider credentials.
 *
 * The values used to be inlined into the bundle at build time, which meant a
 * deployed build shipped the maintainer's Cesium token in plain JS. They are
 * now resolved at runtime instead, from three sources in increasing priority:
 *
 *   1. `environment.ts`, the local dev fallback, empty in production builds
 *   2. `runtime-config.json`, lets a self-hoster (and the Electron build, via
 *      its `app://` handler) supply a token without rebuilding
 *   3. `localStorage`, what the player typed into the token dialog
 *
 * Everything else in the app reads these signals, so the resolution order
 * lives here and nowhere else.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private static readonly STORAGE_KEY = '3dtd-tile-credentials';

  readonly googleMapsApiKey = signal(environment.googleMapsApiKey ?? '');
  readonly cesiumIonToken = signal(environment.cesiumIonToken ?? '');
  readonly cesiumAssetId = signal(environment.cesiumAssetId ?? '2275207');
  readonly tileProvider = signal<'cesium' | 'google'>(environment.tileProvider ?? 'cesium');
  readonly loaded = signal(false);
  readonly isBrowserPlayback = signal(true);

  /** Set when the tile server rejected the credentials we had. */
  readonly credentialsRejected = signal(false);

  /**
   * Set when the player asked for the key screen from inside a running game.
   * Lives here rather than in a component so any part of the UI can open it.
   */
  readonly setupRequested = signal(false);

  /** True when the active provider has no usable credentials. */
  readonly needsCredentials = computed(() =>
    this.tileProvider() === 'google' ? !this.googleMapsApiKey() : !this.cesiumIonToken()
  );

  /** True when the current token came from this browser rather than the build. */
  readonly hasStoredToken = signal(false);

  /**
   * Resolve the credentials. Runs once during app init; never throws, because
   * a missing or broken config file has to end in the token dialog, not in a
   * blank page.
   */
  async load(): Promise<void> {
    await this.applyRuntimeConfigFile();
    this.applyStoredToken();
    this.loaded.set(true);
  }

  /**
   * Store credentials for this browser and switch to that provider.
   * Both providers stay usable: Cesium Ion wraps Google's tiles behind an ion
   * token, the Google path talks to the Map Tiles API directly.
   */
  setCredentials(provider: 'cesium' | 'google', value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (provider === 'cesium') {
      this.cesiumIonToken.set(trimmed);
    } else {
      this.googleMapsApiKey.set(trimmed);
    }

    this.tileProvider.set(provider);
    this.credentialsRejected.set(false);
    this.hasStoredToken.set(true);
    this.writeStorage({
      tileProvider: provider,
      ...(provider === 'cesium' ? { cesiumIonToken: trimmed } : { googleMapsApiKey: trimmed }),
    });
  }

  /** Drop the browser-stored credentials. Does not touch build/runtime values. */
  clearStoredCredentials(): void {
    try {
      localStorage.removeItem(ConfigService.STORAGE_KEY);
    } catch {
      /* private mode or blocked storage, nothing to clear */
    }
    this.hasStoredToken.set(false);
    this.cesiumIonToken.set(environment.cesiumIonToken ?? '');
    this.googleMapsApiKey.set(environment.googleMapsApiKey ?? '');
    this.tileProvider.set(environment.tileProvider ?? 'cesium');
    this.credentialsRejected.set(false);
  }

  /**
   * Ask the provider whether it accepts these credentials, without starting the
   * engine. Hits exactly the endpoint the renderer's auth plugin would hit
   * first, so a pass here means the tile pipeline gets past authentication.
   */
  async validateCredentials(
    provider: 'cesium' | 'google',
    value: string
  ): Promise<{ ok: boolean; message: string }> {
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, message: 'Nothing to check.' };

    const url =
      provider === 'cesium'
        ? `https://api.cesium.com/v1/assets/${this.cesiumAssetId()}/endpoint?access_token=${encodeURIComponent(trimmed)}`
        : `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(trimmed)}`;

    let status: number;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return { ok: true, message: 'Works. Tiles are reachable.' };
      status = response.status;
    } catch {
      // Fetch rejects before a status exists: offline, DNS, or a blocked request.
      return { ok: false, message: 'Could not reach the provider. Check your connection.' };
    }

    if (provider === 'cesium') {
      if (status === 401) return { ok: false, message: 'Token rejected by Cesium Ion.' };
      if (status === 403) return { ok: false, message: 'Token has no access to this asset.' };
      if (status === 404) {
        return {
          ok: false,
          message: `Asset ${this.cesiumAssetId()} is not in your ion account. Add "Google Photorealistic 3D Tiles" there.`,
        };
      }
    } else if (status === 400 || status === 403) {
      return { ok: false, message: 'Key rejected. Is the Map Tiles API enabled for it?' };
    }

    return { ok: false, message: `Provider answered with ${status}.` };
  }

  /**
   * Called when the tiles endpoint refuses our credentials. Anything else that
   * fails during tile loading is a transient network problem and must not send
   * the player to the token dialog.
   */
  reportCredentialsRejected(): void {
    this.credentialsRejected.set(true);
  }

  private async applyRuntimeConfigFile(): Promise<void> {
    try {
      const response = await fetch('runtime-config.json', { cache: 'no-store' });
      if (!response.ok) return;

      const config = (await response.json()) as RuntimeConfig;
      if (config.tileProvider) this.tileProvider.set(config.tileProvider);
      if (config.googleMapsApiKey) this.googleMapsApiKey.set(config.googleMapsApiKey);
      if (config.cesiumIonToken) this.cesiumIonToken.set(config.cesiumIonToken);
      if (config.cesiumAssetId) this.cesiumAssetId.set(config.cesiumAssetId);
    } catch {
      /* no file, offline, or not JSON, the other two sources still apply */
    }
  }

  private applyStoredToken(): void {
    const stored = this.readStorage();
    if (!stored?.cesiumIonToken && !stored?.googleMapsApiKey) return;

    if (stored.cesiumIonToken) this.cesiumIonToken.set(stored.cesiumIonToken);
    if (stored.googleMapsApiKey) this.googleMapsApiKey.set(stored.googleMapsApiKey);
    this.tileProvider.set(stored.tileProvider ?? (stored.cesiumIonToken ? 'cesium' : 'google'));
    this.hasStoredToken.set(true);
  }

  private readStorage(): RuntimeConfig | null {
    try {
      const raw = localStorage.getItem(ConfigService.STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RuntimeConfig) : null;
    } catch {
      return null;
    }
  }

  private writeStorage(config: RuntimeConfig): void {
    try {
      localStorage.setItem(ConfigService.STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* storage blocked, the token still works for this session */
    }
  }
}
