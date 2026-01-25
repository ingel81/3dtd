/**
 * Auto-Start Wave Strategy
 *
 * Priority: LOW (30) - Only after other strategies can't execute
 * Triggers when: In auto-mode, has minimal defense, can't spend more money
 * Action: Start next wave after delay
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';

export class AutoStartWaveStrategy extends BaseStrategy {
  private lastActionTime = 0;
  private setupPhaseStartTime = 0; // Track when setup phase started
  private readonly WAVE_START_DELAY = 1000; // 1 second delay after last action
  private readonly MAX_SETUP_WAIT = 5000; // Max 5 seconds in setup phase before forcing wave start

  constructor(
    private autoMode: boolean
  ) {
    super('AutoStartWave', 30);
  }

  canExecute(state: GameStateSnapshot): boolean {
    // Only in auto-mode and during setup phase
    if (!this.autoMode) return false;
    if (state.phase !== 'setup') return false;

    // Need at least 1 tower
    if (state.defense.towerCount === 0) return false;

    const now = Date.now();

    // Track setup phase start time
    if (this.setupPhaseStartTime === 0) {
      this.setupPhaseStartTime = now;
    }

    // Force start wave if we've been in setup too long (prevents infinite waiting)
    const setupDuration = now - this.setupPhaseStartTime;
    if (setupDuration > this.MAX_SETUP_WAIT) {
      console.log(`[AutoStartWave] Forcing wave start after ${setupDuration}ms in setup`);
      return true;
    }

    // Prefer 2+ towers for early waves, but start anyway if can't afford more
    if (state.waveNumber < 3 && state.defense.towerCount < 2 && state.player.credits >= 20) {
      return false; // Still saving for a second tower
    }

    // Check if enough time passed since last action
    if (now - this.lastActionTime < this.WAVE_START_DELAY) return false;

    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // Reset setup timer when wave actually starts
    this.setupPhaseStartTime = 0;

    return {
      type: 'start-wave',
      confidence: 0.9,
      reason: `Auto-starting wave ${state.waveNumber + 1} (${state.defense.towerCount} towers ready)`
    };
  }

  /** Called by bot when ANY action is executed */
  onActionExecuted(): void {
    this.lastActionTime = Date.now();
  }

  /** Called on game reset */
  onReset(): void {
    this.lastActionTime = 0;
    this.setupPhaseStartTime = 0;
  }
}
