import { Component, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { WaveDirectorService } from '../../ai/core/wave-director.service';
import { BotSkillLevel } from '../../ai/training/bots/tower-bot.interface';

@Component({
  selector: 'app-training-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.trainingWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="training"
        title="AI Training"
        icon="psychology"
        [position]="windowService.trainingWindow().position"
        [zIndex]="windowService.trainingWindow().zIndex"
        (closed)="windowService.close('training')"
        (positionChange)="windowService.updatePosition('training', $event)"
        (focused)="windowService.bringToFront('training')"
      >
        <div class="training-debug-content">
          <!-- Timescale Control -->
          <div class="section">
            <div class="section-title">Game Speed</div>

            <div class="slider-row">
              <span class="label">Timescale</span>
              <input type="range" min="0.1" max="75" step="0.1"
                     [value]="gameState.trainingTimescale()"
                     (input)="onTimescaleChange($event)" />
              <input type="number" class="number-input" min="0.1" max="75" step="0.1"
                     [value]="gameState.trainingTimescale()"
                     (change)="onTimescaleChange($event)" />
              <span class="unit">{{ gameState.trainingTimescale() }}x</span>
            </div>

            <div class="quick-buttons">
              <button class="quick-btn" (click)="setTimescale(1)">1x</button>
              <button class="quick-btn" (click)="setTimescale(10)">10x</button>
              <button class="quick-btn" (click)="setTimescale(25)">25x</button>
              <button class="quick-btn" (click)="setTimescale(50)">50x</button>
              <button class="quick-btn" (click)="setTimescale(75)">75x</button>
            </div>
          </div>

          <!-- Backend Connection -->
          <div class="section">
            <div class="section-title">Backend</div>

            <div class="info-row">
              <span class="label">Status</span>
              <span class="value" [class.connected]="trainingClient.isConnected()" [class.disconnected]="!trainingClient.isConnected()">
                {{ trainingClient.isConnected() ? 'Connected' : 'Disconnected' }}
              </span>
            </div>

            @if (trainingClient.isConnected()) {
              <div class="info-row">
                <span class="label">Client ID</span>
                <span class="value">#{{ trainingClient.displayId() ?? '?' }}</span>
              </div>
            }

            <button class="action-btn" (click)="toggleConnection()">
              {{ trainingClient.isConnected() ? 'Disconnect' : 'Connect' }}
            </button>
          </div>

          <!-- AI Director Status -->
          <div class="section">
            <div class="section-title">Wave Director</div>

            <div class="info-row">
              <span class="label">Mode</span>
              <span class="value">{{ getAIMode() }}</span>
            </div>

            <div class="info-row">
              <span class="label">Model</span>
              <span class="value">{{ getModelStatus() }}</span>
            </div>

            @if (waveDirector.inferenceTimeMs() > 0) {
              <div class="info-row">
                <span class="label">Inference</span>
                <span class="value">{{ waveDirector.inferenceTimeMs() }}ms</span>
              </div>
            }
          </div>

          <!-- Training Stats -->
          @if (trainingClient.isConnected() && trainingClient.stats()) {
            <div class="section">
              <div class="section-title">Training Stats</div>

              <div class="info-row">
                <span class="label">Episode</span>
                <span class="value">{{ trainingClient.stats()?.episode || 0 }}</span>
              </div>

              <div class="info-row">
                <span class="label">Avg Reward</span>
                <span class="value">{{ (trainingClient.stats()?.avgReward || 0).toFixed(3) }}</span>
              </div>

              <div class="info-row">
                <span class="label">Best Reward</span>
                <span class="value">{{ (trainingClient.stats()?.bestReward || 0).toFixed(3) }}</span>
              </div>

              <div class="info-row">
                <span class="label">Games Played</span>
                <span class="value">{{ trainingClient.stats()?.gamesPlayed || 0 }}</span>
              </div>
            </div>
          }

          <!-- Visualization -->
          <div class="section">
            <div class="section-title">Visualization</div>
            <label class="checkbox-row">
              <input type="checkbox"
                     [checked]="showDpsBins()"
                     (change)="toggleDpsBins()" />
              <span>Show DPS Bins</span>
            </label>
          </div>

          <!-- Smart Bot -->
          <div class="section">
            <div class="section-title">Smart Bot</div>

            <div class="info-row">
              <span class="label">Status</span>
              <span class="value" [class.active]="botEnabled()" [class.inactive]="!botEnabled()">
                {{ botEnabled() ? 'Active' : 'Inactive' }}
              </span>
            </div>

            @if (botEnabled()) {
              <div class="info-row">
                <span class="label">Skill Level</span>
                <span class="value">{{ botSkillLevel() }}</span>
              </div>

              <div class="info-row">
                <span class="label">Towers Placed</span>
                <span class="value">{{ botStats().towersPlaced }}</span>
              </div>

              <div class="info-row">
                <span class="label">Gold Spent</span>
                <span class="value">{{ botStats().goldSpent }}</span>
              </div>
            }

            <div class="bot-buttons">
              @if (!botEnabled()) {
                <button class="bot-btn" (click)="enableBot('casual')">
                  <span class="bot-icon">🎯</span> Casual Bot
                </button>
                <button class="bot-btn" (click)="enableBot('strategist')">
                  <span class="bot-icon">🧠</span> Strategist Bot
                </button>
                <button class="bot-btn" (click)="enableBot('meta')">
                  <span class="bot-icon">⚡</span> Meta Bot
                </button>
              } @else {
                <button class="bot-btn danger" (click)="disableBot()">
                  <span class="bot-icon">🛑</span> Disable Bot
                </button>
              }
            </div>
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    .training-debug-content {
      padding: 8px;
      color: var(--td-text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 260px;
    }

    .section {
      padding: 6px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-child {
      padding-top: 0;
    }

    .section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-title {
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .slider-row .label {
      width: 55px;
      flex-shrink: 0;
      color: var(--td-text-muted);
    }

    .slider-row input[type="range"] {
      flex: 1;
      height: 4px;
      accent-color: var(--td-teal);
      cursor: pointer;
    }

    .slider-row .number-input {
      width: 46px;
      padding: 2px 4px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-teal);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      text-align: right;
      -moz-appearance: textfield;
    }

    .slider-row .number-input::-webkit-outer-spin-button,
    .slider-row .number-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .slider-row .number-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .slider-row .unit {
      color: var(--td-text-muted);
      font-size: 9px;
      min-width: 28px;
    }

    .quick-buttons {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }

    .quick-btn {
      flex: 1;
      padding: 3px 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .quick-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .quick-btn:active {
      transform: scale(0.95);
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3px;
    }

    .info-row .label {
      color: var(--td-text-muted);
    }

    .info-row .value {
      color: var(--td-teal);
      font-weight: 600;
      min-width: 36px;
      text-align: right;
    }

    .info-row .value.connected,
    .info-row .value.active {
      color: var(--td-green);
    }

    .info-row .value.disconnected,
    .info-row .value.inactive {
      color: var(--td-text-muted);
    }

    .info-row .value.small {
      font-size: 9px;
      color: var(--td-text-muted);
    }

    .action-btn {
      width: 100%;
      padding: 4px 8px;
      margin-top: 6px;
      background: var(--td-gold);
      color: var(--td-bg-dark);
      border: none;
      border-top: 1px solid var(--td-edge-highlight);
      border-bottom: 2px solid var(--td-gold-dark);
      font-family: inherit;
      font-size: 9px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .action-btn:hover {
      filter: brightness(1.1);
    }

    .action-btn:active {
      transform: scale(0.98);
      border-bottom-width: 1px;
    }

    .bot-buttons {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .bot-btn {
      flex: 1 1 auto;
      min-width: 70px;
      padding: 4px 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .bot-btn .bot-icon {
      font-size: 11px;
    }

    .bot-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .bot-btn:active {
      transform: scale(0.97);
    }

    .bot-btn.danger {
      background: var(--td-health-bg);
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .bot-btn.danger:hover {
      background: rgba(177, 68, 54, 0.3);
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      color: var(--td-text-secondary);
    }

    .checkbox-row input[type="checkbox"] {
      accent-color: var(--td-teal);
      cursor: pointer;
    }

    .checkbox-row span {
      font-size: 10px;
    }
  `
})
export class TrainingDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly gameState = inject(GameStateManager);
  readonly trainingClient = inject(TrainingClientService);
  readonly waveDirector = inject(WaveDirectorService);

  // Bot control inputs (from parent component)
  readonly botEnabled = input<boolean>(false);
  readonly botSkillLevel = input<BotSkillLevel>('strategist');
  readonly botStats = input<{ towersPlaced: number; goldSpent: number }>({ towersPlaced: 0, goldSpent: 0 });
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  readonly onEnableBot = input<(skillLevel: BotSkillLevel) => void>(() => {});
  // eslint-disable-next-line @typescript-eslint/no-empty-function
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
