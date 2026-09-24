/**
 * How smoothly a coop client runs, measured to find why the game feels
 * sluggish in coop (PLAYTEST T19, TODO E29). Counted per frame and per tick,
 * reported to the relay every REPORT_EVERY_MS, which logs it. Framework-free
 * and pure; times are wall-clock ms the caller passes in.
 */

/** How often a client reports, ms */
export const REPORT_EVERY_MS = 10_000;

/** One report, what the relay logs */
export interface LockstepStatsReport {
  /** Frames in the period */
  frames: number;
  /** Frames in which a sub-step was due but the tick barrier held it, 0 to 1 */
  blocked: number;
  /** Frames that ran 0, 1, 2 and 3 or more sub-steps */
  steps: [number, number, number, number];
  /** Ticks closed at the relay and not yet run here, mean and least over the frames */
  behindAvg: number;
  behindMin: number;
  /** Time between two ticks coming in, mean and standard deviation, ms */
  tickGapAvg: number;
  tickGapSd: number;
  /** From sending an own command to it running here, mean and most, ms; n commands */
  inputAvg: number | null;
  inputMax: number | null;
  inputs: number;
}

export class LockstepStats {
  private frames = 0;
  private blockedFrames = 0;
  private steps: [number, number, number, number] = [0, 0, 0, 0];
  private behindSum = 0;
  private behindMin = Infinity;
  private lastTickAt: number | null = null;
  private gaps: number[] = [];
  /** Send times of own commands not yet run, in order */
  private readonly sent: number[] = [];
  private inputs: number[] = [];
  private periodStart: number | null = null;

  /** A frame ran `steps` sub-steps; `blocked` when the barrier held a due one; `behind` ticks closed and not run. */
  frame(steps: number, blocked: boolean, behind: number): void {
    this.frames++;
    if (blocked) this.blockedFrames++;
    this.steps[Math.min(steps, 3)]++;
    this.behindSum += behind;
    this.behindMin = Math.min(this.behindMin, behind);
  }

  /** A tick came in from the relay */
  tickArrived(now: number): void {
    if (this.lastTickAt !== null) this.gaps.push(now - this.lastTickAt);
    this.lastTickAt = now;
  }

  /** An own command went out */
  commandSent(now: number): void {
    this.sent.push(now);
  }

  /** An own command runs here now; they come back in the order they went */
  commandRan(now: number): void {
    const at = this.sent.shift();
    if (at !== undefined) this.inputs.push(now - at);
  }

  /** The report once REPORT_EVERY_MS passed since the last, and a new period; null before. */
  reportDue(now: number): LockstepStatsReport | null {
    if (this.periodStart === null) this.periodStart = now;
    if (now - this.periodStart < REPORT_EVERY_MS || this.frames === 0) return null;
    const report = this.report();
    this.periodStart = now;
    this.frames = 0;
    this.blockedFrames = 0;
    this.steps = [0, 0, 0, 0];
    this.behindSum = 0;
    this.behindMin = Infinity;
    this.gaps = [];
    this.inputs = [];
    return report;
  }

  private report(): LockstepStatsReport {
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const gapAvg = this.gaps.length > 0 ? mean(this.gaps) : 0;
    const gapSd = this.gaps.length > 0 ? Math.sqrt(mean(this.gaps.map((g) => (g - gapAvg) ** 2))) : 0;
    return {
      frames: this.frames,
      blocked: this.blockedFrames / this.frames,
      steps: [...this.steps],
      behindAvg: this.behindSum / this.frames,
      behindMin: this.behindMin === Infinity ? 0 : this.behindMin,
      tickGapAvg: gapAvg,
      tickGapSd: gapSd,
      inputAvg: this.inputs.length > 0 ? mean(this.inputs) : null,
      inputMax: this.inputs.length > 0 ? Math.max(...this.inputs) : null,
      inputs: this.inputs.length,
    };
  }
}

/** "600 frames, blocked 35%, steps 0:210 1:300 2:60 3+:30, behind 0.4 (min 0), ticks 66±12 ms, input 95 ms (max 140, n 12)" */
export function statsLine(r: LockstepStatsReport): string {
  const input = r.inputAvg === null ? 'no input' : `input ${Math.round(r.inputAvg)} ms (max ${Math.round(r.inputMax ?? 0)}, n ${r.inputs})`;
  return `${r.frames} frames, blocked ${Math.round(r.blocked * 100)}%, steps 0:${r.steps[0]} 1:${r.steps[1]} 2:${r.steps[2]} 3+:${r.steps[3]}, `
    + `behind ${r.behindAvg.toFixed(1)} (min ${r.behindMin}), ticks ${Math.round(r.tickGapAvg)}±${Math.round(r.tickGapSd)} ms, ${input}`;
}
