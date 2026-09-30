import type { CommandLogEntry } from '../managers/game-state/command-log';
import { isLosLogCommand } from '../managers/game-state/command-log';
import type { WaveConfig } from '../managers/wave.manager';
import { losMaskFromJson, type LosMask } from '../utils/los-mask';
import type { SimSnapshot } from './sim-snapshot';
import type { WaveSnapshot } from './wave-snapshot';
import type { WaveRecord } from './sim-recorder';
import { STATE_HASH_INTERVAL } from './state-hash';
import { GameClock } from '../managers/game-state/game-clock';

/** What a re-simulation drives; the GameStateManager provides it (GameStateManager.resimHost). */
export interface ResimHost {
  /** Sub-steps run so far */
  subStep(): number;
  restoreSnapshot(snapshot: SimSnapshot): void;
  /** Start the wave from its config, without recording it again */
  startWave(config: WaveConfig): void;
  /** One sub-step by count (not by wall clock), checks and boundary included; true when the game ended in it */
  simulateStep(): boolean;
  waveRunning(): boolean;
  /** Replay mode on: commands only from replayCommand, towers wait for their line of sight as live. */
  setReplayMode(on: boolean): void;
  replayCommand(entry: CommandLogEntry): void;
  /** The state mid-wave as a wave snapshot, null where it cannot be taken (for keyframes) */
  captureWaveSnapshot(): WaveSnapshot | null;
  /** Back to a wave snapshot taken by captureWaveSnapshot, in replay mode */
  restoreWaveSnapshot(snapshot: WaveSnapshot): void;
  /** A logged line of sight, applied at its sub-step to a tower still waiting for it (TowerLos.replayMask) */
  applyLosMask(towerId: string, mask: LosMask): void;
  /**
   * Called at the start of every sub-step with the boundary before it and a
   * way to hash the state there: every input of that boundary has gone in,
   * live and re-simulated alike (the live recorder hashes at the same
   * point). Null to stop.
   */
  setBoundaryListener(listener: ((boundaryStep: number, hash: () => number) => void) | null): void;
}

/** Keyframes of a re-simulation (see Resimulation): at most `budgetBytes` of them, `minIntervalSteps` apart at least */
export interface KeyframeOptions {
  budgetBytes: number;
  minIntervalSteps: number;
}

/** A state the re-simulation passed, as a compact string, with its own place in the log */
interface Keyframe {
  stepInWave: number;
  text: string;
  cursor: number;
  divergedAt: number | null;
  checkedHashes: number;
}

/** A wave without a known end is taken as this long when spacing the keyframes (10 minutes) */
const UNKNOWN_LENGTH_STEPS = Math.round(600_000 / GameClock.FIXED_STEP_MS);

/**
 * Re-simulates one wave from its record and the command log: restore the
 * wave-start snapshot, start the wave with its config, then step the
 * simulation sub-step by sub-step and feed every logged input at the
 * boundary it took effect at (docs/SIMULATOR_PLAN.md, P4 to P6).
 *
 * Divergence: every STATE_HASH_INTERVAL sub-steps into the wave the state
 * hash at that boundary is compared with the one the live run took there.
 * The first mismatch is kept in `divergedAt`; the re-simulation goes on, it
 * just no longer matches.
 *
 * Nothing here reads the wall clock: stepTo() runs as fast as the
 * simulation does (a mid-game wave of 10 800 sub-steps in about 0.6 s,
 * docs/SIMULATOR_PLAN.md, section 5), which is what seeking in the replay is.
 *
 * Keyframes (optional, the replay's): every so often the state the
 * re-simulation passed is kept as a wave snapshot in a string, so a seek
 * starts from the nearest one before its target instead of from the wave's
 * start (a jump at 10 000 enemies took seconds). They are spaced so the
 * wave's keyframes fit the budget, going by the size of the last one (about
 * 1.3 kB per enemy: at 10 000 enemies and 250 MB some 19 of them); taken
 * while playing and while seeking, forgotten with the re-simulation. A
 * keyframe carries the log cursor and the hash check with it, so going on
 * from it is the same as going on without it.
 */
export class Resimulation {
  private cursor: number;
  private started = false;
  private done = false;
  /** Sub-step of the first hash that did not match the live run, null while all match */
  divergedAt: number | null = null;
  /** Hashes compared so far */
  checkedHashes = 0;
  private readonly keyframes: Keyframe[] = [];
  private keyframeBytes = 0;
  private nextKeyframeAt = 0;

  constructor(
    private readonly host: ResimHost,
    readonly record: WaveRecord,
    private readonly log: readonly CommandLogEntry[],
    private readonly keyframeOptions: KeyframeOptions | null = null,
  ) {
    if (!record.snapshot) throw new Error(`Wave ${record.wave} cannot be re-simulated (${record.refusal})`);
    if (record.tainted) throw new Error(`Wave ${record.wave} cannot be re-simulated (${record.tainted})`);
    this.cursor = record.logStart;
  }

  /** Sub-steps into the wave, 0 at its start. */
  get stepInWave(): number {
    return this.host.subStep() - this.record.startStep;
  }

  /** Sub-steps the wave ran live, null when it has no end (game still running it). */
  get lengthInSteps(): number | null {
    return this.record.endStep === null ? null : this.record.endStep - this.record.startStep;
  }

  get finished(): boolean {
    return this.done;
  }

