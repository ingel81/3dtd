import { Injectable, InjectionToken, computed, inject } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { coordKey } from '../utils/geo-utils';
import { MapStore, type MapSummary } from './custom-map/map-store';
import type { OwnTileset } from './tileset/own-tileset';
import { WorldContext } from './world-context.service';
import { WORLD_URL_PARAM, worldUrlValue, type WorldRef } from './world-ref';

/** The map store the menu lists from (IndexedDB and the shipped maps); a spec hands in its own */
export const MAP_STORE = new InjectionToken<MapStore>('MAP_STORE', { providedIn: 'root', factory: () => new MapStore() });

/** How the page goes to another world: a full load of the URL (a spec records it) */
export const WORLD_NAVIGATE = new InjectionToken<(url: string) => void>('WORLD_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

/** A map as the menu lists it: its summary and a picture */
export interface MapChoice {
  summary: MapSummary;
  /** Object URL or address of its top-down picture; null without one */
  picture: string | null;
}

/** Own maps first, then the shipped ones */
export interface MapChoices {
  own: MapChoice[];
  shipped: MapChoice[];
}

/**
 * The worlds a player can choose in the menu besides the real places: the
 * custom maps (own from the map store, then the shipped ones) and the own
 * 3D Tiles sets of the config. A choice loads the page anew on that world
 * (`?world=…`), as a link would; the world is made at the start, not
 * swapped under a running engine.
 */
@Injectable({ providedIn: 'root' })
export class WorldChoiceService {
  private readonly store = inject(MAP_STORE);
  private readonly navigate = inject(WORLD_NAVIGATE);
  private readonly config = inject(ConfigService);
  private readonly world = inject(WorldContext);
  /** Object URLs of own maps' pictures, given back with the next list */
  private pictureUrls: string[] = [];

  /** The own tilesets the config lists */
  readonly tilesets = computed<readonly OwnTileset[]>(() => this.config.ownTilesets());

  /** The world the page plays on */
  readonly current = this.world.ref;

  /** Own and shipped maps with their pictures; an own list that does not load is empty */
  async listMaps(): Promise<MapChoices> {
    const [own, shipped] = await Promise.all([this.store.listOwn().catch(() => []), this.store.listShipped().catch(() => [])]);
    for (const url of this.pictureUrls.splice(0)) URL.revokeObjectURL(url);
    const ownChoices = await Promise.all(own.map(async (summary) => {
      const bytes = await this.store.previewOf(summary.id).catch(() => null);
      if (!bytes) return { summary, picture: null };
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
      this.pictureUrls.push(url);
      return { summary, picture: url };
    }));
    // A shipped map an own one of the same id hides (the store loads the own one)
    const ownIds = new Set(own.map((m) => m.id));
    const shippedChoices = await Promise.all(shipped.filter((m) => !ownIds.has(m.id)).map(async (summary) => ({
      summary,
      picture: await this.store.shippedPreviewUrl(summary.id).catch(() => null),
    })));
    return { own: ownChoices, shipped: shippedChoices };
  }

  /** Whether the page plays this map or set now */
  isCurrent(ref: WorldRef): boolean {
    const current = this.current();
    if (ref.kind === 'custom-map') return current.kind === 'custom-map' && current.mapId === ref.mapId;
    if (ref.kind === 'tileset') return current.kind === 'tileset' && current.id === ref.id;
    return current.kind === ref.kind;
  }

  /** Play a custom map */
  playMap(mapId: string): void {
    this.navigate(this.worldUrl({ kind: 'custom-map', mapId, contentHash: '' }));
  }

  /** Play an own tileset, starting at the middle of its area */
  playTileset(tileset: OwnTileset): void {
    this.navigate(this.worldUrl({ kind: 'tileset', id: tileset.id }, tileset.coverage.center));
  }

  /** Back to the real places of the 3D tiles; the menu then asks where */
  playRealPlaces(): void {
    this.navigate(new URL(document.baseURI).toString());
  }

  /** The map editor's start, its list of maps */
  editorUrl(): string {
    return new URL('editor', document.baseURI).toString();
  }

  /** The map editor on this map (a shipped one opens there as a copy to save) */
  editUrl(mapId: string): string {
    const url = new URL('editor', document.baseURI);
    url.searchParams.set('map', mapId);
    return url.toString();
  }

  /** The page on `ref`, at `at` where the world needs a place */
  private worldUrl(ref: WorldRef, at?: { lat: number; lon: number }): string {
    const url = new URL(document.baseURI);
    url.searchParams.set(WORLD_URL_PARAM, worldUrlValue(ref)!);
    if (at) url.searchParams.set('l', coordKey(at));
    return url.toString();
  }
}
