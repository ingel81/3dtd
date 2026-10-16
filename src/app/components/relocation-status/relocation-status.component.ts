import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { RelocationStatusService } from '../../services/world/relocation-status.service';
import { WorldContext } from '../../world/world-context.service';
import { overpassRetryText } from '../../world/osm/overpass-client';

/**
 * Hint over the map while the HQ moves: the step under way and, while the
 * corridor is measured, how far it is (RelocationStatusService). Takes no
 * clicks. While the streets of a moved HQ load and their servers are asked
 * again (overpass-client.ts), the step says so. The host is the live region, so screen readers hear the step
 * when the hint appears or its step changes, not every percent.
 */
@Component({
  selector: 'app-relocation-status',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './relocation-status.component.html',
  styleUrl: './relocation-status.component.scss',
  host: { role: 'status', class: 'td-chip-slot' },
})
export class RelocationStatusComponent {
  private readonly world = inject(WorldContext);
  private readonly shown = inject(RelocationStatusService).status;
  readonly status = computed(() => {
    const status = this.shown();
    const retry = status?.streets ? this.world.provider()?.streets.retrying?.() : null;
    return status && retry ? { ...status, step: `${overpassRetryText(retry)}…` } : status;
  });
}
