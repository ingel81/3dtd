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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DebugWindowService, DebugWindowId, WindowPosition } from '../../services/debug-window.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-draggable-debug-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #panel
      class="debug-panel"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      [style.z-index]="zIndex()"
      (mousedown)="onPanelClick()"
    >
      <div
        class="debug-panel-header"
        (mousedown)="onHeaderMouseDown($event)"
      >
        <mat-icon class="debug-panel-icon">{{ icon() }}</mat-icon>
        <span class="debug-panel-title">{{ title() }}</span>
        <button class="debug-panel-close" (click)="onClose($event)">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="debug-panel-content">
        <ng-content></ng-content>
      </div>
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
      max-height: 400px;
      overflow-y: auto;
      overflow-x: hidden;
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

  @ViewChild('panel') panelRef!: ElementRef<HTMLDivElement>;

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  ngAfterViewInit(): void {
    // Ensure panel stays within viewport
    this.constrainToViewport();
  }

  ngOnDestroy(): void {
    this.stopDrag();
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
    if (!this.isDragging) return;

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
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    this.stopDrag();
  }

  onClose(event: MouseEvent): void {
    event.stopPropagation();
    this.closed.emit();
  }

  private stopDrag(): void {
    this.isDragging = false;
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
