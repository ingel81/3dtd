import type { LockstepLink, StampedCommand } from '../../coop/lockstep';
import type { CommandData } from '../../managers/game-state/command-data';
import type { LockstepDelivery, SimOutput } from '../protocol/messages';

/**
 * The simulation's end of the relay (docs/SIM_WORKER.md, "Coop"): the relay
 * connection stays on the main thread, which hands the ticks it received
 * over with every tick message (LockstepDelivery). What the simulation sends
 * back (commands, state hashes, the smoothness of a frame) goes out as
 * SimOutput through the tick's `out`.
 */
export class DeliveredLink implements LockstepLink {
  playerId = '';
  private confirmed = -1;
  private readonly ticks = new Map<number, readonly StampedCommand[]>();
  private out: (message: SimOutput) => void = () => undefined;

  /** The ticks of this tick message, and where the answers go. */
  deliver(delivery: LockstepDelivery | null, out: (message: SimOutput) => void): void {
    this.out = out;
    if (!delivery) return;
    for (const { tick, commands } of delivery.ticks) this.ticks.set(tick, commands);
    if (delivery.confirmedTick > this.confirmed) this.confirmed = delivery.confirmedTick;
  }

  /** A new relay (setLockstep): nothing received yet. */
  reset(): void {
    this.confirmed = -1;
    this.ticks.clear();
  }

  send(command: CommandData): void {
    this.out({ kind: 'lockstep-send', command });
  }

  confirmedTick(): number {
    return this.confirmed;
  }

  commandsAt(tick: number): readonly StampedCommand[] {
    return this.ticks.get(tick) ?? [];
  }

  release(tick: number): void {
    this.ticks.delete(tick);
  }

  reportHash(tick: number, hash: number, parts?: readonly number[]): void {
    this.out({ kind: 'lockstep-hash', tick, hash, parts });
  }

  noteFrame(steps: number, blocked: boolean, behind: number): void {
    this.out({ kind: 'lockstep-frame', steps, blocked, behind });
  }

  commandsRan(count: number): void {
    this.out({ kind: 'lockstep-ran', count });
  }
}
