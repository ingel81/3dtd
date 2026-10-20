/**
 * Work that a frame's packets bring and that waits for the frame after it.
 * The simulation's packets are applied at the start of a frame, before the
 * world's update in the same frame: what a strike wiped out or dug, done
 * there, landed in the strike's own frame (a nuclear strike's impact took
 * 37 ms, E271). `mark` in the packet, `tick` at the start of each update,
 * `open` from the update after the mark's.
 */
export class NextFrameGate {
  private frame = 0;
  private markedFor = 0;

  /** A new frame's update begins */
  tick(): void {
    this.frame++;
  }

  /** Work came now: it waits for the update after the coming one */
  mark(): void {
    this.markedFor = this.frame + 1;
  }

  /** Whether the work may run in this update */
  get open(): boolean {
    return this.frame > this.markedFor;
  }
}
