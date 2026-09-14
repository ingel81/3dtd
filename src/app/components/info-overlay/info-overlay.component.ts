import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { UIStore } from '../../store/ui.store';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { observeBottomEdge } from './bottom-edge';

/**
 * Info overlay (top-left).
 *
 * Flat glass panel with runtime stats. FPS row is always visible; the rest
 * (Tiles, Sounds, Streets) collapses behind a subtle caret toggle.
 *
 * Style follows tmp/td-artboards.jsx HudDebugStats — ambient info, not a
 * "debug" label. `uiStore.infoOverlayVisible()` is reused as the
 * expanded/collapsed state.
 *
 * Measures its bottom edge into `uiStore.infoOverlayBottom`, collapsed and
 * expanded: the ability bar at the left edge keeps below it.
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

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const stop = observeBottomEdge(this.box().nativeElement, (px) => this.uiStore.infoOverlayBottom.set(px));
      destroyRef.onDestroy(() => {
        stop();
        this.uiStore.infoOverlayBottom.set(0);
      });
    });
  }
}
