import { storageSafety } from './storage-safety';

describe('storageSafety', () => {
  it('trusts the desktop map folder', async () => {
    expect(await storageSafety(true, undefined, true)).toBe('folder');
  });

  it('asks for persistent storage only when told to, once not granted yet', async () => {
    const persist = vi.fn(async () => true);
    const storage = { persisted: async () => false, persist };
    expect(await storageSafety(false, storage, false)).toBe('evictable');
    expect(persist).not.toHaveBeenCalled();
    expect(await storageSafety(true, storage, false)).toBe('kept');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('knows granted storage without asking, and counts a refusal, a missing API or an error as evictable', async () => {
    const persist = vi.fn(async () => false);
    expect(await storageSafety(true, { persisted: async () => true, persist }, false)).toBe('kept');
    expect(persist).not.toHaveBeenCalled();
    expect(await storageSafety(true, { persisted: async () => false, persist }, false)).toBe('evictable');
    expect(await storageSafety(true, undefined, false)).toBe('evictable');
    expect(await storageSafety(true, { persisted: () => Promise.reject(new Error('no')) }, false)).toBe('evictable');
  });
});
