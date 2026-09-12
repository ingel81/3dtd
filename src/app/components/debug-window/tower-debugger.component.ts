import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { TowerDebugService } from '../../services/debug/tower-debug.service';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-tower-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tower-debugger.component.html',
  styleUrl: './tower-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class TowerDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly towerDebug = inject(TowerDebugService);

  getTowerName(id: TowerTypeId): string {
    return TOWER_TYPES[id].name;
  }

  onTowerSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.towerDebug.selectTower(select.value as TowerTypeId);
  }

  onSliderChange(key: 'scale' | 'previewScale' | 'heightOffset' | 'shootHeight', event: Event): void {
    const input = event.target as HTMLInputElement;
    this.towerDebug.setOverride(key, parseFloat(input.value));
  }

  onRotationChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const deg = parseFloat(input.value);
    this.towerDebug.setOverride('rotationY', this.towerDebug.degToRad(deg));
  }
}
