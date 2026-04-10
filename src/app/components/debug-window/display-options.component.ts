import { Component, inject, signal, output, effect, ChangeDetectionStrategy } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { DebugFacadeService } from '../../services/debug-facade.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { ColorGradingPreset, COLOR_GRADING_PRESETS } from '../../three-engine/post-processing/color-grading';

const STORAGE_KEY = 'td_display_options';

interface DisplayOptions {
  enemies: boolean;
  healthBars: boolean;
  animations: boolean;
  movement: boolean;
  textures: boolean;
  skeletonCloning: boolean;
  alphaBlend: boolean;
  screenShake: boolean;
  colorGrading: ColorGradingPreset;
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
            <input type="checkbox" [checked]="enemies()" (change)="toggleEnemies()" />
            <span>Enemies</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="healthBars()" (change)="toggleHealthBars()" />
            <span>Health Bars</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="animations()" (change)="toggleAnimations()" />
            <span>Animations</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="movement()" (change)="toggleMovement()" />
            <span>Movement</span>
          </label>
          <div class="separator">Performance</div>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="textures()" (change)="toggleTextures()" />
            <span>Textures</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="skeletonCloning()" (change)="toggleSkeletonCloning()" />
            <span>Skeleton Clone</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="alphaBlend()" (change)="toggleAlphaBlend()" />
            <span>Alpha Blend</span>
          </label>
          <div class="separator">Effects</div>
          <label class="checkbox-row">
            <input type="checkbox" [checked]="screenShake()" (change)="toggleScreenShake()" />
            <span>Screen Shake</span>
          </label>
          <div class="separator">Post-Processing</div>
          <label class="select-row">
            <span>Color Grading</span>
            <select (change)="onColorGradingChange($event)">
              @for (preset of colorGradingPresets; track preset.id) {
                <option [value]="preset.id" [selected]="colorGrading() === preset.id">
                  {{ preset.label }}
                </option>
              }
            </select>
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

    .select-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--td-text-secondary);
    }

    .select-row select {
      background: var(--td-panel-bg, #1a1f25);
      color: var(--td-text-primary, #e0e0e0);
      border: 1px solid var(--td-panel-border, #333);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 12px;
      cursor: pointer;
      outline: none;
    }

    .select-row select:hover {
      border-color: var(--td-teal, #00bcd4);
    }

    .select-row:hover {
      color: var(--td-text-primary);
    }

    .separator {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--td-text-tertiary);
      border-top: 1px solid var(--td-panel-border);
      padding-top: 8px;
      margin-top: 4px;
    }
  `,
})
export class DisplayOptionsComponent {
  readonly windowService = inject(DebugWindowService);
  private readonly debugFacade = inject(DebugFacadeService);

  readonly enemies = signal(true);
  readonly healthBars = this.debugFacade.healthBarsVisible;
  readonly animations = signal(true);
  readonly movement = signal(true);
  readonly textures = signal(true);
  readonly skeletonCloning = signal(true);
  readonly alphaBlend = signal(true);
  readonly screenShake = this.debugFacade.screenShakeEnabled;
  readonly colorGrading = signal<ColorGradingPreset>('none');

  readonly colorGradingPresets = COLOR_GRADING_PRESETS;

  readonly enemiesToggled = output<boolean>();
  readonly healthBarsToggled = output<boolean>();
  readonly animationsToggled = output<boolean>();
  readonly movementToggled = output<boolean>();
  readonly texturesToggled = output<boolean>();
  readonly skeletonCloningToggled = output<boolean>();
  readonly alphaBlendToggled = output<boolean>();
  readonly screenShakeToggled = output<boolean>();
  readonly colorGradingChanged = output<ColorGradingPreset>();

  constructor() {
    this.loadFromStorage();

    // Persist on change
    effect(() => {
      const opts: DisplayOptions = {
        enemies: this.enemies(),
        healthBars: this.healthBars(),
        animations: this.animations(),
        movement: this.movement(),
        textures: this.textures(),
        skeletonCloning: this.skeletonCloning(),
        alphaBlend: this.alphaBlend(),
        screenShake: this.screenShake(),
        colorGrading: this.colorGrading(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
      } catch { /* ignore */ }
    });
  }

  toggleEnemies(): void {
    const next = !this.enemies();
    this.enemies.set(next);
    this.enemiesToggled.emit(next);
  }

  toggleHealthBars(): void {
    this.healthBarsToggled.emit(!this.healthBars());
  }

  toggleAnimations(): void {
    const next = !this.animations();
    this.animations.set(next);
    this.animationsToggled.emit(next);
  }

  toggleMovement(): void {
    const next = !this.movement();
    this.movement.set(next);
    this.movementToggled.emit(next);
  }

  toggleTextures(): void {
    const next = !this.textures();
    this.textures.set(next);
    this.texturesToggled.emit(next);
  }

  toggleSkeletonCloning(): void {
    const next = !this.skeletonCloning();
    this.skeletonCloning.set(next);
    this.skeletonCloningToggled.emit(next);
  }

  toggleAlphaBlend(): void {
    const next = !this.alphaBlend();
    this.alphaBlend.set(next);
    this.alphaBlendToggled.emit(next);
  }

  toggleScreenShake(): void {
    this.screenShakeToggled.emit(!this.screenShake());
  }

  onColorGradingChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const preset = select.value as ColorGradingPreset;
    this.colorGrading.set(preset);
    this.colorGradingChanged.emit(preset);
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const opts = JSON.parse(stored) as DisplayOptions;
        this.enemies.set(opts.enemies ?? true);
        // healthBars and screenShake are managed by DebugFacadeService shared signals
        this.animations.set(opts.animations ?? true);
        this.movement.set(opts.movement ?? true);
        this.textures.set(opts.textures ?? true);
        this.skeletonCloning.set(opts.skeletonCloning ?? true);
        this.alphaBlend.set(opts.alphaBlend ?? true);
        this.colorGrading.set(opts.colorGrading ?? 'none');
      }
    } catch { /* ignore */ }
  }
}
