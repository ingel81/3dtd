import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { BackgroundMusicService } from './background-music.service';
import { BACKGROUND_MUSIC, BackgroundMusicConfig } from '../configs/background-music.config';
import type { ThreeTilesEngine } from '../three-engine';

/**
 * Characterization of the background music: the static main theme during
 * loading, the build/wave phase crossfades on the two Three.js channels, the
 * loop crossfade before a track ends, and the user switch and volume.
 *
 * Three's Audio and AudioLoader are replaced by fakes that record what the
 * service asks for; requestAnimationFrame and performance.now are driven by
 * the test so a fade can be stepped to any point.
 */

interface FakeBuffer {
  url: string;
  duration: number;
}

interface PendingLoad {
  url: string;
  onLoad: (buffer: FakeBuffer) => void;
}

const reg = vi.hoisted(() => ({
  audios: [] as FakeAudioShape[],
  failing: new Set<string>(),
  /** URLs whose error callback fires inside load(), before it returns. */
  syncFailing: new Set<string>(),
  manual: false,
  pending: [] as PendingLoad[],
  bufferFor(url: string): FakeBuffer {
    return { url, duration: 60 };
  },
  testConfig(): BackgroundMusicConfig {
    return {
      main: [{ id: 'main', url: 'main.mp3', volume: 0.5, startOffset: 20, loop: false }],
      build: [
        { id: 'b1', url: 'b1.mp3', volume: 0.6 },
        { id: 'b2', url: 'b2.mp3', volume: 0.8 },
      ],
      wave: [
        { id: 'w1', url: 'w1.mp3' },
        { id: 'w2', url: 'w2.mp3' },
        { id: 'w3', url: 'w3.mp3' },
      ],
      loopCrossfadeDuration: 2000,
      phaseFadeDuration: 1500,
      mainThemeFadeOutDuration: 3000,
      mainThemeGapDuration: 600,
      masterVolume: 0.4,
    };
  },
}));

interface FakeAudioShape {
  isPlaying: boolean;
  buffer: FakeBuffer | null;
  volume: number;
  loop: boolean;
  disconnected: boolean;
}

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();

  class FakeAudio implements FakeAudioShape {
    isPlaying = false;
    buffer: FakeBuffer | null = null;
    volume = 1;
    loop = true;
    disconnected = false;
    constructor(_listener: unknown) {
      reg.audios.push(this);
    }
    setBuffer(buffer: FakeBuffer) { this.buffer = buffer; return this; }
    setLoop(loop: boolean) { this.loop = loop; return this; }
    setVolume(volume: number) { this.volume = volume; return this; }
    play() { this.isPlaying = true; return this; }
    stop() { this.isPlaying = false; return this; }
    disconnect() { this.disconnected = true; return this; }
  }

  class FakeAudioLoader {
    load(url: string, onLoad: (b: FakeBuffer) => void, _progress?: unknown, onError?: (e: unknown) => void) {
      if (reg.syncFailing.has(url)) {
        onError?.(new Error(`bad url ${url}`));
      } else if (reg.failing.has(url)) {
        // Network errors arrive asynchronously, as with the real loader.
        void Promise.resolve().then(() => onError?.(new Error(`404 ${url}`)));
      } else if (reg.manual) {
        reg.pending.push({ url, onLoad });
      } else {
        onLoad(reg.bufferFor(url));
      }
    }
  }

  return { ...three, Audio: FakeAudio, AudioLoader: FakeAudioLoader };
});

vi.mock('../configs/background-music.config', () => ({ BACKGROUND_MUSIC: reg.testConfig() }));

/** Stand-in for the HTMLAudioElement the static main theme creates. */
class FakeHtmlAudio {
  static instances: FakeHtmlAudio[] = [];
  static rejectPlay = false;
  loop = true;
  volume = 1;
  currentTime = 0;
  readyState = 0;
  paused = true;
  private listeners = new Map<string, () => void>();
  play = vi.fn(() => {
    if (FakeHtmlAudio.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => { this.paused = true; });
  constructor(public src: string) {
    FakeHtmlAudio.instances.push(this);
  }
  addEventListener(type: string, cb: () => void) {
    this.listeners.set(type, cb);
  }
  dispatch(type: string) {
    this.listeners.get(type)?.();
  }
}

// ─── Frame / clock driver ──────────────────────────────────────

const NOW = 1000;
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

/** Run every pending animation frame at the given timestamp. */
function frame(now: number): void {
  const callbacks = [...frames.values()];
  frames = new Map();
  callbacks.forEach((cb) => cb(now));
}

/** Settle the service's async load/resume chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(opts: { stored?: string; suspended?: boolean } = {}) {
  if (opts.stored !== undefined) localStorage.setItem('td_music_enabled', opts.stored);
  const eventBus = new GameEventBus();
  const context = {
    state: opts.suspended ? 'suspended' : 'running',
    resume: vi.fn(async () => { context.state = 'running'; }),
  };
  const engine = { spatialAudio: { getListener: () => ({ context }) } };
  const before = reg.audios.length;
  const service = new BackgroundMusicService(eventBus, engine as unknown as ThreeTilesEngine);
  const channels = reg.audios.slice(before);
  const playing = () => channels.filter((c) => c.isPlaying);

  const waveStarted = async () => {
    eventBus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
    await flush();
  };
  const waveCompleted = async () => {
    eventBus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    await flush();
  };
  /** Loading screen gone, no main theme: gap, then the build track fully faded in. */
  const startBuild = async () => {
    service.onLoadingComplete();
    await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.mainThemeGapDuration);
    await flush();
    frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
  };

