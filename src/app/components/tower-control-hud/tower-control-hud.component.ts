import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TowerControlService } from '../../services/tower-control.service';

/**
 * What the player sees in a manned tower (TowerControlService,
 * docs/TOWER_CONTROL.md): the crosshair in the middle of the map, gold while
 * it is on an enemy the tower may shoot, a short kick per shot, a white
 * cross on a hit and a red one on a kill, the reload ring under it, and a
 * line with the tower's name and the keys at the bottom.
 *
 * Rendered by the game component while the player sits in a tower. Takes no
 * pointer: the captured mouse aims.
 */
@Component({
  selector: 'app-tower-control-hud',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The crosshair as one drawing: ticks that kick per shot, the hit marker,
         the reload ring under it. Every stroke lies on a dark one, so it reads
         on bright tiles as on dark ones. -->
    <svg class="tc-crosshair" [class.tc-on-target]="control.onTarget()" viewBox="-40 -40 80 80" aria-hidden="true">
      <g class="tc-ticks" [class.tc-kick-a]="kickA()" [class.tc-kick-b]="kickB()">
        <path class="tc-shade" d="M0 -7V-16M0 7V16M-7 0H-16M7 0H16M0 0h.01" />
        <path class="tc-line" d="M0 -7V-16M0 7V16M-7 0H-16M7 0H16M0 0h.01" />
      </g>
      @if (control.marker(); as marker) {
        <g class="tc-marker" [class.tc-kill]="marker === 'kill'">
          <path class="tc-shade" d="M4 4L11 11M-4 4L-11 11M4 -4L11 -11M-4 -4L-11 -11" />
          <path class="tc-line" d="M4 4L11 11M-4 4L-11 11M4 -4L11 -11M-4 -4L-11 -11" />
        </g>
      }
      <circle class="tc-reload" [class.tc-ready]="control.reload() >= 1" [style.--tc-reload]="control.reload()"
              cx="0" cy="29" r="6" />
    </svg>

    <div class="tc-bar td-overlay td-inline">
      <span class="td-section tc-name">{{ control.towerName() }}</span>
      @if (control.aiming()) {
        <span class="td-note"><kbd class="td-kbd">LMB</kbd> fire</span>
        <span class="td-note"><kbd class="td-kbd">RMB</kbd> zoom</span>
        <span class="td-note"><kbd class="td-kbd">C</kbd> / <kbd class="td-kbd">Esc</kbd> get out</span>
      } @else {
        <span class="td-note">Click the map to aim</span>
        <span class="td-note"><kbd class="td-kbd">C</kbd> / <kbd class="td-kbd">Esc</kbd> get out</span>
      }
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 20;
    }

    .tc-crosshair {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 80px;
      height: 80px;
      margin: -40px 0 0 -40px;
      overflow: visible;
      fill: none;
      stroke-linecap: square;
      --tc-color: var(--td-reticle);
    }

    .tc-on-target {
      --tc-color: var(--td-brass-light);
    }

    .tc-line {
      stroke: var(--tc-color);
      stroke-width: 2;
    }

    .tc-shade {
      stroke: var(--td-ink);
      stroke-width: 4;
      stroke-opacity: 0.7;
    }

    /* The ticks open up per shot and close again */
    .tc-kick-a { animation: tc-kick-a 120ms ease-out; }
    .tc-kick-b { animation: tc-kick-b 120ms ease-out; }
    @keyframes tc-kick-a { from { transform: scale(1.6); } to { transform: scale(1); } }
    @keyframes tc-kick-b { from { transform: scale(1.6); } to { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .tc-kick-a, .tc-kick-b { animation: none; }
    }

    /* The hit marker: a cross turned by 45°, light on a hit, red and bigger on a kill */
    .tc-marker .tc-line {
      stroke: var(--td-reticle);
    }

    .tc-marker.tc-kill {
      transform: scale(1.35);
    }

    .tc-marker.tc-kill .tc-line {
      stroke: var(--td-health-red);
    }

    /* The reload ring fills clockwise from the top, gone once ready */
    .tc-reload {
      stroke: var(--tc-color);
      stroke-width: 2;
      stroke-dasharray: calc(var(--tc-reload) * 37.7px) 38px;
      transform: rotate(-90deg);
      transform-box: fill-box;
      transform-origin: center;
      opacity: 0.85;
    }

    .tc-reload.tc-ready {
      opacity: 0;
      transition: opacity var(--td-dur-fast) var(--td-ease-out);
    }

    .tc-bar {
      position: absolute;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      gap: 14px;
      padding: 6px 14px;
      white-space: nowrap;
    }

    .tc-name {
      color: var(--td-brass-light);
    }
  `],
})
export class TowerControlHudComponent {
  readonly control = inject(TowerControlService);

  /** Two classes that take turns per shot, so the kick animation starts again every time */
  readonly kickA = computed(() => this.control.shots() > 0 && this.control.shots() % 2 === 1);
  readonly kickB = computed(() => this.control.shots() > 0 && this.control.shots() % 2 === 0);
}
