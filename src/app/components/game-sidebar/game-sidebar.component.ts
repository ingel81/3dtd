import {
  Component,
  input,
  output,
  OnDestroy,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import {
  TowerTypeConfig,
  TowerTypeId,
  UpgradeId,
  TargetingStrategy,
  AirSubStrategy,
} from '../../configs/tower-types.config';
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import { ResearchConfig, ResearchId } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/infrastructure/model-preview.service';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { ConfigService } from '../../core/services/config.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { SidebarWavePanelComponent } from './wave-panel/wave-panel.component';
import { SidebarBuildPanelComponent } from './build-panel/build-panel.component';
import { SidebarTowerPanelComponent } from './tower-panel/tower-panel.component';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTooltipModule,
    TdIconComponent,
    SidebarWavePanelComponent,
    SidebarBuildPanelComponent,
    SidebarTowerPanelComponent,
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

  // Research store reference
  readonly researchStore = inject(ResearchStore);

  // Outputs
  readonly startWave = output<void>();
  readonly cancelBuild = output<void>();
  readonly selectTower = output<TowerTypeId>();
  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();
  readonly changeTargeting = output<{ tower: Tower; strategy: TargetingStrategy }>();
  readonly changeAirSubStrategy = output<{ tower: Tower; strategy: AirSubStrategy }>();
  readonly startResearch = output<ResearchId>();
  readonly cancelResearch = output<ResearchId>();

  // Research helpers
  readonly isResearchCenter = computed(() =>
    this.store.selectedTower()?.typeConfig.id === 'research-center'
  );

  readonly allResearches = Object.values(RESEARCH_TREE);

  /**
   * Resolve the td-icon name for a research node based on its current status.
   * Status icons override the per-research config; available nodes use config.
   */
  researchNodeIconName(research: ResearchConfig): string {
    const status = this.getResearchStatus(research.id);
    if (status === 'completed') return 'check';
    if (status === 'active') return 'refresh';
    if (status === 'locked') return 'lock';
    return research.icon; // td-icon name set in research-tree.config
  }

  getResearchStatus(id: ResearchId): 'completed' | 'active' | 'available' | 'locked' {
    if (this.researchStore.completedResearches().has(id)) return 'completed';
    if (this.researchStore.activeResearches().some(a => a.researchId === id)) return 'active';
    const config = getResearch(id);
    if (!config) return 'locked';
    const allPrereqsMet = config.prerequisites.every(p => this.researchStore.completedResearches().has(p));
    return allPrereqsMet ? 'available' : 'locked';
  }

  getActiveResearchProgress(id: ResearchId): number {
    const active = this.researchStore.activeResearches().find(a => a.researchId === id);
    if (!active) return 0;
    return Math.min(1, active.elapsed / active.duration);
  }

  getActiveResearchRemaining(id: ResearchId): number {
    const active = this.researchStore.activeResearches().find(a => a.researchId === id);
    if (!active) return 0;
    return Math.max(0, active.duration - active.elapsed);
  }

  getResearchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
  }

  getMissingPrereqs(id: ResearchId): string {
    const config = getResearch(id);
    if (!config) return '';
    const missing = config.prerequisites
      .filter(p => !this.researchStore.completedResearches().has(p))
      .map(p => getResearch(p)?.name ?? p);
    return missing.join(', ');
  }

  /**
   * Die Panels melden ihre Previews selbst an und ab (WAVE: Gegnergruppen,
   * BUILD: Tower-Karten). Der Service lebt so lange wie die Sidebar, ihr
   * Abbau gibt Renderer und Modelle frei.
   */
  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  onUpgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower, upgradeId });
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
