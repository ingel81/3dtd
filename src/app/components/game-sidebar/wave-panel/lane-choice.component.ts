import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { LocationFacadeService } from '../../../services/facade/location-facade.service';
import { EngineInitializationService } from '../../../services/infrastructure/engine-initialization.service';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { UIStore } from '../../../store/ui.store';
import { WorldContext } from '../../../world/world-context.service';
import { hasLaneChoice, laneLoadHint, toggledLanes } from '../../../world/custom-map/lane-choice';

/** A lane as the list shows it */
interface LaneRow {
  id: string;
  name: string;
  color: string;
  open: boolean;
  /** Its switch does something: the map allows the set it would make */
  switchable: boolean;
  /** Why it cannot be switched, for its tooltip */
  why: string;
}

/**
 * The lanes before wave 1 (TODO E130): on a map with optional lanes, the
 * player (in coop the host, in the lobby) switches which are open. A closed
 * lane is as if it were not there: no portal, no route. Every open lane
 * brings a full wave; the line under the list says so.
 */
@Component({
  selector: 'app-lane-choice',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <section class="td-group lc-root" aria-labelledby="td-lane-choice">
        <h3 class="td-section" id="td-lane-choice">Lanes <span class="td-note">before wave 1</span></h3>
        <div class="td-rows">
          @for (lane of rows(); track lane.id) {
            <label class="td-row lc-row" [matTooltip]="lane.why" matTooltipPosition="left" [attr.data-lane]="lane.id">
              <span class="td-swatch" [style.--td-mark]="lane.color"></span>
              <span class="td-name td-trunc lc-name">{{ lane.name }}</span>
              <input class="td-switch" type="checkbox" [checked]="lane.open" [disabled]="busy() || !lane.switchable"
                     (change)="toggle(lane.id, $event)" [attr.aria-label]="'Lane ' + lane.name + ' open'" />
            </label>
          }
        </div>
        <p class="td-note" role="status">{{ hint() }}</p>
      </section>
    }
  `,
  styles: [`.lc-row { gap: 8px; cursor: pointer; } .lc-name { flex: 1 1 auto; min-width: 0; }`],
})
export class LaneChoiceComponent {
  private readonly world = inject(WorldContext);
  private readonly location = inject(LocationFacadeService, { optional: true });
  private readonly store = inject(TowerDefenseStore);
  private readonly ui = inject(UIStore);
  private readonly engineInit = inject(EngineInitializationService);

  /** Counts up when the lanes changed here, so the list reads them again */
  private readonly rev = signal(0);
  /** A change builds the routes anew; the switches wait for it */
  readonly busy = signal(false);

  /** The world's lanes where the player has a choice (hasLaneChoice) */
  private readonly lanes = computed(() => {
    this.rev();
    const lanes = this.world.provider()?.lanes() ?? null;
    return lanes && hasLaneChoice(lanes.choice) ? lanes : null;
  });

  /** Before wave 1, not while the place loads, not for a coop guest or in a coop game (coopMapLocked) */
  readonly shown = computed(() =>
    this.lanes() !== null && this.location !== null && !this.store.gameStarted() && !this.engineInit.loading() && !this.ui.coopMapLocked());

  readonly rows = computed<LaneRow[]>(() => {
    // The world keeps the open lanes itself: read them again after a change
    this.rev();
    const lanes = this.lanes();
    if (!lanes) return [];
    const open = lanes.open();
    return lanes.choice.lanes.map((lane) => {
      const isOpen = open.includes(lane.id);
      const switchable = toggledLanes(lanes.choice, open, lane.id) !== null;
      const why = !lane.optional
        ? 'This lane is always open on this map'
        : switchable ? (isOpen ? 'Close this lane' : 'Open this lane')
          : isOpen ? `At least ${lanes.choice.min} ${lanes.choice.min === 1 ? 'lane stays' : 'lanes stay'} open` : `At most ${lanes.choice.max} lanes are open on this map`;
      return {
        id: lane.id,
        name: lane.name,
        color: `#${SPAWN_COLORS[lane.slot % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`,
        open: isOpen,
        switchable,
        why,
      };
    });
  });

  readonly hint = computed(() => (this.rev(), laneLoadHint(this.lanes()?.open().length ?? 0)));

  async toggle(id: string, event: Event): Promise<void> {
    const lanes = this.lanes();
    const next = lanes ? toggledLanes(lanes.choice, lanes.open(), id) : null;
    if (!next || !this.location || this.busy()) {
      (event.target as HTMLInputElement).checked = lanes?.open().includes(id) ?? false;
      return;
    }
    this.busy.set(true);
    try {
      await this.location.setOpenLanes(next);
    } finally {
      this.busy.set(false);
      this.rev.update((n) => n + 1);
    }
  }
}
