import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { relayLabel } from '../../coop/relay-address';
import { joinSteps } from './coop-dock-view';

/**
 * Joining a coop room as a guest, step by step: connected, room found, the
 * host's map loading (with the loading screen's progress), a seat taken.
 * The loading screen runs behind the dock.
 */
@Component({
  selector: 'app-coop-join-steps',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-join-steps.component.html',
  styleUrl: './coop-join-steps.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopJoinStepsComponent {
  readonly coop = inject(CoopService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);

  readonly placeName = computed(() => this.locationMgmt.getLocationDisplayName());

  /** Share of the loading screen's steps done, while the engine loads a place */
  private readonly mapPercent = computed(() => {
    if (!this.engineInit.loading()) return null;
    const steps = this.engineInit.loadingSteps();
    return steps.length ? Math.round((steps.filter((s) => s.status === 'done').length / steps.length) * 100) : null;
  });

  readonly steps = computed(() => {
    const room = this.coop.room();
    const relay = this.coop.relay();
    return joinSteps({
      status: this.coop.status(),
      room,
      relay: relay ? relayLabel(relay.url) : '',
      mapPercent: this.mapPercent(),
      worldReady: this.coop.worldReady(),
      mySpawn: room?.players.find((p) => p.id === this.coop.playerId())?.spawnId ?? null,
    });
  });
  readonly barPercent = computed(() => this.mapPercent() ?? 0);
}
