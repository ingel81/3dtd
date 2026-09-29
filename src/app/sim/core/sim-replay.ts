import type { GameStateManager } from '../../managers/game-state.manager';
import { GameClock } from '../../managers/game-state/game-clock';
import type { CommandLogEntry } from '../../managers/game-state/command-log';
import { Resimulation } from '../../simulator/resimulation';
import type { SimSnapshot } from '../../simulator/sim-snapshot';
import type { WaveRecord } from '../../simulator/sim-recorder';
import type { SimScalars } from '../protocol/packet';

/**
 * Keyframes of the replay (Resimulation): up to 250 MB of the wave's states,
 * 5 s apart at least, forgotten when the replay ends (docs/REPLAY.md)
 */
const KEYFRAMES = { budgetBytes: 250e6, minIntervalSteps: 300 };
/** Wall clock a seek runs per tick, so the bar shows how far it got and a new target can come in between */
const SEEK_SLICE_MS = 40;

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
 * runs the simulation to the point sought with the show muted, from the
 * nearest keyframe before it (or the wave's start), in slices of
 * SEEK_SLICE_MS per tick: the packets show how far it got, and a new target
 * (a drag on the bar) takes over from the next slice.
 */
export class SimReplay {
  private resim: Resimulation;
  private carryMs = 0;
  /** The step a seek runs to, and where it began running, null while none runs */
  private seeking: { target: number; from: number } | null = null;

  constructor(
    private readonly gsm: GameStateManager,
    readonly record: WaveRecord,
    readonly log: readonly CommandLogEntry[],
    /** The live state to give back on exit */
    private readonly live: SimSnapshot,
  ) {
    this.resim = new Resimulation(gsm.resimHost, record, log, KEYFRAMES);
  }

  get wave(): number {
    return this.record.wave;
  }

  get finished(): boolean {
    return this.resim.finished;
  }

  /** Put the simulation at the wave's start, in replay mode. */
  enter(): void {
    // Blood, scorch marks, damage numbers, a strike still running: the replay starts on a clean field
    this.gsm.clearShow();
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
    if (this.resim.finished || this.seeking !== null) return 0;
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
   * Jump to `stepInWave`: from the nearest keyframe before it, from here or
   * from the wave's start, run in slices by advanceSeek(). What stands on the
   * field there is announced then (resyncPresentation); the sounds and
   * effects of the stretch skipped are left out.
   */
  seek(stepInWave: number): void {
    const target = Math.max(0, Math.round(stepInWave));
    this.muted(() => this.resim.seekFrom(target));
    this.seeking = { target, from: this.resim.stepInWave };
    this.carryMs = 0;
  }

  /** A seek running: one slice of at most `budgetMs` wall clock. Returns the sub-steps run. */
  advanceSeek(budgetMs = SEEK_SLICE_MS): number {
    const seeking = this.seeking;
    if (seeking === null) return 0;
    const resim = this.resim;
    const deadline = performance.now() + budgetMs;
    let steps = 0;
    let running = true;
    this.muted(() => {
      while (resim.stepInWave < seeking.target && performance.now() < deadline && (running = resim.step())) steps++;
    });
    if (resim.stepInWave >= seeking.target || !running) {
      this.seeking = null;
      // Damage numbers and particles of the stretch skipped were muted; a strike
      // from before the jump would play on (a laser seen twice)
      this.gsm.clearShow();
      this.gsm.resyncPresentation();
    }
    return steps;
  }

  get isSeeking(): boolean {
    return this.seeking !== null;
  }

  /** `run` with the show muted: no sounds, effects or numbers of the stretch skipped */
  private muted(run: () => void): void {
    const bus = this.gsm.getEventBus();
    bus.setShowMuted(true);
    this.gsm.ops.setShowMuted(true);
    try {
      run();
    } finally {
      this.gsm.ops.setShowMuted(false);
      bus.setShowMuted(false);
    }
  }

  /**
   * Give the live game back as it was, then leave replay mode. The towers
   * that waited for their line of sight ask again once the live listeners
   * hear: the requests of the restore went out muted.
   */
  exit(): void {
    // The replay's marks, numbers and strikes stay behind in it
    this.gsm.clearShow();
    // In replay mode still: the live listeners hear nothing of the way back
    this.gsm.restoreSnapshot(this.live, 'live');
    this.resim.end();
    this.gsm.towerLos.announceAwaiting();
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
      seeking: this.seeking === null ? null : { ...this.seeking },
    };
  }
}
