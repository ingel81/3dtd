import { Component, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { BotClientService } from '../../bots/bot-client.service';
import { WaveDirector } from '../../director/wave-director';
import type { BotSkillLevel } from '../../bots/bots/tower-bot.interface';

@Component({
  selector: 'app-bot-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bot-debugger.component.html',
  styleUrl: './bot-debugger.component.scss',
})
export class BotDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly gameState = inject(GameStateManager);
  readonly botClient = inject(BotClientService);
  readonly waveDirector = inject(WaveDirector);

  // Bot control inputs (from parent component)
  readonly botEnabled = input<boolean>(false);
  readonly botSkillLevel = input<BotSkillLevel>('expert');
  readonly botStats = input<{ towersPlaced: number; goldSpent: number }>({ towersPlaced: 0, goldSpent: 0 });
  // Bot buttons, handled by the parent
  readonly botEnableRequested = output<BotSkillLevel>();
  readonly botDisableRequested = output<void>();

  // DPS Bins visualization toggle
  readonly showDpsBins = signal(false);
  readonly dpsBinsToggled = output<boolean>();

  /**
   * The correction the active source applied to the last planned wave.
   *
   * Read off the committed plan rather than the source itself: a source
   * without such a loop has none, and the panel must not know which one is
   * running (docs/WAVE_SOURCE_PLAN.md, R1).
   */
  gateMultiplier(): string | null {
    const mult = this.waveDirector.committed?.log.pressureMultiplier;
    return mult === undefined ? null : mult.toFixed(2);
  }

  onTimescaleChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    this.gameState.setGameSpeed(value);
  }

  setTimescale(value: number): void {
    this.gameState.setGameSpeed(value);
  }

  async toggleConnection(): Promise<void> {
    if (this.botClient.isConnected()) {
      this.botClient.disconnect();
    } else {
      await this.botClient.connect();
    }
  }

  toggleDpsBins(): void {
    const newValue = !this.showDpsBins();
    this.showDpsBins.set(newValue);
    this.dpsBinsToggled.emit(newValue);
  }

  enableBot(skillLevel: BotSkillLevel): void {
    this.botEnableRequested.emit(skillLevel);
  }

  disableBot(): void {
    this.botDisableRequested.emit();
  }
}
