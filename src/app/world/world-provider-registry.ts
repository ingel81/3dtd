import { Injectable, Injector, inject } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { DEV_WORLD_CAPABILITIES, DevWorldProvider } from '../devworld/dev-world-provider';
import { DevWorldService } from '../devworld/devworld.service';
import { OsmStreetService } from '../services/location/osm-street.service';
import {
  CUSTOM_MAP_CAPABILITIES,
  CustomMapWorld,
  customMapSpawnLimit,
  openCustomMap,
  openedCustomMap,
} from './custom-map/custom-map-world';
import { mapToGeo } from './custom-map/map-document';
import { FLAT_WORLD_ORIGIN } from './flat-frame';
import { TILES_CAPABILITIES, TilesWorld, tilesLogos } from './tiles/tiles-world';
import type { WorldCapabilities, WorldLogo, WorldProvider } from './world-provider';
import { worldLabel, type WorldKind, type WorldRef } from './world-ref';

/** What a factory gets to make its world */
export interface WorldCreateContext {
  /** The game's injector, for the services a world needs (streets, map storage) */
  injector: Injector;
  /** The run's origin, where a world with a real place puts its scene origin */
  origin: { lat: number; lon: number; height: number };
}

/** Makes the worlds of one kind */
export interface WorldFactory {
  /** Known before the world is made: the UI and the start flow read them */
  readonly capabilities: WorldCapabilities;
  create(ref: WorldRef, ctx: WorldCreateContext): WorldProvider;
  /**
   * Where the HQ of a world that brings its own stands, before the world is
   * made (the start sets the location first); absent where the player picks
   * the place (tiles)
   */
  startHq?(ref: WorldRef, injector: Injector): Promise<{ lat: number; lon: number }>;
  /** Logos the map data asks to be shown with it; none when absent */
  logos?(ref: WorldRef): readonly WorldLogo[];
}

/** A world the registry cannot make here: no factory for its kind, or a map that is missing */
export class WorldUnavailableError extends Error {
  constructor(readonly ref: WorldRef, reason: string) {
    super(`The world "${worldLabel(ref)}" is not available: ${reason}`);
  }
}

/** The 3D tiles, with the credentials and tile source the ConfigService holds now */
const TILES_FACTORY: WorldFactory = {
  capabilities: TILES_CAPABILITIES,
  create: (ref, { injector, origin }) => {
    const config = injector.get(ConfigService);
    return new TilesWorld({
      source: ref.kind === 'tiles' ? ref.source : config.tileProvider(),
      cesiumIonToken: config.cesiumIonToken(),
      cesiumAssetId: config.cesiumAssetId(),
      googleMapsApiKey: config.googleMapsApiKey(),
      origin,
      streets: injector.get(OsmStreetService),
    });
  },
  logos: (ref) => tilesLogos(ref.kind === 'tiles' ? ref.source : 'cesium'),
};

/** DevWorld from the DevWorldService's configuration (the URL, the debug panel) */
const DEV_WORLD_FACTORY: WorldFactory = {
  capabilities: DEV_WORLD_CAPABILITIES,
  create: (_ref, { injector }) => new DevWorldProvider(injector.get(DevWorldService)),
  // At the origin of the synthetic frame, see DevWorldProvider.startLayout
  startHq: () => Promise.resolve({ lat: FLAT_WORLD_ORIGIN.lat, lon: FLAT_WORLD_ORIGIN.lon }),
};

/**
 * A custom map from the map store (own maps in IndexedDB, then the shipped
 * ones): `startHq` loads it, `create` makes the world of the loaded map.
 * How many of its spawns a run uses: customMapSpawnLimit (`?spawns=N`).
 */
const CUSTOM_MAP_FACTORY: WorldFactory = {
  capabilities: CUSTOM_MAP_CAPABILITIES,
  create: (ref, { origin }) => {
    const map = ref.kind === 'custom-map' ? openedCustomMap(ref) : null;
    if (!map) throw new WorldUnavailableError(ref, 'the map was not opened before the world was made');
    const search = typeof window === 'undefined' ? '' : window.location.search;
    return new CustomMapWorld(map, origin, customMapSpawnLimit(search));
  },
  startHq: async (ref) => {
    if (ref.kind !== 'custom-map') throw new WorldUnavailableError(ref, 'not a custom map');
    try {
      return mapToGeo((await openCustomMap(ref)).doc.hq);
    } catch (err) {
      throw new WorldUnavailableError(ref, err instanceof Error ? err.message : String(err));
    }
  },
};

/**
 * WorldRef to WorldProvider: one factory per kind of world. A new kind (a
 * custom map, own tilesets) registers its factory here and needs no change
 * in the engine or the services.
 */
@Injectable({ providedIn: 'root' })
export class WorldProviderRegistry {
  private readonly factories = new Map<WorldKind, WorldFactory>([
    ['tiles', TILES_FACTORY],
    ['devworld', DEV_WORLD_FACTORY],
    ['custom-map', CUSTOM_MAP_FACTORY],
  ]);
  private readonly injector = inject(Injector);

  /** Add or replace the factory of a kind */
  register(kind: WorldKind, factory: WorldFactory): void {
    this.factories.set(kind, factory);
  }

  /** Whether worlds of this kind can be made here */
  has(kind: WorldKind): boolean {
    return this.factories.has(kind);
  }

  /** The capabilities of a kind, null without a factory for it */
  capabilities(kind: WorldKind): WorldCapabilities | null {
    return this.factories.get(kind)?.capabilities ?? null;
  }

  /** The HQ a world of `ref` brings along (WorldFactory.startHq), null where the player picks the place */
  startHq(ref: WorldRef): Promise<{ lat: number; lon: number }> | null {
    return this.factories.get(ref.kind)?.startHq?.(ref, this.injector) ?? null;
  }

  /** The logos a world of `ref` shows beside the map (WorldFactory.logos) */
  logos(ref: WorldRef): readonly WorldLogo[] {
    return this.factories.get(ref.kind)?.logos?.(ref) ?? [];
  }

  /** Make the world `ref` names, around `origin`; throws WorldUnavailableError */
  create(ref: WorldRef, origin: WorldCreateContext['origin']): WorldProvider {
    const factory = this.factories.get(ref.kind);
    if (!factory) throw new WorldUnavailableError(ref, 'this build cannot load it');
    return factory.create(ref, { injector: this.injector, origin });
  }
}
