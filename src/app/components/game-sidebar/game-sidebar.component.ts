import {
  Component,
  Injector,
  input,
  output,
  OnDestroy,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
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
import { openAttributionsDialog } from '../attributions-dialog/open-attributions-dialog';
import { openRunsDialog } from '../runs-dialog/open-runs-dialog';
import { WhatsNewService } from '../../services/onboarding/whats-new.service';
import { openHotkeyHelpDialog } from '../hotkey-help-dialog/open-hotkey-help-dialog';
import { ConfigService } from '../../core/services/config.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { OnboardingService } from '../../services/onboarding/onboarding.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TdIconComponent } from '../icon/icon.component';
import { SidebarWavePanelComponent } from './wave-panel/wave-panel.component';
import { SidebarBuildPanelComponent } from './build-panel/build-panel.component';
import { SidebarTowerPanelComponent } from './tower-panel/tower-panel.component';
import { SidebarResearchPanelComponent } from './research-panel/research-panel.component';
import { SidebarHeroPanelComponent } from './hero-panel/hero-panel.component';
import { SidebarBuildingPanelComponent } from './building-panel/building-panel.component';
import { UIStore } from '../../store/ui.store';
import { openCoopDialog } from '../coop-dialog/open-coop-dialog';
import { COOP } from '../../services/coop.token';

/**
 * Rechte Sidebar: Rahmen, Footer und die Wahl des Panels. Die Sektionen sind
 * eigene Components (WAVE, BUILD, Tower, Research Center, passives Gebäude,
 * Held), ihre Outputs reicht die Sidebar an die Spielkomponente weiter.
 */
@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    MatTooltipModule,
    TdIconComponent,
    SidebarWavePanelComponent,
    SidebarBuildPanelComponent,
    SidebarTowerPanelComponent,
    SidebarResearchPanelComponent,
    SidebarBuildingPanelComponent,
    SidebarHeroPanelComponent,
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
  private readonly injector = inject(Injector);
  private readonly coop = inject(COOP, { optional: true });

  constructor() {
    // Opened with an invite link (?room=): the dialog opens at once and says
    // what happens, the host's map loads, the player joins as soon as it stands
    const coop = this.coop;
    if (coop?.roomFromUrl) {
      this.openCoop();
      void coop.joinFromUrl();
    }
  }

  private readonly config = inject(ConfigService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly onboarding = inject(OnboardingService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);

  // Store, single source of truth
  readonly store = inject(TowerDefenseStore);

  /** Der Held ist gewählt: sein Panel statt des Tower-Details. */
  readonly heroSelected = inject(UIStore).heroSelected;

  readonly buildVersion = BUILD_VERSION;

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
  readonly setHoldFire = output<{ tower: Tower; holdFire: boolean }>();
  readonly takeControl = output<Tower>();
  readonly cancelResearch = output<ResearchId>();

  /** Das Research Center bekommt statt des Tower-Details sein eigenes Panel. */
  readonly isResearchCenter = computed(() =>
    this.store.selectedTower()?.typeConfig.id === 'research-center'
  );

  /** Jedes andere passive Gebäude (Missile Silo): Text und Verkauf statt Kampfwerten. */
  readonly isPassiveBuilding = computed(() =>
    this.store.selectedTower()?.typeConfig.attackType === 'passive'
  );

  /**
   * Die Panels melden ihre Previews selbst an und ab (WAVE: Gegnergruppen,
   * BUILD: Tower-Karten). Der Service lebt so lange wie die Sidebar, ihr
   * Abbau gibt Renderer und Modelle frei.
   */
  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  /** The location dialog on its World tab: defended places, a click loads one. */
  openWorldMap(): void {
    void this.locationCoordinator.openLocationDialog('world');
  }

  /** Show the first-run tips again, from the first the running game has not done. */
  showTips(): void {
    this.onboarding.restart();
  }

  /** The shortcut overview, the same dialog as H and ?. */
  openHotkeys(): void {
    void openHotkeyHelpDialog(this.dialog);
  }

  /** Open the tile-credentials screen (swap or clear the stored key). */
  openTokenSetup(): void {
    this.config.setupRequested.set(true);
  }

  openAttributions(): void {
    void openAttributionsDialog(this.dialog);
  }

  /** Coop: open a room or join one (docs/COOP_PLAN.md, C4); the header's coop button opens it as well. */
  openCoop(): void {
    void openCoopDialog(this.dialog, this.injector, !this.coop?.inGame());
  }

  /** The runs this browser kept, each one to save as a file (docs/RUN_LOG.md). */
  openRuns(): void {
    void openRunsDialog(this.dialog);
  }

  /** The version in the footer opens "What's new" with every release */
  openWhatsNew(): void {
    this.whatsNew.open();
  }
}
