import { Component, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { UIStore } from '../../store/ui.store';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

/**
 * Info overlay (top-left).
 *
 * Flat glass panel with runtime stats. FPS row is always visible; the rest
 * (Tiles, Sounds, Streets) collapses behind a subtle caret toggle.
 *
 * Style follows tmp/td-artboards.jsx HudDebugStats — ambient info, not a
 * "debug" label. `uiStore.infoOverlayVisible()` is reused as the
 * expanded/collapsed state.
 */
@Component({
  selector: 'app-info-overlay',
  standalone: true,
  imports: [CommonModule, DecimalPipe, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './info-overlay.component.html',
  styleUrl: './info-overlay.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class InfoOverlayComponent {
  readonly uiStore = inject(UIStore);

  readonly fps = input.required<number>();
  readonly tileStats = input.required<{ visible: number; total: number; cacheMB: number }>();
  readonly activeSounds = input.required<number>();
  readonly streetCount = input.required<number>();
}
