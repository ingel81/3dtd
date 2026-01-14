import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug-window.service';
import { GameUIStateService } from '../../services/game-ui-state.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="td-quick-actions">
      <!-- Layer Toggles (collapsible) -->
      <div class="td-layer-toggles" [class.expanded]="uiState.layerMenuExpanded()">
        <button class="td-layer-btn"
                [class.active]="uiState.streetsVisible()"
                (click)="uiState.toggleStreets(); streetsToggled.emit()"
                matTooltip="Strassen anzeigen"
                matTooltipPosition="left">
          <mat-icon>route</mat-icon>
        </button>
        <button class="td-layer-btn"
                [class.active]="uiState.routesVisible()"
                (click)="uiState.toggleRoutes(); routesToggled.emit()"
                matTooltip="Routen anzeigen"
                matTooltipPosition="left">
          <mat-icon>timeline</mat-icon>
        </button>
      </div>
      <button class="td-quick-btn td-layer-toggle-btn"
              [class.active]="uiState.layerMenuExpanded()"
              (click)="uiState.toggleLayerMenu()"
              matTooltip="Ebenen"
              matTooltipPosition="left">
        <mat-icon>{{ uiState.layerMenuExpanded() ? 'layers_clear' : 'layers' }}</mat-icon>
      </button>
      <button class="td-quick-btn" (click)="resetCamera.emit()" matTooltip="Kamera zuruecksetzen" matTooltipPosition="left">
        <mat-icon>my_location</mat-icon>
      </button>
      <button class="td-quick-btn"
              [class.active]="uiState.infoOverlayVisible()"
              (click)="uiState.toggleInfoOverlay()"
              matTooltip="Info-Overlay"
              matTooltipPosition="left">
        <mat-icon>info</mat-icon>
      </button>
      <!-- Dev Menu (expands right and up) -->
      <div class="td-dev-menu-wrapper">
        <div class="td-dev-menu" [class.expanded]="uiState.devMenuExpanded()">
          <button class="td-dev-btn"
                  [class.active]="uiState.towerDebugVisible()"
                  (click)="uiState.toggleTowerDebug(); towerDebugToggled.emit()"
                  matTooltip="Tower-Schusshoehe anzeigen"
                  matTooltipPosition="left">
            <mat-icon>gps_fixed</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="uiState.heightDebugVisible()"
                  (click)="heightDebugToggled.emit()"
                  matTooltip="Terrain-Hoehen debuggen"
                  matTooltipPosition="left">
            <mat-icon>terrain</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.waveWindow().isOpen"
                  (click)="debugWindows.toggle('wave')"
                  matTooltip="Wave-Debug-Panel"
                  matTooltipPosition="left">
            <mat-icon>pest_control</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="debugWindows.cameraWindow().isOpen"
                  (click)="debugWindows.toggle('camera')"
                  matTooltip="Kamera-Debug-Overlay"
                  matTooltipPosition="left">
            <mat-icon>videocam</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="cameraFramingDebug()"
                  (click)="cameraFramingDebugToggled.emit()"
                  matTooltip="Kamera-Framing Debug"
                  matTooltipPosition="left">
            <mat-icon>crop_free</mat-icon>
          </button>
          <button class="td-dev-btn"
                  (click)="resetToDefaultLocation.emit()"
                  matTooltip="Default-Ort laden"
                  matTooltipPosition="left">
            <mat-icon>home</mat-icon>
          </button>
          <button class="td-dev-btn"
                  [class.active]="uiState.specialPointsDebugVisible()"
                  (click)="specialPointsDebugToggled.emit()"
                  matTooltip="Spezial-Punkte debuggen (Feuer, etc.)"
                  matTooltipPosition="left">
            <mat-icon>location_on</mat-icon>
          </button>
          <button class="td-dev-btn route-anim-btn"
                  (click)="playRouteAnimation.emit()"
                  matTooltip="Route Animation abspielen"
                  matTooltipPosition="left">
            <mat-icon>moving</mat-icon>
          </button>
        </div>
        <button class="td-quick-btn td-dev-toggle-btn"
                [class.active]="uiState.devMenuExpanded()"
                (click)="uiState.toggleDevMenu()"
                matTooltip="Entwickler-Optionen"
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

    .td-layer-toggles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.2s ease, opacity 0.15s ease;
    }

    .td-layer-toggles.expanded {
      max-height: 80px;
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
      flex-direction: row-reverse;
      align-items: flex-end;
    }

    .td-dev-menu {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 0;
      overflow: hidden;
      opacity: 0;
      transition: all 0.2s ease;
    }

    .td-dev-menu.expanded {
      max-width: 40px;
      margin-left: 4px;
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
  `,
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiState = inject(GameUIStateService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Outputs for actions that need parent handling
  readonly resetCamera = output<void>();
  readonly streetsToggled = output<void>();
  readonly routesToggled = output<void>();
  readonly towerDebugToggled = output<void>();
  readonly heightDebugToggled = output<void>();
  readonly cameraFramingDebugToggled = output<void>();
  readonly resetToDefaultLocation = output<void>();
  readonly specialPointsDebugToggled = output<void>();
  readonly playRouteAnimation = output<void>();
}
