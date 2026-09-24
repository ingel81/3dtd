import type { WaveConfig } from '../managers/wave.manager';
import type { SimSnapshot, SnapshotRefusal } from './sim-snapshot';
import { STATE_HASH_INTERVAL } from './state-hash';

/**
 * One wave of the run as a re-simulation needs it (docs/SIMULATOR_PLAN.md,
 * P4, P5): the state it started from, its config, where its inputs start in
 * the command log, and the state hashes the live run took, to check a
 * re-simulation against.
 */
export interface WaveRecord {
  wave: number;
  /** Null when the state at the start was not quiet, see `refusal` */
  snapshot: SimSnapshot | null;
  refusal: SnapshotRefusal | null;
  /**
   * Something changed the simulation past the command log (a debug cheat
   * that spawns or removes enemies): the wave does not re-simulate.
   */
  tainted: string | null;
  /** The wave's config as plain data (the start command carries the same) */
  config: WaveConfig;
  /** Sub-steps run when the wave started */
  startStep: number;
  /** Index of the first command log entry after the start */
  logStart: number;
  /** Sub-steps run when the wave ended, null while it runs */
  endStep: number | null;
  /**
   * State hash at every STATE_HASH_INTERVAL-th boundary into the wave ([0]
   * at startStep + interval), taken when the next sub-step starts, after
   * every input of that boundary (ResimHost.setBoundaryListener)
   */
  hashes: number[];
}

/**
 * The waves of the run, for the replay (every wave, decision D4) and its
 * export. Owned by the GameStateManager, which feeds it: wave start with
 * the snapshot, a hash every STATE_HASH_INTERVAL sub-steps, the wave end, a
 * taint. Cleared with a new run or place, like the command log.
 *
 * Cost: a snapshot of a few KB per wave start, a hash per game second while
 * a wave runs (a few hundred numbers per hundred enemies), nothing else.
 */
export class SimRecorder {
  private readonly list: WaveRecord[] = [];
  private current: WaveRecord | null = null;

  get records(): readonly WaveRecord[] {
    return this.list;
  }

  /** The record of `wave`, the latest when a wave number came twice (dev jump). */
  get(wave: number): WaveRecord | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].wave === wave) return this.list[i];
    }
    return null;
  }

  begin(record: Omit<WaveRecord, 'endStep' | 'hashes' | 'tainted'>): void {
    this.current = { ...record, endStep: null, hashes: [], tainted: null };
    this.list.push(this.current);
  }

  /** Whether the running wave wants a hash at boundary `step`. */
  wantsHash(step: number): boolean {
    const current = this.current;
    return current !== null && current.snapshot !== null && current.tainted === null
      && (step - current.startStep) % STATE_HASH_INTERVAL === 0 && step > current.startStep;
  }

  addHash(hash: number): void {
    this.current?.hashes.push(hash);
  }

  end(step: number): void {
    if (this.current) this.current.endStep = step;
    this.current = null;
  }

  /** The running wave went past the log (see WaveRecord.tainted). */
  taint(reason: string): void {
    if (this.current && !this.current.tainted) this.current.tainted = reason;
  }

  clear(): void {
    this.list.length = 0;
    this.current = null;
  }
}
