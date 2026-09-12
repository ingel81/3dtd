import { Component, inject, ChangeDetectionStrategy, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { EnemyDebugService } from '../../services/debug/enemy-debug.service';
import { WaveDebugService } from '../../services/debug/wave-debug.service';
import { ENEMY_TYPES, EnemyTypeId } from '../../configs/enemy-types.config';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-enemy-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './enemy-debugger.component.html',
  styleUrl: './enemy-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class EnemyDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly enemyDebug = inject(EnemyDebugService);
  private readonly waveDebug = inject(WaveDebugService);

  // Outputs for removing enemies
  readonly removeEnemy = output<string>();
  readonly clearAllEnemies = output<void>();

  // Outputs for animation/movement control
  readonly playWalk = output<string>();
  readonly playRun = output<string>();
  readonly startMovement = output<string>();
  readonly stopMovement = output<string>();

  getEnemyName(id: EnemyTypeId): string {
    return ENEMY_TYPES[id].name;
  }

  onEnemyTypeSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const typeId = select.value as EnemyTypeId;
    this.enemyDebug.selectEnemy(typeId);
    // Also update wave debug so the sidebar preview shows the correct enemy type
    this.waveDebug.setEnemyType(typeId);
  }

  onSelectedSliderChange(key: 'scale' | 'heightOffset' | 'healthBarOffset' | 'baseSpeed' | 'animationSpeed' | 'previewScale' | 'previewCameraDistance' | 'previewCameraAngle' | 'previewOffsetY', event: Event): void {
    const input = event.target as HTMLInputElement;
    this.enemyDebug.updateSelectedOverride(key, parseFloat(input.value));
  }

  onRotationChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const deg = parseFloat(input.value);
    this.enemyDebug.updateSelectedOverride('rotation', this.degToRad(deg));
  }

  radToDeg(rad: number): number {
    return Math.round((rad * 180) / Math.PI);
  }

  degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  onRemoveEnemy(event: Event, enemyId: string): void {
    event.stopPropagation(); // Don't trigger selection
    this.removeEnemy.emit(enemyId);
  }

  onClearAll(): void {
    this.clearAllEnemies.emit();
  }

  onCopyJson(): void {
    const selected = this.enemyDebug.selectedDebugEnemy();
    if (selected) {
      const json = JSON.stringify({
        typeId: selected.typeId,
        overrides: {
          scale: Math.round(selected.overrides.scale * 1000) / 1000,
          heightOffset: Math.round(selected.overrides.heightOffset * 10) / 10,
          healthBarOffset: Math.round(selected.overrides.healthBarOffset * 10) / 10,
          baseSpeed: Math.round(selected.overrides.baseSpeed * 10) / 10,
          animationSpeed: Math.round(selected.overrides.animationSpeed * 100) / 100,
          rotation: Math.round(selected.overrides.rotation * 1000) / 1000,
          previewScale: Math.round(selected.overrides.previewScale * 1000) / 1000,
          previewCameraDistance: Math.round(selected.overrides.previewCameraDistance * 10) / 10,
          previewCameraAngle: Math.round(selected.overrides.previewCameraAngle * 100) / 100,
          previewOffsetY: Math.round(selected.overrides.previewOffsetY * 10) / 10,
        }
      }, null, 2);
      navigator.clipboard.writeText(json);
      console.log('[EnemyDebug] Selected enemy JSON copied');
    } else {
      this.enemyDebug.copyJsonToClipboard();
    }
  }
}
