import { Component, inject, signal, computed, output, effect, ChangeDetectionStrategy } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { ColorGradingPreset, COLOR_GRADING_PRESETS } from '../../three-engine/post-processing/color-grading';
import { loadDisplayOptions, persistDisplayOptions } from '../../utils/display-options.storage';

@Component({
  selector: 'app-display-options',
  standalone: true,
  imports: [DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './display-options.component.html',
  styleUrl: './display-options.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
  /** One of the VFX settings, which the display menu shows as well. */
  readonly colorGrading = computed(() => this.debugFacade.vfx().colorGrading);
  /** Session only, see DebugFacadeService.onTileLodDebugToggled. */
  readonly tileLodDebug = signal(false);

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
  readonly tileLodDebugToggled = output<boolean>();

  constructor() {
    this.loadFromStorage();

    // Persist on change. Health bars, screen shake and color grading are
    // DebugFacadeService state, it persists them itself.
    effect(() => {
      persistDisplayOptions({
        enemies: this.enemies(),
        animations: this.animations(),
        movement: this.movement(),
        textures: this.textures(),
        skeletonCloning: this.skeletonCloning(),
        alphaBlend: this.alphaBlend(),
      });
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

  toggleTileLodDebug(): void {
    const next = !this.tileLodDebug();
    this.tileLodDebug.set(next);
    this.tileLodDebugToggled.emit(next);
  }

  onColorGradingChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.colorGradingChanged.emit(select.value as ColorGradingPreset);
  }

  private loadFromStorage(): void {
    const opts = loadDisplayOptions();
    this.enemies.set(opts.enemies ?? true);
    this.animations.set(opts.animations ?? true);
    this.movement.set(opts.movement ?? true);
    this.textures.set(opts.textures ?? true);
    this.skeletonCloning.set(opts.skeletonCloning ?? true);
    this.alphaBlend.set(opts.alphaBlend ?? true);
  }
}
