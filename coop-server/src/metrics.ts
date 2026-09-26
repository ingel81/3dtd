/**
 * What the relay counts while it runs (relay review 2026-09-26): traffic,
 * what it dropped and why, refused connections, errors. Kept in memory only:
 * a sample every SAMPLE_MS for the last hour, gone with a restart. The status
 * page draws the samples; a line with the totals goes to the log every minute.
 */

/** Why the relay dropped a message or a connection */
export type DropReason = 'rate' | 'malformed' | 'slow' | 'error' | 'join-guessing' | 'no-hello' | 'hanging' | 'kicked';
/** Why the relay refused a connection before it opened */
export type RefuseReason = 'origin' | 'full' | 'per-address';

/** One sample of the last hour */
export interface MetricsSample {
  /** Seconds since the relay started */
  atS: number;
  connections: number;
  lobbies: number;
  games: number;
  /** Bytes in and out since the last sample */
  bytesIn: number;
  bytesOut: number;
  /** Messages dropped since the last sample */
  dropped: number;
  rssMb: number;
}

/** Samples this often, ms; an hour of them is kept */
export const SAMPLE_MS = 30_000;
const SAMPLES_KEPT = (60 * 60 * 1000) / SAMPLE_MS;

export class RelayMetrics {
  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  connectionsOpened = 0;
  errors = 0;
  readonly dropped: Record<DropReason, number> = {
    rate: 0, malformed: 0, slow: 0, error: 0, 'join-guessing': 0, 'no-hello': 0, hanging: 0, kicked: 0,
  };
  readonly refused: Record<RefuseReason, number> = { origin: 0, full: 0, 'per-address': 0 };
  readonly samples: MetricsSample[] = [];
  private sampledIn = 0;
  private sampledOut = 0;
  private sampledDropped = 0;

  drop(reason: DropReason): void {
    this.dropped[reason]++;
  }

  get droppedTotal(): number {
    return Object.values(this.dropped).reduce((sum, n) => sum + n, 0);
  }

  /** A sample now; `counts` are the relay's current connections and rooms. */
  sample(atS: number, counts: { connections: number; lobbies: number; games: number }): MetricsSample {
    const dropped = this.droppedTotal;
    const sample: MetricsSample = {
      atS,
      ...counts,
      bytesIn: this.bytesIn - this.sampledIn,
      bytesOut: this.bytesOut - this.sampledOut,
      dropped: dropped - this.sampledDropped,
      rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
    };
    this.sampledIn = this.bytesIn;
    this.sampledOut = this.bytesOut;
    this.sampledDropped = dropped;
    this.samples.push(sample);
    if (this.samples.length > SAMPLES_KEPT) this.samples.shift();
    return sample;
  }

  /** The log line with the totals */
  line(counts: { connections: number; lobbies: number; games: number }): string {
    const dropped = Object.entries(this.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
    const refused = Object.entries(this.refused).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
    return `metrics: ${counts.connections} connections, ${counts.lobbies} lobbies, ${counts.games} games, `
      + `in ${kb(this.bytesIn)}, out ${kb(this.bytesOut)}, dropped ${dropped || 'none'}, refused ${refused || 'none'}, `
      + `errors ${this.errors}, rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB`;
  }
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} kB`;
