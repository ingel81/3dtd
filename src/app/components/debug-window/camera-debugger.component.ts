import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { CameraControlService, CameraDebugInfo } from '../../services/camera-control.service';

@Component({
  selector: 'app-camera-debugger',
  standalone: true,
  imports: [CommonModule, DecimalPipe, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './camera-debugger.component.html',
  styleUrl: './camera-debugger.component.scss',
})
export class CameraDebuggerComponent implements OnDestroy {
  readonly windowService = inject(DebugWindowService);
  private readonly cameraControl = inject(CameraControlService);

  // Signal that holds camera info, updated by external caller
  readonly cameraInfo = signal<CameraDebugInfo | null>(null);

  private updateInterval: ReturnType<typeof setInterval> | null = null;

  private readonly zone = inject(NgZone);

  constructor() {
    // Start updating when window opens
    this.startUpdates();
  }

  ngOnDestroy(): void {
    this.stopUpdates();
  }

  private startUpdates(): void {
    // Update camera info at ~30fps when window is open. Outside the zone: the
    // timer runs while the window is closed too (the dev menu is persisted), and
    // in the zone every tick ran change detection; the signal asks for it itself
    this.updateInterval = this.zone.runOutsideAngular(() => setInterval(() => {
      if (this.windowService.cameraWindow().isOpen) {
        const info = this.cameraControl.getCameraDebugInfo();
        if (info) {
          this.cameraInfo.set(info);
        }
      }
    }, 33));
  }

  private stopUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
