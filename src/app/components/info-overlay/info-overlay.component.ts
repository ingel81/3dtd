import { Component, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameUIStateService } from '../../services/game-ui-state.service';

/**
 * InfoOverlayComponent
 *
 * Transparentes Text-Overlay oben links auf dem Spielfeld.
 * Zeigt FPS, Tiles, aktive Gegner, aktive Sounds, Straßen-Count.
 *
 * Features:
 * - Kein Background - komplett transparent
 * - Multi-Layer Text-Shadow für Lesbarkeit auf allen Untergründen
 * - Zuschaltbar über Quick Actions Button
 */
@Component({
  selector: 'app-info-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (uiState.infoOverlayVisible()) {
      <div class="info-overlay">
        <div class="info-line">FPS: {{ fps() }}</div>
        <div class="info-line">Tiles: {{ tileStats().visible }}/{{ tileStats().total }}</div>
        <div class="info-line">Gegner: {{ enemiesAlive() }}</div>
        <div class="info-line">Sounds: {{ activeSounds() }}</div>
        <div class="info-line">Strassen: {{ streetCount() }}</div>
      </div>
    }
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
  `,
})
export class InfoOverlayComponent {
  readonly uiState = inject(GameUIStateService);

  // Inputs from parent component
  readonly fps = input.required<number>();
  readonly tileStats = input.required<{ visible: number; total: number }>();
  readonly enemiesAlive = input.required<number>();
  readonly activeSounds = input.required<number>();
  readonly streetCount = input.required<number>();
}
