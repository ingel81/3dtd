import { Component, inject, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug-window.service';
import { GameUIStateService } from '../../services/game-ui-state.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-quick-actions">
      <!-- Route Animation Button -->
      <button class="td-quick-btn route-anim-btn"
              (click)="playRouteAnimation.emit()"
              matTooltip="Play route animation"
              matTooltipPosition="left">
        <mat-icon>moving</mat-icon>
      </button>
      <!-- Layer Menu (collapsible, expands upward) -->
      <div class="td-layer-menu-wrapper">
        <div class="td-layer-toggles" [class.expanded]="uiState.layerMenuExpanded()">
          <button class="td-layer-btn"
                  [class.active]="uiState.spatialGridDebugVisible()"
                  (click)="spatialGridDebugToggled.emit()"
                  matTooltip="Route Grid Overlay"
                  matTooltipPosition="left">
            <mat-icon>grid_on</mat-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiState.streetsVisible()"
                  (click)="uiState.toggleStreets(); streetsToggled.emit()"
                  matTooltip="Show streets"
                  matTooltipPosition="left">
            <mat-icon>route</mat-icon>
          </button>
          <button class="td-layer-btn"
                  [class.active]="uiState.routesVisible()"
                  (click)="uiState.toggleRoutes(); routesToggled.emit()"
                  matTooltip="Show routes"
                  matTooltipPosition="left">
            <mat-icon>timeline</mat-icon>
          </button>
        </div>
        <button class="td-quick-btn td-layer-toggle-btn"
                [class.active]="uiState.layerMenuExpanded()"
                (click)="uiState.toggleLayerMenu()"
                matTooltip="Layers"
                matTooltipPosition="left">
          <mat-icon>{{ uiState.layerMenuExpanded() ? 'layers_clear' : 'layers' }}</mat-icon>
        </button>
      </div>
      <button class="td-quick-btn" (click)="resetCamera.emit()" matTooltip="Reset camera" matTooltipPosition="left">
        <mat-icon>my_location</mat-icon>
      </button>
      <button class="td-quick-btn"
              [class.active]="uiState.infoOverlayVisible()"
              (click)="uiState.toggleInfoOverlay()"
              matTooltip="Info-Overlay"
              matTooltipPosition="left">
        <mat-icon>info</mat-icon>
      </button>
      <!-- Dev Menu (expands upward) -->
      <div class="td-dev-menu-wrapper">
        <div class="td-dev-menu" [class.expanded]="uiState.devMenuExpanded()">
          <!-- Cheats -->
          <button class="td-dev-btn td-dev-btn-danger"
                  (click)="killAllEnemies.emit()"
                  matTooltip="Kill all enemies"
                  matTooltipPosition="left">
            <mat-icon>skull</mat-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-credits"
                  (click)="addCredits.emit()"
                  matTooltip="+1000 Credits"
                  matTooltipPosition="left">
            <mat-icon>payments</mat-icon>
          </button>
          <button class="td-dev-btn td-dev-btn-health"
                  (click)="addHealth.emit()"
                  matTooltip="+1000 HP"
                  matTooltipPosition="left">
            <mat-icon>heart_plus</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Terrain & Map -->
          <button class="td-dev-btn"
                  [class.active]="uiState.heightDebugVisible()"
                  (click)="heightDebugToggled.emit()"
                  matTooltip="Height markers"
                  matTooltipPosition="left">
            <mat-icon>terrain</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="uiState.specialPointsDebugVisible()"
                  (click)="specialPointsDebugToggled.emit()"
                  matTooltip="Special points"
                  matTooltipPosition="left">
            <mat-icon>place</mat-icon>
          </button>
          <button class="td-dev-btn"
                  (click)="refreshHeights.emit()"
                  matTooltip="Re-raycast heights"
                  matTooltipPosition="left">
            <mat-icon>sync</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Camera -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.cameraWindow().isOpen"
                  (click)="debugWindows.toggle('camera')"
                  matTooltip="Camera info"
                  matTooltipPosition="left">
            <mat-icon>videocam</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="cameraFramingDebug()"
                  (click)="cameraFramingDebugToggled.emit()"
                  matTooltip="Framing guides"
                  matTooltipPosition="left">
            <mat-icon>crop_free</mat-icon>
          </button>
          <div class="td-dev-separator"></div>
          <!-- Debug Panels -->
          <button class="td-dev-btn"
                  [class.active]="debugWindows.waveWindow().isOpen"
                  (click)="debugWindows.toggle('wave')"
                  matTooltip="Wave spawner"
                  matTooltipPosition="left">
            <mat-icon>waves</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.towerWindow().isOpen"
                  (click)="debugWindows.toggle('tower')"
                  matTooltip="Tower inspector"
                  matTooltipPosition="left">
            <mat-icon>tower</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.enemyWindow().isOpen"
                  (click)="debugWindows.toggle('enemy')"
                  matTooltip="Enemy inspector"
                  matTooltipPosition="left">
            <mat-icon>pest_control</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.soundWindow().isOpen"
                  (click)="debugWindows.toggle('sound')"
                  matTooltip="Spatial audio"
                  matTooltipPosition="left">
            <mat-icon>spatial_audio</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.eventsWindow().isOpen"
                  (click)="debugWindows.toggle('events')"
                  matTooltip="Event bus"
                  matTooltipPosition="left">
            <mat-icon>hub</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.trainingWindow().isOpen"
                  (click)="debugWindows.toggle('training')"
                  matTooltip="AI Training"
                  matTooltipPosition="left">
            <mat-icon>smart_toy</mat-icon>
          </button>
          @if (devWorld.isActive) {
            <button class="td-dev-btn"
                    [class.active]="debugWindows.devworldWindow().isOpen"
                    (click)="debugWindows.toggle('devworld')"
                    matTooltip="DevWorld"
                    matTooltipPosition="left">
              <mat-icon>public</mat-icon>
            </button>
          }
        </div>
        <button class="td-quick-btn td-dev-toggle-btn"
                [class.active]="uiState.devMenuExpanded()"
                (click)="uiState.toggleDevMenu()"
                matTooltip="Developer options"
                matTooltipPosition="left">
          <mat-icon>{{ uiState.devMenuExpanded() ? 'code_off' : 'code' }}</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    .td-quick-actions {
      position: absolute;
      bottom: 36px;
      right: 8px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
      z-index: 5;
    }

    .td-quick-actions > * {
      flex-shrink: 0;
    }

    .td-layer-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-layer-toggles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-layer-toggles.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    .td-layer-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-layer-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-layer-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-layer-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-quick-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-quick-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-quick-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-quick-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .td-layer-toggle-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .td-dev-menu-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .td-dev-menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease-out, opacity 0.15s ease;
    }

    .td-dev-menu.expanded {
      max-height: 100vh;
      opacity: 1;
    }

    .td-dev-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      box-sizing: border-box;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-dev-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-dev-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .td-dev-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .td-dev-toggle-btn.active {
      background: var(--td-gold-dark);
      color: var(--td-text-primary);
    }

    .route-anim-btn {
      border-color: var(--td-warn-orange);
      color: var(--td-warn-orange);
    }

    .route-anim-btn:hover {
      background: var(--td-warn-orange);
      color: var(--td-bg-dark);
    }

    .td-dev-separator {
      height: 1px;
      background: var(--td-frame-mid);
      margin: 4px 0;
    }

    .td-dev-btn-danger {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .td-dev-btn-danger:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .td-dev-btn-credits {
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .td-dev-btn-credits:hover {
      background: var(--td-gold);
      color: var(--td-bg-dark);
    }

    .td-dev-btn-health {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .td-dev-btn-health:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }
  `,
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiState = inject(GameUIStateService);
  readonly devWorld = inject(DevWorldService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Outputs for actions that need parent handling
  readonly resetCamera = output<void>();
  readonly streetsToggled = output<void>();
  readonly routesToggled = output<void>();
  readonly heightDebugToggled = output<void>();
  readonly cameraFramingDebugToggled = output<void>();
  readonly specialPointsDebugToggled = output<void>();
  readonly spatialGridDebugToggled = output<void>();
  readonly playRouteAnimation = output<void>();
  readonly refreshHeights = output<void>();
  readonly killAllEnemies = output<void>();
  readonly addCredits = output<void>();
  readonly addHealth = output<void>();
}
