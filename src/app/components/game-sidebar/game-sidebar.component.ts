import {
  Component,
  input,
  output,
  ViewChild,
  ViewChildren,
  QueryList,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  inject,
  effect,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameStateManager } from '../../managers/game-state.manager';
import { TowerTypeConfig, TowerTypeId, UpgradeId, TOWER_TYPES } from '../../configs/tower-types.config';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/model-preview.service';
import { WaveDebugService } from '../../services/wave-debug.service';
import { AdBannerComponent } from '../ad-banner/ad-banner.component';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatTooltipModule,
    AdBannerComponent,
  ],
  templateUrl: './game-sidebar.component.html',
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    /* === Sidebar === */
    .td-sidebar {
      width: 300px;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .td-sidebar-content {
      flex: 1;
      background:
        linear-gradient(rgba(15, 19, 15, 0.75), rgba(15, 19, 15, 0.75)),
        url('/assets/images/425.jpg') repeat;
      background-size: auto, 100px 100px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      overflow-y: auto;
      position: relative;
      z-index: 1;
      border-left: 4px solid var(--td-panel-shadow);
      box-shadow:
        -6px 0 12px rgba(0, 0, 0, 0.5),
        -3px 0 6px rgba(0, 0, 0, 0.3),
        inset 4px 0 8px rgba(0, 0, 0, 0.4);
    }

    .td-sidebar-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 6px 8px;
      margin-top: auto;
      font-size: 10px;
      color: var(--td-text-muted);
      opacity: 0.6;
    }

    .td-sidebar-footer:hover {
      opacity: 1;
    }

    .td-sidebar-footer a {
      color: var(--td-text-secondary);
      text-decoration: none;
      display: flex;
      align-items: center;
    }

    .td-sidebar-footer a:hover {
      color: var(--td-text-primary);
    }

    /* === Panel (WC3 Style) === */
    .td-panel {
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-light);
      border-left: 1px solid var(--td-frame-mid);
      border-right: 1px solid var(--td-frame-dark);
      border-bottom: 2px solid var(--td-frame-dark);
    }

    .td-panel-header {
      padding: 6px 10px;
      background: var(--td-panel-secondary);
      border-bottom: 1px solid var(--td-frame-dark);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .td-panel-content {
      padding: 8px;
    }

    /* === Status Panel === */
    .td-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0;
    }

    .td-stat-label {
      color: var(--td-text-secondary);
      font-size: 10px;
      text-transform: uppercase;
    }

    .td-stat-value {
      color: var(--td-text-primary);
      font-size: 12px;
      font-weight: 600;
    }

    .td-stat-value.td-damage { color: var(--td-red); }
    .td-stat-value.td-kills { color: var(--td-gold); }

    /* === Action Buttons === */
    .td-action-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-teal);
    }

    .td-action-btn:hover:not(:disabled) {
      background: var(--td-frame-mid);
    }

    .td-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .td-action-btn.td-btn-green:not(:disabled) {
      background: var(--td-green);
      color: var(--td-bg-dark);
    }

    .td-action-btn.td-btn-green mat-icon {
      color: var(--td-bg-dark);
    }

    .td-action-btn.td-btn-green:hover:not(:disabled) {
      filter: brightness(1.1);
    }

    .td-build-hint {
      padding: 4px 8px;
      background: var(--td-warn-orange);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      animation: td-pulse 1.5s ease-in-out infinite;
    }

    @keyframes td-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* === Wave Section === */
    .td-wave-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .td-wave-info {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .td-enemy-preview-container {
      flex-shrink: 0;
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 100%);
      border: 1px solid var(--td-frame-dark);
      border-radius: 4px;
      overflow: hidden;
    }

    .td-enemy-preview-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .td-enemy-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--td-warn-orange);
      margin-bottom: 4px;
    }

    .td-wave-stats {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .td-wave-btn {
      margin-top: 4px;
    }

    /* === Build Section === */
    .td-build-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .td-tower-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }

    .td-tower-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: 0;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
      border-radius: 3px;
      overflow: hidden;
    }

    .td-tower-card:hover:not(:disabled) {
      border-color: var(--td-gold-dark);
      box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
    }

    .td-tower-card:disabled,
    .td-tower-card.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .td-tower-preview-canvas {
      width: 100%;
      height: 70px;
      display: block;
      background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 100%);
    }

    .td-tower-card-name {
      display: block;
      padding: 4px 6px;
      font-size: 9px;
      font-weight: 600;
      color: var(--td-text-secondary);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-dark);
    }

    .td-tower-card-cost {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 2px 6px;
      background: var(--td-gold-dark);
      color: var(--td-bg-dark);
      font-size: 9px;
      font-weight: 700;
      border-radius: 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }

    .td-tower-card:hover:not(:disabled) .td-tower-card-name {
      color: var(--td-gold);
    }

    .td-hidden {
      display: none;
    }

    .td-cancel-btn {
      background: var(--td-panel-secondary);
    }

    .td-cancel-btn mat-icon {
      color: var(--td-red);
    }

    .td-cancel-btn:hover {
      background: rgba(244, 67, 54, 0.2);
    }

    .td-cost {
      margin-left: auto;
      padding: 2px 6px;
      background: var(--td-gold-dark);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 700;
      border-radius: 2px;
    }

    /* === Tower Section === */
    .td-tower-panel {
      border-color: var(--td-teal);
    }

    .td-tower-panel .td-panel-header {
      background: linear-gradient(180deg, var(--td-teal) 0%, rgba(0, 188, 212, 0.3) 100%);
      color: var(--td-bg-dark);
    }

    .td-tower-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Stats Grid - 2x2 tiles */
    .td-stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }

    .td-stat-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 8px 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      border-radius: 3px;
    }

    .td-stat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      opacity: 0.7;
    }

    .td-icon-damage { color: #ff6b4a; }
    .td-icon-range { color: var(--td-teal); }
    .td-icon-firerate { color: #ffc107; }
    .td-icon-kills { color: var(--td-gold); }

    .td-stat-tile .td-stat-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--td-text-primary);
    }

    .td-stat-tile .td-val-damage { color: #ff6b4a; }
    .td-stat-tile .td-val-kills { color: var(--td-gold); }

    .td-stat-tile .td-stat-label {
      font-size: 8px;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* === Upgrade Section === */
    .td-upgrades-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .td-upgrade-tile {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px;
      background: linear-gradient(135deg, rgba(255, 193, 7, 0.15) 0%, rgba(255, 193, 7, 0.05) 100%);
      border: 2px solid var(--td-gold-dark);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .td-upgrade-tile:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(255, 193, 7, 0.25) 0%, rgba(255, 193, 7, 0.1) 100%);
      border-color: var(--td-gold);
      box-shadow: 0 0 12px rgba(255, 193, 7, 0.3);
    }

    .td-upgrade-tile:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: var(--td-frame-mid);
      background: var(--td-panel-secondary);
    }

    .td-upgrade-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--td-gold);
    }

    .td-upgrade-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }

    .td-upgrade-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--td-text-primary);
    }

    .td-upgrade-desc {
      font-size: 9px;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .td-upgrade-cost {
      padding: 4px 10px;
      background: var(--td-gold);
      color: var(--td-bg-dark);
      font-size: 12px;
      font-weight: 700;
      border-radius: 3px;
    }

    /* === Sell Button (subtle) === */
    .td-sell-tile {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: transparent;
      border: 1px solid var(--td-frame-dark);
      border-radius: 3px;
      color: var(--td-text-muted);
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-sell-tile mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--td-text-muted);
    }

    .td-sell-tile:hover {
      background: rgba(244, 67, 54, 0.1);
      border-color: var(--td-red);
      color: var(--td-text-secondary);
    }

    .td-sell-tile:hover mat-icon {
      color: var(--td-red);
    }

    .td-sell-value {
      margin-left: auto;
      padding: 2px 6px;
      background: var(--td-green);
      color: var(--td-bg-dark);
      font-size: 10px;
      font-weight: 600;
      border-radius: 2px;
    }
  `,
})
export class GameSidebarComponent implements AfterViewInit, OnDestroy {
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Update enemy preview when enemy type changes
    effect(() => {
      // Track currentEnemyConfig to trigger effect when it changes
      this.currentEnemyConfig();
      // Wait for the preview to be initialized
      if (this.enemyPreviewCanvas?.nativeElement) {
        this.initEnemyPreview();
      }
    });
  }

  // Inputs
  readonly gameState = input.required<GameStateManager>();
  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  // Current enemy config from wave debug service
  readonly currentEnemyConfig = this.waveDebug.currentEnemyConfig;

  // Ad banner should be compact during active wave
  readonly adCompact = computed(() => this.waveActive());

  // Outputs
  readonly startWave = output<void>();
  readonly cancelBuild = output<void>();
  readonly selectTower = output<TowerTypeId>();
  readonly sellTower = output<void>();
  readonly upgradeTower = output<{ tower: Tower; upgradeId: UpgradeId }>();

  // Canvas refs for previews
  @ViewChild('enemyPreviewCanvas') enemyPreviewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChildren('towerPreviewCanvas') towerPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initPreviews(), 100);

    // Re-initialize tower previews when the list changes
    this.towerPreviewCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initTowerPreviews(), 50);
      });
  }

  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  private initPreviews(): void {
    this.modelPreview.initialize();
    this.initEnemyPreview();
    this.initTowerPreviews();
  }

  private initEnemyPreview(): void {
    if (!this.enemyPreviewCanvas?.nativeElement) return;

    const enemyConfig = this.currentEnemyConfig();
    this.modelPreview.createPreview(
      'enemy-preview',
      this.enemyPreviewCanvas.nativeElement,
      {
        modelUrl: enemyConfig.modelUrl,
        scale: enemyConfig.scale * 0.5,
        rotationSpeed: 0.4,
        cameraDistance: 7,
        cameraAngle: Math.PI / 12,
        animationName: enemyConfig.walkAnimation || enemyConfig.idleAnimation || undefined,
        animationTimeScale: 0.7,
        lightIntensity: 1.3,
        groundModel: true,
      }
    );
  }

  private initTowerPreviews(): void {
    if (!this.towerPreviewCanvases) return;

    this.towerPreviewCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const towerId = canvas.getAttribute('data-tower-id') as TowerTypeId;
      if (!towerId) return;

      const towerConfig = TOWER_TYPES[towerId];
      if (!towerConfig) return;

      // Use fixed preview scale (independent of game world scale)
      // Use previewScale if defined, otherwise calculate from scale
      const previewScale = towerConfig.previewScale
        ?? (towerConfig.modelUrl.endsWith('.fbx') ? 0.032 : towerConfig.scale * 0.4);

      this.modelPreview.createPreview(
        `tower-preview-${towerId}`,
        canvas,
        {
          modelUrl: towerConfig.modelUrl,
          scale: previewScale,
          rotationSpeed: 0.4,
          cameraDistance: 20,
          cameraAngle: Math.PI / 5,
          lightIntensity: 1.2,
        }
      );
    });
  }

  onUpgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower, upgradeId });
  }
}
