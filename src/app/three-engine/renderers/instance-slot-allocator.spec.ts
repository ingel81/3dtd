import { describe, it, expect } from 'vitest';
import { InstanceSlotAllocator } from './instance-slot-allocator';

describe('InstanceSlotAllocator', () => {
  it('hands out slots in order and reuses a freed one before growing', () => {
    const slots = new InstanceSlotAllocator(8);
    expect([slots.alloc(), slots.alloc(), slots.alloc()]).toEqual([0, 1, 2]);

    slots.release(1);
    expect(slots.activeCount).toBe(3); // a hole, slot 2 is still in use
    expect(slots.alloc()).toBe(1);
    expect(slots.alloc()).toBe(3);
    expect(slots.activeCount).toBe(4);
  });

  it('shrinks over the free slots below the released top slot', () => {
    const slots = new InstanceSlotAllocator(8);
    for (let i = 0; i < 5; i++) slots.alloc();

    slots.release(1);
    slots.release(3);
    expect(slots.activeCount).toBe(5);
    slots.release(4); // top slot: 3 is free too, 2 is not
    expect(slots.activeCount).toBe(3);
    slots.release(2); // 1 is free, 0 is not
    expect(slots.activeCount).toBe(1);
    slots.release(0);
    expect(slots.activeCount).toBe(0);
  });

  it('never hands out a slot that was cut off by a shrink from the free list', () => {
    const slots = new InstanceSlotAllocator(8);
    for (let i = 0; i < 4; i++) slots.alloc();
    slots.release(2);
    slots.release(3); // shrinks to 2, slots 2 and 3 stay on the list
    expect(slots.activeCount).toBe(2);

    expect(slots.alloc()).toBe(2); // grows, the stale entries are dropped
    expect(slots.alloc()).toBe(3);
    expect(slots.alloc()).toBe(4);
    expect(slots.activeCount).toBe(5);
  });

  it('returns -1 when full and ignores releases of free slots', () => {
    const slots = new InstanceSlotAllocator(2);
    expect([slots.alloc(), slots.alloc(), slots.alloc()]).toEqual([0, 1, -1]);

    slots.release(0);
    slots.release(0);
    slots.release(7);
    slots.release(-1);
    expect(slots.alloc()).toBe(0);
    expect(slots.alloc()).toBe(-1); // released twice, handed out once
  });

  it('frees everything on reset', () => {
    const slots = new InstanceSlotAllocator(4);
    slots.alloc();
    slots.alloc();
    slots.release(0);
    slots.reset();
    expect(slots.activeCount).toBe(0);
    expect(slots.alloc()).toBe(0);
    expect(slots.alloc()).toBe(1);
  });

  it('keeps activeCount at the highest live slot through random churn', () => {
    const capacity = 64;
    const slots = new InstanceSlotAllocator(capacity);
    const live = new Set<number>();
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let step = 0; step < 20000; step++) {
      // Drift between filling up and draining so both ends get exercised.
      const fillBias = Math.floor(step / 2000) % 2 === 0 ? 0.65 : 0.35;
      if (live.size === 0 || random() < fillBias) {
        const index = slots.alloc();
        if (live.size === capacity) {
          expect(index).toBe(-1);
        } else {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(live.has(index)).toBe(false);
          live.add(index);
        }
      } else {
        const pick = [...live][Math.floor(random() * live.size)];
        live.delete(pick);
        slots.release(pick);
      }
      const top = live.size === 0 ? 0 : Math.max(...live) + 1;
      expect(slots.activeCount).toBe(top);
    }
  });
});
