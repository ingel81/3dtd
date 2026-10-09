import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { AddressAutocompleteComponent } from '../../../address-autocomplete.component';
import { TdIconComponent } from '../../../icon/icon.component';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { WorldGlobeComponent } from '../../../world-globe/world-globe.component';
import { GeocodingService, NominatimAddress, UNKNOWN_LOCATION_NAME } from '../../../../services/location/geocoding.service';
import { GeolocationService } from '../../../../services/location/geolocation.service';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import { UrlLocationService } from '../../../../services/location/url-location.service';
import { RecentLocation, formatVisitAge, isSamePlace } from '../../../../services/location/recent-locations';
import { BestWaveService } from '../../../../services/location/best-wave.service';
import { BestWave, byBestWave } from '../../../../services/location/best-waves';
import { parseCoordinates, storedPlace, type PlaceChoice, type SpawnPick } from '../../../../services/location/place-choice';
import { SHOWCASE_LOCATIONS, ShowcaseLocation } from '../../../../configs/showcase-locations.config';
import { MAX_MANUAL_SPAWN_DISTANCE } from '../../../../configs/map-constants.config';
import type { FavoriteLocation } from '../../../../models/location.types';
import { haversineDistance } from '../../../../utils/geo-utils';
import { GameStore } from '../../../../store/game.store';

type SpawnMode = 'random' | 'manual';

/** The lists under the search: one at a time behind a switch */
export type PlaceList = 'recent' | 'favorites' | 'showcase' | 'world';

const LISTS: readonly { id: PlaceList; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'world', label: 'World' },
];

/** What a searched place looks like before it loads */
interface SearchedPlace {
  lat: number;
  lon: number;
  name?: string;
  address?: NominatimAddress;
}

/**
 * The place picker of the menu's New game page (plan E121, replaces the
 * location dialog): the search with coordinates and a pasted 3DTD link, the
 * spawn of a searched place, "Use my location", the world dice, and the
 * lists of recent places, favorites, the showcase and the world map of
 * defended places. A listed place loads with one click; a searched place
 * with "Load place". With a place loaded the spawn alone moves by address.
 *
 * It decides nothing about loading: every choice goes out as a PlaceChoice
 * (`chosen`), and the page hands it to the coordinator.
 */
