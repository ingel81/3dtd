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
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import {
  TargetingStrategyConfig,
  AirSubStrategyConfig,
  TowerTypeConfig,
  TowerTypeId,
  UpgradeId,
  TOWER_TYPES,
  TargetingStrategy,
  TARGETING_STRATEGIES,
  AirSubStrategy,
  AIR_SUB_STRATEGIES,
} from '../../configs/tower-types.config';
import { DAMAGE_TYPE_UI, ARMOR_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import { ResearchConfig, ResearchId, RESEARCH_CATEGORIES } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/model-preview.service';
import { WaveDebugService, WaveGroupDisplay } from '../../services/wave-debug.service';
import { TowerDebugService } from '../../services/tower-debug.service';
import { EnemyDebugService } from '../../services/enemy-debug.service';
import { EnemyTypeId, ENEMY_TYPES } from '../../models/enemy-types';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      height: 100%;
      max-height: 100%;
      overflow: hidden;
    }

    .td-sidebar-content {
      flex: 1;
      min-height: 0;
      background:
        linear-gradient(rgba(15, 19, 15, 0.75), rgba(15, 19, 15, 0.75)),
        url('/assets/images/backgrounds/stone-wall.jpg') repeat;
      background-size: auto, 100px 100px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      overflow: hidden;
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
      flex-direction: column;
      align-items: center;
      margin-top: auto;
      font-size: 10px;
      color: var(--td-text-muted);
    }

    .td-sidebar-footer-bottom {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 6px 8px;
      opacity: 0.6;
    }

    .td-sidebar-footer-bottom:hover {
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

    .td-attributions-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 6px 8px;
      background: none;
      border: none;
      border-top: 1px solid var(--td-frame-dark);
      color: var(--td-text-muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      cursor: pointer;
      opacity: 0.6;
      transition: all 0.15s ease;
    }

    .td-attributions-btn:hover {
      opacity: 1;
      color: var(--td-text-secondary);
      background: var(--td-panel-secondary);
    }

    .td-attributions-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    /* === Panel (WC3 Style) === */
    .td-panel {
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-light);
      border-left: 1px solid var(--td-frame-mid);
      border-right: 1px solid var(--td-frame-dark);
      border-bottom: 2px solid var(--td-frame-dark);
    }
    /* Non-wave panels fill available space and allow internal scroll */
    .td-panel:not(.td-wave-panel) {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .td-panel:not(.td-wave-panel) > .td-panel-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      ${TD_SCROLLBAR_STYLES}
    }
    .td-panel:not(.td-wave-panel) > .td-panel-content::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }
    .td-panel:not(.td-wave-panel) > .td-panel-content::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }
    .td-panel:not(.td-wave-panel) > .td-panel-content::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }
    .td-panel:not(.td-wave-panel) > .td-panel-content::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
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

    .td-wave-panel {
      border-left: 3px solid var(--td-teal);
    }

    .td-wave-panel .td-panel-header {
      background: linear-gradient(90deg, rgba(111, 183, 165, 0.15) 0%, var(--td-panel-secondary) 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .td-mixed-badge {
      font-size: 9px;
      color: var(--td-warn-orange);
      background: rgba(255, 152, 0, 0.15);
      padding: 1px 5px;
      border-radius: 2px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .td-panel:not(.td-wave-panel):not(.td-tower-panel) .td-panel-header {
      background: linear-gradient(90deg, rgba(201, 164, 76, 0.1) 0%, var(--td-panel-secondary) 100%);
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
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .td-stat-value.td-damage { color: var(--td-red); }
    .td-stat-value.td-kills { color: var(--td-gold); }
    .td-stat-value.td-val-count { color: var(--td-warn-orange); }
    .td-stat-value.td-val-modified { color: var(--td-teal); }

    .td-multiplier {
      font-size: 9px;
      color: var(--td-gold);
      background: rgba(255, 193, 7, 0.15);
      padding: 1px 4px;
      border-radius: 2px;
      font-weight: 700;
    }

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
      background: var(--td-panel-secondary);
      color: var(--td-teal);
      border-color: var(--td-teal);
    }

    .td-action-btn.td-btn-green mat-icon {
      color: var(--td-teal);
    }

    .td-action-btn.td-btn-green:hover:not(:disabled) {
      background: rgba(111, 183, 165, 0.15);
    }

    .td-action-btn.td-btn-green.td-wave-btn:not(:disabled) {
      background: linear-gradient(180deg, rgba(111, 183, 165, 0.2) 0%, var(--td-panel-secondary) 100%);
      font-size: 13px;
      font-weight: 700;
      padding: 10px;
      border: 1px solid var(--td-teal);
      letter-spacing: 1px;
      color: var(--td-teal);
    }

    .td-action-btn.td-btn-green.td-wave-btn:not(:disabled) mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .td-action-btn.td-btn-green.td-wave-btn:hover:not(:disabled) {
      background: linear-gradient(180deg, rgba(111, 183, 165, 0.3) 0%, rgba(111, 183, 165, 0.1) 100%);
      box-shadow: 0 0 12px rgba(111, 183, 165, 0.3);
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

    .td-wave-btn {
      margin-top: 4px;
    }

    /* === Wave Enemy List === */
    .td-enemy-group-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .td-enemy-group-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: default;
      padding: 2px;
      border-radius: 4px;
      transition: background 0.15s;
      padding: 4px;
      border-radius: 3px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
    }

    .td-enemy-group-row:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .td-group-preview-container {
      width: 64px;
      height: 64px;
      flex-shrink: 0;
      background: linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 100%);
      border: 1px solid var(--td-frame-dark);
      border-radius: 4px;
      overflow: hidden;
    }

    .td-group-preview-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .td-group-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .td-group-info-header {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    .td-group-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--td-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td-group-count {
      font-size: 10px;
      font-weight: 700;
      color: var(--td-warn-orange);
    }
    .td-group-stats {
      display: flex;
      gap: 8px;
    }
    .td-group-stat {
      font-size: 9px;
      color: var(--td-text-muted);
    }
    .td-group-armor {
      display: flex;
      gap: 6px;
      font-size: 9px;
      color: var(--td-text-secondary);
    }
    .td-group-weak {
      color: var(--td-gold-dark);
      font-style: italic;
    }

    /* === Build Section === */
    .td-build-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
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

    /* Locked tower — silhouette effect */
    .td-tower-locked {
      opacity: 0.5;
      cursor: default;
      pointer-events: auto;
    }
    .td-tower-locked .td-silhouette {
      filter: brightness(0) saturate(0);
      opacity: 0.3;
    }
    .td-tower-locked .td-tower-card-name {
      color: var(--td-text-muted);
    }
    .td-lock-icon {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -70%);
      font-size: 24px;
      color: var(--td-text-muted);
      opacity: 0.7;
    }

    .td-tower-preview-canvas {
      width: 100%;
      height: 80px;
      display: block;
      background: linear-gradient(180deg, rgba(30,40,30,0.3) 0%, rgba(10,15,10,0.5) 100%);
    }

    .td-tower-card-name {
      display: block;
      padding: 5px 6px;
      font-size: 11px;
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
      padding: 3px 8px;
      background: var(--td-gold);
      color: var(--td-bg-dark);
      font-size: 11px;
      font-weight: 700;
      border-radius: 2px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }

    .td-tower-card:hover:not(:disabled) .td-tower-card-name {
      color: var(--td-gold);
    }

    .td-hidden {
      display: none !important;
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
    .td-tower-panel .td-panel-header {
      background: linear-gradient(180deg, var(--td-teal) 0%, rgba(0, 188, 212, 0.3) 100%);
      color: var(--td-bg-dark);
    }

    .td-tower-section {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 52px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
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

    .td-icon-damage { color: var(--td-health-red); }
    .td-icon-range { color: var(--td-teal); }
    .td-icon-firerate { color: var(--td-gold); }
    .td-icon-kills { color: var(--td-gold); }

    .td-stat-tile .td-stat-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--td-text-primary);
    }

    .td-stat-tile .td-val-damage { color: var(--td-health-red); }
    .td-stat-tile .td-val-kills { color: var(--td-gold); }

    .td-stat-tile .td-stat-label {
      font-size: 8px;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* === Targeting Strategy Row === */
    .td-targeting-row {
      display: flex;
      gap: 4px;
    }

    .td-targeting-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      border-radius: 3px;
      color: var(--td-text-muted);
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .td-targeting-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .td-targeting-btn:hover {
      border-color: var(--td-teal);
      color: var(--td-text-secondary);
    }

    .td-targeting-btn.active {
      border-color: var(--td-teal);
      background: rgba(0, 188, 212, 0.15);
      color: var(--td-teal);
      box-shadow: 0 0 6px rgba(0, 188, 212, 0.3);
    }

    .td-sub-targeting-row {
      padding-top: 2px;
      border-top: 1px dashed var(--td-frame-dark);
    }

    /* === Upgrade Section === */
    .td-upgrades-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 120px;
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

    /* Tier-locked upgrades (requires further research) */
    .td-upgrade-tile.td-upgrade-tier-locked {
      opacity: 0.45;
      border-color: var(--td-frame-dark);
      background: var(--td-panel-shadow);
    }
    .td-upgrade-tile.td-upgrade-tier-locked .td-upgrade-icon {
      color: var(--td-text-muted);
    }

    .td-upgrade-tier-badge {
      display: inline-block;
      padding: 1px 5px;
      margin-left: 4px;
      font-size: 9px;
      font-weight: 700;
      color: var(--td-bg-dark);
      background: var(--td-gold-dark);
      border-radius: 2px;
      vertical-align: middle;
    }
    .td-upgrade-tier-locked .td-upgrade-tier-badge {
      background: var(--td-frame-mid);
      color: var(--td-text-muted);
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
    .td-sell-section {
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: 8px;
      margin-top: 0;
      padding-top: 6px;
      border-top: 1px dashed var(--td-frame-dark);
    }

    /* Inline variant for Research Center — flows after tree, no overlay */
    .td-sell-section-inline {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed var(--td-frame-dark);
    }

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

    /* === Damage Type Badge === */
    .td-damage-type-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      margin-bottom: 6px;
      border: 1px solid;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--td-text-secondary);
      background: rgba(0,0,0,0.2);
    }

    /* === Research Panel === */
    .td-research-slots-header {
      font-size: 11px;
      color: var(--td-text-muted);
      padding: 4px 0;
      border-bottom: 1px solid var(--td-frame-dark);
      margin-bottom: 6px;
    }
    .td-research-active {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      margin-bottom: 4px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-teal);
      border-radius: 3px;
    }
    .td-research-active-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .td-research-active-name {
      font-size: 10px;
      font-weight: 600;
      color: var(--td-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .td-research-active-time {
      font-size: 9px;
      color: var(--td-teal);
    }
    .td-research-progress-bar {
      flex: 1;
      height: 4px;
      background: var(--td-frame-dark);
      border-radius: 2px;
      overflow: hidden;
    }
    .td-research-progress-fill {
      height: 100%;
      background: var(--td-teal);
      transition: width 0.3s linear;
    }
    .td-research-cancel-btn {
      background: none;
      border: 1px solid var(--td-red, #cc3333);
      color: var(--td-red, #cc3333);
      cursor: pointer;
      border-radius: 3px;
      padding: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .td-research-cancel-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .td-research-cancel-btn:hover { background: rgba(204,51,51,0.2); }

    /* Research Tree Nodes */
    .td-research-node {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      margin-bottom: 3px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .td-research-node:disabled { cursor: not-allowed; opacity: 0.5; }
    .td-research-node-icon { font-size: 18px; width: 18px; height: 18px; }
    .td-research-node-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .td-research-node-name { font-size: 10px; font-weight: 600; color: var(--td-text-secondary); }
    .td-research-node-meta { font-size: 9px; color: var(--td-text-muted); }

    .td-research-completed {
      border-color: var(--td-green);
      opacity: 0.7;
    }
    .td-research-completed .td-research-node-icon { color: var(--td-green); }
    .td-research-available {
      border-color: var(--td-gold-dark);
    }
    .td-research-available:hover:not(:disabled) {
      border-color: var(--td-gold);
      box-shadow: 0 0 8px rgba(255,215,0,0.2);
    }
    .td-research-available .td-research-node-icon { color: var(--td-gold); }
    .td-research-active { border-color: var(--td-teal); }
    .td-research-active .td-research-node-icon { color: var(--td-teal); }
    .td-research-locked {
      opacity: 0.4;
    }
    .td-research-locked .td-research-node-icon { color: var(--td-text-muted); }
  `,
})
export class GameSidebarComponent implements AfterViewInit, OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Update enemy group previews when wave groups change
    effect(() => {
      const groups = this.currentWaveGroups();
      // Also track debug overrides for preview updates
      for (const g of groups) {
        this.enemyDebug.allOverrides()[g.enemyType];
      }
      if (this.mixedEnemyCanvases?.length) {
        this.initMixedEnemyPreviews();
      }
    });

    // Update tower previews when debug overrides change
    effect(() => {
      // Track selected tower and its overrides
      const typeId = this.towerDebug.selectedTowerId();
      const overrides = this.towerDebug.allOverrides()[typeId];
      // Refresh only the selected tower's preview
      if (this.towerPreviewCanvases) {
        this.refreshTowerPreview(typeId, overrides.previewScale);
      }
    });
  }

  // Store — single source of truth
  readonly store = inject(TowerDefenseStore);

  // Inputs
  readonly towerTypes = input.required<TowerTypeConfig[]>();
  readonly buildMode = input.required<boolean>();
  readonly waveActive = input.required<boolean>();
  readonly isGameOver = input.required<boolean>();

  // Wave group display (with fallback for initial state before first wave)
  readonly currentWaveGroups = computed(() => {
    const groups = this.waveDebug.currentWaveGroups();
    if (groups.length > 0) return groups;
    // Fallback: show currently selected enemy type from debug panel
    const config = this.waveDebug.currentEnemyConfig();
    return [{
      enemyType: config.id as EnemyTypeId,
      name: config.name,
      count: this.waveDebug.enemyCount(),
      baseHp: config.baseHp,
      actualHp: config.baseHp,
      baseSpeed: config.baseSpeed,
      actualSpeed: config.baseSpeed,
      healthMultiplier: 1,
      speedMultiplier: 1,
      spawnDelay: this.waveDebug.spawnDelay(),
    }];
  });
  readonly isMixedWave = this.waveDebug.isMixedWave;

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
  readonly damageTypeUI = DAMAGE_TYPE_UI;

  isTowerUnlocked(towerId: TowerTypeId): boolean {
    return this.researchStore.isTowerUnlocked(towerId);
  }

  getTowerLockTooltip(towerId: TowerTypeId): string {
    const name = this.researchStore.getRequiredResearchName(towerId);
    return name ? `Requires: ${name}` : 'Locked';
  }

  isResearchCenterPlaced(): boolean {
    return this.researchStore.centerPlaced();
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

  /**
   * Get the required upgrade tier for the NEXT level of this upgrade.
   * Level 0→1 = Tier 1 (always free)
   * Level 1→2 = Tier 2 (requires Advanced Weaponry)
   * Level 2+ = Tier 3 (requires Master Engineering)
   */
  getRequiredUpgradeTier(tower: Tower, upgradeId: UpgradeId): number {
    const currentLevel = tower.getUpgradeLevel(upgradeId);
    if (currentLevel >= 2) return 3;
    if (currentLevel >= 1) return 2;
    return 1;
  }

  isUpgradeTierUnlocked(tower: Tower, upgradeId: UpgradeId): boolean {
    const requiredTier = this.getRequiredUpgradeTier(tower, upgradeId);
    return this.researchStore.maxUpgradeTier() >= requiredTier;
  }

  getUpgradeTierLockReason(tower: Tower, upgradeId: UpgradeId): string | null {
    if (this.isUpgradeTierUnlocked(tower, upgradeId)) return null;
    const tier = this.getRequiredUpgradeTier(tower, upgradeId);
    if (tier === 2) return 'Requires: Advanced Weaponry';
    if (tier === 3) return 'Requires: Master Engineering';
    return null;
  }

  getMissingPrereqs(id: ResearchId): string {
    const config = getResearch(id);
    if (!config) return '';
    const missing = config.prerequisites
      .filter(p => !this.researchStore.completedResearches().has(p))
      .map(p => getResearch(p)?.name ?? p);
    return missing.join(', ');
  }

  // Canvas refs for previews
  @ViewChildren('towerPreviewCanvas') towerPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChildren('mixedEnemyCanvas') mixedEnemyCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private activeMixedPreviewIds: string[] = [];

  ngAfterViewInit(): void {
    // Initialize previews after DOM is ready
    setTimeout(() => this.initPreviews(), 100);

    // Re-initialize tower previews when the list changes
    this.towerPreviewCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initTowerPreviews(), 50);
      });

    // Initialize mixed enemy previews when canvases appear
    this.mixedEnemyCanvases.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        setTimeout(() => this.initMixedEnemyPreviews(), 100);
      });
  }

  ngOnDestroy(): void {
    this.modelPreview.dispose();
  }

  private initPreviews(): void {
    this.modelPreview.initialize();
    this.initMixedEnemyPreviews();
    this.initTowerPreviews();
  }

  private initTowerPreviews(): void {
    if (!this.towerPreviewCanvases) return;

    this.towerPreviewCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const towerId = canvas.getAttribute('data-tower-id') as TowerTypeId;
      if (!towerId) return;

      const towerConfig = TOWER_TYPES[towerId];
      if (!towerConfig) return;

      // Sync canvas resolution to actual CSS display size to avoid stretching
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * devicePixelRatio);
        canvas.height = Math.round(rect.height * devicePixelRatio);
      }

      // Use previewScale from debug overrides for live updates
      const overrides = this.towerDebug.allOverrides()[towerId];
      const previewScale = overrides.previewScale;

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

  /**
   * Refresh a specific tower's preview with new scale
   */
  private refreshTowerPreview(towerId: TowerTypeId, previewScale: number): void {
    if (!this.towerPreviewCanvases) return;

    const canvasRef = this.towerPreviewCanvases.find((ref) =>
      ref.nativeElement.getAttribute('data-tower-id') === towerId
    );
    if (!canvasRef) return;

    const towerConfig = TOWER_TYPES[towerId];
    if (!towerConfig) return;

    // Sync canvas resolution to actual CSS display size
    const canvas = canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width * devicePixelRatio);
      canvas.height = Math.round(rect.height * devicePixelRatio);
    }

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
  }

  // Targeting strategy config for template
  readonly targetingStrategies = TARGETING_STRATEGIES;
  readonly airSubStrategies = AIR_SUB_STRATEGIES;

  getTargetingStrategies(tower: Tower): TargetingStrategyConfig[] {
    const canTargetAir = tower.typeConfig.canTargetAir ?? false;
    const canTargetGround = tower.typeConfig.canTargetGround ?? true;

    return this.targetingStrategies.filter((strategy) => {
      if (strategy.id === 'air-priority') {
        return canTargetAir && canTargetGround;
      }
      return true;
    });
  }

  onChangeTargeting(tower: Tower, strategy: TargetingStrategy): void {
    this.changeTargeting.emit({ tower, strategy });
  }

  onChangeAirSubStrategy(tower: Tower, strategy: AirSubStrategy): void {
    this.changeAirSubStrategy.emit({ tower, strategy });
  }

  onUpgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    this.upgradeTower.emit({ tower, upgradeId });
  }

  getMixedTotalCount(): number {
    return this.currentWaveGroups().reduce((sum, g) => sum + g.count, 0);
  }

  getArmorIcon(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].icon : '';
  }

  getArmorLabel(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].label : '';
  }

  getArmorWeakTo(enemyType: EnemyTypeId): string {
    const config = ENEMY_TYPES[enemyType];
    return config?.armorType ? ARMOR_TYPE_UI[config.armorType].weakTo : '';
  }

  getGroupTooltip(group: WaveGroupDisplay): string {
    let tip = `HP: ${group.actualHp}`;
    if (group.healthMultiplier !== 1) {
      tip += ` (×${group.healthMultiplier.toFixed(1)})`;
    }
    tip += `\nSpeed: ${group.actualSpeed.toFixed(1)}m/s`;
    if (group.speedMultiplier !== 1) {
      tip += ` (×${group.speedMultiplier.toFixed(2)})`;
    }
    // Armor type + weakness info
    const enemyConfig = ENEMY_TYPES[group.enemyType];
    if (enemyConfig?.armorType) {
      const armorMeta = ARMOR_TYPE_UI[enemyConfig.armorType];
      tip += `\nArmor: ${armorMeta.icon} ${armorMeta.label}`;
      tip += `\nWeak to: ${armorMeta.weakTo}`;
    }
    return tip;
  }

  private initMixedEnemyPreviews(): void {
    if (!this.mixedEnemyCanvases) return;

    // Destroy old mixed previews
    for (const id of this.activeMixedPreviewIds) {
      this.modelPreview.destroyPreview(id);
    }
    this.activeMixedPreviewIds = [];

    const groups = this.currentWaveGroups();
    this.mixedEnemyCanvases.forEach((canvasRef) => {
      const canvas = canvasRef.nativeElement;
      const idx = parseInt(canvas.getAttribute('data-group-index') ?? '0', 10);
      const group = groups[idx];
      if (!group) return;

      const enemyConfig = ENEMY_TYPES[group.enemyType];
      if (!enemyConfig) return;

      const overrides = this.enemyDebug.getOverrides(group.enemyType);
      const previewId = `mixed-enemy-${idx}`;
      this.activeMixedPreviewIds.push(previewId);

      this.modelPreview.createPreview(previewId, canvas, {
        modelUrl: enemyConfig.modelUrl,
        scale: overrides?.previewScale ?? enemyConfig.previewScale ?? enemyConfig.scale * 0.5,
        rotationSpeed: 0.4,
        cameraDistance: overrides?.previewCameraDistance ?? enemyConfig.previewCameraDistance ?? 7,
        cameraAngle: overrides?.previewCameraAngle ?? enemyConfig.previewCameraAngle ?? Math.PI / 12,
        offsetY: overrides?.previewOffsetY ?? enemyConfig.previewOffsetY ?? 0,
        animationName: enemyConfig.walkAnimation || enemyConfig.idleAnimation || undefined,
        animationTimeScale: 0.7,
        lightIntensity: 1.3,
        groundModel: true,
      });
    });
  }

  openAttributions(): void {
    this.dialog.open(AttributionsDialogComponent, {
      panelClass: 'td-dialog-panel',
    });
  }
}
