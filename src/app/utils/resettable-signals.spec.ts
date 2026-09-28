import { describe, it, expect } from 'vitest';
import { ResettableSignals } from './resettable-signals';

describe('ResettableSignals', () => {
  it('puts every signal back to its start value at once', () => {
    const group = new ResettableSignals();
    const status = group.signal<'off' | 'on'>('off');
    const list = group.signal<readonly number[]>([]);
    status.set('on');
    list.set([1, 2]);
    group.reset();
    expect(status()).toBe('off');
    expect(list()).toEqual([]);
  });
});
