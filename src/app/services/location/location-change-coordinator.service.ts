import { Injectable, inject, signal } from '@angular/core';
import { OsmStreetService, STREET_RADIUS_M } from './osm-street.service';
import type { StreetNetwork } from '../../interfaces/street-network-provider.interface';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { HeightUpdateService } from '../world/height-update.service';
import { LocationManagementService } from './location-management.service';
import { UrlLocationService } from './url-location.service';
import { WORLD_DICE_FAILED, WorldDiceService } from './world-dice.service';
import { UIStore } from '../../store/ui.store';
import { FavoriteLocation, SavedSpawn } from '../../models/location.types';
import type { PlaceChoice, PlacedChoice } from './place-choice';
import {
  LocationChangeExecutorService,
  LocationChangeCallbacks,
  LocationChangeContext,
  LocationChangeInput,
} from './location-change-executor.service';
import { canonicalCoords } from '../../utils/geo-utils';
import type { NominatimAddress } from './geocoding.service';

/**
 * Delegate interface for component-specific state the coordinator needs
 * for location flow methods (place choice, favorites, etc.)
 */
export interface LocationFlowDelegate {
  /** Build the LocationChangeContext from current component state */
  getChangeContext(): LocationChangeContext | null;
  /** Build the LocationChangeCallbacks from component methods */
  getChangeCallbacks(): LocationChangeCallbacks;
}

/** What the player reads when the streets of the place they go to did not load; they stay where they are */
export function streetsFailedText(place: string): string {
  return `The streets of ${place} did not load: the map server is busy or out of reach. You stay where you are; try again in a minute.`;
}

/**
 * LocationChangeCoordinatorService - Entry point for changing the location
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Handles the location flow UI (the menu's place choice, world dice,
 * favorites, share) and
 * applyNewLocation, which guards against concurrent changes, runs the
 * 7-step change in LocationChangeExecutorService and unwinds the loading
 * flags when it fails.
 */
