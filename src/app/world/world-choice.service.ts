import { Injectable, InjectionToken, Injector, computed, inject } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { readDesktopBridge } from '../core/desktop-bridge';
import { MapStore, type MapSummary } from './custom-map/map-store';
import type { OwnTileset } from './tileset/own-tileset';
import { WorldContext } from './world-context.service';
import type { WorldRef } from './world-ref';
import { PLAIN_START } from './world-start';
import { WorldSession } from './world-session.service';
import { AppScreen } from './app-screen.service';
import { WorldsStageService } from '../worlds/worlds-stage.service';

/** The shipped map a player without a tile key starts on (the token screen's "Play the maps") */
export const FIRST_MAP_ID = 'mountain-pass';

/** The map store the menu lists from (IndexedDB and the shipped maps); a spec hands in its own */
export const MAP_STORE = new InjectionToken<MapStore>('MAP_STORE', { providedIn: 'root', factory: () => new MapStore() });


/** A map as the menu lists it: its summary and a picture */
export interface MapChoice {
  summary: MapSummary;
  /** Object URL or address of its top-down picture; null without one */
  picture: string | null;
}

/** Own maps first, then those coop hosts sent, then the shipped ones */
export interface MapChoices {
  own: MapChoice[];
  /** Maps received in coop (origin 'shared') */
  shared: MapChoice[];
  shipped: MapChoice[];
}

/**
 * The worlds a player can choose in the menu besides the real places: the
 * custom maps (own from the map store, then the shipped ones) and the own
 * 3D Tiles sets of the config. A choice opens that world in the page
 * (WorldSession): the open one goes, engine and worker with it, and the new
 * one is made from the start. The map editor opens in the window too
 * (AppScreen), the game goes meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class WorldChoiceService {
  private readonly store = inject(MAP_STORE);
  private readonly screens = inject(AppScreen);
  private readonly config = inject(ConfigService);
  private readonly world = inject(WorldContext);
  private readonly session = inject(WorldSession);
  private readonly injector = inject(Injector);
  /** Object URLs of own maps' pictures, given back with the next list */
  private pictureUrls: string[] = [];

  /** The own tilesets the config lists */
  readonly tilesets = computed<readonly OwnTileset[]>(() => this.config.ownTilesets());

  /** The world the page plays on */
  readonly current = this.world.ref;

  /** Own, received and shipped maps with their pictures; a stored list that does not load is empty */
  async listMaps(): Promise<MapChoices> {
    const [own, shipped] = await Promise.all([this.store.listOwn().catch(() => []), this.store.listShipped().catch(() => [])]);
    for (const url of this.pictureUrls.splice(0)) URL.revokeObjectURL(url);
    const stored = await Promise.all(own.map(async (summary) => {
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
    return {
      own: stored.filter((m) => m.summary.origin !== 'shared'),
      shared: stored.filter((m) => m.summary.origin === 'shared'),
      shipped: shippedChoices,
    };
  }

  /** Whether the page plays this map or set now */
  isCurrent(ref: WorldRef): boolean {
    const current = this.current();
    if (ref.kind === 'custom-map') return current.kind === 'custom-map' && current.mapId === ref.mapId;
    if (ref.kind === 'tileset') return current.kind === 'tileset' && current.id === ref.id;
    return current.kind === ref.kind;
  }

  /** Play a custom map: the game shows once it stands */
  playMap(mapId: string, name: string | null = null): void {
    this.session.open({ ...PLAIN_START, world: { kind: 'custom-map', mapId, contentHash: '' }, play: true, label: name });
  }

  /** Play an own tileset, starting at the middle of its area */
  playTileset(tileset: OwnTileset): void {
    const { lat, lon } = tileset.coverage.center;
    this.session.open({
      ...PLAIN_START,
      world: { kind: 'tileset', id: tileset.id },
      place: { hq: { lat, lon }, spawns: [] },
      play: true,
      label: tileset.name,
    });
  }

  /** The desktop app's map folder, or null in a browser */
  readonly mapFolder = readDesktopBridge()?.maps ?? null;

  /** Shows the map folder in the system's file manager (desktop app) */
  revealMapFolder(): void {
    this.mapFolder?.reveal();
  }

  /**
   * A map the player double-clicked (desktop app): the app copied it into
   * the map folder, the store takes it in when the world opens on it.
   * `mayLeave` asks before a running game is left. Called once at the
   * page's start; returns the unsubscribe.
   */
  playOpenedMaps(mayLeave: (mapName: string) => boolean = () => true): () => void {
    return (
      this.mapFolder?.onOpen((name) => {
        if (!mayLeave(name)) return;
        void this.store.folderMapId(name).then((id) => this.playMap(id));
      }) ?? (() => undefined)
    );
  }

  /**
   * A save of another world than the open one: the save's world (its map,
   * or the real places) opens in the page and loads the save once it stands
   * (WorldStart.resume, MainMenuService).
   */
  openSave(slot: { id: string; map: { id: string; name?: string } | null }): void {
    const world: WorldRef | null = slot.map ? { kind: 'custom-map', mapId: slot.map.id, contentHash: '' } : null;
    this.session.open({ ...PLAIN_START, world, resume: slot.id, play: true, label: slot.map?.name ?? null });
  }

  /** Back to the real places of the 3D tiles: their menu on the globes asks where, the game goes */
  playRealPlaces(): void {
    // Looked up here: the globes' service lists the maps through this one
    this.injector.get(WorldsStageService).leaveGame({ world: 'real', pick: null });
  }

  /** An own map to the editor's trash (an OpenStreetMap map off the Recent worlds); false when it did not go */
  async trashMap(id: string): Promise<boolean> {
    try {
      await this.store.trash(id);
      return true;
    } catch {
      return false;
    }
  }

  /** The map editor in this window on this map (a shipped one opens there as a copy to save); null: its list */
  editMap(mapId: string | null): void {
    this.screens.openEditor(mapId);
  }
}
