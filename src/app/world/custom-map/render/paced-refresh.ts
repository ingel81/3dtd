/**
 * A refresh that runs at once when it has rested, then at most every
 * `interval` ms while requests keep coming (an editor drag moves objects
 * every frame), and always once more after the last request: the final
 * state is never missed. What a request brings along (the objects a contact
 * shadow must redo) is gathered until the run.
 */
export class PacedRefresh<T> {
  private at = -Infinity;
  private due: ReturnType<typeof setTimeout> | null = null;
  private gathered: T[] = [];
  private whole = false;

  /**
   * @param run Gets what the requests brought, or null when one asked for everything
   */
  constructor(
    private readonly interval: number,
    private readonly run: (items: T[] | null) => void,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  /** Asks for a run with these items; none for a run over everything */
  request(items?: readonly T[]): void {
    if (items) for (const item of items) this.gathered.push(item);
    else this.whole = true;
    if (this.due) return;
    const wait = this.at + this.interval - this.clock();
    if (wait <= 0) this.fire();
    else this.due = setTimeout(() => this.fire(), wait);
  }

  /** Forgets what waits (the view went) */
  cancel(): void {
    if (this.due) clearTimeout(this.due);
    this.due = null;
    this.gathered = [];
    this.whole = false;
  }

  private fire(): void {
    this.due = null;
    this.at = this.clock();
    const items = this.whole ? null : this.gathered;
    this.gathered = [];
    this.whole = false;
    this.run(items);
  }
}
