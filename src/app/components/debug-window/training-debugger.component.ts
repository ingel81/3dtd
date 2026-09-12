import { Component, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { WaveDirectorService } from '../../ai/core/wave-director.service';
import type { BotSkillLevel } from '../../ai/training/bots/tower-bot.interface';

@Component({
  selector: 'app-training-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './training-debugger.component.html',
  styleUrl: './training-debugger.component.scss',
})
export class TrainingDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly gameState = inject(GameStateManager);
  readonly trainingClient = inject(TrainingClientService);
  readonly waveDirector = inject(WaveDirectorService);
  readonly loadingModel = signal(false);

  // Bot control inputs (from parent component)
  readonly botEnabled = input<boolean>(false);
  readonly botSkillLevel = input<BotSkillLevel>('strategist');
  readonly botStats = input<{ towersPlaced: number; goldSpent: number }>({ towersPlaced: 0, goldSpent: 0 });
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- no-op until the parent binds a handler
  readonly onEnableBot = input<(skillLevel: BotSkillLevel) => void>(() => {});
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- no-op until the parent binds a handler
  readonly onDisableBot = input<() => void>(() => {});

  // DPS Bins visualization toggle
  readonly showDpsBins = signal(false);
  readonly dpsBinsToggled = output<boolean>();

  onTimescaleChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.gameState.setTrainingTimescale(value);
  }

  setTimescale(value: number): void {
    this.gameState.setTrainingTimescale(value);
  }

  async toggleConnection(): Promise<void> {
    if (this.trainingClient.isConnected()) {
      this.trainingClient.disconnect();
    } else {
      await this.trainingClient.connect();
    }
  }

  getAIMode(): string {
    if (this.trainingClient.isConnected()) {
      return 'training';
    }
    return this.waveDirector.aiMode();
  }

  getModelStatus(): string {
    if (this.trainingClient.isConnected()) {
      return 'Backend Training Model';
    }
    return this.waveDirector.statusText();
  }

  /**
   * Load the ONNX policy on demand. Nothing loads it on startup: it measured
   * statistically indistinguishable from uniform random sampling, and a 404 kB
   * runtime plus a network round-trip is not worth paying for that on every
   * cold start.
   */
  async loadOnnxModel(): Promise<void> {
    this.loadingModel.set(true);
    try {
      await this.waveDirector.loadModel();
    } finally {
      this.loadingModel.set(false);
    }
  }

  /** Drop back to the rule director. */
  useRules(): void {
    this.waveDirector.forceRuleMode();
  }

  toggleDpsBins(): void {
    const newValue = !this.showDpsBins();
    this.showDpsBins.set(newValue);
    this.dpsBinsToggled.emit(newValue);
  }

  enableBot(skillLevel: BotSkillLevel): void {
    this.onEnableBot()(skillLevel);
  }

  disableBot(): void {
    this.onDisableBot()();
  }
}
