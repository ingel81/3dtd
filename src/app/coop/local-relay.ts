import type { LockstepLink, StampedCommand } from './lockstep';
import { HashCheck, type Divergence } from './hash-check';

type Command = StampedCommand['command'];

/**
 * A relay inside the process: the specs run two or more simulations against
 * it, and it is the reference for what the network relay does (C4). It keeps
 * the order commands arrive in, puts them into the next open tick when that
 * tick closes, and hands every closed tick to every link.
 *
 * The hashes the links report go through the same HashCheck as at the
 * network relay; `divergences` keeps what it found.
 *
 * Nothing is timed here: whoever drives it closes the ticks. A link receives
 * a closed tick when its owner calls deliver(), which is how a spec holds a
 * client back as if its network were slow.
 */
export class LocalRelay {
  private readonly links: LocalLink[] = [];
  private open: { playerId: string; command: Command }[] = [];
  private closed = -1;
  private seq = 0;
  private readonly hashCheck = new HashCheck();
  /** Ticks at which the links reported different hashes, in the order found */
  readonly divergences: Divergence[] = [];

  /** @param autoDeliver hand a closed tick to the links at once, no latency */
  constructor(private readonly autoDeliver = false) {}

  /** The last tick closed; -1 before the first. */
  get lastClosed(): number {
    return this.closed;
  }

  connect(playerId: string): LocalLink {
    const link = new LocalLink(
      playerId,
      (command) => this.submit(playerId, command),
      (tick, hash) => {
        const divergence = this.hashCheck.report(tick, playerId, hash);
        if (divergence) this.divergences.push(divergence);
      },
    );
    this.links.push(link);
    return link;
  }

  /** Close the next tick with every command that arrived since the last one. */
  closeTick(): number {
    const tick = ++this.closed;
    const commands: StampedCommand[] = this.open.map(({ playerId, command }) => ({
      tick,
      seq: this.seq++,
      playerId,
      command,
    }));
    this.open = [];
    for (const link of this.links) {
      link.enqueue(tick, commands);
      if (this.autoDeliver) link.deliver();
    }
    return tick;
  }

  private submit(playerId: string, command: Command): void {
    this.open.push({ playerId, command });
  }
}

/** A client's end of the LocalRelay. */
export class LocalLink implements LockstepLink {
  /** Closed at the relay, not yet here */
  private readonly inbox: { tick: number; commands: readonly StampedCommand[] }[] = [];
  /** Here, not yet released; ticks without commands are not kept */
  private readonly received = new Map<number, readonly StampedCommand[]>();
  private confirmed = -1;

  constructor(
    readonly playerId: string,
    private readonly submit: (command: Command) => void,
    private readonly hashTo: (tick: number, hash: number) => void = () => undefined,
  ) {}

  send(command: Command): void {
    this.submit(command);
  }

  confirmedTick(): number {
    return this.confirmed;
  }

  commandsAt(tick: number): readonly StampedCommand[] {
    return this.received.get(tick) ?? [];
  }

  release(tick: number): void {
    this.received.delete(tick);
  }

  reportHash(tick: number, hash: number): void {
    this.hashTo(tick, hash);
  }

  /** Ticks closed at the relay that this link has not received yet. */
  get pending(): number {
    return this.inbox.length;
  }

  /** Receive up to `count` closed ticks, oldest first; returns how many. */
  deliver(count = Infinity): number {
    let n = 0;
    while (n < count && this.inbox.length > 0) {
      const { tick, commands } = this.inbox.shift()!;
      if (commands.length > 0) this.received.set(tick, commands);
      this.confirmed = tick;
      n++;
    }
    return n;
  }

  /** From the relay: a tick closed. */
  enqueue(tick: number, commands: readonly StampedCommand[]): void {
    this.inbox.push({ tick, commands });
  }
}
