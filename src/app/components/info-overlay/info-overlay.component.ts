import { Component, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UIStore } from '../../store/ui.store';

/**
 * InfoOverlayComponent
 *
 * Transparent text overlay in the top left of the game field.
 * Shows FPS (always visible) with a caret toggle for additional stats.
 * Clicking the FPS line expands/collapses Tiles, enemies, sounds, street count.
 *
 * Features:
 * - FPS display is always visible with clickable caret
 * - Rest (Tiles, enemies, sounds, streets) toggleable via caret
 * - No background - completely transparent
 * - Multi-layer text shadow for readability on all backgrounds
 */
@Component({
  selector: 'app-info-overlay',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="info-overlay">
      <!-- FPS always visible, caret toggles details -->
      <div class="info-line fps-line" (click)="uiStore.toggleInfoOverlay()">
        <span>FPS: {{ fps() }}</span>
        <span class="caret" [class.expanded]="uiStore.infoOverlayVisible()">&#9656;</span>
      </div>
      <!-- Rest only visible when info overlay is toggled -->
      @if (uiStore.infoOverlayVisible()) {
        <div class="info-line">Tiles: {{ tileStats().visible }}/{{ tileStats().total }}</div>
        <div class="info-line">Enemies: {{ enemiesAlive() }}</div>
        <div class="info-line">Sounds: {{ activeSounds() }}</div>
        <div class="info-line">Streets: {{ streetCount() }}</div>
      }
    </div>
  `,
  styles: `
    .info-overlay {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 15;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.6;
      pointer-events: none;
      user-select: none;
    }

    .info-line {
      color: #ffffff;
      text-shadow:
        /* Black outline - 8 directions for clean edges */
        -1px -1px 0 #000000,
         1px -1px 0 #000000,
        -1px  1px 0 #000000,
         1px  1px 0 #000000,
        -1px  0   0 #000000,
         1px  0   0 #000000,
         0   -1px 0 #000000,
         0    1px 0 #000000,
        /* Subtle glow for extra contrast */
         0    0   4px rgba(0, 0, 0, 0.8);
    }

    .fps-line {
      pointer-events: auto;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .caret {
      display: inline-block;
      font-size: 10px;
      transition: transform 0.15s ease;
    }

    .caret.expanded {
      transform: rotate(90deg);
    }
  `,
})
export class InfoOverlayComponent {
  readonly uiStore = inject(UIStore);

  // Inputs from parent component
  readonly fps = input.required<number>();
  readonly tileStats = input.required<{ visible: number; total: number }>();
  readonly enemiesAlive = input.required<number>();
  readonly activeSounds = input.required<number>();
  readonly streetCount = input.required<number>();
}
