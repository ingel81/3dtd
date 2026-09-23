import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioListener } from 'three';

/**
 * The two-channel crossfade on its own: which channel plays, the volumes
 * along a fade, the near-end callback that drives the gapless loop, and
 * stop / fade-out / user volume. BackgroundMusicService's spec covers the
 * phase logic on top of it.
 */

interface FakeAudioShape {
  isPlaying: boolean;
  buffer: { duration: number } | null;
  volume: number;
  loop: boolean;
  disconnected: boolean;
}

const reg = vi.hoisted(() => ({ audios: [] as FakeAudioShape[] }));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeAudio implements FakeAudioShape {
    isPlaying = false;
    buffer: { duration: number } | null = null;
    volume = 1;
    loop = false;
    disconnected = false;
    constructor(_listener: unknown) {
      reg.audios.push(this);
    }
    setBuffer(buffer: { duration: number }) { this.buffer = buffer; return this; }
    setLoop(loop: boolean) { this.loop = loop; return this; }
    setVolume(volume: number) { this.volume = volume; return this; }
    play() { this.isPlaying = true; return this; }
    stop() { this.isPlaying = false; return this; }
    disconnect() { this.disconnected = true; return this; }
  }
  return { ...three, Audio: FakeAudio };
});

import { MusicMixer, type NearEndCallback } from './music-mixer';

const NOW = 1000;
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function frame(now: number): void {
  const callbacks = [...frames.values()];
  frames = new Map();
  callbacks.forEach((cb) => cb(now));
}

const track = (duration = 60) => ({ duration }) as unknown as AudioBuffer;
const noLoop: NearEndCallback = { leadMs: 0, onNearEnd: () => undefined };

function setup(opts: { suspended?: boolean } = {}) {
  const context = {
    state: opts.suspended ? 'suspended' : 'running',
    resume: vi.fn(async () => { context.state = 'running'; }),
  };
  const before = reg.audios.length;
  const mixer = new MusicMixer({ context } as unknown as AudioListener);
  // Channel A starts out active, so the first track goes to B.
  const [second, first] = reg.audios.slice(before);
  return { mixer, first, second, context };
}

beforeEach(() => {
  frames = new Map();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MusicMixer', () => {
  it('fades the new track in on the idle channel while the old one fades out', async () => {
    const { mixer, first, second } = setup();
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    frame(NOW + 1000);
    expect(first.isPlaying).toBe(true);
    expect(first.volume).toBeCloseTo(0.4);

    await mixer.crossfadeTo(track(), 0.2, 1000, noLoop);
    expect(second.isPlaying).toBe(true);
    expect(second.volume).toBe(0);

    frame(NOW + 500);
    expect(first.volume).toBeCloseTo(0.2);
    expect(second.volume).toBeCloseTo(0.1);

    frame(NOW + 1000);
    expect(first.isPlaying).toBe(false);
    expect(second.volume).toBeCloseTo(0.2);
  });

  it('resumes a suspended audio context before it plays', async () => {
    const { mixer, first, context } = setup({ suspended: true });
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(first.isPlaying).toBe(true);
  });

  it('crossfades on when the audio context refuses to resume, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mixer, first, second, context } = setup({ suspended: true });
    context.resume.mockRejectedValue(new Error('not allowed'));

    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    expect(first.isPlaying).toBe(true);
    await mixer.crossfadeTo(track(), 0.2, 1000, noLoop);
    frame(NOW + 1000);

    expect(first.isPlaying).toBe(false);
    expect(second.isPlaying).toBe(true);
    expect(second.volume).toBeCloseTo(0.2);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fades the active track out to silence, and reports when nothing plays', async () => {
    const { mixer, first } = setup();
    expect(mixer.fadeOut(1000)).toBe(false);

    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    frame(NOW + 1000);
    expect(mixer.fadeOut(1000)).toBe(true);
    frame(NOW + 500);
    expect(first.volume).toBeCloseTo(0.2);
    frame(NOW + 1000);
    expect(first.isPlaying).toBe(false);
  });

  it('stops both channels at once, even mid crossfade', async () => {
    const { mixer, first, second } = setup();
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);

    mixer.stop();
    frame(NOW + 1000);

    expect(first.isPlaying).toBe(false);
    expect(second.isPlaying).toBe(false);
  });

  it('calls back shortly before the track ends while it is still active', async () => {
    const { mixer } = setup();
    const onNearEnd = vi.fn();
    await mixer.crossfadeTo(track(60), 0.4, 1000, { leadMs: 2000, onNearEnd });

    await vi.advanceTimersByTimeAsync(58_000 - 1);
    expect(onNearEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onNearEnd).toHaveBeenCalledOnce();
  });

  it('loops the playing track natively, so a late near-end timer in a hidden tab leaves no silence', async () => {
    const { mixer, first } = setup();
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    expect(first.loop).toBe(true);
  });

  it('drops the near-end callback of a track that was replaced or stopped', async () => {
    const { mixer } = setup();
    const replaced = vi.fn();
    const stopped = vi.fn();
    await mixer.crossfadeTo(track(60), 0.4, 1000, { leadMs: 2000, onNearEnd: replaced });
    await mixer.crossfadeTo(track(60), 0.4, 1000, { leadMs: 2000, onNearEnd: stopped });
    mixer.stop();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(replaced).not.toHaveBeenCalled();
    expect(stopped).not.toHaveBeenCalled();
  });

  it('scales playing channels and a running fade-in by the user volume', async () => {
    const { mixer, first, second } = setup();
    await mixer.crossfadeTo(track(), 0.4, 1000, noLoop);
    frame(NOW + 1000);
    mixer.setUserVolume(0.5);
    expect(first.volume).toBeCloseTo(0.2);

    await mixer.crossfadeTo(track(), 0.8, 1000, noLoop);
    frame(NOW + 500);
    mixer.setUserVolume(0.25);
    frame(NOW + 1000);
    expect(second.volume).toBeCloseTo(0.2);
  });

  it('disconnects both channels on dispose', () => {
    const { mixer, first, second } = setup();
    mixer.dispose();
    expect(first.disconnected).toBe(true);
    expect(second.disconnected).toBe(true);
  });
});
