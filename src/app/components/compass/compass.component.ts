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
  templateUrl: './compass.component.html',
  styleUrl: './compass.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
