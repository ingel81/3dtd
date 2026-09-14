import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { RelocationStatusService } from '../../services/world/relocation-status.service';

/**
 * Hint over the map while the HQ moves: the step under way and, while the
 * corridor is measured, how far it is (RelocationStatusService). Takes no
 * clicks. The host is the live region, so screen readers hear the step
 * when the hint appears or its step changes, not every percent.
 */
@Component({
  selector: 'app-relocation-status',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './relocation-status.component.html',
  styleUrl: './relocation-status.component.scss',
  host: { role: 'status' },
})
export class RelocationStatusComponent {
  readonly status = inject(RelocationStatusService).status;
}
