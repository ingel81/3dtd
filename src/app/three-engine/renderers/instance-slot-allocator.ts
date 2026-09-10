/**
 * Slot allocator for instanced pools (enemy types, health bars, projectiles).
 *
 * Freed slots go onto a free list and are handed out again before the pool
 * grows. `activeCount` is one past the highest slot in use: the draw count
 * and the length of the per-frame buffer uploads. Releasing the top slot
 * drops it back over every free slot below, so a pool that peaked at 20 000
 * stops drawing and uploading 20 000 slots once that wave is gone.
 *
 * Slots cut off that way stay on the free list and are skipped when alloc()
 * reaches them, instead of searching the list on every shrink. The pool only
 * grows again once the list is empty, so an entry below `activeCount` always
 * names a free slot.
 */
export class InstanceSlotAllocator {
  private readonly used: Uint8Array;
  private readonly free: number[] = [];
  private _activeCount = 0;

  constructor(readonly capacity: number) {
    this.used = new Uint8Array(capacity);
  }

  /** One past the highest slot in use, 0 when the pool is empty. */
  get activeCount(): number {
    return this._activeCount;
  }

  /** A free slot, or -1 when all `capacity` slots are taken. */
  alloc(): number {
    while (this.free.length > 0) {
      const index = this.free.pop()!;
      if (index < this._activeCount) {
        this.used[index] = 1;
        return index;
      }
    }
    if (this._activeCount >= this.capacity) return -1;
    const index = this._activeCount++;
    this.used[index] = 1;
    return index;
  }

  /** Free a slot. Ignores slots that are not in use. */
  release(index: number): void {
    if (!this.used[index]) return;
    this.used[index] = 0;
    this.free.push(index);
    if (index === this._activeCount - 1) {
      let top = index;
      while (top > 0 && !this.used[top - 1]) top--;
      this._activeCount = top;
    }
  }

  /** Free every slot. */
  reset(): void {
    this.used.fill(0);
    this.free.length = 0;
    this._activeCount = 0;
  }
}
