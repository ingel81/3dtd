import type { GameStateManager } from '../../managers/game-state.manager';
import { GameClock } from '../../managers/game-state/game-clock';
import type { CommandLogEntry } from '../../managers/game-state/command-log';
import { Resimulation } from '../../simulator/resimulation';
import type { SimSnapshot } from '../../simulator/sim-snapshot';
import type { WaveRecord } from '../../simulator/sim-recorder';
import type { SimScalars } from '../protocol/packet';

/**
 * A replay as a re-simulation in the simulation (docs/SIMULATOR_PLAN.md, P6,
 * decision D1; docs/SIM_WORKER.md, "Replay"): the live state is kept as a
 * snapshot, the wave is re-simulated from its own snapshot, and leaving puts
 * the live state back. Its frames go to the main thread as normal packets,
 * the show included; the bar and the player's controls are the main
 * thread's (ReplayService), which drives this through SimCore's tick
 * (SimTickInput.replay) and its rpc.
 *
 * Playing advances the re-simulation by speed times the frame's wall time,
 * at most GameClock.MAX_CATCHUP_MS per frame like the game clock. Seeking
 * runs the simulation to the point sought (backwards from the wave's start)
 * with the show muted meanwhile.
 */
export class SimReplay {
  private resim: Resimulation;
  private carryMs = 0;

  constructor(
    private readonly gsm: GameStateManager,
    readonly record: WaveRecord,
    readonly log: readonly CommandLogEntry[],
    /** The live state to give back on exit */
    private readonly live: SimSnapshot,
  ) {
    this.resim = new Resimulation(gsm.resimHost, record, log);
  }

  get wave(): number {
    return this.record.wave;
  }

  get finished(): boolean {
    return this.resim.finished;
  }

  /** Put the simulation at the wave's start, in replay mode. */
  enter(): void {
    this.resim.start();
    this.gsm.resyncPresentation();
    this.carryMs = 0;
  }

  /** The replay of another wave, the live state kept: this one ends in replay mode, the other starts. */
  switchTo(record: WaveRecord, log: readonly CommandLogEntry[]): SimReplay {
    const next = new SimReplay(this.gsm, record, log, this.live);
    next.enter();
    return next;
  }

  /**
   * One frame of `deltaMs` wall time at `speed`: sub-steps as the time
   * holds, until the wave ends. Returns the sub-steps run.
   */
  play(deltaMs: number, speed: number): number {
    if (this.resim.finished) return 0;
    this.carryMs += Math.min(deltaMs, GameClock.MAX_CATCHUP_MS) * speed;
    let steps = 0;
    while (this.carryMs >= GameClock.FIXED_STEP_MS) {
      this.carryMs -= GameClock.FIXED_STEP_MS;
      steps++;
      if (!this.resim.step()) {
        this.carryMs = 0;
        break;
      }
    }
    return steps;
  }

  /**
   * Jump to `stepInWave`: with the show muted, forward from here or from the
   * wave's start. What stands on the field there is announced
   * (resyncPresentation); the sounds and effects of the stretch skipped are
   * left out.
   */
  seek(stepInWave: number): void {
    const bus = this.gsm.getEventBus();
    bus.setShowMuted(true);
    this.gsm.ops.setShowMuted(true);
    try {
      this.resim.stepTo(Math.max(0, Math.round(stepInWave)));
    } finally {
      this.gsm.ops.setShowMuted(false);
      bus.setShowMuted(false);
    }
    this.carryMs = 0;
    this.gsm.resyncPresentation();
  }

  /** Give the live game back as it was, then leave replay mode. */
  exit(): void {
    // In replay mode still: the live listeners hear nothing of the way back
    this.gsm.restoreSnapshot(this.live, 'live');
    this.resim.end();
    this.gsm.resyncPresentation();
  }

  /** The replay for the packet's scalars */
  state(): NonNullable<SimScalars['replay']> {
    return {
      wave: this.record.wave,
      stepInWave: this.resim.stepInWave,
      lengthInSteps: this.resim.lengthInSteps,
      divergedAt: this.resim.divergedAt,
      finished: this.resim.finished,
    };
  }
}
