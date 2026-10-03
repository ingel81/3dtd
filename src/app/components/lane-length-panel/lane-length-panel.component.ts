import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MapPlacementService } from '../../services/world/map-placement.service';
import { PathAndRouteService } from '../../services/world/path-route.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { laneStats } from '../../coop/lane-stats';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { laneLengthRows } from './lane-length-rows';

/**
 * While a spawn is added or moved, single player and coop: every lane's
 * route to the HQ as a bar in its colour, the one being placed highlighted
 * and following the cursor, and how it compares with the others on average
 * (docs/WAVE_SYSTEM.md (Spuren), L6). A short lane leaves less time to shoot.
 */
@Component({
  selector: 'app-lane-length-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lane-length-panel.component.html',
  styleUrl: './lane-length-panel.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class LaneLengthPanelComponent {
  private readonly placement = inject(MapPlacementService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly store = inject(TowerDefenseStore);

  /** Which lane is placed: the same object for the whole placement, so standing() reads the routes once */
  private readonly target = computed(() => this.placement.spawnPreview()?.target ?? null);

  /** The route lengths of the spawns as they stand, read once a placement starts (the routes do not change meanwhile) */
  private readonly standing = computed(() => {
    if (this.target() === null) return [];
    const paths = this.pathRoute.getCachedPaths();
    const stats = laneStats(paths, 1);
    return this.store.spawnPoints().map((spawn) => stats.get(spawn.id)?.meters ?? 0);
  });

  readonly view = computed(() => {
    const preview = this.placement.spawnPreview();
    return preview ? laneLengthRows(this.standing(), preview) : null;
  });
}
