import { describe, expect, it } from 'vitest';
import { fnv1a } from './fnv1a';

describe('fnv1a', () => {
  it('hashes with FNV-1a', () => {
    // Reference values of 32-bit FNV-1a
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });
});