  /** Put the simulation at the wave's start. Replay mode stays on until end(). */
  start(): void {
    const record = this.record;
    // Replay mode first: the restore sends events of its own (out of the
    // manned tower), which the live listeners must not hear either
    this.host.setReplayMode(true);
    this.host.setBoundaryListener((boundary, hash) => this.checkHash(boundary, hash));
    this.host.restoreSnapshot(record.snapshot!);
    this.host.startWave(record.config);
    this.cursor = record.logStart;
    this.divergedAt = null;
    this.checkedHashes = 0;
    this.done = false;
    this.started = true;
    this.feedInputs();
    if (this.keyframes.length === 0) this.nextKeyframeAt = this.keyframeOptions?.minIntervalSteps ?? 0;
  }

  /** One sub-step. False once the wave is over. */
  step(): boolean {
    if (!this.started) this.start();
    if (this.done) return false;
    const ended = this.host.simulateStep();
    const end = this.record.endStep;
    if (ended || !this.host.waveRunning() || (end !== null && this.host.subStep() >= end)) {
      this.done = true;
      return false;
    }
    this.feedInputs();
    if (this.keyframeOptions !== null && this.stepInWave >= this.nextKeyframeAt) this.keepKeyframe(this.keyframeOptions);
    return true;
  }

  /**
   * Step until `stepInWave` reaches `target` or the wave ends. From the
   * nearest keyframe before `target` when that is nearer than where it
   * stands; from the wave's start when `target` lies behind and none is.
   */
  stepTo(target: number): void {
    this.seekFrom(target);
    while (this.stepInWave < target && this.step()) { /* next sub-step */ }
  }

  /**
   * The nearest place to step to `target` from: the keyframe before it when
   * that is nearer than where it stands, the wave's start when `target` lies
   * behind and no keyframe is; else where it stands. stepTo() without the
   * steps, for a seek run in slices (SimReplay).
   */
  seekFrom(target: number): void {
    if (!this.started) this.start();
    const at = this.stepInWave;
    const from = this.keyframeBefore(target);
    if (from !== null && (target < at || from.stepInWave > at)) this.restoreKeyframe(from);
    else if (target < at) this.start();
  }

  /** Keyframes kept and their size, for the budget (bytes as string length) */
  get keyframeStats(): { count: number; bytes: number } {
    return { count: this.keyframes.length, bytes: this.keyframeBytes };
  }

  private keyframeBefore(target: number): Keyframe | null {
    let best: Keyframe | null = null;
    for (const keyframe of this.keyframes) {
      if (keyframe.stepInWave <= target && (best === null || keyframe.stepInWave > best.stepInWave)) best = keyframe;
    }
    return best;
  }

  private keepKeyframe(options: KeyframeOptions): void {
    const stepInWave = this.stepInWave;
    if (this.keyframes.some((k) => k.stepInWave === stepInWave)) return;
    const snapshot = this.host.captureWaveSnapshot();
    if (snapshot === null) {
      this.nextKeyframeAt = stepInWave + 1;
      return;
    }
    const text = JSON.stringify(snapshot);
    const length = this.lengthInSteps ?? UNKNOWN_LENGTH_STEPS;
    // Spaced so this wave's keyframes of this size fit the budget
    this.nextKeyframeAt = stepInWave + Math.max(options.minIntervalSteps, Math.ceil((length * text.length) / options.budgetBytes));
    if (this.keyframeBytes + text.length > options.budgetBytes) return;
    this.keyframes.push({ stepInWave, text, cursor: this.cursor, divergedAt: this.divergedAt, checkedHashes: this.checkedHashes });
    this.keyframeBytes += text.length;
  }

  private restoreKeyframe(keyframe: Keyframe): void {
    this.host.restoreWaveSnapshot(JSON.parse(keyframe.text) as WaveSnapshot);
    this.cursor = keyframe.cursor;
    this.divergedAt = keyframe.divergedAt;
    this.checkedHashes = keyframe.checkedHashes;
    this.done = false;
  }

  /**
   * Replay mode off. Restore what the live game had before, while the mode is
   * still on, so the live listeners hear nothing of it (ReplaySession.exit).
   */
  end(): void {
    this.host.setBoundaryListener(null);
    this.host.setReplayMode(false);
    this.started = false;
  }

  /** The inputs logged at the boundary the simulation stands at, in log order. */
  private feedInputs(): void {
    const now = this.host.subStep();
    const end = this.record.endStep;
    while (this.cursor < this.log.length) {
      const entry = this.log[this.cursor];
      if (entry.step > now) return;
      if (end !== null && entry.step >= end) return;
      this.cursor++;
      if (entry.step < now) continue;
      const los = entry.command;
      if (isLosLogCommand(los)) {
        // A mask the tower still waits for (a log from before the worker
        // split had no command:los-mask for it); one the command answered
        // already takes nothing
        this.host.applyLosMask(los.towerId, losMaskFromJson(los.mask));
        continue;
      }
      this.host.replayCommand(entry);
    }
  }

  private checkHash(boundary: number, hash: () => number): void {
    const inWave = boundary - this.record.startStep;
    if (inWave <= 0 || inWave % STATE_HASH_INTERVAL !== 0) return;
    const expected = this.record.hashes[inWave / STATE_HASH_INTERVAL - 1];
    if (expected === undefined) return;
    this.checkedHashes++;
    if (this.divergedAt === null && hash() !== expected) this.divergedAt = boundary;
  }
}