  return { eventBus, context, service, channels, playing, waveStarted, waveCompleted, startBuild };
}

/** Track volume as the service computes it: per-track (default 0.5) times master. */
function trackVolume(id: string): number {
  const track = [...BACKGROUND_MUSIC.build, ...BACKGROUND_MUSIC.wave].find((t) => t.id === id)!;
  return (track.volume ?? 0.5) * BACKGROUND_MUSIC.masterVolume;
}

beforeEach(() => {
  Object.assign(BACKGROUND_MUSIC, reg.testConfig());
  reg.audios.length = 0;
  reg.failing.clear();
  reg.syncFailing.clear();
  reg.manual = false;
  reg.pending.length = 0;
  FakeHtmlAudio.instances = [];
  FakeHtmlAudio.rejectPlay = false;
  localStorage.clear();
  frames = new Map();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('Audio', FakeHtmlAudio);
  vi.spyOn(performance, 'now').mockReturnValue(NOW);
  // Deterministic track picks: always the first candidate.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  // The main theme lives in a static field; drop it so tests stay independent.
  (BackgroundMusicService as unknown as { mainThemeAudio: unknown }).mainThemeAudio = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BackgroundMusicService.playMainTheme', () => {
  it('starts the main track once and waits for metadata before seeking to its offset', () => {
    BackgroundMusicService.playMainTheme();
    BackgroundMusicService.playMainTheme();

    expect(FakeHtmlAudio.instances).toHaveLength(1);
    const audio = FakeHtmlAudio.instances[0];
    expect(audio.src).toBe('main.mp3');
    expect(audio.loop).toBe(false);
    expect(audio.volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume);
    expect(audio.play).not.toHaveBeenCalled();

    audio.dispatch('loadedmetadata');
    expect(audio.currentTime).toBe(20);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('plays at once from the start when the track has no offset', () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    BackgroundMusicService.playMainTheme();

    const audio = FakeHtmlAudio.instances[0];
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume);
  });

  it('stays silent when the player turned music off', () => {
    localStorage.setItem('td_music_enabled', 'false');
    BackgroundMusicService.playMainTheme();
    expect(FakeHtmlAudio.instances).toHaveLength(0);
  });

  it('swallows a blocked autoplay', async () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    FakeHtmlAudio.rejectPlay = true;
    expect(() => BackgroundMusicService.playMainTheme()).not.toThrow();
    await flush();
  });
});

