import { Injectable, signal } from '@angular/core';

export interface RandomCity {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

@Injectable({ providedIn: 'root' })
export class WorldDiceService {
  private readonly WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
  private readonly TIMEOUT_MS = 30000;
  private readonly CITY_POOL_SIZE = 200;

  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  // Cached city pool - loaded once, then pick randomly
  private cityPool: RandomCity[] = [];
  private poolLoadPromise: Promise<void> | null = null;

  /**
   * Wikidata SPARQL query for cities with population > 100,000
   * No ORDER BY RAND() - we pick randomly client-side
   */
  private readonly SPARQL_QUERY = `
    SELECT ?city ?cityLabel ?countryLabel ?coord WHERE {
      ?city wdt:P31/wdt:P279* wd:Q515.
      ?city wdt:P625 ?coord.
      ?city wdt:P1082 ?pop.
      ?city wdt:P17 ?country.
      FILTER(?pop > 100000)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
    }
    LIMIT ${200}
  `.replace('${200}', String(this.CITY_POOL_SIZE));

  /**
   * Roll for a random city - loads pool once, then picks randomly
   */
  async rollRandomCity(): Promise<RandomCity | null> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Load pool if not yet loaded
      if (this.cityPool.length === 0) {
        await this.loadCityPool();
      }

      if (this.cityPool.length === 0) {
        throw new Error('Keine Staedte geladen');
      }

      // Pick random city from pool
      const randomIndex = Math.floor(Math.random() * this.cityPool.length);
      return this.cityPool[randomIndex];
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

  /**
   * Load city pool from Wikidata (once)
   */
  private async loadCityPool(): Promise<void> {
    // Avoid parallel loading
    if (this.poolLoadPromise) {
      await this.poolLoadPromise;
      return;
    }

    this.poolLoadPromise = this.fetchCityPool();
    await this.poolLoadPromise;
    this.poolLoadPromise = null;
  }

  private async fetchCityPool(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const url = `${this.WIKIDATA_ENDPOINT}?query=${encodeURIComponent(this.SPARQL_QUERY)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/sparql-results+json',
          'User-Agent': 'Nervbox-TowerDefense/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Wikidata error: ${response.status}`);
      }

      const data = await response.json();
      this.cityPool = this.parseAllCities(data);

      console.log(`[WorldDice] Loaded ${this.cityPool.length} cities`);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Timeout - Wikidata antwortet nicht');
      }
      throw err;
    }
  }

  /**
   * Parse all cities from Wikidata response
   */
  private parseAllCities(data: WikidataSparqlResponse): RandomCity[] {
    const bindings = data?.results?.bindings;
    if (!bindings || bindings.length === 0) {
      return [];
    }

    const cities: RandomCity[] = [];

    for (const binding of bindings) {
      const coordString = binding.coord?.value;
      if (!coordString) continue;

      const coordMatch = coordString.match(/Point\((-?[\d.]+)\s+(-?[\d.]+)\)/);
      if (!coordMatch) continue;

      const lon = parseFloat(coordMatch[1]);
      const lat = parseFloat(coordMatch[2]);

      if (isNaN(lat) || isNaN(lon)) continue;

      cities.push({
        name: binding.cityLabel?.value || 'Unbekannte Stadt',
        lat,
        lon,
        country: binding.countryLabel?.value,
      });
    }

    return cities;
  }
}

// Wikidata SPARQL response types
interface WikidataSparqlResponse {
  results?: {
    bindings?: WikidataBinding[];
  };
}

interface WikidataBinding {
  city?: { value: string };
  cityLabel?: { value: string };
  countryLabel?: { value: string };
  coord?: { value: string };
}
