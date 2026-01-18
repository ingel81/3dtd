import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { CameraControlService, CameraDebugInfo } from '../../services/camera-control.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-camera-debugger',
  standalone: true,
  imports: [CommonModule, DecimalPipe, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.cameraWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="camera"
        title="Kamera"
        icon="videocam"
        [position]="windowService.cameraWindow().position"
        [zIndex]="windowService.cameraWindow().zIndex"
        (closed)="windowService.close('camera')"
        (positionChange)="windowService.updatePosition('camera', $event)"
        (focused)="windowService.bringToFront('camera')"
      >
        @if (cameraInfo(); as cam) {
          <div class="camera-debug-content">
            <div class="section">
              <span class="section-label">Position</span>
              <div class="row">
                <span class="key">X:</span>
                <span class="value">{{ cam.posX | number:'1.0-0' }}m</span>
              </div>
              <div class="row">
                <span class="key">Y:</span>
                <span class="value">{{ cam.posY | number:'1.0-0' }}m</span>
              </div>
              <div class="row">
                <span class="key">Z:</span>
                <span class="value">{{ cam.posZ | number:'1.0-0' }}m</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Winkel</span>
              <div class="row">
                <span class="key">Heading:</span>
                <span class="value">{{ cam.heading | number:'1.0-0' }}°</span>
              </div>
              <div class="row">
                <span class="key">Pitch:</span>
                <span class="value">{{ cam.pitch | number:'1.1-1' }}°</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Abstand</span>
              <div class="row">
                <span class="key">Hoehe:</span>
                <span class="value">{{ cam.altitude | number:'1.0-0' }}m</span>
              </div>
              <div class="row">
                <span class="key">Distanz:</span>
                <span class="value">{{ cam.distanceToCenter | number:'1.0-0' }}m</span>
              </div>
              <div class="row">
                <span class="key">Terrain:</span>
                <span class="value">{{ cam.terrainHeight | number:'1.0-0' }}m</span>
              </div>
            </div>

            <div class="section">
              <span class="section-label">Optik</span>
              <div class="row">
                <span class="key">FOV:</span>
                <span class="value">{{ cam.fov | number:'1.0-0' }}°</span>
              </div>
            </div>
          </div>
        } @else {
          <div class="no-data">Keine Kamera-Daten</div>
        }
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .camera-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 180px;
    }

    .section {
      padding: 6px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-child {
      padding-top: 0;
    }

    .section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-label {
      display: block;
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 1px 0;
    }

    .key {
      color: var(--td-text-muted);
    }

    .value {
      color: var(--td-teal);
      font-weight: 600;
      text-align: right;
    }

    .no-data {
      color: var(--td-text-muted);
      font-style: italic;
      text-align: center;
      padding: 12px;
    }
  `,
})
export class CameraDebuggerComponent implements OnDestroy {
  readonly windowService = inject(DebugWindowService);
  private readonly cameraControl = inject(CameraControlService);

  // Signal that holds camera info, updated by external caller
  readonly cameraInfo = signal<CameraDebugInfo | null>(null);

  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start updating when window opens
    this.startUpdates();
  }

  ngOnDestroy(): void {
    this.stopUpdates();
  }

  private startUpdates(): void {
    // Update camera info at ~30fps when window is open
    this.updateInterval = setInterval(() => {
      if (this.windowService.cameraWindow().isOpen) {
        const info = this.cameraControl.getCameraDebugInfo();
        if (info) {
          this.cameraInfo.set(info);
        }
      }
    }, 33);
  }

  private stopUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
