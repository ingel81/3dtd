import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readJson, readText, removeKey, writeJson, writeText } from './storage';

describe('storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('writes and reads text and JSON, and drops a key', () => {
    expect(writeText('a', 'x')).toBe(true);
    expect(readText('a')).toBe('x');
    expect(writeJson('b', { n: 1, list: [2] })).toBe(true);
    expect(readJson('b')).toEqual({ n: 1, list: [2] });
    removeKey('a');
    expect(readText('a')).toBeNull();
  });

  it('reads a missing key and a corrupt entry as null', () => {
    expect(readText('none')).toBeNull();
    expect(readJson('none')).toBeNull();
    localStorage.setItem('bad', '{not json');
    expect(readJson('bad')).toBeNull();
  });

  it('goes on without storage: reads give null, writes false, a drop nothing', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    expect(readText('a')).toBeNull();
    expect(readJson('a')).toBeNull();
    expect(writeText('a', 'x')).toBe(false);
    expect(writeJson('a', {})).toBe(false);
    expect(() => removeKey('a')).not.toThrow();
  });
});
