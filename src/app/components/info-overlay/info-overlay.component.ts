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
  template: `
    <aside class="td-info" [class.td-info--expanded]="uiStore.infoOverlayVisible()"
           (click)="uiStore.toggleInfoOverlay()"
           role="button" [attr.aria-expanded]="uiStore.infoOverlayVisible()">
      <div class="td-info__row td-info__row--head">
        <span class="k">FPS</span>
        <span class="v">{{ fps() | number:'1.0-0' }}</span>
        <td-icon class="caret"
                 [name]="uiStore.infoOverlayVisible() ? 'caretU' : 'caret'"
                 [size]="10"></td-icon>
      </div>
      @if (uiStore.infoOverlayVisible()) {
        <div class="td-info__row"><span class="k">Tiles</span><span class="v">{{ tileStats().visible }}/{{ tileStats().total }}</span></div>
        <div class="td-info__row"><span class="k">Sounds</span><span class="v">{{ activeSounds() }}</span></div>
        <div class="td-info__row"><span class="k">Streets</span><span class="v">{{ streetCount() }}</span></div>
      }
    </aside>
  `,
  styles: `
    :host { ${TD_CSS_VARS} }

    .td-info {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 50;
      padding: 8px 12px;
      font-family: var(--td-font-mono);
      font-size: 11px;
      color: var(--td-text-secondary);
      background: var(--td-glass-tint);
      backdrop-filter: blur(6px) saturate(1.1);
      -webkit-backdrop-filter: blur(6px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.33),
        var(--td-shadow-key);
      user-select: none;
      cursor: pointer;
      transition: box-shadow 0.15s ease;
    }
    .td-info:hover {
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.45),
        var(--td-shadow-key);
    }

    .td-info__row {
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.5;
    }

    .td-info__row .k {
      color: var(--td-text-muted);
      width: 56px;
    }

    .td-info__row .v {
      color: var(--td-teal);
      font-variant-numeric: tabular-nums;
      flex: 1;
    }

    /* Caret only on the head row, subtle */
    .td-info__row--head .caret {
      color: var(--td-text-muted);
      opacity: 0.6;
      transition: opacity 0.15s ease;
    }
    .td-info:hover .td-info__row--head .caret {
      opacity: 1;
    }
  `,
})
export class InfoOverlayComponent {
  readonly uiStore = inject(UIStore);

  readonly fps = input.required<number>();
  readonly tileStats = input.required<{ visible: number; total: number }>();
  readonly activeSounds = input.required<number>();
  readonly streetCount = input.required<number>();
}
