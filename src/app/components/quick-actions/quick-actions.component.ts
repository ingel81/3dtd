import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DebugStateDumpService } from '../../services/debug/debug-state-dump.service';
import { CellReportService } from '../../services/debug/cell-report.service';
import { CorridorSnapshotService } from '../../services/debug/corridor-snapshot.service';
import { UIStore } from '../../store/ui.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-actions.component.html',
  styleUrl: './quick-actions.component.scss',
})
export class QuickActionsComponent {
  readonly debugWindows = inject(DebugWindowService);
  readonly uiStore = inject(UIStore);
  readonly devWorld = inject(DevWorldService);
  readonly debugStateDump = inject(DebugStateDumpService);
  readonly cellReport = inject(CellReportService);
  readonly corridorSnapshot = inject(CorridorSnapshotService);

  // Input for camera framing debug state (component-local in parent)
  readonly cameraFramingDebug = input.required<boolean>();

  // Per-tower-LOS filter — icon + tooltip computed from the UIStore signal
  // so the button reflects the current mode (both / ground / air).
  readonly perTowerLosFilterIcon = computed<'layers' | 'grid' | 'gridAir'>(() => {
    const mode = this.uiStore.perTowerLosFilter();
    return mode === 'both' ? 'layers' : mode === 'ground' ? 'grid' : 'gridAir';
  });
  readonly perTowerLosFilterTooltip = computed(() => {
    const mode = this.uiStore.perTowerLosFilter();
    const current = mode === 'both' ? 'Both layers' : mode === 'ground' ? 'Ground only' : 'Air only';
    const next = mode === 'both' ? 'Ground only' : mode === 'ground' ? 'Air only' : 'Both layers';
    return `Per-tower LOS: ${current} (click → ${next})`;
  });

  // Outputs for actions that need parent handling
  readonly resetCamera = output<void>();
  readonly buildingsToggled = output<void>();
  readonly streetsToggled = output<void>();
  readonly routesToggled = output<void>();
  readonly heightDebugToggled = output<void>();
  readonly cameraFramingDebugToggled = output<void>();
  readonly specialPointsDebugToggled = output<void>();
  readonly spatialGridDebugToggled = output<void>();
  readonly airSpatialGridDebugToggled = output<void>();
  readonly airRouteToggled = output<void>();
  readonly perTowerLosFilterCycled = output<void>();
  readonly playRouteAnimation = output<void>();
  readonly refreshHeights = output<void>();
  readonly killAllEnemies = output<void>();
  readonly addCredits = output<MouseEvent>();
  readonly addHealth = output<MouseEvent>();
  readonly completeAllResearch = output<void>();
  readonly maxUpgradeAllTowers = output<void>();
  readonly readyAbilities = output<void>();
  readonly readyHero = output<void>();
  readonly photoModeRequested = output<void>();
  /** The menu's Settings page: effects, audio, graphics (the display and audio menus moved there) */
  readonly settingsRequested = output<void>();
}
