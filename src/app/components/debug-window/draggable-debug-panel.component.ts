import {
  Component,
  input,
  output,
  computed,
  AfterViewInit,
  OnDestroy,
  inject,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DebugWindowService,
  DebugWindowId,
  WindowPosition,
  DEBUG_PANEL_MIN_SIZE,
  clampPanelSize,
} from '../../services/debug/debug-window.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

/**
 * Shared frame for all debug panels: drag, resize, close, focus.
 * Size lives in DebugWindowService per windowId, so every panel is resizable
 * and remembers its size without extra wiring in the individual debugger.
 */
@Component({
  selector: 'app-draggable-debug-panel',
  standalone: true,
  imports: [CommonModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './draggable-debug-panel.component.html',
  styleUrl: './draggable-debug-panel.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .debug-panel {
      min-width: ${DEBUG_PANEL_MIN_SIZE.width}px;
      min-height: ${DEBUG_PANEL_MIN_SIZE.height}px;
    }
  `,
})
export class DraggableDebugPanelComponent implements AfterViewInit, OnDestroy {
  private readonly debugWindowService = inject(DebugWindowService);

  // Inputs
  readonly windowId = input.required<DebugWindowId>();
  readonly title = input.required<string>();
  readonly icon = input<string>('bug_report');
  readonly position = input.required<WindowPosition>();
  readonly zIndex = input.required<number>();

  // Outputs
  readonly closed = output<void>();
  readonly positionChange = output<WindowPosition>();
  readonly focused = output<void>();

  readonly size = computed(() => this.debugWindowService.getSize(this.windowId()));

  private isDragging = false;
  private isResizing = false;
  private dragOffset = { x: 0, y: 0 };
  private resizeStart = { x: 0, y: 0, width: 0, height: 0 };

  ngAfterViewInit(): void {
    // Ensure panel stays within viewport - outside the current change detection pass
    requestAnimationFrame(() => this.constrainToViewport());
  }

  ngOnDestroy(): void {
    this.stopDrag();
    this.stopResize();
  }

  onPanelClick(): void {
    this.focused.emit();
  }

  onHeaderMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left click

    event.preventDefault();
    this.isDragging = true;
    this.dragOffset = {
      x: event.clientX - this.position().x,
      y: event.clientY - this.position().y,
    };

    this.focused.emit();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.isDragging) {
      const newX = event.clientX - this.dragOffset.x;
      const newY = event.clientY - this.dragOffset.y;

      // Constrain to viewport
      const size = this.size();
      const maxX = window.innerWidth - size.width;
      const maxY = window.innerHeight - size.height;

      this.positionChange.emit({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    } else if (this.isResizing) {
      const deltaX = event.clientX - this.resizeStart.x;
      const deltaY = event.clientY - this.resizeStart.y;

      // Constrain to viewport, but never below the shared minimum
      const pos = this.position();
      const size = clampPanelSize(
        {
          width: this.resizeStart.width + deltaX,
          height: this.resizeStart.height + deltaY,
        },
        window.innerWidth - pos.x - 10,
        window.innerHeight - pos.y - 10
      );

      this.debugWindowService.updateSize(this.windowId(), size);
    }
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    this.stopDrag();
    this.stopResize();
  }

  onResizeMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left click

    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;

    const size = this.size();
    this.resizeStart = {
      x: event.clientX,
      y: event.clientY,
      width: size.width,
      height: size.height,
    };

    this.focused.emit();
  }

  onClose(event: MouseEvent): void {
    event.stopPropagation();
    this.closed.emit();
  }

  private stopDrag(): void {
    this.isDragging = false;
  }

  private stopResize(): void {
    this.isResizing = false;
  }

  private constrainToViewport(): void {
    // A stored size may come from a larger window: shrink it first, then
    // move the panel back into view.
    const current = this.size();
    const size = clampPanelSize(current, window.innerWidth, window.innerHeight);
    if (size.width !== current.width || size.height !== current.height) {
      this.debugWindowService.updateSize(this.windowId(), size);
    }

    const pos = this.position();
    let needsUpdate = false;
    let newX = pos.x;
    let newY = pos.y;

    if (pos.x + size.width > window.innerWidth) {
      newX = Math.max(0, window.innerWidth - size.width);
      needsUpdate = true;
    }
    if (pos.y + size.height > window.innerHeight) {
      newY = Math.max(0, window.innerHeight - size.height);
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.positionChange.emit({ x: newX, y: newY });
    }
  }
}
