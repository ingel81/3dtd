import {
  Component,
  input,
  output,
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import {
  TargetingStrategyConfig,
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
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES, ArmorType, DamageType } from '../../configs/combat/combat.types';
import { RESEARCH_TREE, getResearch } from '../../configs/research/research-tree.config';
import { ResearchConfig, ResearchId } from '../../configs/research/research.types';
import { Tower } from '../../entities/tower.entity';
import { ModelPreviewService } from '../../services/model-preview.service';
import { WaveDebugService, WaveGroupDisplay } from '../../services/wave-debug.service';
import { TowerDebugService } from '../../services/tower-debug.service';
import { EnemyDebugService } from '../../services/enemy-debug.service';
import { EnemyTypeId, ENEMY_TYPES } from '../../models/enemy-types';
import { templateObjectForWave } from '../../ai/core/wave-curriculum';
import { AttributionsDialogComponent } from '../attributions-dialog/attributions-dialog.component';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { TdRichTooltipDirective } from '../tooltip/td-rich-tooltip.directive';
import { TdTooltipData } from '../tooltip/tooltip-data.types';

@Component({
  selector: 'app-game-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTooltipModule,
    TdIconComponent,
    TdRichTooltipDirective,
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

    /* Sidebar background — refined: NO stone texture, NO inner panel frames.
     * Sidebar IS one panel; sections are split only by 1px border-bottom rules.
     * (Mockup ref: tmp/td-artboards.jsx HudSidebar.) */
    .td-sidebar-content {
      flex: 1;
      min-height: 0;
      background: var(--td-bg-dark);
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
      overflow: hidden;
      position: relative;
      z-index: 1;
      border-left: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 1px 0 0 rgba(122, 133, 128, 0.22),
        -2px 0 12px rgba(0, 0, 0, 0.5);
    }

    .td-sidebar-footer {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      margin-top: auto;
      flex-shrink: 0;
      width: 100%;
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


    /* === Section (was .td-panel) — flat, no frames, just dividers ===
     * The sidebar is a single panel; each section is just a vertical strip
     * separated by a 1px frame-dark border-bottom. No bevel, no shadow. */
    .td-panel {
      background: transparent;
      border: 0;
      box-shadow: none;
      border-bottom: 1px solid var(--td-frame-dark);
    }
    .td-panel:last-of-type {
      border-bottom: 0;
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

    /* Section heads — flat label with mono caps + rune-amber color. */
    .td-panel-header {
      position: relative;
      padding: 12px 14px 8px;
      background: transparent;
      border: 0;
      flex-shrink: 0;
      font-family: var(--td-font-mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.18em;
      color: var(--td-rune-amber);
      text-transform: uppercase;
    }

    /* Build section gets a trailing gold gradient rule next to the label
     * (matches tmp/td-artboards.jsx HudSidebar — only the BUILD header). */
    .td-panel:not(.td-wave-panel):not(.td-tower-panel):not(.td-research-panel) .td-panel-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .td-panel:not(.td-wave-panel):not(.td-tower-panel):not(.td-research-panel) .td-panel-header::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg,
        var(--td-rune-amber-muted) 0%,
        transparent 100%);
      pointer-events: none;
    }

    .td-wave-panel .td-panel-header {
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


    .td-panel-content {
      padding: 4px 14px 14px;
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
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.18),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 1px 0 rgba(0, 0, 0, 0.6);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: box-shadow 0.18s ease, background 0.15s ease, color 0.15s ease;
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
      background: linear-gradient(
        180deg,
        var(--td-teal-light) 0%,
        var(--td-teal) 55%,
        var(--td-teal-dark) 100%
      );
      font-family: var(--td-font-mono);
      font-size: 13px;
      font-weight: 700;
      padding: 10px;
      border: 1px solid #11140F;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        var(--td-shadow-key);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0E1612;
    }

    .td-action-btn.td-btn-green.td-wave-btn:not(:disabled) mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: #0E1612;
    }

    .td-action-btn.td-btn-green.td-wave-btn:hover:not(:disabled) {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35),
        var(--td-teal-glow);
    }

    /* Curriculum coming-up preview — flat, embedded directly under the
     * Next-Wave button. No quote-block style (no bg, no border-left, no radius).
     * Matches tmp/td-artboards.jsx HudSidebar Coming-Up section. */
    .td-coming-up {
      margin-top: 10px;
      padding: 0;
    }
    .td-coming-up-label {
      font-family: var(--td-font-mono);
      font-size: 9px;
      letter-spacing: 0.18em;
      color: var(--td-text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .td-coming-up-row {
      display: grid;
      grid-template-columns: 26px 1fr auto;
      gap: 8px;
      align-items: center;
      font-family: var(--td-font-mono);
      font-size: 11px;
      padding: 4px 0;
      cursor: help;
    }
    .td-coming-up-wave {
      color: var(--td-rune-amber);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .td-coming-up-name {
      color: var(--td-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td-coming-up-icons {
      font-size: 12px;
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
      /* Button user-agent reset — locked + unlocked share <button>, so heights
       * stay identical in the grid. Without these, native button styles
       * (line-height, intrinsic min-content, appearance) leak into rows. */
      appearance: none;
      -webkit-appearance: none;
      margin: 0;
      text-align: inherit;
      color: inherit;
      font-family: var(--td-font-body);
      font-size: 11px;
      line-height: 1;

      position: relative;
      display: flex;
      flex-direction: column;
      padding: 0;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.13),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 1px 0 rgba(0, 0, 0, 0.6);
      cursor: pointer;
      transition: box-shadow 0.18s ease, border-color 0.18s ease;
      border-radius: 3px;
      overflow: hidden;
    }

    .td-tower-card:hover:not(:disabled) {
      border-color: var(--td-gold-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.13),
        inset 0 -1px 0 var(--td-panel-shadow),
        var(--td-gold-glow);
    }

    .td-tower-card:disabled,
    .td-tower-card.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Locked tower — silhouette effect.
     * Specificity .td-tower-card.td-tower-locked (0,2,0) ≥ :disabled (0,2,0)
     * and order-after wins over the default :disabled rule above. */
    .td-tower-card.td-tower-locked {
      opacity: 0.55;
      cursor: default;
      pointer-events: auto;
    }
    .td-tower-card.td-tower-locked .td-silhouette {
      filter: brightness(0) saturate(0);
      opacity: 0.3;
    }
    .td-tower-card.td-tower-locked .td-tower-card-name {
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

    /* Cost badge — refined: panel-shadow background, coin glyph + value */
    .td-tower-card-cost {
      position: absolute;
      top: 5px;
      right: 5px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 6px 2px 4px;
      background: var(--td-panel-shadow);
      color: var(--td-gold-light);
      font-family: var(--td-font-mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      border: 1px solid var(--td-frame-dark);
      box-shadow: inset 0 1px 0 rgba(74, 84, 77, 0.33);
    }
    .td-coin-glyph {
      width: 9px;
      height: 9px;
      display: block;
      flex-shrink: 0;
    }
    .td-tower-card-cost-value {
      font-variant-numeric: tabular-nums;
    }

    /* Tier indicator — top-left rune-amber diamonds */
    .td-tower-card-tier {
      position: absolute;
      top: 5px;
      left: 5px;
      display: flex;
      gap: 2px;
      pointer-events: none;
      z-index: 2;
    }
    .td-tower-card-tier-mark {
      width: 5px;
      height: 5px;
      background: var(--td-rune-amber);
      transform: rotate(45deg);
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
    }

    /* Hover corner brackets — gold accents at the edges, fade in on hover */
    .td-tower-card-bracket {
      position: absolute;
      width: 8px;
      height: 8px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .td-tower-card-bracket-tl {
      top: -1px; left: -1px;
      border-top: 2px solid var(--td-gold-light);
      border-left: 2px solid var(--td-gold-light);
    }
    .td-tower-card-bracket-tr {
      top: -1px; right: -1px;
      border-top: 2px solid var(--td-gold-light);
      border-right: 2px solid var(--td-gold-light);
    }
    .td-tower-card-bracket-bl {
      bottom: -1px; left: -1px;
      border-bottom: 2px solid var(--td-gold-light);
      border-left: 2px solid var(--td-gold-light);
    }
    .td-tower-card-bracket-br {
      bottom: -1px; right: -1px;
      border-bottom: 2px solid var(--td-gold-light);
      border-right: 2px solid var(--td-gold-light);
    }
    .td-tower-card:hover:not(:disabled) .td-tower-card-bracket {
      opacity: 1;
    }

    .td-tower-card:hover:not(:disabled) .td-tower-card-name {
      color: var(--td-gold-light);
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

    /* === Tower Section ===
     * Header inherits the typographic divider style from .td-panel-header,
     * with a teal accent for the title color (was a heavy teal gradient bar). */
    .td-tower-panel .td-panel-header {
      color: var(--td-teal-light);
    }
    .td-tower-panel .td-panel-header .td-tower-header-name {
      color: var(--td-teal-light);
    }
    /* Phase 5.16: header layout with sell button on the right */
    .td-tower-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-right: 4px;
    }
    .td-tower-header-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td-header-sell-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      border-radius: 3px;
      color: var(--td-gold-light);
      font-family: var(--td-font-mono);
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      transition: color 0.15s, box-shadow 0.18s;
    }
    .td-header-sell-btn:hover {
      color: var(--td-health-red);
      box-shadow: 0 0 0 1px var(--td-health-red);
    }
    .td-header-sell-value {
      font-variant-numeric: tabular-nums;
    }

    .td-tower-section {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    /* Stats Grid — 3×2 (Phase 5.16) with damage-type tile at pos 0 */
    .td-stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .td-stats-grid.td-stats-grid-3 {
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
    }

    .td-stat-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 6px 4px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      border-radius: 3px;
      min-width: 0;
    }
    .td-stat-tile-dmgtype {
      border-width: 1px;
      border-style: solid;
    }
    .td-stat-value-small {
      font-size: 11px !important;
      font-weight: 700;
      letter-spacing: 0.3px;
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
      const overrides = this.enemyDebug.allOverrides();
      for (const g of groups) {
        void overrides[g.enemyType];
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

  // Wave group display — only consumed by the template while a wave is active,
  // so we don't need curriculum-derived or debug-panel fallbacks. The COMING UP
  // panel handles the setup-phase preview separately.
  readonly currentWaveGroups = computed(() => this.waveDebug.currentWaveGroups());
  readonly isMixedWave = this.waveDebug.isMixedWave;

  /**
   * Wave-number shown in the panel header. During an active wave it's the
   * running wave; during build/setup it's the UPCOMING wave (waveNumber+1)
   * so the panel content (enemy preview, next-wave button) matches the label.
   * Avoids the meaningless "WAVE 0" header at game start.
   */
  readonly displayedWaveNumber = computed(() => {
    const n = this.store.waveNumber();
    return this.waveActive() ? n : n + 1;
  });

  /**
   * Phase 5.16: Show next 2 curriculum-forced waves so the player can
   * prepare their defense (e.g. build Anti-Air before W7 bat_swarm).
   * Returns empty array once we're past the curriculum (NN-loop range).
   */
  readonly upcomingWaves = computed(() => {
    const currentWave = this.store.waveNumber();
    const peeks: { wave: number; name: string; description: string; armorIcons: string }[] = [];
    for (const offset of [1, 2]) {
      const w = currentWave + offset;
      const t = templateObjectForWave(w);
      if (!t) continue;
      const armors = new Set<string>();
      let hasAir = false;
      for (const [enemyId] of t.enemies) {
        const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
        if (!cfg) continue;
        armors.add(cfg.armorType);
        if (cfg.isAirUnit) hasAir = true;
      }
      const armorIcons = Array.from(armors)
        .map((a) => ARMOR_TYPE_UI[a as keyof typeof ARMOR_TYPE_UI]?.icon ?? '')
        .filter(Boolean)
        .join(' ') + (hasAir ? ' ✈️' : '');
      peeks.push({
        wave: w,
        name: t.name,
        description: t.description,
        armorIcons,
      });
    }
    return peeks;
  });

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

  /** Map a damage-type to its td-icon name (config holds an emoji glyph). */
  private static readonly DAMAGE_TYPE_TD_ICON: Record<string, string> = {
    physical: 'sword',
    pierce: 'target',
    siege: 'bolt',
    magic: 'bolt',
    fire: 'flame',
    ice: 'splash',
    poison: 'skull',
  };
  damageTypeTdIcon(type: string): string {
    return GameSidebarComponent.DAMAGE_TYPE_TD_ICON[type] ?? 'sword';
  }

  getTowerLockTooltip(towerId: TowerTypeId): string {
    const name = this.researchStore.getRequiredResearchName(towerId);
    return name ? `Requires: ${name}` : 'Locked';
  }

  /**
   * Tier hint for the small rune-amber diamonds in the tower-card top-left.
   * Mirrors the research-tree progression depth, capped at 3:
   *   T1 = starter (archer, research-center)
   *   T2 = first unlock layer (gatling, ice, tentacle, poison)
   *   T3 = deeper unlocks (cannon, fire, magic, rocket)
   */
  private static readonly TOWER_TIER: Record<TowerTypeId, number> = {
    'archer': 1,
    'research-center': 1,
    'dual-gatling': 2,
    'ice': 2,
    'tentacle': 2,
    'poison': 2,
    'cannon': 3,
    'fire': 3,
    'magic': 3,
    'rocket': 3,
  };

  getTowerTier(towerId: TowerTypeId): number {
    return GameSidebarComponent.TOWER_TIER[towerId] ?? 0;
  }

  /**
   * Returns an array sized to the tier, used purely for *ngFor / @for to
   * render the right number of diamond marks. Content is irrelevant.
   */
  tierMarks(towerId: TowerTypeId): unknown[] {
    return new Array(this.getTowerTier(towerId));
  }

  /**
   * Structured tooltip payload for the tower-card rich tooltip.
   * Matches the design refinement spec — header, stat triple, vs-armor table.
   */
  getTowerCardTooltipData(tower: TowerTypeConfig): TdTooltipData | null {
    if (tower.id === 'research-center') {
      return {
        title: 'Research Center',
        category: 'STRUCTURE',
        accent: 'gold',
        flavor: this.isResearchCenterPlaced()
          ? 'Already placed.'
          : 'Unlocks new towers and upgrade tiers.',
      };
    }
    const dmgUi = DAMAGE_TYPE_UI[tower.damageType];
    const matrix = DAMAGE_MATRIX[tower.damageType as DamageType];
    const stats = tower.attackType === 'beam'
      ? [
          { label: 'DPS', value: String(tower.damagePerSecond ?? 0) },
          { label: 'TYPE', value: 'BEAM' },
          { label: 'RANGE', value: `${tower.range}m` },
        ]
      : [
          { label: 'DMG', value: String(tower.damage) },
          { label: 'RATE', value: `${tower.fireRate}/s` },
          { label: 'RANGE', value: `${tower.range}m` },
        ];
    // Armor identity colors per mockup (tmp/td-components.jsx ArmorChip).
    // The dot color reflects the ARMOR TYPE, not the effectiveness; the dim
    // flag (faded row) communicates "weak matchup" instead.
    const armorColor: Record<string, string> = {
      'unarmored': '#7DBE82',
      'light': '#5BA4D9',
      'heavy': '#C46B3A',
      'fortified': '#5A6258',
      'ethereal': '#9A78C7',
    };
    const armor = ARMOR_TYPES.map(a => {
      const mul = matrix[a as ArmorType];
      const meta = ARMOR_TYPE_UI[a as ArmorType];
      return {
        label: meta.label,
        multiplier: `${mul.toFixed(2)}×`,
        color: armorColor[a] ?? 'var(--td-text-muted)',
        dim: mul < 0.7,
      };
    });
    const accentMap: Record<string, TdTooltipData['accent']> = {
      'physical': 'gold',
      'magic': 'teal',
      'fire': 'fire',
      'cold': 'cold',
      'poison': 'poison',
    };
    return {
      title: tower.name,
      category: dmgUi.label.toUpperCase(),
      accent: accentMap[tower.damageType] ?? 'gold',
      stats,
      armorTitle: 'vs Armor',
      armor,
    };
  }

  /**
   * Phase 5.16: Legacy string-based tooltip — kept as a fallback / for places
   * that haven't migrated to the rich tooltip directive yet.
   */
  getTowerCardTooltip(tower: TowerTypeConfig): string {
    if (tower.id === 'research-center') {
      return this.isResearchCenterPlaced()
        ? 'Already placed'
        : 'RESEARCH CENTER\nUnlocks new towers and upgrade tiers';
    }
    const dmgUi = DAMAGE_TYPE_UI[tower.damageType];
    const dps = tower.attackType === 'beam'
      ? `${tower.damagePerSecond ?? 0} DPS`
      : `${tower.damage} DMG · ${tower.fireRate}/s`;
    const sep = '────────────────────────';
    const lines: string[] = [
      `${tower.name.toUpperCase()}  ·  ${dmgUi.icon} ${dmgUi.label}`,
      sep,
      `${dps}    RANGE ${tower.range}m`,
      sep,
      'VS ARMOR',
    ];
    const matrix = DAMAGE_MATRIX[tower.damageType as DamageType];
    for (const armor of ARMOR_TYPES) {
      const mul = matrix[armor as ArmorType];
      const armorMeta = ARMOR_TYPE_UI[armor as ArmorType];
      const symbol = mul >= 1.5 ? '✓✓' : mul >= 1.2 ? '✓ ' : mul < 0.7 ? '✗ ' : '· ';
      const label = armorMeta.label.padEnd(10, ' ');
      lines.push(`  ${symbol} ${armorMeta.icon} ${label} ${mul.toFixed(2)}×`);
    }
    return lines.join('\n');
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
   * Phase 5.16: 25-level tracks gated in 5-level bands.
   *   L1-5  = Tier 1 (always free)
   *   L6-10 = Tier 2 (requires Advanced Weaponry)
   *   L11-15 = Tier 3 (requires Master Engineering)
   *   L16-20 = Tier 4 (requires Advanced Engineering)
   *   L21-25 = Tier 5 (requires Transcendent Tech)
   */
  getRequiredUpgradeTier(tower: Tower, upgradeId: UpgradeId): number {
    const currentLevel = tower.getUpgradeLevel(upgradeId);
    if (currentLevel >= 20) return 5;
    if (currentLevel >= 15) return 4;
    if (currentLevel >= 10) return 3;
    if (currentLevel >= 5) return 2;
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
    if (tier === 4) return 'Requires: Advanced Engineering';
    if (tier === 5) return 'Requires: Transcendent Tech';
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

  /**
   * Compute effective DPS for the tower-detail tile. Beam towers (Fire) use
   * damagePerSecond directly; projectile towers use damage × fireRate.
   */
  getDps(tower: Tower): number {
    const cfg = tower.typeConfig;
    if (cfg.attackType === 'beam') {
      return cfg.damagePerSecond ?? 0;
    }
    return tower.combat.damage * tower.combat.fireRate;
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
    const enemyConfig = ENEMY_TYPES[group.enemyType];
    if (enemyConfig?.armorType) {
      const armorMeta = ARMOR_TYPE_UI[enemyConfig.armorType];
      tip += `\nArmor: ${armorMeta.icon} ${armorMeta.label}`;
      // Concrete damage multipliers — sorted by effectiveness so best/worst pop.
      const armor = enemyConfig.armorType as ArmorType;
      const rows: { type: string; icon: string; mul: number }[] = [];
      for (const dt of Object.keys(DAMAGE_MATRIX) as DamageType[]) {
        const dtUi = DAMAGE_TYPE_UI[dt];
        rows.push({ type: dtUi.label, icon: dtUi.icon, mul: DAMAGE_MATRIX[dt][armor] });
      }
      rows.sort((a, b) => b.mul - a.mul);
      tip += '\nDamage taken:';
      for (const r of rows) {
        const symbol = r.mul >= 1.5 ? '✓✓' : r.mul >= 1.2 ? '✓' : r.mul < 0.7 ? '✗' : '·';
        tip += `\n  ${symbol} ${r.icon} ${r.type}: ${r.mul.toFixed(2)}×`;
      }
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
