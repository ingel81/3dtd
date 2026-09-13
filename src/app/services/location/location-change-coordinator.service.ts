import { Injectable, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take } from 'rxjs';
import { OsmStreetService } from './osm-street.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { HeightUpdateService } from '../world/height-update.service';
import { LocationManagementService } from './location-management.service';
import { UrlLocationService } from './url-location.service';
import { WorldDiceService } from './world-dice.service';
import {
  LOCATION_DIALOG_LOAD_FAILED,
  LOCATION_DIALOG_OPEN_FAILED,
  LocationDialogLoadError,
  openLocationDialog,
} from '../../components/location-dialog/open-location-dialog';
import { UIStore } from '../../store/ui.store';
import { LocationConfig, LocationDialogData, LocationDialogResult, FavoriteLocation } from '../../models/location.types';
import {
  LocationChangeExecutorService,
  LocationChangeCallbacks,
  LocationChangeContext,
  LocationChangeInput,
} from './location-change-executor.service';

/**
 * Delegate interface for component-specific state the coordinator needs
 * for location flow methods (dialog, favorites, etc.)
 */
export interface LocationFlowDelegate {
  /** Build the LocationChangeContext from current component state */
  getChangeContext(): LocationChangeContext | null;
  /** Build the LocationChangeCallbacks from component methods */
  getChangeCallbacks(): LocationChangeCallbacks;
  /** Whether a game is in progress (for dialog warning) */
  isGameInProgress(): boolean;
  /** Get the current location display name */
  getCurrentLocationName(): string;
}

/**
 * LocationChangeCoordinatorService - Entry point for changing the location
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Handles the location flow UI (dialog, world dice, favorites, share) and
 * applyNewLocation, which guards against concurrent changes, runs the
 * 7-step change in LocationChangeExecutorService and unwinds the loading
 * flags when it fails.
 */
@Injectable({ providedIn: 'root' })
export class LocationChangeCoordinatorService {
  private readonly dialog = inject(MatDialog);
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

  // ==================== Initialization ====================

  /**
   * Register the component delegate for location flow operations.
   * Must be called before using dialog/favorites/worldDice methods.
   */
  initializeFlow(delegate: LocationFlowDelegate): void {
    this.delegate = delegate;
    this.resolveFavoriteNames();
  }

  // ==================== Location Flow Methods ====================

