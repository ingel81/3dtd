import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IntroCameraFlightService } from '../../services/world/intro-camera-flight.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

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
    <button class="intro-skip-btn" type="button" (click)="skip()">
      Skip Intro
      <span class="intro-skip-hint">ESC</span>
    </button>
  `,
  styles: [`
    /*
     * Placed by the bottom stack of the game component, with the LOS legend
     * and the hint box (.td-bottom-stack). Right-aligning put it underneath
     * the sidebar.
     */
    :host {
      ${TD_CSS_VARS}
      display: block;
      /* Clickable, so above the band of the off-screen arrows */
      margin-bottom: 36px;
      pointer-events: auto;
    }

    .intro-skip-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      cursor: pointer;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-mid);
      border-radius: 4px;
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.33),
        var(--td-shadow-soft);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: border-color 120ms ease, color 120ms ease;
    }

    .intro-skip-btn:hover {
      border-color: var(--td-gold-light);
      color: var(--td-gold-light);
    }

    .intro-skip-hint {
      padding: 1px 5px;
      border: 1px solid var(--td-frame-dark);
      border-radius: 2px;
      font-size: 9px;
      letter-spacing: 0.04em;
      opacity: 0.7;
    }
  `],
})
export class IntroSkipComponent {
  private readonly introFlight = inject(IntroCameraFlightService);

  skip(): void {
    this.introFlight.cancel('skip-button');
  }
}
