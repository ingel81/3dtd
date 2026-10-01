import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { TD_CSS_VARS } from '../../styles/td-theme';

/** What the player calls a model: the tower's or enemy's name, else the file's */
export function modelLabel(url: string): string {
  const owner = [...Object.values(TOWER_TYPES), ...Object.values(ENEMY_TYPES)].find((type) => type.modelUrl === url);
  return owner?.name ?? url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? url;
}

/**
 * A model that did not load after every try (AssetManagerService.failedModels)
 * leaves its enemies invisible or a tower without its body; until now only
 * the console said so. The chip names them and offers a reload. Not modal,
 * the player can hide it; a model that fails later shows it again.
 */
@Component({
  selector: 'app-model-load-hint',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-load-hint.component.html',
  styleUrl: './model-load-hint.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class ModelLoadHintComponent {
  private readonly assets = inject(AssetManagerService);
  /** How many failed models the player hid the chip at */
  private readonly hiddenAt = signal(0);
  readonly names = computed(() => [...new Set(this.assets.failedModels().map(modelLabel))]);
  readonly visible = computed(() => this.assets.failedModels().length > this.hiddenAt());

  reload(): void {
    location.reload();
  }

  hide(): void {
    this.hiddenAt.set(this.assets.failedModels().length);
  }
}
