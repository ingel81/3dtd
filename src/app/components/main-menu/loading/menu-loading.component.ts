import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../../services/location/location-management.service';
import { ConfigService } from '../../../core/services/config.service';
import { UIStore } from '../../../store/ui.store';
import { WorldContext } from '../../../world/world-context.service';
import { worldPlaceName } from '../../../world/world-ref';
import { MainMenuService } from '../main-menu.service';
import { loadingPlateView } from './loading-plate';

/**
 * The loading plate of the start menu, bottom right (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 6): the place, a brass bar of the boot steps done, the step under
 * way with its detail and the steps as a list to open. A load that went
 * wrong shows here as a banner with the ways on: Retry, Other place (Other
 * map on a world of its own), Map key (where the world needs one).
 */
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
