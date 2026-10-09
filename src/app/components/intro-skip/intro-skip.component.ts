import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IntroCameraFlightService } from '../../services/world/intro-camera-flight.service';

/**
 * Skip control for the intro camera flight.
 *
 * Only rendered while the flight is running (the caller gates on
 * `IntroCameraFlightService.active`). Clicking it ends the cinematic and
 * jumps straight to the normal game view — the same thing clicking or
 * scrolling on the canvas does, just discoverable.
 */
@Component({
  selector: 'app-intro-skip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="td-btn-secondary" type="button" (click)="skip()">
      Skip intro <kbd class="td-kbd">Esc</kbd>
    </button>
  `,
  styles: [`
    /*
     * Placed by the bottom stack of the game component, with the LOS legend
     * and the hint box (.td-bottom-stack). Right-aligning put it underneath
     * the sidebar.
     */
    :host {
      display: block;
      /* Clickable, so above the band of the off-screen arrows */
      margin-bottom: 36px;
      pointer-events: auto;
    }
  `],
})
export class IntroSkipComponent {
  private readonly introFlight = inject(IntroCameraFlightService);

  skip(): void {
    this.introFlight.cancel('skip-button');
  }
}
