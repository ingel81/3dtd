import { Component, inject, ChangeDetectionStrategy, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { WaveDebugService } from '../../services/debug/wave-debug.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { EnemyTypeId } from '../../configs/enemy-types.config';
import { isBossWave, templateObjectForWave } from '../../configs/campaign.config';
import { bossVariantForWave } from '../../configs/boss-variants.config';
import { SpawnPattern } from '../../director/spawn-schedule-builder';
import { TdIconComponent } from '../icon/icon.component';
import { TowerDefenseStore } from '../../store/tower-defense.store';

const PATTERN_LABELS: Record<SpawnPattern, string> = {
  'interleaved': 'Interleaved',
  'sequential': 'Sequential',
  'clustered': 'Clustered',
  'random': 'Random',
  'front-loaded': 'Front-loaded',
  'back-loaded': 'Back-loaded',
  'wave-in-wave': 'Wave-in-Wave',
};

const PATTERN_ICONS: Record<SpawnPattern, string> = {
  'interleaved': 'shuffle',
  'sequential': 'sliders',
  'clustered': 'grid',
  'random': 'random',
  'front-loaded': 'arrowUp',
  'back-loaded': 'caret',
  'wave-in-wave': 'wave',
};

/** Highest wave the jump field takes */
const MAX_JUMP_WAVE = 999;

@Component({
  selector: 'app-wave-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wave-debugger.component.html',
  styleUrl: './wave-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class WaveDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);
  private readonly store = inject(TowerDefenseStore);
  /** Director's reasons for the wave in play; null for waves it did not plan. */
  readonly explanation = this.store.waveExplanation;

  readonly eventBus = input<GameEventBus>();

  readonly patternLabels = PATTERN_LABELS;
  readonly patternIcons = PATTERN_ICONS;

  // === Jump to wave (dev cheat, GameStateManager.jumpToWave) ===

  readonly maxJumpWave = MAX_JUMP_WAVE;
  /** The wave the next start should be */
  readonly jumpWave = signal(35);
  /** Pay what the skipped waves would have paid */
  readonly jumpGrantGold = signal(true);
  /** A jump skips at least one wave */
  readonly minJumpWave = computed(() => this.store.waveNumber() + 2);
  readonly canJump = computed(() => this.store.phase() === 'setup' && this.jumpWave() >= this.minJumpWave());
  /** What that wave is, to check W35 is the worm before jumping */
  readonly jumpWaveName = computed(() => {
    const wave = this.jumpWave();
    return bossVariantForWave(wave)?.name
      ?? templateObjectForWave(wave)?.name
      ?? (isBossWave(wave) ? 'Boss wave' : 'Director wave');
  });
  readonly jumpLabel = computed(() => {
    if (this.store.phase() !== 'setup') return 'Between waves only';
    if (this.jumpWave() < this.minJumpWave()) return `Wave ${this.minJumpWave()} or later`;
    return `Jump: next start Wave ${this.jumpWave()}`;
  });

  onStartCustomWave(): void {
    const bus = this.eventBus();
    if (bus) {
      bus.emit({ type: 'debug:start-custom-wave' });
    }
  }

  onJumpWaveChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isFinite(value)) this.jumpWave.set(Math.min(MAX_JUMP_WAVE, Math.max(2, value)));
  }

  onJumpGrantGoldChange(event: Event): void {
    this.jumpGrantGold.set((event.target as HTMLInputElement).checked);
  }

  onJumpToWave(): void {
    const bus = this.eventBus();
    if (!bus || !this.canJump()) return;
    bus.emit({ type: 'debug:jump-to-wave', wave: this.jumpWave(), grantGold: this.jumpGrantGold() });
  }

  // === Single Mode Handlers ===

  onEnemyTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EnemyTypeId;
    this.waveDebug.setEnemyType(value);
  }

  onEnemyCountChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemyCount(value);
  }

  onSpeedChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemySpeed(value);
  }

  onHealthChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemyHealth(value);
  }

  onSpawnDelayChange(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.waveDebug.setSpawnDelay(this.roundTo(value, 2));
  }

  onMaxSpawnsPerFrameChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setMaxSpawnsPerFrame(value);
  }

  // === Mixed Mode Handlers ===

  onGroupTypeChange(groupId: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EnemyTypeId;
    this.waveDebug.updateGroup(groupId, { enemyType: value });
  }

  onGroupCountChange(groupId: number, event: Event): void {
    const value = Math.max(1, parseInt((event.target as HTMLInputElement).value, 10) || 1);
    this.waveDebug.updateGroup(groupId, { count: value });
  }

  onGroupHealthMultChange(groupId: number, event: Event): void {
    const value = Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 1);
    this.waveDebug.updateGroup(groupId, { healthMultiplier: this.roundTo(value, 1) });
  }

  onGroupSpeedMultChange(groupId: number, event: Event): void {
    const value = Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 1);
    this.waveDebug.updateGroup(groupId, { speedMultiplier: this.roundTo(value, 1) });
  }

  onGroupDelayChange(groupId: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const delay = raw === '' ? undefined : Math.max(10, parseInt(raw, 10) || 0);
    this.waveDebug.updateGroup(groupId, { spawnDelay: delay });
  }

  onClusterSizeChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setClusterSize(value);
  }

  onSubWavePauseChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setSubWavePause(value);
  }

  onDelayVariationChange(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.waveDebug.setDelayVariation(this.roundTo(value, 2));
  }

  // === Formatting ===

  formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  formatDelay(ms: number): string {
    if (ms >= 100) return `${this.formatNumber(ms / 1000, 2)}s`;
    if (ms >= 1) return `${this.formatNumber(ms, 1)}ms`;
    return `${this.formatNumber(ms, 2)}ms`;
  }

  private formatNumber(value: number, decimals: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(value);
  }

  private roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