describe('BackgroundMusicService', () => {
  describe('music switch', () => {
    it('is on by default and remembers a stored choice', () => {
      expect(setup().service.enabled).toBe(true);
      expect(setup({ stored: 'false' }).service.enabled).toBe(false);
    });

    it('toggle persists the choice and silences the running track when turned off', async () => {
      const { service, playing, startBuild } = setup();
      await startBuild();
      expect(playing()).toHaveLength(1);

      expect(service.toggle()).toBe(false);
      expect(localStorage.getItem('td_music_enabled')).toBe('false');
      expect(playing()).toHaveLength(0);

      expect(service.toggle()).toBe(true);
      expect(localStorage.getItem('td_music_enabled')).toBe('true');
      // Turning it back on does not restart anything by itself.
      expect(playing()).toHaveLength(0);
    });

    it('disable also stops the main theme', () => {
      BackgroundMusicService.playMainTheme();
      const main = FakeHtmlAudio.instances[0];
      const { service } = setup();

      service.disable();

      expect(main.pause).toHaveBeenCalled();
      expect(main.src).toBe('');
    });

    it('ignores phase events while music is off', async () => {
      const { playing, waveStarted, waveCompleted } = setup({ stored: 'false' });
      await waveStarted();
      await waveCompleted();
      expect(playing()).toHaveLength(0);
    });
  });

  describe('end of loading', () => {
    it('without a main theme, waits the silent gap and fades a build track in', async () => {
      const { service, playing } = setup();
      service.onLoadingComplete();

      await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.mainThemeGapDuration - 1);
      await flush();
      expect(playing()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      const [build] = playing();
      expect(build.buffer?.url).toBe('b1.mp3');
      expect(build.loop).toBe(false);
      expect(build.volume).toBe(0);

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration / 2);
      expect(build.volume).toBeCloseTo(trackVolume('b1') / 2);
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(build.volume).toBeCloseTo(trackVolume('b1'));
    });

    it('fades a playing main theme out first, then the gap, then build', async () => {
      BackgroundMusicService.playMainTheme();
      const main = FakeHtmlAudio.instances[0];
      main.dispatch('loadedmetadata');
      const startVolume = main.volume;
      const { service, playing } = setup();

      service.onLoadingComplete();
      frame(NOW + BACKGROUND_MUSIC.mainThemeFadeOutDuration / 2);
      expect(main.volume).toBeCloseTo(startVolume / 2);
      expect(main.paused).toBe(false);

      frame(NOW + BACKGROUND_MUSIC.mainThemeFadeOutDuration);
      expect(main.paused).toBe(true);
      expect(main.src).toBe('');
      await flush();
      expect(playing()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.mainThemeGapDuration);
      await flush();
      expect(playing()).toHaveLength(1);
    });

    it('with music off, drops the main theme and starts nothing', async () => {
      BackgroundMusicService.playMainTheme();
      const main = FakeHtmlAudio.instances[0];
      const { service, playing } = setup({ stored: 'false' });

      service.onLoadingComplete();
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();

      expect(main.pause).toHaveBeenCalled();
      expect(playing()).toHaveLength(0);
    });

    it('stop() during the gap cancels the build start', async () => {
      const { service, playing } = setup();
      service.onLoadingComplete();
      service.stop();

      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      expect(playing()).toHaveLength(0);
    });
  });

  describe('phases', () => {
    it('crossfades from build to a wave track and stops the build channel when the fade ends', async () => {
      const { playing, startBuild, waveStarted } = setup();
      await startBuild();
      const [build] = playing();

      await waveStarted();
      const wave = playing().find((c) => c !== build)!;
      expect(wave.buffer?.url).toBe('w1.mp3');
      expect(wave.volume).toBe(0);

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration / 2);
      expect(build.volume).toBeCloseTo(trackVolume('b1') / 2);
      expect(wave.volume).toBeCloseTo(trackVolume('w1') / 2);

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(build.isPlaying).toBe(false);
      expect(playing()).toEqual([wave]);
      expect(wave.volume).toBeCloseTo(trackVolume('w1'));
    });

    it('goes back to build music when the wave completes', async () => {
      const { playing, startBuild, waveStarted, waveCompleted } = setup();
      await startBuild();
      await waveStarted();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);

      await waveCompleted();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);

      expect(playing()).toHaveLength(1);
      // b1 was the last build track, so the other one comes next.
      expect(playing()[0].buffer?.url).toBe('b2.mp3');
    });

    it('never repeats the previous wave track back to back', async () => {
      const { playing, waveStarted, waveCompleted } = setup();
      const waveTracks: (string | undefined)[] = [];
      for (let i = 0; i < 3; i++) {
        await waveStarted();
        frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
        waveTracks.push(playing()[0].buffer?.url);
        await waveCompleted();
        frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      }
      expect(waveTracks).toEqual(['w1.mp3', 'w2.mp3', 'w1.mp3']);
    });

    it('fades out on game over without starting a new track', async () => {
      const { eventBus, playing, startBuild } = setup();
      await startBuild();
      const [build] = playing();

      eventBus.emit({ type: 'game:over', reason: 'base-destroyed' });
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration / 2);
      expect(build.volume).toBeCloseTo(trackVolume('b1') / 2);
      expect(playing()).toEqual([build]);

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(0);
    });

    it('stops everything at once on game reset, even mid crossfade', async () => {
      const { eventBus, playing, startBuild, waveStarted } = setup();
      await startBuild();
      await waveStarted();
      expect(playing()).toHaveLength(2);

      eventBus.emit({ type: 'game:reset' });
      expect(playing()).toHaveLength(0);

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(0);
    });

    it('resumes a suspended audio context before playing', async () => {
      const { context, playing, waveStarted } = setup({ suspended: true });
      await waveStarted();
      expect(context.resume).toHaveBeenCalledOnce();
      expect(playing()).toHaveLength(1);
    });
  });

  describe('loop crossfade', () => {
    it('restarts the same track on the other channel shortly before it ends', async () => {
      const { playing, startBuild } = setup();
      await startBuild();
      const [first] = playing();
      const lead = first.buffer!.duration * 1000 - BACKGROUND_MUSIC.loopCrossfadeDuration;

      await vi.advanceTimersByTimeAsync(lead - 1);
      await flush();
      expect(playing()).toEqual([first]);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      const second = playing().find((c) => c !== first)!;
      expect(second.buffer?.url).toBe(first.buffer?.url);

      frame(NOW + BACKGROUND_MUSIC.loopCrossfadeDuration / 2);
      expect(second.volume).toBeCloseTo(trackVolume('b1') / 2);
      frame(NOW + BACKGROUND_MUSIC.loopCrossfadeDuration);
      expect(playing()).toEqual([second]);
    });

    it('does not loop once the music was stopped', async () => {
      const { service, playing, startBuild } = setup();
      await startBuild();
      service.stop();

      await vi.advanceTimersByTimeAsync(120_000);
      await flush();
      expect(playing()).toHaveLength(0);
    });
  });

  describe('volume', () => {
    it('clamps the user volume and applies it to the running track at once', async () => {
      const { service, playing, startBuild } = setup();
      await startBuild();
      const [build] = playing();

      service.setVolume(0.5);
      expect(service.volume).toBe(0.5);
      expect(build.volume).toBeCloseTo(trackVolume('b1') * 0.5);

      service.setVolume(2);
      expect(service.volume).toBe(1);
      expect(build.volume).toBeCloseTo(trackVolume('b1'));

      service.setVolume(-1);
      expect(service.volume).toBe(0);
      expect(build.volume).toBe(0);
    });

    it('retargets a fade-in that is still running', async () => {
      const { service, playing, startBuild, waveStarted } = setup();
      await startBuild();
      const [build] = playing();
      await waveStarted();
      const wave = playing().find((c) => c !== build)!;

      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration / 2);
      service.setVolume(0.5);
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);

      expect(wave.volume).toBeCloseTo(trackVolume('w1') * 0.5);
    });

    it('applies to tracks that start later', async () => {
      const { service, playing, startBuild } = setup();
      service.setVolume(0.5);
      await startBuild();
      expect(playing()[0].volume).toBeCloseTo(trackVolume('b1') * 0.5);
    });
  });

  describe('loading', () => {
    it('plays nothing when the track fails to load', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      reg.failing.add('w1.mp3');
      const { playing, waveStarted } = setup();
      await flush(); // the preload has failed by the time the wave starts

      await waveStarted();

      expect(playing()).toHaveLength(0);
      // Preload and the retry on the phase change both report the file.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('w1.mp3'), expect.anything());
    });

    it('plays nothing when the phase change shares a preload that then fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      reg.failing.add('w1.mp3');
      const { playing, waveStarted } = setup();

      await waveStarted(); // the preload of w1 is still in flight

      expect(playing()).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('loads a track again after the loader reported an error synchronously', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      reg.syncFailing.add('w1.mp3');
      const { playing, waveStarted } = setup();
      await flush();
      reg.syncFailing.clear();

      await waveStarted();

      expect(playing().map((c) => c.buffer?.url)).toEqual(['w1.mp3']);
    });

    it('loads every build and wave track once up front', () => {
      reg.manual = true;
      setup();
      expect(reg.pending.map((p) => p.url).sort()).toEqual(['b1.mp3', 'b2.mp3', 'w1.mp3', 'w2.mp3', 'w3.mp3']);
    });

    it('drops a phase change that was stopped while its track was still loading', async () => {
      reg.manual = true;
      const { eventBus, playing, waveStarted } = setup();
      await waveStarted();
      eventBus.emit({ type: 'game:reset' });

      reg.pending.forEach((p) => p.onLoad(reg.bufferFor(p.url)));
      await flush();

      expect(playing()).toHaveLength(0);
    });
  });

  it('destroy unsubscribes, silences and disconnects both channels', async () => {
    BackgroundMusicService.playMainTheme();
    const main = FakeHtmlAudio.instances[0];
    const { service, channels, playing, waveStarted } = setup();
    await waveStarted();
    expect(playing()).toHaveLength(1);

    service.destroy();

    expect(playing()).toHaveLength(0);
    expect(channels.every((c) => c.disconnected)).toBe(true);
    expect(main.src).toBe('');
    await waveStarted();
    expect(playing()).toHaveLength(0);
  });
});
