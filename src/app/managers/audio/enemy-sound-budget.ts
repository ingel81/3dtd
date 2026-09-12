import { AUDIO_LIMITS, ENEMY_SOUND_PATTERNS } from '../../configs/audio.config';

/** Enemy sounds are recognised by id pattern, case-insensitive. */
export function isEnemySoundId(soundId: string): boolean {
  const lowerSoundId = soundId.toLowerCase();
  return ENEMY_SOUND_PATTERNS.some((pattern) => lowerSoundId.includes(pattern));
}

/**
 * Cap on enemy sounds audible at once (AUDIO_LIMITS.maxEnemySounds). A
 * running enemy loop holds one slot; a paused one has given it back.
 */
export class EnemySoundBudget {
  private count = 0;

  canReserve(): boolean {
    return this.count < AUDIO_LIMITS.maxEnemySounds;
  }

  /** Take a slot; false when the budget is full. */
  reserve(): boolean {
    if (this.count >= AUDIO_LIMITS.maxEnemySounds) {
      return false;
    }
    this.count++;
    return true;
  }

  /** Give a slot back. Never counts below zero. */
  release(): void {
    if (this.count > 0) {
      this.count--;
    }
  }

  stats(): { current: number; max: number } {
    return { current: this.count, max: AUDIO_LIMITS.maxEnemySounds };
  }
}
