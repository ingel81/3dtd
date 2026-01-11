import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-compass',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="compass-container">
      <div class="compass" [style.transform]="'rotate(' + (-rotation()) + 'deg)'">
        <svg class="compass-svg" viewBox="0 0 64 64">
          <!-- Background -->
          <circle cx="32" cy="32" r="30" class="compass-bg"/>
          <!-- Outer ring -->
          <circle cx="32" cy="32" r="30" class="compass-ring"/>
          <!-- Inner ring -->
          <circle cx="32" cy="32" r="22" class="compass-inner-ring"/>
          <!-- Major tick marks (N, E, S, W) -->
          <line x1="32" y1="3" x2="32" y2="10" class="compass-tick major" transform="rotate(0 32 32)"/>
          <line x1="32" y1="3" x2="32" y2="10" class="compass-tick major" transform="rotate(90 32 32)"/>
          <line x1="32" y1="3" x2="32" y2="10" class="compass-tick major" transform="rotate(180 32 32)"/>
          <line x1="32" y1="3" x2="32" y2="10" class="compass-tick major" transform="rotate(270 32 32)"/>
          <!-- Minor tick marks (NE, SE, SW, NW) -->
          <line x1="32" y1="4" x2="32" y2="8" class="compass-tick minor" transform="rotate(45 32 32)"/>
          <line x1="32" y1="4" x2="32" y2="8" class="compass-tick minor" transform="rotate(135 32 32)"/>
          <line x1="32" y1="4" x2="32" y2="8" class="compass-tick minor" transform="rotate(225 32 32)"/>
          <line x1="32" y1="4" x2="32" y2="8" class="compass-tick minor" transform="rotate(315 32 32)"/>
          <!-- North needle (red) -->
          <path d="M32 10 L28 32 L32 28 L36 32 Z" class="compass-needle-n"/>
          <!-- South needle (dark) -->
          <path d="M32 54 L28 32 L32 36 L36 32 Z" class="compass-needle-s"/>
          <!-- Center pivot -->
          <circle cx="32" cy="32" r="5" class="compass-pivot"/>
          <circle cx="32" cy="32" r="3" class="compass-pivot-inner"/>
        </svg>
        <!-- Cardinal direction labels -->
        <span class="compass-label compass-n">N</span>
        <span class="compass-label compass-e">O</span>
        <span class="compass-label compass-s">S</span>
        <span class="compass-label compass-w">W</span>
      </div>
      <!-- Debug: show heading value -->
      <div class="compass-heading-debug">{{ heading() }}°</div>
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
      width: 52px;
      height: 52px;
      transition: transform 0.15s ease-out;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
    }

    .compass-svg {
      width: 100%;
      height: 100%;
    }

    .compass-bg {
      fill: rgba(20, 24, 21, 0.7);
    }

    .compass-ring {
      fill: none;
      stroke: rgba(212, 175, 55, 0.6);
      stroke-width: 1.5;
    }

    .compass-inner-ring {
      fill: none;
      stroke: rgba(212, 175, 55, 0.15);
      stroke-width: 0.75;
    }

    .compass-tick {
      stroke: var(--td-text-secondary);
      stroke-width: 1;
      stroke-linecap: round;
    }

    .compass-tick.major {
      stroke: rgba(212, 175, 55, 0.7);
      stroke-width: 1.5;
    }

    .compass-tick.minor {
      stroke: rgba(212, 175, 55, 0.3);
      stroke-width: 0.75;
    }

    .compass-needle-n {
      fill: rgba(220, 80, 60, 0.85);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
    }

    .compass-needle-s {
      fill: rgba(160, 160, 160, 0.45);
    }

    .compass-pivot {
      fill: rgba(212, 175, 55, 0.7);
    }

    .compass-pivot-inner {
      fill: rgba(20, 24, 21, 0.8);
    }

    /* Cardinal direction labels */
    .compass-label {
      position: absolute;
      font-size: 8px;
      font-weight: 600;
      color: rgba(180, 180, 180, 0.6);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      pointer-events: none;
    }

    .compass-label.compass-n {
      top: 9px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(220, 80, 60, 0.8);
      font-size: 9px;
    }

    .compass-label.compass-e {
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
    }

    .compass-label.compass-s {
      bottom: 9px;
      left: 50%;
      transform: translateX(-50%);
    }

    .compass-label.compass-w {
      top: 50%;
      left: 8px;
      transform: translateY(-50%);
    }

    .compass-heading-debug {
      display: none;
    }
  `,
})
export class CompassComponent {
  readonly rotation = input.required<number>();
  readonly heading = input.required<number>();
}
