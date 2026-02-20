import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-compass',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="compass-container">
      <!-- Rotating dial -->
      <div class="compass" [style.transform]="'rotate(' + (-rotation()) + 'deg)'">
        <svg class="compass-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" class="compass-bg"/>
          <circle cx="50" cy="50" r="48" class="compass-ring"/>
          <!-- Tick marks at intercardinal positions -->
          <line x1="50" y1="5" x2="50" y2="12" class="compass-tick" transform="rotate(45 50 50)"/>
          <line x1="50" y1="5" x2="50" y2="12" class="compass-tick" transform="rotate(135 50 50)"/>
          <line x1="50" y1="5" x2="50" y2="12" class="compass-tick" transform="rotate(225 50 50)"/>
          <line x1="50" y1="5" x2="50" y2="12" class="compass-tick" transform="rotate(315 50 50)"/>
          <!-- Cardinal labels on the dial -->
          <text x="50" y="16" class="compass-label-n">N</text>
          <text x="50" y="89" class="compass-label-s">S</text>
          <text x="87" y="53" class="compass-label-ew">O</text>
          <text x="13" y="53" class="compass-label-ew">W</text>
          <!-- Center dot -->
          <circle cx="50" cy="50" r="3" class="compass-pivot"/>
          <circle cx="50" cy="50" r="1.5" class="compass-pivot-inner"/>
        </svg>
      </div>
      <!-- Fixed look-direction indicator (always points up) -->
      <svg class="compass-indicator" viewBox="0 0 100 100">
        <path d="M50 0 L44 10 L56 10 Z" class="compass-indicator-arrow"/>
      </svg>
    </div>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    .compass-container {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 5;
      pointer-events: none;
    }

    .compass {
      position: relative;
      width: 64px;
      height: 64px;
      transition: transform 0.15s ease-out;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
    }

    .compass-svg {
      width: 100%;
      height: 100%;
    }

    .compass-bg {
      fill: rgba(15, 18, 15, 0.75);
    }

    .compass-ring {
      fill: none;
      stroke: rgba(212, 175, 55, 0.5);
      stroke-width: 2;
    }

    .compass-tick {
      stroke: rgba(212, 175, 55, 0.3);
      stroke-width: 1.5;
      stroke-linecap: round;
    }

    .compass-pivot {
      fill: rgba(212, 175, 55, 0.6);
    }

    .compass-pivot-inner {
      fill: rgba(15, 18, 15, 0.9);
    }

    .compass-indicator {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .compass-indicator-arrow {
      fill: rgba(255, 255, 255, 0.95);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }

    .compass-label-n {
      font-size: 14px;
      font-weight: 700;
      font-family: Arial, sans-serif;
      fill: rgba(220, 70, 50, 1);
      text-anchor: middle;
      dominant-baseline: central;
    }

    .compass-label-s {
      font-size: 12px;
      font-weight: 600;
      font-family: Arial, sans-serif;
      fill: rgba(210, 210, 210, 0.85);
      text-anchor: middle;
      dominant-baseline: central;
    }

    .compass-label-ew {
      font-size: 11px;
      font-weight: 600;
      font-family: Arial, sans-serif;
      fill: rgba(180, 180, 180, 0.6);
      text-anchor: middle;
      dominant-baseline: central;
    }
  `,
})
export class CompassComponent {
  readonly rotation = input.required<number>();
  readonly heading = input.required<number>();
}