@Injectable({ providedIn: 'root' })
export class LocationChangeCoordinatorService {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly osmService = inject(OsmStreetService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly worldDice = inject(WorldDiceService);
  private readonly executor = inject(LocationChangeExecutorService);
  private readonly uiStore = inject(UIStore);

  /** Favorite display names (resolved via geocoding) */
  readonly favoriteNamesMap = signal<Record<string, string>>({});

  /** Delegate for component-specific state access */
  private delegate: LocationFlowDelegate | null = null;

  /** A start without a place waits for the menu's choice (waitForStartChoice) */
  private startWaiter: ((choice: PlacedChoice) => void) | null = null;
  /** The start waits for a place to be chosen in the menu */
  readonly awaitingStartChoice = signal(false);

  // ==================== Initialization ====================

  /**
   * Register the component delegate for location flow operations.
   * Must be called before using the place choice, favorites or the world dice.
   */
  initializeFlow(delegate: LocationFlowDelegate): void {
    this.delegate = delegate;
    this.resolveFavoriteNames();
  }

  // ==================== Location Flow Methods ====================

  /**
   * The start without a place (LocationFacadeService.initializeLocation)
   * waits here until the menu chooses one: New game, a coop host's place, the
   * place of a save loaded before the first. One waiter at a time; a second
   * call replaces the first.
   */
  waitForStartChoice(): Promise<PlacedChoice> {
    return new Promise((resolve) => {
      this.startWaiter = resolve;
      this.awaitingStartChoice.set(true);
    });
  }

  /** The start gave up waiting (the component went away) */
  cancelStartChoice(): void {
    this.startWaiter = null;
    this.awaitingStartChoice.set(false);
  }

  /**
   * The one way in for a place chosen in the menu. At a start without a
   * place it hands the choice to the start (the dice rolls first); with a
   * place it goes there in this page: a stored place with every spawn, a
   * place with its spawn or a random one, the world dice. False when nothing
   * happens: the host sets the map, or the dice found no city.
   */
  async choosePlace(choice: PlaceChoice): Promise<boolean> {
    if (this.startWaiter) {
      const placed = choice.kind === 'dice' ? await this.rollStartCity() : choice;
      // The start may have given up while the dice rolled
      if (!placed || !this.startWaiter) return false;
      const resolve = this.startWaiter;
      this.cancelStartChoice();
      resolve(placed);
      return true;
    }
    if (this.uiStore.coopMapLocked()) return false;
    if (!this.delegate) {
      console.error('[LocationCoordinator] No delegate registered');
      return false;
    }
    switch (choice.kind) {
      case 'stored':
        await this.loadPlace(choice.hq, choice.spawns);
        break;
      case 'place':
        await this.moveTo(choice.hq, choice.spawn);
        break;
      case 'dice':
        await this.onWorldDice();
        break;
    }
    return true;
  }

  /** The world dice before the first place: a city with a random spawn, or a problem in the menu when none came */
  private async rollStartCity(): Promise<PlacedChoice | null> {
    const city = await this.worldDice.rollRandomCity();
    if (!city) {
      this.uiStore.loadProblem.set({ text: WORLD_DICE_FAILED, retry: () => void this.choosePlace({ kind: 'dice' }) });
      return null;
    }
    const name = city.country ? `${city.name}, ${city.country}` : city.name;
    return { kind: 'place', hq: { lat: city.lat, lon: city.lon, name }, spawn: null };
  }

  /**
   * Go to another place in this page, no reload: a place chosen in the menu
   * and the world dice. `spawn` null draws a random street spawn 500 to 1000 m
   * from the HQ. In place, so a coop room survives it and the guests follow
   * (docs/COOP_PLAN.md, D35).
   */
  private async moveTo(
    target: { lat: number; lon: number; name: string; address?: NominatimAddress },
    spawn: { lat: number; lon: number; name?: string; portalBearing?: number } | null,
  ): Promise<void> {
      this.uiStore.loadProblem.set(null);
      // Show loading overlay IMMEDIATELY before any async operations
      this.engineInit.loading.set(true);
      this.engineInit.resetLoadingSteps();

      // Canonical already here (see applyNewLocation): the streets for a
      // random spawn load around the HQ the change moves to
      const hq = canonicalCoords(target);
      let spawnLat = spawn?.lat ?? 0;
      let spawnLon = spawn?.lon ?? 0;
      let spawnName = spawn ? spawn.name : '';

      // Generate random spawn if requested
      if (!spawn) {
        const callbacks = this.delegate!.getChangeCallbacks();
        // Load streets for the new location to find spawn. Nothing changed yet: when they do not
        // come (every Overpass server busy or out of reach), the game stays where it is and says so,
        // instead of a loading screen that waits for good
        let newNetwork: StreetNetwork;
        try {
          newNetwork = await this.osmService.loadStreets(hq.lat, hq.lon, STREET_RADIUS_M);
        } catch (err) {
          console.error('[LocationCoordinator] The streets of the new place did not load:', err);
          callbacks.appendDebugLog(`Streets of ${target.name} failed: ${err instanceof Error ? err.message : 'unknown'}`);
          this.engineInit.setLoading(false);
          this.uiStore.loadProblem.set({ text: streetsFailedText(target.name), retry: () => void this.moveTo(target, spawn) });
          return;
        }

        // Store for reuse in executeLocationChange to avoid double-loading
        callbacks.setStreetNetwork(newNetwork);
        callbacks.setStreetNetworkLocation({ lat: hq.lat, lon: hq.lon });

        const randomSpawn = this.osmService.findRandomStreetPoint(newNetwork, hq.lat, hq.lon, 500, 1000);

        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Random Spawn';
          callbacks.appendDebugLog(`Random spawn: ${Math.round(randomSpawn.distance)}m away`);
        } else {
          callbacks.appendDebugLog('No valid spawn found, using fallback');
          // Fallback: use a point 700m north
          spawnLat = hq.lat + 0.0063; // ~700m north
          spawnLon = hq.lon;
          spawnName = 'Fallback Spawn';
        }
      }

      // Apply the new location
      await this.applyNewLocation({
        hq: {
          lat: hq.lat,
          lon: hq.lon,
          name: target.name,
          address: target.address,
        },
        spawn: {
          lat: spawnLat,
          lon: spawnLon,
          name: spawnName,
          portalBearing: spawn?.portalBearing,
        },
      });
  }

  /**
   * Copy shareable URL to clipboard (URL already reflects current location)
   */
  onShareLocation(): void {
    const url = this.urlLocation.getShareUrl();
    navigator.clipboard.writeText(url);
    this.delegate?.getChangeCallbacks().appendDebugLog('Link copied: ' + url);
  }

  /**
   * Roll for a random city from Wikidata and go there, in this page
   */
  async onWorldDice(): Promise<void> {
    if (this.uiStore.coopMapLocked()) return;
    const callbacks = this.delegate?.getChangeCallbacks();
    callbacks?.appendDebugLog('World Dice: Rolling random city...');

    this.uiStore.loadProblem.set(null);
    // Show loading overlay with World Dice step
    this.engineInit.startWorldDiceLoading();

    // Connect step detail callback
    this.worldDice.onStepDetail = (detail: string) => {
      this.engineInit.updateWorldDiceDetail(detail);
    };

    const city = await this.worldDice.rollRandomCity();

    // Cleanup callback
    this.worldDice.onStepDetail = null;

    if (!city) {
      const reason = this.worldDice.error();
      callbacks?.appendDebugLog('World Dice: Failed - ' + (reason || 'Unknown error'));
      // Hide loading overlay on error and say so: it used to close without a word
      this.engineInit.setLoading(false);
      this.uiStore.loadProblem.set({ text: WORLD_DICE_FAILED, retry: () => void this.onWorldDice() });
      return;
    }

    const displayName = city.country ? `${city.name}, ${city.country}` : city.name;
    callbacks?.appendDebugLog(`World Dice: ${displayName} (${city.lat.toFixed(4)}, ${city.lon.toFixed(4)})`);

    // In place with a random spawn, as a place chosen in the menu goes there: a
    // reload would end a coop room (the host's socket) and its lanes
    await this.moveTo({ lat: city.lat, lon: city.lon, name: displayName }, null);
  }

