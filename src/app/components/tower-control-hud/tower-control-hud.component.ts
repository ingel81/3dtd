import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TowerControlService } from '../../services/tower-control.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

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
    <div class="tc-crosshair" [class.tc-on-target]="control.onTarget()" aria-hidden="true">
      <span class="tc-ticks" [class.tc-kick-a]="kickA()" [class.tc-kick-b]="kickB()">
        <span class="tc-tick tc-up"></span>
        <span class="tc-tick tc-down"></span>
        <span class="tc-tick tc-left"></span>
        <span class="tc-tick tc-right"></span>
        <span class="tc-dot"></span>
      </span>
      @if (control.marker(); as marker) {
        <span class="tc-marker" [class.tc-kill]="marker === 'kill'"></span>
      }
      <span class="tc-reload" [class.tc-ready]="control.reload() >= 1"
            [style.--tc-reload]="control.reload()"></span>
    </div>

    <div class="tc-bar">
      <span class="tc-name">{{ control.towerName() }}</span>
      @if (control.aiming()) {
        <span class="tc-key"><kbd>LMB</kbd> fire</span>
        <span class="tc-key"><kbd>RMB</kbd> zoom</span>
        <span class="tc-key"><kbd>Esc</kbd> get out</span>
      } @else {
        <span class="tc-key">Click the map to aim</span>
        <span class="tc-key"><kbd>C</kbd> get out</span>
      }
    </div>
  `,
  styles: [`
    :host {
      ${TD_CSS_VARS}
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 20;
    }

    .tc-crosshair {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 0;
      height: 0;
      --tc-gap: 7px;
      --tc-color: rgba(255, 255, 255, 0.9);
    }

    .tc-on-target {
      --tc-color: var(--td-gold-light);
    }

    /* The ticks open up per shot and close again */
    .tc-ticks { position: absolute; left: 0; top: 0; }
    .tc-kick-a { animation: tc-kick-a 120ms ease-out; }
    .tc-kick-b { animation: tc-kick-b 120ms ease-out; }
    @keyframes tc-kick-a { from { transform: scale(1.6); } to { transform: scale(1); } }
    @keyframes tc-kick-b { from { transform: scale(1.6); } to { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .tc-kick-a, .tc-kick-b { animation: none; }
    }

    .tc-tick {
      position: absolute;
      background: var(--tc-color);
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
    }

    .tc-up, .tc-down { width: 2px; height: 9px; left: -1px; }
    .tc-left, .tc-right { width: 9px; height: 2px; top: -1px; }
    .tc-up { bottom: var(--tc-gap); }
    .tc-down { top: var(--tc-gap); }
    .tc-left { right: var(--tc-gap); }
    .tc-right { left: var(--tc-gap); }

    .tc-dot {
      position: absolute;
      width: 2px;
      height: 2px;
      left: -1px;
      top: -1px;
      background: var(--tc-color);
    }

    /* The hit marker: a cross turned by 45°, white on a hit, red and bigger on a kill */
    .tc-marker {
      position: absolute;
      width: 22px;
      height: 22px;
      left: -11px;
      top: -11px;
      transform: rotate(45deg);
      background:
        linear-gradient(var(--tc-marker), var(--tc-marker)) center / 2px 100% no-repeat,
        linear-gradient(var(--tc-marker), var(--tc-marker)) center / 100% 2px no-repeat;
      -webkit-mask: radial-gradient(circle, transparent 5px, #000 5.5px);
      mask: radial-gradient(circle, transparent 5px, #000 5.5px);
      --tc-marker: #fff;
      filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9));
    }

    .tc-marker.tc-kill {
      width: 30px;
      height: 30px;
      left: -15px;
      top: -15px;
      --tc-marker: var(--td-health-red);
    }

    .tc-reload {
      position: absolute;
      width: 14px;
      height: 14px;
      left: -7px;
      top: 22px;
      border-radius: 50%;
      background: conic-gradient(var(--tc-color) calc(var(--tc-reload) * 360deg), rgba(255, 255, 255, 0.15) 0);
      -webkit-mask: radial-gradient(circle, transparent 4.5px, #000 5px);
      mask: radial-gradient(circle, transparent 4.5px, #000 5px);
      opacity: 0.85;
    }

    .tc-reload.tc-ready {
      opacity: 0;
      transition: opacity 150ms ease;
    }

    .tc-bar {
      position: absolute;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 6px 14px;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-mid);
      border-radius: 4px;
      box-shadow: var(--td-shadow-soft);
      color: var(--td-text-secondary);
      font-family: var(--td-font-body);
      font-size: 11px;
      white-space: nowrap;
    }

    .tc-name {
      color: var(--td-gold-light);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    kbd {
      padding: 1px 5px;
      margin-right: 3px;
      border: 1px solid var(--td-frame-dark);
      border-radius: 2px;
      font-family: var(--td-font-body);
      font-size: 9px;
      color: var(--td-text-primary);
    }
  `],
})
export class TowerControlHudComponent {
  readonly control = inject(TowerControlService);

  /** Two classes that take turns per shot, so the kick animation starts again every time */
  readonly kickA = computed(() => this.control.shots() > 0 && this.control.shots() % 2 === 1);
  readonly kickB = computed(() => this.control.shots() > 0 && this.control.shots() % 2 === 0);
}
