import { InstancedBufferAttribute, type BufferAttribute } from 'three';

/**
 * Per-slot update ranges one attribute collects before uploadSlot()
 * collapses them into one range over the drawn slots. three clears the
 * ranges only when it uploads, so while nothing renders (headless
 * training) they would otherwise pile up without bound.
 */
const MAX_SLOT_RANGES = 64;

/**
 * A copy of a per-instance attribute with room for `capacity` instances,
 * its values kept, for a pool that grew (InstanceSlotAllocator.grow). The
 * caller swaps it in; three frees the old one's GPU buffer only with the
 * geometry (or InstancedMesh) it belonged to, so the caller disposes that
 * first.
 */
export function grownAttribute(attribute: InstancedBufferAttribute, capacity: number): InstancedBufferAttribute {
  const array = new Float32Array(capacity * attribute.itemSize);
  array.set(attribute.array as Float32Array);
  const grown = new InstancedBufferAttribute(array, attribute.itemSize, attribute.normalized, attribute.meshPerAttribute);
  grown.setUsage(attribute.usage);
  return grown;
}

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
  private used: Uint8Array;
  private readonly free: number[] = [];
  private _activeCount = 0;

  constructor(private _capacity: number) {
    this.used = new Uint8Array(_capacity);
  }

  /** Slots there are, taken or free */
  get capacity(): number {
    return this._capacity;
  }

  /**
   * Room for `capacity` slots, the slots in use kept: for a pool whose
   * buffers grow with it (health bars, enemy types). Never shrinks.
   */
  grow(capacity: number): void {
    if (capacity <= this._capacity) return;
    const used = new Uint8Array(capacity);
    used.set(this.used);
    this.used = used;
    this._capacity = capacity;
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
    if (this._activeCount >= this._capacity) return -1;
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

  /**
   * Queue one slot of a per-instance attribute for upload, for attributes
   * no frame flush covers. The slot must be in use (below activeCount).
   */
  uploadSlot(attribute: BufferAttribute, index: number): void {
    const itemSize = attribute.itemSize;
    if (attribute.updateRanges.length >= MAX_SLOT_RANGES) {
      // Slots at or above activeCount are not drawn and get rewritten
      // before the pool grows over them, so the drawn slice covers all.
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this._activeCount * itemSize);
    } else {
      attribute.addUpdateRange(index * itemSize, itemSize);
    }
    attribute.needsUpdate = true;
  }

  /** Free every slot. */
  reset(): void {
    this.used.fill(0);
    this.free.length = 0;
    this._activeCount = 0;
  }
}
