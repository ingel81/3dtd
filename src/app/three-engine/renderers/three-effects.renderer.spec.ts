import { describe, it, expect } from 'vitest';

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
