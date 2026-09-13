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
    this.subs.add(this.eventBus.on('wave:started', ({ wave }) => this.look.setActive(isBloodMoonWave(wave))));
    this.subs.add(this.eventBus.on('wave:completed', () => this.look.setActive(false)));
    this.subs.add(this.eventBus.on('game:over', () => this.look.setActive(false)));
    this.subs.add(this.eventBus.on('game:reset', () => this.look.setActive(false, true)));
  }

  destroy(): void {
    this.subs.disposeAll();
  }
}
