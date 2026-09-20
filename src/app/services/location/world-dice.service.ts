import { Injectable, isDevMode, signal } from '@angular/core';

/** What the player reads when the city list did not load. */
export const WORLD_DICE_FAILED =
  'The city list did not load, so there is no random city. Reload the page, or pick a place yourself.';

/** Where the list lives, relative to the base href (app:// in the desktop app). */
export const CITY_POOL_URL = 'assets/data/cities.json';

/**
 * One city of the pool. Everything Wikidata knows about it that a filter
 * might want later: where it is, how many live there, how big and how high it
 * lies, whether it is its country's capital, and whether Google has
 * photorealistic 3D data there (tools/google3d).
 */
export interface RandomCity {
  /** Wikidata id, e.g. Q1726 */
  id: string;
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2, e.g. DE */
  countryCode: string;
  continent: string;
  lat: number;
  lon: number;
  population: number;
  /** km², null where Wikidata has none */
  area: number | null;
  /** m above sea level, null where Wikidata has none */
  elevation: number | null;
  capital: boolean;
  /** Google's photorealistic 3D data covers it; null where nobody checked */
  google3d: boolean | null;
}

/** The file the generator writes: one array per city, in the order of `fields`. */
interface CityPoolFile {
  fields?: string[];
  cities?: unknown[][];
}

@Injectable({ providedIn: 'root' })
export class WorldDiceService {
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  /** Callback for step detail updates (set by the coordinator) */
  onStepDetail: ((detail: string) => void) | null = null;

  /** The pool, loaded once from the shipped file */
  private cityPool: RandomCity[] = [];
  /** Those of the pool that Google covers with 3D data: the ones worth playing */
  private playable: RandomCity[] = [];
  private poolLoadPromise: Promise<void> | null = null;

  /**
   * Roll for a random city: loads the pool once, then picks from it.
   *
   * Only cities Google covers with photorealistic 3D data are rolled
   * (`google3d`, marked by tools/google3d): without it the place is a grey
   * plane, which is no game. Should a list carry no answers at all, every
   * city is in play, so a fresh list still rolls something.
   *
   * The list is shipped with the game (`tools/wikidata/fetch-cities.mjs`
   * builds it). Until 2026-09-20 the first roll asked the Wikidata Query
   * Service itself; that endpoint answered in 13 s at best and not at all
   * under load, and the player watched the dialog close on a timeout.
   */
  async rollRandomCity(): Promise<RandomCity | null> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      if (this.cityPool.length === 0) {
        this.updateDetail('Loading city list...');
        await this.loadCityPool();
      }

      if (this.playable.length === 0) {
        throw new Error('No cities loaded');
      }

      this.updateDetail('Rolling city...');
      return this.playable[Math.floor(Math.random() * this.playable.length)];
    } catch (err) {
      if (err instanceof Error) {
        this.error.set(err.message);
        console.error('[WorldDice] Error:', err.message);
      }
      return null;
    } finally {
      this.isLoading.set(false);
    }
  }

  /** The cities of the pool, empty until the first roll loaded them. */
  get cities(): readonly RandomCity[] {
    return this.cityPool;
  }

  /** Those a roll can land on: the ones with 3D data, or all of them where none is marked. */
  get rollable(): readonly RandomCity[] {
    return this.playable;
  }

  private updateDetail(detail: string): void {
    if (this.onStepDetail) {
      this.onStepDetail(detail);
    }
  }

  /** Load the pool once; a second roll during the load waits for the same one. */
  private async loadCityPool(): Promise<void> {
    if (this.poolLoadPromise) {
      await this.poolLoadPromise;
      return;
    }

    this.poolLoadPromise = this.fetchCityPool();
    try {
      await this.poolLoadPromise;
    } finally {
      // Also after a failure: a kept rejected promise would fail every later
      // roll at once, until the page is reloaded
      this.poolLoadPromise = null;
    }
  }

  private async fetchCityPool(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(CITY_POOL_URL, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new Error(WORLD_DICE_FAILED, { cause: err });
    }
    if (!response.ok) {
      throw new Error(WORLD_DICE_FAILED, { cause: new Error(`HTTP ${response.status}`) });
    }

    this.cityPool = parseCityPool(await response.json());
    const covered = this.cityPool.filter((city) => city.google3d === true);
    this.playable = covered.length > 0 ? covered : this.cityPool;
    if (isDevMode()) console.log(`[WorldDice] Loaded ${this.cityPool.length} cities, ${this.playable.length} with 3D data`);
  }
}

/** The rows of the pool file as cities, skipping any row that lacks the basics. */
export function parseCityPool(file: CityPoolFile | null | undefined): RandomCity[] {
  const rows = file?.cities;
  if (!Array.isArray(rows)) return [];

  const cities: RandomCity[] = [];
  for (const row of rows) {
    const [id, name, country, countryCode, continent, lat, lon, population, area, elevation, capital, google3d] = row;
    if (typeof name !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    cities.push({
      id: typeof id === 'string' ? id : '',
      name,
      country: typeof country === 'string' ? country : '',
      countryCode: typeof countryCode === 'string' ? countryCode : '',
      continent: typeof continent === 'string' ? continent : '',
      lat,
      lon,
      population: typeof population === 'number' ? population : 0,
      area: typeof area === 'number' ? area : null,
      elevation: typeof elevation === 'number' ? elevation : null,
      capital: capital === 1 || capital === true,
      google3d: google3d === null || google3d === undefined ? null : google3d === 1 || google3d === true,
    });
  }
  return cities;
}
