import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface PendingLoad {
  url: string;
  onLoad: (buffer: { url: string }) => void;
  onError: (err: unknown) => void;
}

const reg = vi.hoisted(() => ({
  pending: [] as PendingLoad[],
  /** URLs whose error callback fires inside load(), before it returns. */
  syncFailing: new Set<string>(),
}));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeAudioLoader {
    load(url: string, onLoad: PendingLoad['onLoad'], _progress: unknown, onError: PendingLoad['onError']) {
      if (reg.syncFailing.has(url)) onError(new Error(`bad url ${url}`));
      else reg.pending.push({ url, onLoad, onError });
    }
  }
  return { ...three, AudioLoader: FakeAudioLoader };
});

import { MusicBufferLoader } from './music-buffer-loader';

describe('MusicBufferLoader', () => {
  let loader: MusicBufferLoader;

  beforeEach(() => {
    reg.pending.length = 0;
    reg.syncFailing.clear();
    loader = new MusicBufferLoader();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shares a load in flight and serves the buffer from the cache afterwards', async () => {
    const first = loader.load('a.mp3');
    const second = loader.load('a.mp3');
    expect(reg.pending).toHaveLength(1);

    reg.pending[0].onLoad({ url: 'a.mp3' });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);

    await expect(loader.load('a.mp3')).resolves.toBe(a);
    expect(reg.pending).toHaveLength(1);
  });

  it('answers null for a failed load and tries again on the next request', async () => {
    const failed = loader.load('a.mp3');
    reg.pending[0].onError(new Error('404'));

    await expect(failed).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a.mp3'), expect.any(Error));

    void loader.load('a.mp3');
    expect(reg.pending).toHaveLength(2);
  });

  it('recovers from an error the loader reports before load() returns', async () => {
    reg.syncFailing.add('a.mp3');
    await expect(loader.load('a.mp3')).resolves.toBeNull();

    reg.syncFailing.clear();
    const retry = loader.load('a.mp3');
    expect(reg.pending).toHaveLength(1);
    reg.pending[0].onLoad({ url: 'a.mp3' });
    await expect(retry).resolves.toEqual({ url: 'a.mp3' });
  });
});
