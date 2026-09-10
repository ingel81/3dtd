import {
  Component,
  input,
  output,
  OnDestroy,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import {
  TowerTypeConfig,
  TowerTypeId,
  UpgradeId,
  TargetingStrategy,
  AirSubStrategy,
} from '../../configs/tower-types.config';
import { ResearchId } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/infrastructure/model-preview.service';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { ConfigService } from '../../core/services/config.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { SidebarWavePanelComponent } from './wave-panel/wave-panel.component';
import { SidebarBuildPanelComponent } from './build-panel/build-panel.component';
import { SidebarTowerPanelComponent } from './tower-panel/tower-panel.component';
import { SidebarResearchPanelComponent } from './research-panel/research-panel.component';

/**
 * Rechte Sidebar: Rahmen, Footer und die Wahl des Panels. Die Sektionen sind
 * eigene Components (WAVE, BUILD, Tower, Research Center), ihre Outputs
 * reicht die Sidebar an die Spielkomponente weiter.
 */
@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    TdIconComponent,
    SidebarWavePanelComponent,
    SidebarBuildPanelComponent,
    SidebarTowerPanelComponent,
    SidebarResearchPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-sidebar.component.html',
  styleUrl: './game-sidebar.component.scss',
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }
  `,
})
export class GameSidebarComponent implements OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly config = inject(ConfigService);
  private readonly modelPreview = inject(ModelPreviewService);

  // Store, single source of truth
  readonly store = inject(TowerDefenseStore);

  // Inputs
  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  // Outputs, aus den Panels durchgereicht
  readonly startWave = output<void>();
  readonly cancelBuild = output<void>();
  readonly selectTower = output<TowerTypeId>();
  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly changeTargeting = output<{ tower: Tower; strategy: TargetingStrategy }>();
  readonly changeAirSubStrategy = output<{ tower: Tower; strategy: AirSubStrategy }>();
  readonly startResearch = output<ResearchId>();
  readonly cancelResearch = output<ResearchId>();

  /** Das Research Center bekommt statt des Tower-Details sein eigenes Panel. */
  readonly isResearchCenter = computed(() =>
    this.store.selectedTower()?.typeConfig.id === 'research-center'
  );

  /**
   * Die Panels melden ihre Previews selbst an und ab (WAVE: Gegnergruppen,
   * BUILD: Tower-Karten). Der Service lebt so lange wie die Sidebar, ihr
   * Abbau gibt Renderer und Modelle frei.
   */
  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  /** Open the tile-credentials screen (swap or clear the stored key). */
  openTokenSetup(): void {
    this.config.setupRequested.set(true);
  }

  openAttributions(): void {
    this.dialog.open(AttributionsDialogComponent, {
      panelClass: 'td-dialog-panel',
    });
  }
}