  /**
   * Open location dialog to change HQ and spawn point. Resolves once the
   * dialog is open; the first call loads its chunk. When the chunk does not
   * load or the dialog fails to open, a notice over the game says which and
   * the game goes on.
   */
  async openLocationDialog(): Promise<void> {
    if (!this.delegate) {
      console.error('[LocationCoordinator] No delegate registered');
      return;
    }

    const hq = this.locationMgmt.editableHqLocation();
    const spawn = this.locationMgmt.editableSpawnLocations()[0];

    const dialogData: LocationDialogData = {
      currentLocation: hq
        ? {
            lat: hq.lat,
            lon: hq.lon,
            name: this.delegate.getCurrentLocationName(),
            displayName: hq.name || '',
          }
        : null,
      currentSpawn: spawn
        ? {
            id: spawn.id,
            lat: spawn.lat,
            lon: spawn.lon,
            name: spawn.name,
          }
        : null,
      isGameInProgress: this.delegate.isGameInProgress(),
    };

    let dialogRef: Awaited<ReturnType<typeof openLocationDialog>>;
    try {
      dialogRef = await openLocationDialog(this.dialog, {
        data: dialogData,
        panelClass: 'td-dialog-panel',
        disableClose: false,
      });
    } catch (err) {
      if (err instanceof LocationDialogLoadError) {
        console.error('[LocationCoordinator] Location dialog did not load:', err);
        this.uiStore.notice.set(LOCATION_DIALOG_LOAD_FAILED);
      } else {
        console.error('[LocationCoordinator] Location dialog failed to open:', err);
        this.uiStore.notice.set(LOCATION_DIALOG_OPEN_FAILED);
      }
      return;
    }

    dialogRef.afterClosed()
      .pipe(take(1))
      .subscribe(async (result: LocationDialogResult | null | undefined) => {
      if (!result?.confirmed) return;

      // Show loading overlay IMMEDIATELY before any async operations
      this.engineInit.loading.set(true);
      this.engineInit.resetLoadingSteps();

      let spawnLat = result.spawn.lat;
      let spawnLon = result.spawn.lon;
      let spawnName = result.spawn.name;

      // Generate random spawn if requested
      if (result.spawn.isRandom) {
        // Load streets for the new location to find spawn
        const newNetwork = await this.osmService.loadStreets(result.hq.lat, result.hq.lon, 2000);

        // Store for reuse in executeLocationChange to avoid double-loading
        const callbacks = this.delegate!.getChangeCallbacks();
        callbacks.setStreetNetwork(newNetwork);
        callbacks.setStreetNetworkLocation({ lat: result.hq.lat, lon: result.hq.lon });

        const randomSpawn = this.osmService.findRandomStreetPoint(newNetwork, result.hq.lat, result.hq.lon, 500, 1000);

        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Random Spawn';
          callbacks.appendDebugLog(`Random spawn: ${Math.round(randomSpawn.distance)}m away`);
        } else {
          callbacks.appendDebugLog('No valid spawn found, using fallback');
          // Fallback: use a point 700m north
          spawnLat = result.hq.lat + 0.0063; // ~700m north
          spawnLon = result.hq.lon;
          spawnName = 'Fallback Spawn';
        }
      }

      // Apply the new location
      await this.applyNewLocation({
        hq: {
          lat: result.hq.lat,
          lon: result.hq.lon,
          name: result.hq.displayName,
          address: result.hq.address,
        },
        spawn: {
          lat: spawnLat,
          lon: spawnLon,
          name: spawnName,
        },
      });
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
   * Roll for a random city from Wikidata and navigate there
   */
  async onWorldDice(): Promise<void> {
    const callbacks = this.delegate?.getChangeCallbacks();
    callbacks?.appendDebugLog('World Dice: Rolling random city...');

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
      callbacks?.appendDebugLog('World Dice: Failed - ' + (this.worldDice.error() || 'Unknown error'));
      // Hide loading overlay on error
      this.engineInit.setLoading(false);
      return;
    }

    const displayName = city.country ? `${city.name}, ${city.country}` : city.name;
    callbacks?.appendDebugLog(`World Dice: ${displayName} (${city.lat.toFixed(4)}, ${city.lon.toFixed(4)})`);

    // Show "Loading Map..." step before reload
    this.engineInit.finishWorldDiceLoading(displayName);

    // Update URL with only HQ (l=), no spawn (s=) -> randomizer will create spawn
    const url = new URL(window.location.href);
    url.searchParams.set('l', `${city.lat.toFixed(5)},${city.lon.toFixed(5)}`);
    url.searchParams.delete('s'); // Remove spawn so randomizer kicks in

    // Small delay so user sees the "Loading Map..." step
    await new Promise(resolve => setTimeout(resolve, 300));

    // Navigate to new location (full reload for clean state)
    window.location.href = url.toString();
  }

  /**
   * Save current location as favorite
   */
  onAddFavorite(): void {
    this.locationMgmt.saveFavorite();
    this.resolveFavoriteNames(); // Refresh names
    this.delegate?.getChangeCallbacks().appendDebugLog('Favorite saved');
  }

  /**
   * Apply a favorite location
   */
  async onSelectFavorite(fav: FavoriteLocation): Promise<void> {
    const spawn = fav.spawns[0] || { lat: fav.hq.lat + 0.005, lon: fav.hq.lon };

    // Update service and URL
    this.locationMgmt.setLocation(fav.hq, fav.spawns);
    this.delegate?.getChangeCallbacks().syncUrlWithLocation();

    // Apply to game
    await this.applyNewLocation({
      hq: { lat: fav.hq.lat, lon: fav.hq.lon, name: 'Loading...' },
      spawn: { lat: spawn.lat, lon: spawn.lon, name: 'Spawn' },
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
   * Resolve display names for all favorites
   */
  async resolveFavoriteNames(): Promise<void> {
    const favs = this.locationMgmt.favorites();
    const names: Record<string, string> = {};

    for (const fav of favs) {
      names[fav.id] = await this.locationMgmt.getFavoriteDisplayName(fav);
    }

    this.favoriteNamesMap.set(names);
  }

  // ==================== Core Location Change ====================

  /**
   * Apply new location - builds context from delegate and executes change
   */
  async applyNewLocation(data: { hq: LocationConfig; spawn: LocationConfig }): Promise<void> {
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
    const input: LocationChangeInput = { hq: data.hq, spawn: data.spawn };

    try {
      await this.executor.executeLocationChange(input, ctx, callbacks);
    } catch (err) {
      console.error('[Location] Failed to apply location:', err);
      callbacks.appendDebugLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      this.engineInit.setError(err instanceof Error ? err.message : 'Error changing location');

      // Reset loading flags on error
      this.engineInit.tilesLoading.set(false);
      this.engineInit.osmLoading.set(false);
      this.heightUpdate.heightsLoading.set(false);
      this.locationMgmt.isApplyingLocation.set(false);
    }
  }
}
