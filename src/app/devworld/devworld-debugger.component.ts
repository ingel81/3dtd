import { Component, inject, ChangeDetectionStrategy, output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from '../components/debug-window/draggable-debug-panel.component';
import { DevWorldDebugPanelComponent } from './devworld-debug-panel.component';
import { DebugWindowService } from '../services/debug/debug-window.service';
import { DevWorldService } from './devworld.service';

/**
 * DevWorld Debugger Window
 *
 * Draggable debug window for DevWorld mode.
 * Only visible when DevWorld is active.
 */
@Component({
  selector: 'app-devworld-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, DevWorldDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (devWorld.isActive && windowService.devworldWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="devworld"
        title="DevWorld"
        icon="gamepad"
        [position]="windowService.devworldWindow().position"
        [zIndex]="windowService.devworldWindow().zIndex"
        (closed)="windowService.close('devworld')"
        (positionChange)="windowService.updatePosition('devworld', $event)"
        (focused)="windowService.bringToFront('devworld')"
      >
        <app-devworld-debug-panel [isRegenerating]="isRegenerating()" (terrainRefresh)="onTerrainRefresh()" />
      </app-draggable-debug-panel>
    }
  `,
})
export class DevWorldDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly devWorld = inject(DevWorldService);

  // Input for loading state
  readonly isRegenerating = input(false);

  // Output for terrain refresh request
  readonly terrainRefresh = output<void>();

  onTerrainRefresh(): void {
    this.terrainRefresh.emit();
  }
}
