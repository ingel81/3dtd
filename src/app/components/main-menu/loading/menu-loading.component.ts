import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../../services/location/location-management.service';
import { ConfigService } from '../../../core/services/config.service';
import { UIStore } from '../../../store/ui.store';
import { MainMenuService } from '../main-menu.service';
import { loadingPlateView } from './loading-plate';

/**
 * The loading plate of the start menu, bottom right (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 6): the place, a brass bar of the boot steps done, the step under
 * way with its detail and the steps as a list to open. A load that went
 * wrong shows here as a banner with the ways on: Retry, Other place, Map key.
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
  readonly menu = inject(MainMenuService);

  readonly steps = this.engineInit.loadingSteps;
  readonly view = computed(() => loadingPlateView(this.steps()));
  /** The bar in ten segments, filled to the steps done */
  readonly segments = computed(() => {
    const filled = Math.round(this.view().percent / 10);
    return Array.from({ length: 10 }, (_, i) => i < filled);
  });
  readonly placeName = computed(() => {
    const mission = this.locationMgmt.missionInfo();
    return mission?.city || this.locationMgmt.displayName();
  });
  readonly problem = this.menu.problem;
  /** A failed engine or a refused key: the map key may be why */
  readonly offersMapKey = computed(() => this.problem()?.mapKey === true || this.engineInit.error() !== null);
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
