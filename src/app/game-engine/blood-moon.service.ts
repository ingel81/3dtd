import type { GamePhase } from '../models/game.types';
import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { isBloodMoonWave } from '../configs/blood-moon.config';
import type { BloodMoonLook } from '../three-engine/blood-moon/blood-moon-look';

/**
 * BloodMoonService
 *
 * Tells the scene's blood moon look (ThreeTilesEngine.bloodMoon) when a
 * blood moon wave runs: on with `wave:started` of such a wave
 * (isBloodMoonWave), off with its end (`wave:completed`, `game:over`), off
 * without a fade on `game:reset`. Looks only; nothing here reaches the
 * simulation, and the wave itself is the same as any other.
 */
export class BloodMoonService {
  private readonly subs = new SubscriptionBag();

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly look: Pick<BloodMoonLook, 'setActive'>,
  ) {
    this.subs.add(this.eventBus.onShow('wave:started', ({ wave }) => this.look.setActive(isBloodMoonWave(wave))));
    this.subs.add(this.eventBus.onShow('wave:completed', () => this.look.setActive(false)));
    this.subs.add(this.eventBus.onShow('game:over', () => this.look.setActive(false)));
    this.subs.add(this.eventBus.onShow('game:reset', () => this.look.setActive(false, true)));
  }

  /**
   * The look of `phase` and `wave`, at once: after a snapshot restore or a
   * replay's seek (GameStateManager.resyncPresentation).
   */
  follow(phase: GamePhase, wave: number): void {
    this.look.setActive(phase === 'wave' && isBloodMoonWave(wave), true);
  }

  destroy(): void {
    this.subs.disposeAll();
  }
}
