import type { SimFramePacket } from '../protocol/packet';

/**
 * Wall clock a pass of the loop may run sub-steps before it publishes and
 * lets messages in. Start value, tuned by measurement
 * (docs/archive/SIM_DECOUPLE_PLAN.md, TODO E85).
 */
export const PASS_BUDGET_MS = 8;

/** What the loop drives (SimCore) */
export interface LoopCore {
  /** One pass: the sub-steps due until `deadline`, the packet out; null when there is none to publish now */
  pass(now: number, deadline: number): SimFramePacket | null;
  /** Wall ms until the next pass has work: 0 at once, Infinity until a message comes (SimCore.idleMs) */
  idleMs(): number;
}

/** How the loop waits: a message to itself for at once, a timer for later (the worker's globals by default) */
export interface LoopTimers {
  now(): number;
  soon(run: () => void): void;
  later(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** The worker's timers: at once through a MessageChannel (chained setTimeout waits 4 ms and more), later by setTimeout */
export function workerTimers(): LoopTimers {
  let channel: MessageChannel | null = null;
  let queued: (() => void) | null = null;
  return {
    now: () => performance.now(),
    soon: (run) => {
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => {
          const next = queued;
          queued = null;
          next?.();
        };
      }
      queued = run;
      channel.port2.postMessage(null);
    },
    later: (run, ms) => setTimeout(run, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * The simulation's loop in the worker (docs/archive/SIM_DECOUPLE_PLAN.md): its own
 * clock, no frame to wait for. A pass runs the sub-steps due, at most
 * PASS_BUDGET_MS of wall clock, publishes a packet when the main thread
 * asks for one (SimCore.pass) and gives the thread back, so messages
 * (inputs, calls) come in between two passes, at a sub-step boundary. With nothing due it sleeps until the next sub-step is due, or
 * until a message wakes it (paused, waiting for the relay, no world).
 */
export class SimLoop {
  private soonQueued = false;
  private timer: unknown = null;
  private stopped = false;

  constructor(
    private readonly core: LoopCore,
    private readonly publish: (packet: SimFramePacket) => void,
    private readonly fail: (error: unknown) => void,
    private readonly timers: LoopTimers = workerTimers(),
  ) {}

  /** Something came in (an input, a call, a world): a pass at once */
  wake(): void {
    this.schedule(0);
  }

  /** For good, after a failure: the state may be half updated */
  stop(): void {
    this.stopped = true;
    this.soonQueued = false;
    this.clearTimer();
  }

  private schedule(ms: number): void {
    if (this.stopped || this.soonQueued) return;
    this.clearTimer();
    if (ms <= 0) {
      this.soonQueued = true;
      this.timers.soon(() => this.run());
    } else if (ms !== Infinity) {
      this.timer = this.timers.later(() => {
        this.timer = null;
        this.run();
      }, ms);
    }
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.cancel(this.timer);
    this.timer = null;
  }

  private run(): void {
    this.soonQueued = false;
    this.clearTimer();
    if (this.stopped) return;
    try {
      const now = this.timers.now();
      const packet = this.core.pass(now, now + PASS_BUDGET_MS);
      if (packet) this.publish(packet);
      this.schedule(this.core.idleMs());
    } catch (error) {
      this.stop();
      this.fail(error);
    }
  }
}
