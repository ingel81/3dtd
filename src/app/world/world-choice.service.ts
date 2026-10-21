import { Injectable, InjectionToken, computed, inject } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { readDesktopBridge } from '../core/desktop-bridge';
import { MapStore, type MapSummary } from './custom-map/map-store';
import { MAP_FILE_EXTENSION } from './custom-map/map-file-kind';
import { downloadBlob } from '../utils/download';
import { pictureColours, type MapPictureColours } from '../map-ops/map-picture';
import type { OwnTileset } from './tileset/own-tileset';
import type { WorldRef } from './world-ref';
import { PLAIN_START } from './world-start';
import { WorldSession } from './world-session.service';
import { AppScreen } from './app-screen.service';

/** The shipped map a player without a tile key starts on (the token screen's "Play the maps") */
export const FIRST_MAP_ID = 'mountain-pass';

/** The map store the menu lists from (IndexedDB and the shipped maps); a spec hands in its own */
export const MAP_STORE = new InjectionToken<MapStore>('MAP_STORE', { providedIn: 'root', factory: () => new MapStore() });


/**
 * The ground materials' colours the list pictures are drawn in, from the
 * renderer's catalogue (read once a page); empty without it. A spec hands in its own
 */
export const MAP_PICTURE_COLOURS = new InjectionToken<() => Promise<MapPictureColours>>('MAP_PICTURE_COLOURS', {
  providedIn: 'root',
  factory: () => async () => {
    const { MapAssetLibrary } = await import('./custom-map/render/map-asset-library');
    return pictureColours((await MapAssetLibrary.shared().catalog().catch(() => null))?.materials ?? []);
  },
});

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
  private readonly colours = inject(MAP_PICTURE_COLOURS);
  private readonly screens = inject(AppScreen);
  private readonly config = inject(ConfigService);
  private readonly session = inject(WorldSession);
  /** Object URLs of own maps' pictures, given back with the next list */
  private pictureUrls: string[] = [];
  /** Stored maps whose missing picture was drawn (or tried) in this page's life */
  private readonly pictured = new Set<string>();

  /** The own tilesets the config lists */
  readonly tilesets = computed<readonly OwnTileset[]>(() => this.config.ownTilesets());

  /**
   * Own, received and shipped maps with their pictures; a stored list that
   * does not load is empty. A stored map without a picture (an import that
   * brought none, a coop host's map, one saved before the editor drew one
   * with every save) lists without, its picture is drawn behind and kept;
   * `pictured` hears when some were, to list again
   */
  async listMaps(pictured?: () => void): Promise<MapChoices> {
    const [own, shipped] = await Promise.all([this.store.listOwn().catch(() => []), this.store.listShipped().catch(() => [])]);
    for (const url of this.pictureUrls.splice(0)) URL.revokeObjectURL(url);
    const missing: string[] = [];
    const stored = await Promise.all(own.map(async (summary) => {
      const bytes = await this.store.previewOf(summary.id).catch(() => null);
      if (!bytes) {
        missing.push(summary.id);
        return { summary, picture: null };
      }
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
    this.drawPictures(missing, pictured);
    return {
      own: stored.filter((m) => m.summary.origin !== 'shared'),
      shared: stored.filter((m) => m.summary.origin === 'shared'),
      shipped: shippedChoices,
    };
  }

  /**
   * The pictures of stored maps that have none, drawn one after another off
   * the page's thread (MapStore.drawPreview) in the catalogue's colours;
   * without the catalogue (offline before any map loaded) none is drawn, the
   * next list tries again. A file that does not read is not tried again
   * before the next page
   */
  private drawPictures(ids: readonly string[], drawn?: () => void): void {
    const wanted = ids.filter((id) => !this.pictured.has(id));
    if (!wanted.length) return;
    for (const id of wanted) this.pictured.add(id);
    void (async () => {
      const colours = await this.colours().catch(() => ({}));
      if (!Object.keys(colours).length) {
        for (const id of wanted) this.pictured.delete(id);
        return;
      }
      let any = false;
      for (const id of wanted) if (await this.store.drawPreview(id, colours).catch(() => null)) any = true;
      if (any) drawn?.();
    })();
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

  /** The trash: own maps deleted, waiting TRASH_DAYS (the Built Worlds' menu lists it) */
  listTrash(): Promise<MapSummary[]> {
    return this.store.listTrash().catch(() => []);
  }

  /** A copy of a map as an own one beside it; returns the copy's id */
  async duplicateMap(id: string, origin: MapSummary['origin']): Promise<string> {
    return (await this.store.duplicate(id, undefined, origin)).doc.meta.id;
  }

  /** A coop host's map gone for good (the host sends it again on joining the room) */
  deleteShared(id: string): Promise<void> {
    return this.store.delete(id);
  }

  /** A map as a .3dtdmap file to save */
  async downloadMap(id: string, origin: MapSummary['origin']): Promise<void> {
    const loaded = await this.store.load(id, origin);
    const { packMapFile } = await import('./custom-map/map-file');
    downloadBlob(new Blob([packMapFile(loaded.doc, { preview: loaded.preview ?? undefined }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${id}${MAP_FILE_EXTENSION}`);
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
    this.toEditor(() => this.screens.openEditor(mapId));
  }

  /** The map editor in this window on a new map's form */
  newMap(): void {
    this.toEditor(() => this.screens.openMake({ kind: 'new' }));
  }

  /** The map editor in this window reading files in (.3dtdmap, Warcraft maps): its import, then the map */
  importMaps(files: readonly File[]): void {
    this.toEditor(() => this.screens.openMake({ kind: 'import', files }));
  }

  /** A world held behind the globes goes first, its run kept as autosave (docs/WORLDS_STATE_PLAN.md, 3.5) */
  private toEditor(open: () => void): void {
    if (this.session.parked()) {
      void this.session.leaveParked(true).then(open);
      return;
    }
    open();
  }
}
