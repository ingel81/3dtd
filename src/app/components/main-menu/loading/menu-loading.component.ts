import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../../services/location/location-management.service';
import { ConfigService } from '../../../core/services/config.service';
import { UIStore } from '../../../store/ui.store';
import { WorldContext } from '../../../world/world-context.service';
import { worldPlaceName } from '../../../world/world-ref';
import { MainMenuService } from '../main-menu.service';
import { loadingPlateView, mapDataLine } from './loading-plate';
import { tilesProgress, type TilesProgress } from '../../../three-engine/tile-loading-tracker';
import { onMapDataProgress, type MapDataProgress } from '../../../world/custom-map/map-data';

/**
 * The loading plate of the start menu, bottom right (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 6): the place, a brass bar of the boot steps done, the step under
 * way with its detail, the map tiles while they stream in (a thin bar with
 * the share and the count) and the steps as a list to open. A load that went
 * wrong shows here as a banner with the ways on: Retry, Other place (Other
 * map on a world of its own), Map key (where the world needs one).
 */
/** How often the plate reads the tiles' count, ms */
const TILES_POLL_MS = 500;

@Component({
  selector: 'app-menu-loading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menu-loading.component.html',
  styleUrl: './menu-loading.component.scss',
})
export class MenuLoadingComponent {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly config = inject(ConfigService);
  private readonly ui = inject(UIStore);
  private readonly world = inject(WorldContext);
  readonly menu = inject(MainMenuService);

  readonly steps = this.engineInit.loadingSteps;
  readonly view = computed(() => loadingPlateView(this.steps()));
  /** The bar in ten segments, filled to the steps done */
  readonly segments = computed(() => {
    const filled = Math.round(this.view().percent / 10);
    return Array.from({ length: 10 }, (_, i) => i < filled);
  });
  readonly placeName = computed(() => {
    // A world of its own (a custom map, DevWorld) is named by its ref, not by an address
    if (!this.world.capabilities().realPlace) return worldPlaceName(this.world.ref()) ?? this.locationMgmt.displayName();
    const mission = this.locationMgmt.missionInfo();
    return mission?.city || this.locationMgmt.displayName();
  });
  readonly problem = this.menu.problem;
  /** A failed engine or a refused key: the map key may be why, on a world that needs one */
  readonly offersMapKey = computed(
    () => this.world.capabilities().credentials && (this.problem()?.mapKey === true || this.engineInit.error() !== null),
  );
  /** Another place to load from New game; on a world of its own another map */
  readonly otherLabel = computed(() => (this.world.capabilities().realPlace ? 'Other place' : 'Other map'));
  readonly stepsOpen = signal(false);

  /** The custom maps' files loading from the site (TODO E134), counted since the page opened */
  private readonly mapData = signal<MapDataProgress>({ requested: 0, done: 0, fetched: 0, bytes: 0 });
  /** "Map data 12 of 48 files, 3.4 MB" while files still come, null otherwise */
  readonly mapDataLine = computed(() => mapDataLine(this.mapData()));

  /** The map tiles while they stream in, read twice a second (the engine keeps its count 500 ms) */
  readonly tiles = signal<TilesProgress | null>(null);

  constructor() {
    const off = onMapDataProgress((p) => this.mapData.set(p));
    const timer = setInterval(() => {
      const engine = this.engineInit.getEngine();
      const next = engine && this.world.capabilities().streaming ? tilesProgress(engine.getTileStats()) : null;
      const now = this.tiles();
      if (next?.loaded !== now?.loaded || next?.pending !== now?.pending) this.tiles.set(next);
    }, TILES_POLL_MS);
    inject(DestroyRef).onDestroy(() => {
      off();
      clearInterval(timer);
    });
  }

  toggleSteps(): void {
    this.stepsOpen.update((open) => !open);
  }

  /** Try the load again: its own retry, else the page anew (the link keeps the place) */
  retry(): void {
    const retry = this.ui.loadProblem()?.retry;
    if (retry) retry();
    else window.location.reload();
  }

  otherPlace(): void {
    this.menu.open('new-game');
  }

  mapKey(): void {
    this.config.setupRequested.set(true);
  }
}
