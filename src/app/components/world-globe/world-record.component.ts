import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TD_CSS_VARS } from '../../styles/td-theme';
import type { NewRecord } from '../../services/location/best-wave.service';
import type { BestWave } from '../../services/location/best-waves';
import { WorldGlobeComponent } from './world-globe.component';

/**
 * Game-over hint of a new record: a small globe turned to the place, "New
 * record for <town>: wave N" and the best before. Fades in a moment after
 * the game-over screen; Skip hides it, Restart removes it with the run.
 */
@Component({
  selector: 'app-world-record',
  standalone: true,
  imports: [WorldGlobeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './world-record.component.html',
  styleUrl: './world-record.component.scss',
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }
  `,
})
export class WorldRecordComponent {
  readonly record = input.required<NewRecord>();
  /** Every place, so the globe shows the new record among the others */
  readonly records = input.required<readonly BestWave[]>();

  readonly dismissed = output<void>();
}