@Component({
  selector: 'app-place-picker',
  standalone: true,
  imports: [
    AddressAutocompleteComponent,
    TdIconComponent,
    RovingGroupDirective,
    // Used only inside @defer on the World list, so the globe and its outlines load as a chunk of their own
    WorldGlobeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './place-picker.component.html',
  styleUrl: './place-picker.component.scss',
  host: { class: 'td-stack is-loose' },
})
export class PlacePickerComponent {
  private readonly geocoding = inject(GeocodingService);
  private readonly geolocation = inject(GeolocationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly coordinator = inject(LocationChangeCoordinatorService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly bestWaves = inject(BestWaveService);
  private readonly game = inject(GameStore);

  /** A place the player chose; the page loads it */
  readonly chosen = output<PlaceChoice>();

  /** The place loaded now, null at a start without one */
  readonly current = computed(() => {
    const hq = this.locationMgmt.editableHqLocation();
    return hq ? { lat: hq.lat, lon: hq.lon, name: this.locationMgmt.getLocationDisplayName() } : null;
  });

  /** The run under way at the place loaded, which a new place ends; moving only the spawn keeps the place */
  readonly runEnds = computed(() => {
    const current = this.current();
    const underWay = this.game.gameStarted() || this.game.towerCount() > 0;
    return current && underWay && !this.movingSpawn() ? current.name : null;
  });

  readonly lists = LISTS;
  readonly list = signal<PlaceList>(this.locationMgmt.recents().length > 0 ? 'recent' : 'showcase');

  /** Recent places except the one loaded, which would only restart it */
  readonly recentLocations = computed(() => {
    const current = this.current();
    return this.locationMgmt.recents().filter((r) => !current || !isSamePlace(r.hq, current));
  });
  readonly favorites = this.locationMgmt.favorites;
  readonly showcase = SHOWCASE_LOCATIONS;
  private readonly openedAt = Date.now();

  /** Defended places, highest wave first; the globe turns to the row under the pointer or the focus */
  readonly worldRecords = computed(() => [...this.bestWaves.records()].sort(byBestWave));
  readonly worldHover = signal<BestWave | null>(null);
  /** The place loaded, for the globe: grey ring, not clickable */
  readonly worldCurrent = computed(() => {
    const current = this.current();
    return current ? { lat: current.lat, lon: current.lon } : null;
  });

  /** Moving only the spawn of the place loaded, by address */
  readonly movingSpawn = signal(false);

  readonly selectedHQ = signal<SearchedPlace | null>(null);
  readonly selectedSpawn = signal<SpawnPick | null>(null);
  readonly spawnMode = signal<SpawnMode>('random');
  readonly spawnOpen = signal(false);

  readonly showCoordinates = signal(false);
  readonly coordLat = signal<number | null>(null);
  readonly coordLon = signal<number | null>(null);
  readonly isLoadingCoords = signal(false);

  /** "Use my location": asking the browser, or why it gave nothing */
  readonly locating = signal<'busy' | 'failed' | null>(null);

  readonly canApplyCoords = computed(() => {
    const lat = this.coordLat();
    const lon = this.coordLon();
    return lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  });

  /** How far the picked spawn is from the HQ it belongs to, m */
  readonly spawnDistance = computed(() => {
    const spawn = this.selectedSpawn();
    const hq = this.movingSpawn() ? this.current() : this.selectedHQ();
    return spawn && hq ? haversineDistance(hq.lat, hq.lon, spawn.lat, spawn.lon) : null;
  });
  readonly maxSpawnKm = MAX_MANUAL_SPAWN_DISTANCE / 1000;
  readonly isSpawnTooFar = computed(() => (this.spawnDistance() ?? 0) > MAX_MANUAL_SPAWN_DISTANCE);

  readonly canConfirm = computed(() => {
    if (this.movingSpawn()) return this.current() !== null && this.selectedSpawn() !== null && !this.isSpawnTooFar();
    if (this.spawnMode() === 'manual' && (this.selectedSpawn() === null || this.isSpawnTooFar())) return false;
    return this.selectedHQ() !== null;
  });

  /** The folded spawn line: "Spawn: random, 0.5 to 1 km from the HQ" */
  readonly spawnSummary = computed(() => {
    if (this.spawnMode() === 'random') return 'random, 0.5 to 1 km from the HQ';
    const spawn = this.selectedSpawn();
    return spawn?.name ? `at ${spawn.name}` : 'by address, none picked yet';
  });

  // ---- Search and coordinates ----

  onHQSelected(place: SearchedPlace): void {
    this.selectedHQ.set(place);
    this.coordLat.set(place.lat);
    this.coordLon.set(place.lon);
  }

  onHQCleared(): void {
    this.selectedHQ.set(null);
  }

  onCoordLat(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLat.set(value ? parseFloat(value) : null);
  }

  onCoordLon(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.coordLon.set(value ? parseFloat(value) : null);
  }

  /** A pasted 3DTD link loads that place with all its spawns, as a favourite does; pasted coordinates fill both fields */
  onCoordPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text')?.trim();
    if (!text) return;
    const place = text.includes('l=') ? this.urlLocation.parseLink(text) : null;
    if (place) {
      event.preventDefault();
      this.chosen.emit(storedPlace(place.hq, place.spawns));
      return;
    }
    const coords = parseCoordinates(text);
    if (coords) {
      event.preventDefault();
      this.coordLat.set(coords.lat);
      this.coordLon.set(coords.lon);
    }
  }

  async applyCoordinates(): Promise<void> {
    if (!this.canApplyCoords()) return;
    const lat = this.coordLat()!;
    const lon = this.coordLon()!;
    this.isLoadingCoords.set(true);
    try {
      this.selectedHQ.set(await this.named(lat, lon));
    } finally {
      this.isLoadingCoords.set(false);
    }
  }

  /** The place at these coordinates with its name; the coordinates themselves when the lookup finds none */
  private async named(lat: number, lon: number): Promise<SearchedPlace> {
    const result = await this.geocoding.reverseGeocodeDetailed(lat, lon);
    return result
      ? { lat, lon, name: result.displayName, address: result.address }
      : { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  }

  // ---- Spawn ----

  setSpawnMode(mode: SpawnMode): void {
    this.spawnMode.set(mode);
    if (mode === 'random') this.selectedSpawn.set(null);
  }

  onSpawnSelected(spawn: { lat: number; lon: number; name: string }): void {
    this.selectedSpawn.set(spawn);
  }

  onSpawnCleared(): void {
    this.selectedSpawn.set(null);
  }

  /** Into and out of moving only the spawn; each way starts without a picked spawn */
  setMovingSpawn(on: boolean): void {
    this.movingSpawn.set(on);
    this.selectedSpawn.set(null);
    this.spawnMode.set(on ? 'manual' : 'random');
  }

  confirm(): void {
    if (!this.canConfirm()) return;
    const spawn = this.spawnMode() === 'manual' ? this.selectedSpawn() : null;
    if (this.movingSpawn()) {
      const current = this.current()!;
      this.chosen.emit({ kind: 'place', hq: { lat: current.lat, lon: current.lon, name: current.name }, spawn });
      return;
    }
    const hq = this.selectedHQ()!;
    const extracted = hq.address ? this.geocoding.extractLocationName(hq.address) : UNKNOWN_LOCATION_NAME;
    const name = hq.name || (extracted !== UNKNOWN_LOCATION_NAME ? extracted : `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`);
    this.chosen.emit({ kind: 'place', hq: { lat: hq.lat, lon: hq.lon, name, address: hq.address }, spawn });
  }

  // ---- One click ----

  /** The browser's location, asked only on this click; it loads with a random spawn */
  async useMyLocation(): Promise<void> {
    if (this.locating() === 'busy') return;
    this.locating.set('busy');
    const found = await this.geolocation.detectLocation();
    if (!found) {
      this.locating.set('failed');
      return;
    }
    this.locating.set(null);
    const place = await this.named(found.lat, found.lon);
    this.chosen.emit({ kind: 'place', hq: { lat: place.lat, lon: place.lon, name: place.name!, address: place.address }, spawn: null });
  }

  rollDice(): void {
    this.chosen.emit({ kind: 'dice' });
  }

  visitAge(recent: RecentLocation): string {
    return formatVisitAge(recent.visitedAt, this.openedAt);
  }

  /** A recent place with the spawn it was played with */
  loadRecent(recent: RecentLocation): void {
    this.chosen.emit(this.listed(recent.hq, recent.name, recent.spawns[0]));
  }

  favoriteName(fav: FavoriteLocation): string {
    return fav.name ?? this.coordinator.favoriteNamesMap()[fav.id] ?? `${fav.hq.lat.toFixed(4)}, ${fav.hq.lon.toFixed(4)}`;
  }

  /** A favourite with every spawn it was saved with */
  loadFavorite(fav: FavoriteLocation): void {
    this.chosen.emit(storedPlace(fav.hq, fav.spawns));
  }

  isCurrent(hq: { lat: number; lon: number }): boolean {
    const current = this.current();
    return !!current && isSamePlace(hq, current);
  }

  /** A showcase place with its fixed spawn if it has one, otherwise random */
  loadShowcase(place: ShowcaseLocation): void {
    this.chosen.emit(this.listed(place, place.name, place.spawn));
  }

  /** A defended place with the spawn of its record run; the place loaded would only restart */
  loadRecord(record: BestWave): void {
    if (this.isCurrent(record.hq)) return;
    this.chosen.emit(this.listed(record.hq, record.detail, record.spawns[0]));
  }

  private listed(hq: { lat: number; lon: number }, name: string, spawn: SpawnPick | undefined): PlaceChoice {
    return {
      kind: 'place',
      hq: { lat: hq.lat, lon: hq.lon, name },
      spawn: spawn ? (spawn.portalBearing === undefined
        ? { lat: spawn.lat, lon: spawn.lon }
        : { lat: spawn.lat, lon: spawn.lon, portalBearing: spawn.portalBearing }) : null,
    };
  }
}
