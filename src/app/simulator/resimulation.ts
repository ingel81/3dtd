import type { CommandLogEntry } from '../managers/game-state/command-log';
import { isLosLogCommand } from '../managers/game-state/command-log';
import type { WaveConfig } from '../managers/wave.manager';
import type { LosResolveReason } from '../game-engine/game-event-bus';
import { losMaskFromJson, type LosMask } from '../utils/los-mask';
import type { SimSnapshot } from './sim-snapshot';
import type { WaveRecord } from './sim-recorder';
import { STATE_HASH_INTERVAL } from './state-hash';

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
  /**
   * Replay mode on: commands only from replayCommand, masks for place and
   * upgrade from `masks`, no retrofit drain. Off with null.
   */
  setReplayMode(masks: ((towerId: string, reason: LosResolveReason) => LosMask | null) | null): void;
  replayCommand(entry: CommandLogEntry): void;
  /** A logged retrofit mask, applied at its sub-step */
  applyLosMask(towerId: string, mask: LosMask): void;
  /**
   * Called at the start of every sub-step with the boundary before it and a
   * way to hash the state there: every input of that boundary has gone in,
   * live and re-simulated alike (the live recorder hashes at the same
   * point). Null to stop.
   */
  setBoundaryListener(listener: ((boundaryStep: number, hash: () => number) => void) | null): void;
}

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
 */
export class Resimulation {
  private cursor: number;
  private readonly masks = new Map<string, LosMask[]>();
  private started = false;
  private done = false;
  /** Sub-step of the first hash that did not match the live run, null while all match */
  divergedAt: number | null = null;
  /** Hashes compared so far */
  checkedHashes = 0;

  constructor(
    private readonly host: ResimHost,
    readonly record: WaveRecord,
    private readonly log: readonly CommandLogEntry[],
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
    this.collectMasks();
    // Replay mode first: the restore sends events of its own (out of the
    // manned tower), which the live listeners must not hear either
    this.host.setReplayMode((towerId, reason) => this.masks.get(`${towerId}|${reason}`)?.shift() ?? null);
    this.host.setBoundaryListener((boundary, hash) => this.checkHash(boundary, hash));
    this.host.restoreSnapshot(record.snapshot!);
    this.host.startWave(record.config);
    this.cursor = record.logStart;
    this.divergedAt = null;
    this.checkedHashes = 0;
    this.done = false;
    this.started = true;
    this.feedInputs();
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
    return true;
  }

  /** Step until `stepInWave` reaches `target` or the wave ends. Starts over when `target` lies behind. */
  stepTo(target: number): void {
    if (!this.started || target < this.stepInWave) this.start();
    while (this.stepInWave < target && this.step()) { /* next sub-step */ }
  }

  /**
   * Replay mode off. Restore what the live game had before, while the mode is
   * still on, so the live listeners hear nothing of it (ReplaySession.exit).
   */
  end(): void {
    this.host.setBoundaryListener(null);
    this.host.setReplayMode(null);
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
        // Place and upgrade masks come in through the command (collectMasks)
        if (los.reason === 'retrofit') this.host.applyLosMask(los.towerId, losMaskFromJson(los.mask));
        continue;
      }
      this.host.replayCommand(entry);
    }
  }

  /** The place and upgrade masks of the wave, per tower and reason in log order. */
  private collectMasks(): void {
    this.masks.clear();
    const end = this.record.endStep;
    for (let i = this.record.logStart; i < this.log.length; i++) {
      const entry = this.log[i];
      if (end !== null && entry.step >= end) break;
      const los = entry.command;
      if (!isLosLogCommand(los)) continue;
      if (los.reason === 'retrofit') continue;
      const key = `${los.towerId}|${los.reason}`;
      let list = this.masks.get(key);
      if (!list) this.masks.set(key, (list = []));
      list.push(losMaskFromJson(los.mask));
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