  /**
   * Save current location as favorite
   * @param name Name for it, from the suggestion the header prefills
   */
  onAddFavorite(name?: string): void {
    this.locationMgmt.saveFavorite(name);
    this.resolveFavoriteNames(); // Refresh names
    this.delegate?.getChangeCallbacks().appendDebugLog('Favorite saved');
  }

  /**
   * Rename a favorite. A cleared name falls back to the geocoded one, which
   * resolveFavoriteNames looks up again.
   */
  onRenameFavorite(id: string, name: string): void {
    this.locationMgmt.renameFavorite(id, name);
    this.resolveFavoriteNames();
  }

  /** Move a favorite up (-1) or down (1) in the list */
  onMoveFavorite(id: string, offset: number): void {
    this.locationMgmt.moveFavorite(id, offset);
  }

  /**
   * Apply a favorite location
   */
  async onSelectFavorite(fav: FavoriteLocation): Promise<void> {
    if (this.uiStore.coopMapLocked()) return;
    await this.loadPlace(fav.hq, fav.spawns);
  }

  /** A stored place with all its spawns: a favourite, a pasted link, a coop host's or a save's place */
  private async loadPlace(hqAt: { lat: number; lon: number }, spawns: SavedSpawn[]): Promise<void> {
    const fav = { hq: hqAt, spawns };
    const spawn: SavedSpawn = fav.spawns[0] || { lat: fav.hq.lat + 0.005, lon: fav.hq.lon };

    // Update service and URL
    this.locationMgmt.setLocation(fav.hq, fav.spawns);
    this.delegate?.getChangeCallbacks().syncUrlWithLocation();

    // Apply to game; a portal the player turned faces the way it was saved
    await this.applyNewLocation({
      hq: { lat: fav.hq.lat, lon: fav.hq.lon, name: 'Loading...' },
      spawn: { lat: spawn.lat, lon: spawn.lon, name: 'Spawn', portalBearing: spawn.portalBearing },
      // Every lane of the place, not only the first (saved with all of them)
      ...(fav.spawns.length > 1 ? { spawns: fav.spawns } : {}),
    });
  }

  /**
   * Delete a favorite
   */
  onDeleteFavorite(id: string): void {
    this.locationMgmt.deleteFavorite(id);
    this.favoriteNamesMap.update(m => {
      const copy = { ...m };
      delete copy[id];
      return copy;
    });
    this.delegate?.getChangeCallbacks().appendDebugLog('Favorite deleted');
  }

  /**
   * Resolve display names for the favorites without a name of their own
   * (FavoriteLocation.name); the header shows that name first.
   */
  async resolveFavoriteNames(): Promise<void> {
    const favs = this.locationMgmt.favorites();
    const names: Record<string, string> = {};

    for (const fav of favs) {
      if (fav.name) continue;
      names[fav.id] = await this.locationMgmt.getFavoriteDisplayName(fav);
    }

    this.favoriteNamesMap.set(names);
  }

  // ==================== Core Location Change ====================

  /**
   * Apply new location - builds context from delegate and executes change.
   * The change runs on HQ and spawn in their canonical form
   * (canonicalCoords): a place stored with every digit (favorite, recent
   * place, world map) gets the origin, routes and corridor its URL gives it.
   */
  async applyNewLocation(data: LocationChangeInput): Promise<void> {
    // Prevent concurrent location changes (guard against rapid clicks)
    if (this.locationMgmt.isApplyingLocation()) {
      console.warn('[LocationCoordinator] Location change already in progress, ignoring');
      return;
    }

    if (!this.delegate) {
      console.error('[LocationCoordinator] No delegate registered');
      return;
    }

    const ctx = this.delegate.getChangeContext();
    if (!ctx) {
      console.error('[LocationCoordinator] No engine available');
      return;
    }

    const callbacks = this.delegate.getChangeCallbacks();
    const input: LocationChangeInput = {
      hq: canonicalCoords(data.hq),
      spawn: canonicalCoords(data.spawn),
      ...(data.spawns?.length ? { spawns: data.spawns.map((s) => canonicalCoords(s)) } : {}),
    };

    this.uiStore.loadProblem.set(null);
    this.engineInit.setError(null);
    try {
      await this.executor.executeLocationChange(input, ctx, callbacks);
    } catch (err) {
      console.error('[Location] Failed to apply location:', err);
      callbacks.appendDebugLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      const message = err instanceof Error ? err.message : 'Error changing location';
      // The old place may be gone half way: the run cannot go on, the menu says so and offers the way back
      this.engineInit.setError(message);
      this.uiStore.loadProblem.set({ text: `The place did not load: ${message}`, retry: () => void this.applyNewLocation(data) });

      // Reset loading flags on error; without `loading` the menu's plate stood on its last step for good
      this.engineInit.setLoading(false);
      this.engineInit.tilesLoading.set(false);
      this.engineInit.osmLoading.set(false);
      this.heightUpdate.heightsLoading.set(false);
      this.locationMgmt.isApplyingLocation.set(false);
    }
  }
}
