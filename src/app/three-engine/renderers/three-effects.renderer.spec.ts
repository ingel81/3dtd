import { describe, it, expect } from 'vitest';

describe('Free-Stack Pool Allocation Logic', () => {
  interface MockInstance { id: string; active: boolean; }

  /**
   * Free-stack allocation: pop from stack for O(1) reuse.
   * Used by FloatingTextInstanceManager, DecalInstanceManager, etc.
   */
  function allocateFromFreeStack(
    pool: MockInstance[],
    freeIndices: number[]
  ): MockInstance | undefined {
    if (freeIndices.length > 0) {
      return pool[freeIndices.pop()!];
    }
    return undefined;
  }

  function deactivateInstance(
    pool: MockInstance[],
    freeIndices: number[],
    index: number
  ): void {
    pool[index].active = false;
    freeIndices.push(index);
  }

  it('should pop from free-stack and return the correct instance', () => {
    const pool: MockInstance[] = [
      { id: 'a', active: false },
      { id: 'b', active: true },
      { id: 'c', active: false },
    ];
    const freeIndices = [0, 2]; // indices 0 and 2 are free

    const result = allocateFromFreeStack(pool, freeIndices);
    expect(result).toBe(pool[2]); // Last-in (index 2) is popped first
    expect(freeIndices).toEqual([0]);
  });

  it('should return undefined when free-stack is empty', () => {
    const pool: MockInstance[] = [
      { id: 'a', active: true },
      { id: 'b', active: true },
    ];
    const freeIndices: number[] = [];

    const result = allocateFromFreeStack(pool, freeIndices);
    expect(result).toBeUndefined();
  });

  it('should make deactivated index available for reuse', () => {
    const pool: MockInstance[] = [
      { id: 'a', active: true },
      { id: 'b', active: true },
      { id: 'c', active: true },
    ];
    const freeIndices: number[] = [];

    deactivateInstance(pool, freeIndices, 1);
    expect(pool[1].active).toBe(false);
    expect(freeIndices).toEqual([1]);

    const reused = allocateFromFreeStack(pool, freeIndices);
    expect(reused).toBe(pool[1]);
    expect(freeIndices).toEqual([]);
  });

  it('should support multiple deactivations and allocations in LIFO order', () => {
    const pool: MockInstance[] = [
      { id: 'a', active: true },
      { id: 'b', active: true },
      { id: 'c', active: true },
    ];
    const freeIndices: number[] = [];

    deactivateInstance(pool, freeIndices, 0);
    deactivateInstance(pool, freeIndices, 2);
    expect(freeIndices).toEqual([0, 2]);

    expect(allocateFromFreeStack(pool, freeIndices)).toBe(pool[2]);
    expect(allocateFromFreeStack(pool, freeIndices)).toBe(pool[0]);
    expect(allocateFromFreeStack(pool, freeIndices)).toBeUndefined();
  });
});

describe('Particle Pool Cursor Logic', () => {
  interface MockParticle { life: number; }

  function getInactiveParticle(pool: MockParticle[], cursor: { value: number }): MockParticle | null {
    const len = pool.length;
    for (let i = 0; i < len; i++) {
      const idx = (cursor.value + i) % len;
      if (pool[idx].life <= 0) {
        cursor.value = (idx + 1) % len;
        return pool[idx];
      }
    }
    return null;
  }

  it('should find first inactive particle', () => {
    const pool = [{ life: 1 }, { life: 0 }, { life: 1 }];
    const cursor = { value: 0 };
    const result = getInactiveParticle(pool, cursor);
    expect(result).toBe(pool[1]);
    expect(cursor.value).toBe(2);
  });

  it('should wrap around using cursor', () => {
    const pool = [{ life: 0 }, { life: 1 }, { life: 1 }];
    const cursor = { value: 2 }; // Start near end
    const result = getInactiveParticle(pool, cursor);
    expect(result).toBe(pool[0]); // Wraps to index 0
    expect(cursor.value).toBe(1);
  });

  it('should return null when all active', () => {
    const pool = [{ life: 1 }, { life: 1 }, { life: 1 }];
    const cursor = { value: 0 };
    expect(getInactiveParticle(pool, cursor)).toBeNull();
  });

  it('should advance cursor for sequential calls', () => {
    const pool = [{ life: 0 }, { life: 0 }, { life: 0 }];
    const cursor = { value: 0 };

    getInactiveParticle(pool, cursor);
    expect(cursor.value).toBe(1);

    getInactiveParticle(pool, cursor);
    expect(cursor.value).toBe(2);

    getInactiveParticle(pool, cursor);
    expect(cursor.value).toBe(0); // Wraps
  });
});
