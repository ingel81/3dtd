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
  /** Phase 5.12: all timers game-time accumulated via tickCooldowns. */
  private msSinceLastAction = Infinity; // starts "ready" so the first wave can trigger
  private setupPhaseDurationMs = 0;
  private inSetupPhase = false;
  private readonly WAVE_START_DELAY = 1000; // 1s game-time after last action
  private readonly MAX_SETUP_WAIT = 5000; // max 5s game-time in setup before force-start

  constructor(
    private autoMode: boolean
  ) {
    super('AutoStartWave', 30);
  }

  override tickCooldowns(deltaTime: number): void {
    if (this.msSinceLastAction !== Infinity) {
      this.msSinceLastAction += deltaTime;
    }
    if (this.inSetupPhase) {
      this.setupPhaseDurationMs += deltaTime;
    }
  }

  canExecute(state: GameStateSnapshot): boolean {
    // Only in auto-mode and during setup phase
    if (!this.autoMode) return false;
    if (state.phase !== 'setup') {
      // Leaving setup — reset setup duration so next setup starts fresh
      this.inSetupPhase = false;
      this.setupPhaseDurationMs = 0;
      return false;
    }

    // Need at least 1 tower
    if (state.defense.towerCount === 0) return false;

    // Phase 5.11: wait for any active research before triggering the wave.
    // A human wouldn't start a wave while upgrading — neither should the bot.
    const activeResearchCount = state.research?.activeIds?.length ?? 0;
    if (activeResearchCount > 0) return false;

    // Track that we're in setup phase (tickCooldowns will accumulate duration)
    if (!this.inSetupPhase) {
      this.inSetupPhase = true;
      this.setupPhaseDurationMs = 0;
    }

    // Force start wave if we've been in setup too long (prevents infinite waiting
    // when there is NO research running — research takes priority above).
    if (this.setupPhaseDurationMs > this.MAX_SETUP_WAIT) {
      return true;
    }

    // Prefer 2+ towers for early waves, but start anyway if can't afford more
    if (state.waveNumber < 3 && state.defense.towerCount < 2 && state.player.credits >= 20) {
      return false; // Still saving for a second tower
    }

    // Check if enough game-time passed since last action
    if (this.msSinceLastAction < this.WAVE_START_DELAY) return false;

    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    // Reset setup timer when wave actually starts
    this.inSetupPhase = false;
    this.setupPhaseDurationMs = 0;

    return {
      type: 'start-wave',
      confidence: 0.9,
      reason: `Auto-starting wave ${state.waveNumber + 1} (${state.defense.towerCount} towers ready)`
    };
  }

  /** Called by bot when ANY action is executed */
  onActionExecuted(): void {
    this.msSinceLastAction = 0;
  }

  /** Called on game reset */
  onReset(): void {
    this.msSinceLastAction = Infinity;
    this.setupPhaseDurationMs = 0;
    this.inSetupPhase = false;
  }
}
