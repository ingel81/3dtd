/**
 * About how many players a day: each client's address (by clientKey, IPv6
 * per /64) is hashed with a key drawn at random for the day, held only in
 * memory and thrown away when the day changes, and the hashes are kept in a
 * set for that day only. What is written is the count. Neither address nor
 * hash nor key leaves this module; after the day its set is dropped too, and
 * no hash of one day can be linked to another's. A restart draws a new key:
 * a client seen before and after it counts twice that day (the count before
 * the restart is the base the new set adds to).
 */
import { createHmac, randomBytes } from 'node:crypto';

/** The UTC day of `ms`, as the statistics name it: `2026-10-18` */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class DailyPlayers {
  private day = '';
  private key = Buffer.alloc(0);
  private seen = new Set<string>();
  private base = 0;
  private readonly now: () => number;
  private readonly maxPerDay: number;
  /** The count of a day already written before this process (its base), e.g. from the statistics */
  private readonly baseOf: (day: string) => number;
  /** Hears the final count of a day when the next begins */
  private readonly onDayEnd: (day: string, players: number) => void;

  constructor(options: {
    now?: () => number;
    maxPerDay?: number;
    baseOf?: (day: string) => number;
    onDayEnd?: (day: string, players: number) => void;
  } = {}) {
    this.now = options.now ?? Date.now;
    this.maxPerDay = options.maxPerDay ?? 1_000_000;
    this.baseOf = options.baseOf ?? (() => 0);
    this.onDayEnd = options.onDayEnd ?? (() => undefined);
  }

  /** Count the client `clientKey` for today */
  see(clientKey: string): void {
    this.roll();
    if (this.seen.size >= this.maxPerDay) return;
    // 16 hex characters of the hash are plenty to tell a day's clients apart
    this.seen.add(createHmac('sha256', this.key).update(clientKey).digest('hex').slice(0, 16));
  }

  /** Today and its count so far */
  current(): { day: string; players: number } {
    this.roll();
    return { day: this.day, players: this.base + this.seen.size };
  }

  /** A new day: the old key and set go, the old day's count is handed on */
  private roll(): void {
    const today = dayOf(this.now());
    if (today === this.day) return;
    if (this.day) this.onDayEnd(this.day, this.base + this.seen.size);
    this.day = today;
    this.key = randomBytes(32);
    this.seen = new Set();
    this.base = this.baseOf(today);
  }
}
