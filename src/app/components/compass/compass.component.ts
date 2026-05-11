import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isCardinal: boolean;
}

/**
 * Compass — refined per design bundle (tmp/td-components.jsx, NewCompass).
 *
 * Round face with radial-gradient body, 32 punched tick marks (every 11.25°),
 * cardinal letters (N gold, S/E/W muted), and a centered needle.
 *
 * Real-compass convention: the rose stays fixed (N always at top), only
 * the needle rotates with the bearing.
 */
@Component({
  selector: 'app-compass',
  standalone: true,
  imports: [CommonModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-compass-wrap">
      <div class="td-compass">
        <svg viewBox="0 0 100 100" class="td-compass__svg" aria-hidden="true">
          <!-- Tick rosette: 32 ticks; every 8th (cardinals) is gold + thicker -->
          <g stroke-linecap="round">
            @for (t of ticks; track $index) {
              <line [attr.x1]="t.x1" [attr.y1]="t.y1"
                    [attr.x2]="t.x2" [attr.y2]="t.y2"
                    [attr.stroke]="t.isCardinal ? 'var(--td-gold)' : 'var(--td-frame-light)'"
                    [attr.stroke-width]="t.isCardinal ? 1.5 : 0.6"/>
            }
          </g>

          <!-- Cardinal letters: N gold, S/E/W muted -->
          <g font-family="var(--td-font-mono)" font-size="9" font-weight="700"
             text-anchor="middle" dominant-baseline="central">
            <text x="50" y="18" fill="var(--td-gold-light)">N</text>
            <text x="82" y="52" fill="var(--td-text-muted)">E</text>
            <text x="50" y="86" fill="var(--td-text-muted)">S</text>
            <text x="18" y="52" fill="var(--td-text-muted)">W</text>
          </g>

          <!-- Needle rotates around the center (50,50); rose stays fixed.
               Polygons are anchored at (50,50); rotate uses explicit pivot. -->
          <g class="td-compass__needle"
             [attr.transform]="'rotate(' + rotation() + ' 50 50)'">
            <polygon points="50,28 54,50 50,53 46,50" fill="var(--td-health-red)"/>
            <polygon points="50,72 54,50 50,47 46,50" fill="var(--td-text-secondary)"/>
            <circle cx="50" cy="50" r="3" fill="var(--td-gold)"
                    stroke="var(--td-gold-dark)" stroke-width="0.8"/>
          </g>
        </svg>
      </div>

      @if (rotation() !== 0) {
        <button class="td-compass__reset" (click)="onReset()" title="Reset bearing">
          <td-icon name="refresh" [size]="12"></td-icon>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 5;
    }

    .td-compass-wrap {
      position: relative;
      width: 88px;
      height: 88px;
    }

    .td-compass {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: radial-gradient(circle,
        var(--td-panel-main) 0%,
        var(--td-panel-shadow) 100%);
      border: 1px solid var(--td-frame-mid);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.4),
        inset 0 -2px 4px rgba(0, 0, 0, 0.5),
        var(--td-shadow-key),
        0 4px 8px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .td-compass__svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .td-compass__needle {
      transition: transform 0.25s cubic-bezier(.4, 0, .2, 1);
    }

    .td-compass__reset {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--td-frame-dark);
      background: var(--td-panel-main);
      color: var(--td-gold-light);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.25),
        0 1px 0 rgba(0, 0, 0, 0.6);
      transition: color 0.15s, box-shadow 0.15s;
    }

    .td-compass__reset:hover {
      color: #FFF;
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.25),
        0 0 10px rgba(194, 160, 85, 0.4);
    }
  `,
})
export class CompassComponent {
  /** Map bearing in degrees. Whole face rotates so N points actual north. */
  readonly rotation = input.required<number>();

  /** Emitted when the user clicks the reset bearing button. */
  readonly resetBearing = output<void>();

  /** 32 tick marks pre-computed; every 8th is a cardinal (gold + thicker). */
  protected readonly ticks: readonly Tick[] = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2; // start at top
    const isCardinal = i % 8 === 0;
    const r1 = isCardinal ? 38 : 42;
    const r2 = 46;
    return {
      x1: 50 + Math.cos(a) * r1,
      y1: 50 + Math.sin(a) * r1,
      x2: 50 + Math.cos(a) * r2,
      y2: 50 + Math.sin(a) * r2,
      isCardinal,
    };
  });

  onReset(): void {
    this.resetBearing.emit();
  }
}
