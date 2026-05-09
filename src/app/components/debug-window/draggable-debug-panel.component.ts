import {
  Component,
  input,
  output,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  inject,
  HostListener,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DebugWindowService, DebugWindowId, WindowPosition } from '../../services/debug/debug-window.service';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

export interface WindowSize {
  width: number;
  height: number;
}

@Component({
  selector: 'app-draggable-debug-panel',
  standalone: true,
  imports: [CommonModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #panel
      class="debug-panel"
      [class.resizable]="resizable()"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      [style.z-index]="zIndex()"
      [style.width.px]="resizable() ? currentSize().width : null"
      [style.height.px]="resizable() ? currentSize().height : null"
      (mousedown)="onPanelClick()"
    >
      <div
        class="debug-panel-header"
        (mousedown)="onHeaderMouseDown($event)"
      >
        <td-icon class="debug-panel-icon" [name]="$any(icon())" [size]="14"></td-icon>
        <span class="debug-panel-title">{{ title() }}</span>
        <button class="debug-panel-close" (click)="onClose($event)">
          <td-icon name="cross" [size]="14"></td-icon>
        </button>
      </div>
      <div class="debug-panel-content" [class.resizable-content]="resizable()">
        <ng-content></ng-content>
      </div>
      @if (resizable()) {
        <div class="resize-handle" (mousedown)="onResizeMouseDown($event)">
          <td-icon name="dragHandle" [size]="14"></td-icon>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .debug-panel {
      position: absolute;
      min-width: 200px;
      max-width: 400px;
      background: rgba(20, 24, 21, 0.95);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.5),
        0 2px 4px rgba(0, 0, 0, 0.3);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      user-select: none;
    }

    .debug-panel-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border-bottom: 1px solid var(--td-frame-dark);
      cursor: grab;
    }

    .debug-panel-header:active {
      cursor: grabbing;
    }

    .debug-panel-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-gold);
    }

    .debug-panel-title {
      flex: 1;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .debug-panel-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      background: transparent;
      border: 1px solid transparent;
      color: var(--td-text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .debug-panel-close mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .debug-panel-close:hover {
      background: var(--td-health-red);
      border-color: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .debug-panel-content {
      padding: 8px;
      max-height: min(600px, 70vh);
      overflow-y: auto;
      overflow-x: hidden;
      ${TD_SCROLLBAR_STYLES}
    }

    .debug-panel-content::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .debug-panel-content::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .debug-panel-content::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .debug-panel-content::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
    }

    .debug-panel.resizable {
      min-width: 300px;
      min-height: 200px;
      max-width: none;
      display: flex;
      flex-direction: column;
    }

    .debug-panel.resizable .debug-panel-content.resizable-content {
      flex: 1;
      max-height: none;
      overflow: auto;
    }

    .resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 20px;
      height: 20px;
      cursor: nwse-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--td-text-muted);
      opacity: 0.5;
      transition: opacity 0.15s;
    }

    .resize-handle:hover {
      opacity: 1;
      color: var(--td-teal);
    }

    .resize-handle mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      transform: rotate(-45deg);
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
  readonly resizable = input<boolean>(false);
  readonly size = input<WindowSize>({ width: 400, height: 350 });

  // Outputs
  readonly closed = output<void>();
  readonly positionChange = output<WindowPosition>();
  readonly focused = output<void>();
  readonly sizeChange = output<WindowSize>();

  @ViewChild('panel') panelRef!: ElementRef<HTMLDivElement>;

  // Internal state for current size (initialized from input)
  readonly currentSize = signal<WindowSize>({ width: 400, height: 350 });

  private isDragging = false;
  private isResizing = false;
  private dragOffset = { x: 0, y: 0 };
  private resizeStart = { x: 0, y: 0, width: 0, height: 0 };

  ngAfterViewInit(): void {
    // Initialize size from input
    this.currentSize.set(this.size());
    // Ensure panel stays within viewport - delay until DOM has updated with correct size
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
      const panel = this.panelRef?.nativeElement;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;

        this.positionChange.emit({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        });
      } else {
        this.positionChange.emit({ x: newX, y: newY });
      }
    } else if (this.isResizing) {
      const deltaX = event.clientX - this.resizeStart.x;
      const deltaY = event.clientY - this.resizeStart.y;

      const newWidth = Math.max(300, this.resizeStart.width + deltaX);
      const newHeight = Math.max(200, this.resizeStart.height + deltaY);

      // Constrain to viewport
      const pos = this.position();
      const maxWidth = window.innerWidth - pos.x - 10;
      const maxHeight = window.innerHeight - pos.y - 10;

      const size: WindowSize = {
        width: Math.min(newWidth, maxWidth),
        height: Math.min(newHeight, maxHeight),
      };

      this.currentSize.set(size);
      this.sizeChange.emit(size);
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

    const size = this.currentSize();
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
    const panel = this.panelRef?.nativeElement;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const pos = this.position();
    let needsUpdate = false;
    let newX = pos.x;
    let newY = pos.y;

    if (pos.x + rect.width > window.innerWidth) {
      newX = Math.max(0, window.innerWidth - rect.width);
      needsUpdate = true;
    }
    if (pos.y + rect.height > window.innerHeight) {
      newY = Math.max(0, window.innerHeight - rect.height);
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.positionChange.emit({ x: newX, y: newY });
    }
  }
}
