import { Component, inject, signal, output, effect, ChangeDetectionStrategy } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

const STORAGE_KEY = 'td_display_options';

interface DisplayOptions {
  healthBars: boolean;
  animations: boolean;
}

@Component({
  selector: 'app-display-options',
  standalone: true,
  imports: [DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.displayWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="display"
        title="Display"
        icon="tune"
        [position]="windowService.displayWindow().position"
        [zIndex]="windowService.displayWindow().zIndex"
        (closed)="windowService.close('display')"
        (positionChange)="windowService.updatePosition('display', $event)"
        (focused)="windowService.bringToFront('display')"
      >
        <div class="display-options">
          <label class="checkbox-row">
            <input type="checkbox" [checked]="healthBars()" (change)="toggleHealthBars()" />
            <span>Health Bars</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="animations()" (change)="toggleAnimations()" />
            <span>Animations</span>
          </label>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    .display-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--td-text-secondary);
    }

    .checkbox-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--td-teal);
    }

    .checkbox-row:hover {
      color: var(--td-text-primary);
    }
  `,
})
export class DisplayOptionsComponent {
  readonly windowService = inject(DebugWindowService);

  readonly healthBars = signal(true);
  readonly animations = signal(true);

  readonly healthBarsToggled = output<boolean>();
  readonly animationsToggled = output<boolean>();

  constructor() {
    this.loadFromStorage();

    // Persist on change
    effect(() => {
      const opts: DisplayOptions = {
        healthBars: this.healthBars(),
        animations: this.animations(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
      } catch { /* ignore */ }
    });
  }

  toggleHealthBars(): void {
    const next = !this.healthBars();
    this.healthBars.set(next);
    this.healthBarsToggled.emit(next);
  }

  toggleAnimations(): void {
    const next = !this.animations();
    this.animations.set(next);
    this.animationsToggled.emit(next);
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const opts = JSON.parse(stored) as DisplayOptions;
        this.healthBars.set(opts.healthBars ?? true);
        this.animations.set(opts.animations ?? true);
      }
    } catch { /* ignore */ }
  }
}
