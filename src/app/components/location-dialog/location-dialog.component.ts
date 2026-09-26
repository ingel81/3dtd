import { Component, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AddressAutocompleteComponent } from '../address-autocomplete.component';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../services/location/geocoding.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { RecentLocation, formatVisitAge, isSamePlace } from '../../services/location/recent-locations';
import { BestWaveService } from '../../services/location/best-wave.service';
import { BestWave, byBestWave } from '../../services/location/best-waves';
import { SHOWCASE_LOCATIONS, ShowcaseLocation } from '../../configs/showcase-locations.config';
import { TdIconComponent } from '../icon/icon.component';
import { WorldGlobeComponent } from '../world-globe/world-globe.component';
import { CoopEntryComponent } from '../coop-entry/coop-entry.component';
import { COOP } from '../../services/coop.token';
import { joinedPlaceResult } from './joined-place';
import {
  LocationDialogData,
  LocationDialogMode,
  LocationDialogResult,
  LocationInfo,
  SavedSpawn,
  SpawnLocationConfig,
} from '../../models/location.types';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { haversineDistance } from '../../utils/geo-utils';

type SpawnMode = 'random' | 'manual';

@Component({
  selector: 'app-td-location-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    AddressAutocompleteComponent,
    TdIconComponent,
    CoopEntryComponent,
    // Used only inside @defer on the World tab, so the globe and its outlines load as a chunk of their own
    WorldGlobeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './location-dialog.component.html',
  styleUrl: './location-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class LocationDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<LocationDialogComponent>);
  private readonly geocodingService = inject(GeocodingService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly bestWaves = inject(BestWaveService);
  readonly data: LocationDialogData = inject(MAT_DIALOG_DATA);
  /** The game's coop service, through the injector the start dialog opens with (E30); null elsewhere */
  readonly coop = inject(COOP, { optional: true });

  constructor() {
    // Joined from the Coop tab: the host's world came, close with its place
    // (every spawn of it), and the boot loads that place (E30)
    const coop = this.coop;
    if (coop) effect(() => {
      const place = coop.hostPlace();
      if (place && this.editMode() === 'coop') this.dialogRef.close(joinedPlaceResult(place));
    });
  }

  /** A start without a place: "Choose a place", and no Cancel, there is nothing to go back to */
  readonly firstPlace = !this.data.currentLocation;
  readonly title = this.firstPlace ? 'Choose a place' : 'Change place';

  /** Recent places except the one being played, which would only restart it. */
  readonly recentLocations = computed(() => {
    const current = this.data.currentLocation;
    return this.locationMgmt.recents().filter((r) => !current || !isSamePlace(r.hq, current));
  });
  private readonly openedAt = Date.now();

  readonly showcaseLocations = SHOWCASE_LOCATIONS;
  /** Tab of the quick-pick list; without recent places only the showcase is there. */
  readonly quickTab = signal<'recent' | 'showcase'>('recent');
  readonly activeQuickTab = computed(() =>
    this.recentLocations().length > 0 ? this.quickTab() : 'showcase',
  );

  /** World tab: defended places, highest wave first */
  readonly worldRecords = computed(() => [...this.bestWaves.records()].sort(byBestWave));
  /** Row under the pointer or the focus; the globe turns to it */
  readonly worldHover = signal<BestWave | null>(null);
  readonly worldCurrent = this.data.currentLocation
    ? { lat: this.data.currentLocation.lat, lon: this.data.currentLocation.lon }
    : null;

  /**
   * The Coop tab: only at a start without a place, where there is something
   * to join (the desktop app's LAN, or an online lobby) (E30, D67)
   */
  readonly coopOffered = computed(() => {
    const coop = this.coop;
    return !!coop && this.firstPlace && (coop.lanAvailable || coop.lobby() !== null);
  });

  // State
  readonly editMode = signal<LocationDialogMode>(this.data.initialMode ?? 'place');
  /**
   * The Place tab picks a new place, or, with a place loaded, moves only its
   * spawn by address: the former Spawn Only tab (plan U1)
   */
  readonly placeView = signal<'pick' | 'spawn'>('pick');
  /** The spawn settings of a new place, folded into one line until opened (plan U2) */
  readonly spawnOpen = signal(false);
  readonly selectedHQ = signal<{ lat: number; lon: number; name?: string; address?: NominatimAddress } | null>(null);
  readonly selectedSpawn = signal<{ lat: number; lon: number; name?: string } | null>(null);
  readonly spawnMode = signal<SpawnMode>('random');
  /** Only the spawn moves, the HQ stays where it is */
  readonly movingSpawn = computed(() => this.editMode() === 'place' && this.placeView() === 'spawn');
  readonly showCoordinates = signal(false);
  readonly isLoadingCoords = signal(false);

  // Coordinate inputs as signals for reactivity
  readonly coordLat = signal<number | null>(null);
  readonly coordLon = signal<number | null>(null);

  // Computed
  readonly canApplyCoords = computed(() => {
    const lat = this.coordLat();
    const lon = this.coordLon();
    return (
      lat !== null &&
      lon !== null &&
      !isNaN(lat) &&
      !isNaN(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    );
  });

  // Spawn distance from HQ
  readonly spawnDistance = computed(() => {
    const spawn = this.selectedSpawn();
    if (!spawn) return null;

    let hqLat: number, hqLon: number;
    if (this.movingSpawn() && this.data.currentLocation) {
      hqLat = this.data.currentLocation.lat;
      hqLon = this.data.currentLocation.lon;
    } else if (this.selectedHQ()) {
      hqLat = this.selectedHQ()!.lat;
      hqLon = this.selectedHQ()!.lon;
    } else {
      return null;
    }

    return haversineDistance(hqLat, hqLon, spawn.lat, spawn.lon);
  });

  readonly isSpawnTooFar = computed(() => {
    const dist = this.spawnDistance();
    return dist !== null && dist > 1500;
  });

  readonly canConfirm = computed(() => {
    if (this.movingSpawn()) {
      return this.data.currentLocation !== null && this.selectedSpawn() !== null && !this.isSpawnTooFar();
    }
    if (this.spawnMode() === 'manual' && (this.selectedSpawn() === null || this.isSpawnTooFar())) return false;
    return this.selectedHQ() !== null;
  });

  /**
   * The confirm button: on the Place tab once a place is picked in the search
   * (recent and showcase places load with one click), or while moving the spawn
   */
  readonly showConfirm = computed(() =>
    this.editMode() === 'place' && (this.movingSpawn() || this.selectedHQ() !== null));

  /** The folded spawn line: "Spawn: random, 0.5 to 1 km from the HQ" */
  readonly spawnSummary = computed(() => {
    if (this.spawnMode() === 'random') return 'random, 0.5 to 1 km from the HQ';
    const spawn = this.selectedSpawn();
    return spawn?.name ? `at ${spawn.name}` : 'by address, none picked yet';
  });

  setEditMode(mode: LocationDialogMode): void {
    this.editMode.set(mode);
  }

  /** Into and out of moving only the spawn; each way starts without a picked spawn */
  setPlaceView(view: 'pick' | 'spawn'): void {
    this.placeView.set(view);
    this.selectedSpawn.set(null);
    this.spawnMode.set(view === 'spawn' ? 'manual' : 'random');
  }

  toggleCoordinates(): void {
    this.showCoordinates.update((v) => !v);
  }

  onCoordLatChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLat.set(value ? parseFloat(value) : null);
  }

  onCoordLonChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLon.set(value ? parseFloat(value) : null);
  }

  onCoordPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text')?.trim();
    if (!pastedText) return;

    const coords = this.parseCoordinates(pastedText);
    if (coords) {
      event.preventDefault();
      this.coordLat.set(coords.lat);
      this.coordLon.set(coords.lon);
    }
  }

  private parseCoordinates(text: string): { lat: number; lon: number } | null {
    // Normalize whitespace and common separators
    const normalized = text.trim().replace(/\s+/g, ' ');

    // Try various formats

    // Format: "49.5432, 9.1234" or "49.5432,9.1234" or "49.5432 9.1234"
    const decimalPattern = /^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/;
    let match = normalized.match(decimalPattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Format with cardinal directions: "49.5432°N, 9.1234°E" or "49.5432N 9.1234E"
    const cardinalPattern = /^(-?\d+\.?\d*)\s*°?\s*([NSns])[,\s]+(-?\d+\.?\d*)\s*°?\s*([EWew])$/;
    match = normalized.match(cardinalPattern);
    if (match) {
      let lat = parseFloat(match[1]);
      let lon = parseFloat(match[3]);
      if (match[2].toUpperCase() === 'S') lat = -lat;
      if (match[4].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Format: "N 49.5432, E 9.1234" or "N49.5432 E9.1234"
    const prefixCardinalPattern = /^([NSns])\s*(-?\d+\.?\d*)[,\s]+([EWew])\s*(-?\d+\.?\d*)$/;
    match = normalized.match(prefixCardinalPattern);
    if (match) {
      let lat = parseFloat(match[2]);
      let lon = parseFloat(match[4]);
      if (match[1].toUpperCase() === 'S') lat = -lat;
      if (match[3].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // DMS Format: "49°32'35.5\"N 9°7'24.2\"E" or similar
    const dmsPattern = /^(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([NSns])[,\s]+(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([EWew])$/;
    match = normalized.match(dmsPattern);
    if (match) {
      let lat = this.dmsToDecimal(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
      let lon = this.dmsToDecimal(parseFloat(match[5]), parseFloat(match[6]), parseFloat(match[7]));
      if (match[4].toUpperCase() === 'S') lat = -lat;
      if (match[8].toUpperCase() === 'W') lon = -lon;
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    // Google Maps URL format: "@49.5432,9.1234" or "/@49.5432,9.1234,"
    const googleMapsPattern = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
    match = text.match(googleMapsPattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (this.isValidLatLon(lat, lon)) {
        return { lat, lon };
      }
    }

    return null;
  }

  private dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
    return degrees + minutes / 60 + seconds / 3600;
  }

  private isValidLatLon(lat: number, lon: number): boolean {
    return !isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  async applyCoordinates(): Promise<void> {
    if (!this.canApplyCoords()) return;

    const lat = this.coordLat()!;
    const lon = this.coordLon()!;

    this.isLoadingCoords.set(true);
    try {
      const result = await this.geocodingService.reverseGeocodeDetailed(lat, lon);
      if (result) {
        this.selectedHQ.set({
          lat,
          lon,
          name: result.displayName,
          address: result.address,
        });
      } else {
        // Use coordinates directly if reverse geocoding fails
        this.selectedHQ.set({
          lat,
          lon,
          name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        });
      }
    } finally {
      this.isLoadingCoords.set(false);
    }
  }

  onHQSelected(location: { lat: number; lon: number; name: string; address?: NominatimAddress }): void {
    this.selectedHQ.set(location);
    // Update coordinate fields
    this.coordLat.set(location.lat);
    this.coordLon.set(location.lon);
  }

  onHQCleared(): void {
    this.selectedHQ.set(null);
  }

  setSpawnMode(mode: SpawnMode): void {
    this.spawnMode.set(mode);
    if (mode === 'random') {
      this.selectedSpawn.set(null);
    }
  }

  onSpawnSelected(location: { lat: number; lon: number; name: string }): void {
    this.selectedSpawn.set(location);
  }

  onSpawnCleared(): void {
    this.selectedSpawn.set(null);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  visitAge(recent: RecentLocation): string {
    return formatVisitAge(recent.visitedAt, this.openedAt);
  }

  /** One click loads a recent place with the spawn it was played with. */
  loadRecent(recent: RecentLocation): void {
    this.closeWithPlace(recent.hq, recent.name, recent.name, recent.spawns[0], 'spawn_recent');
  }

  /** The place being played: loading it again would only restart it. */
  isCurrentPlace(record: BestWave): boolean {
    return !!this.worldCurrent && isSamePlace(record.hq, this.worldCurrent);
  }

  /** One click on the globe or the list loads a defended place with the spawn of its record run. */
  loadRecord(record: BestWave): void {
    if (this.isCurrentPlace(record)) return;
    this.closeWithPlace(record.hq, record.name, record.detail, record.spawns[0], 'spawn_world');
  }

  /** Close with a place picked from a list: no confirm step, a random spawn when none is stored. */
  private closeWithPlace(
    hq: { lat: number; lon: number },
    name: string,
    displayName: string,
    spawn: SavedSpawn | undefined,
    spawnId: string,
  ): void {
    this.dialogRef.close({
      hq: { lat: hq.lat, lon: hq.lon, name, displayName },
      spawn: spawn
        ? { id: spawnId, lat: spawn.lat, lon: spawn.lon, portalBearing: spawn.portalBearing, isRandom: false }
        : { id: 'spawn_random', lat: 0, lon: 0, isRandom: true },
      confirmed: true,
    } satisfies LocationDialogResult);
  }

  /** One click loads a showcase place, with its fixed spawn if it has one, otherwise random like the Random mode. */
  loadShowcase(place: ShowcaseLocation): void {
    this.closeWithPlace(place, place.name, place.name, place.spawn, 'spawn_showcase');
  }

  confirm(): void {
    let hqInfo: LocationInfo;

    if (this.movingSpawn()) {
      // Use current HQ
      const current = this.data.currentLocation;
      if (!current) return;

      hqInfo = {
        lat: current.lat,
        lon: current.lon,
        name: current.name || `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}`,
        displayName: current.name || `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}`,
      };
    } else {
      // Use selected HQ
      const hq = this.selectedHQ();
      if (!hq) return;

      const extractedName = hq.address
        ? this.geocodingService.extractLocationName(hq.address)
        : UNKNOWN_LOCATION_NAME;

      hqInfo = {
        lat: hq.lat,
        lon: hq.lon,
        name: extractedName !== UNKNOWN_LOCATION_NAME ? extractedName : (hq.name || `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`),
        displayName: hq.name || '',
        address: hq.address,
      };
    }

    let spawnConfig: SpawnLocationConfig;

    if (this.spawnMode() === 'random') {
      spawnConfig = {
        id: 'spawn_random',
        lat: 0,
        lon: 0,
        isRandom: true,
      };
    } else {
      const spawn = this.selectedSpawn();
      if (!spawn) return;

      spawnConfig = {
        id: 'spawn_manual',
        lat: spawn.lat,
        lon: spawn.lon,
        name: spawn.name,
        isRandom: false,
      };
    }

    const result: LocationDialogResult = {
      hq: hqInfo,
      spawn: spawnConfig,
      confirmed: true,
    };

    this.dialogRef.close(result);
  }
}
