import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { CameraControlService, CameraDebugInfo } from '../../services/camera-control.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-camera-debugger',
  standalone: true,
  imports: [CommonModule, DecimalPipe, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './camera-debugger.component.html',
  styleUrl: './camera-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
