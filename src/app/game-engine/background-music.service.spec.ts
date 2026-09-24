import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { BackgroundMusicService } from './background-music.service';
import { BACKGROUND_MUSIC, BackgroundMusicConfig } from '../configs/background-music.config';
import { MASTER_BUS_PRE_GAIN } from '../configs/audio.config';
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
      boss: [{ id: 'boss', url: 'boss.mp3' }],
      bloodMoon: [{ id: 'moon', url: 'moon.mp3' }],
      gameOver: [{ id: 'over', url: 'over.mp3', volume: 0.35 }],
      gameOverMusicDelayMs: 4000,
      waveEnd: { fadeOutMs: 1200, buildDelayMs: 2800, buildFadeInMs: 3000 },
      pauseDim: 0.35,
      duck: {
        nuclearStrike: { factor: 0.35, holdMs: 3000 },
        abilityImpact: { factor: 0.6, holdMs: 1200 },
        hqDamage: { factor: 0.65, holdMs: 600 },
        releaseMs: 800,
      },
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

function setup(opts: { suspended?: boolean } = {}) {
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
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
    expect(audio.volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume * MASTER_BUS_PRE_GAIN);
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
    expect(audio.volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume * MASTER_BUS_PRE_GAIN);
  });

  it('plays at the music volume of the player, 0 when muted', () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    BackgroundMusicService.playMainTheme(0.5);
    expect(FakeHtmlAudio.instances[0].volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume * MASTER_BUS_PRE_GAIN * 0.5);
  });

  it('swallows a blocked autoplay', async () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    FakeHtmlAudio.rejectPlay = true;
    expect(() => BackgroundMusicService.playMainTheme()).not.toThrow();
    await flush();
  });

  it('starts a blocked main theme on the first click or key, once', async () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    FakeHtmlAudio.rejectPlay = true;
    BackgroundMusicService.playMainTheme();
    await flush();
    const audio = FakeHtmlAudio.instances[0];
    expect(audio.play).toHaveBeenCalledOnce();

    FakeHtmlAudio.rejectPlay = false;
    window.dispatchEvent(new Event('pointerdown'));
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.paused).toBe(false);

    window.dispatchEvent(new Event('keydown'));
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});

describe('BackgroundMusicService', () => {
  it('sets the main theme to the music volume while it plays', () => {
    BACKGROUND_MUSIC.main[0] = { id: 'main', url: 'main.mp3' };
    BackgroundMusicService.playMainTheme();
    const { service } = setup();
    service.setVolume(0.25);
    expect(FakeHtmlAudio.instances[0].volume).toBeCloseTo(0.5 * BACKGROUND_MUSIC.masterVolume * MASTER_BUS_PRE_GAIN * 0.25);
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
      // Looped natively only as a fallback for a late crossfade timer (MusicMixer)
      expect(build.loop).toBe(true);
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
    it('follows a phase set by a restore, and leaves a track that fits alone', async () => {
      const { playing, service, startBuild } = setup();
      await startBuild();
      const [build] = playing();

      // Already build: nothing changes
      service.followPhase('setup', 0);
      await flush();
      expect(playing()).toEqual([build]);

      // A replay put the game in wave 1: the wave track comes in
      service.followPhase('wave', 1);
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      const wave = playing().find((c) => c !== build)!;
      expect(wave.buffer?.url).toBe('w1.mp3');

      // A seek within the same wave: the track plays on
      service.followPhase('wave', 1);
      await flush();
      expect(playing()).toEqual([wave]);
    });

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

    it('fades the wave music out when the wave completes, then brings build music in after the horn', async () => {
      const { playing, startBuild, waveStarted, waveCompleted } = setup();
      await startBuild();
      await waveStarted();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      const { fadeOutMs, buildDelayMs, buildFadeInMs } = BACKGROUND_MUSIC.waveEnd;

      await waveCompleted();
      frame(NOW + fadeOutMs);
      expect(playing()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(buildDelayMs);
      await flush();
      frame(NOW + buildFadeInMs);
      expect(playing()).toHaveLength(1);
      // b1 was the last build track, so the other one comes next.
      expect(playing()[0].buffer?.url).toBe('b2.mp3');
    });

    it('drops the build music after the horn when the next wave starts first', async () => {
      const { playing, startBuild, waveStarted, waveCompleted } = setup();
      await startBuild();
      await waveStarted();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      await waveCompleted();
      await waveStarted();
      await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.waveEnd.buildDelayMs);
      await flush();
      frame(NOW + BACKGROUND_MUSIC.waveEnd.buildFadeInMs);
      expect(playing().map((c) => c.buffer?.url)).toEqual([expect.stringMatching(/^w\d\.mp3$/)]);
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

    it('fades out on game over, then brings in the game-over track after the stinger', async () => {
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

      await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.phaseFadeDuration + BACKGROUND_MUSIC.gameOverMusicDelayMs);
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing().map((c) => c.buffer?.url)).toEqual(['over.mp3']);
    });

    it('plays the boss track on a boss wave and the blood-moon track on a blood-moon wave', async () => {
      const { eventBus, playing, startBuild } = setup();
      await startBuild();
      const start = async (wave: number) => {
        eventBus.emit({ type: 'wave:started', wave, enemyCount: 10 });
        await flush();
        frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
        return playing().map((c) => c.buffer?.url);
      };
      expect(await start(10)).toEqual(['boss.mp3']);
      expect(await start(14)).toEqual(['moon.mp3']);
      expect(await start(15)).toEqual([expect.stringMatching(/^w\d\.mp3$/)]);
    });

    it('goes down in the pause and ducks under big sounds, then comes back', async () => {
      const { eventBus, service, playing, startBuild } = setup();
      await startBuild();
      const [build] = playing();
      const full = trackVolume('b1');

      service.setDimmed(true);
      expect(build.volume).toBeCloseTo(full * BACKGROUND_MUSIC.pauseDim);
      service.setDimmed(false);
      expect(build.volume).toBeCloseTo(full);

      eventBus.emit({ type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1, target: { lat: 0, lon: 0 }, radiusM: 1 });
      expect(build.volume).toBeCloseTo(full * BACKGROUND_MUSIC.duck.nuclearStrike.factor);
      await vi.advanceTimersByTimeAsync(BACKGROUND_MUSIC.duck.nuclearStrike.holdMs + BACKGROUND_MUSIC.duck.releaseMs);
      expect(build.volume).toBeCloseTo(full);
    });

    it('goes back to build music on a game reset (restart), even after game over', async () => {
      const { eventBus, playing, startBuild, waveStarted } = setup();
      await startBuild();
      await waveStarted();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      eventBus.emit({ type: 'game:over', wave: 1, reason: 'hq-destroyed' } as never);
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(0);

      eventBus.emit({ type: 'game:reset' });
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(1);
      expect(playing()[0].buffer?.url).toMatch(/^b\d\.mp3$/);
    });

    it('keeps the build music of a location change playing when its loading ends', async () => {
      const { eventBus, service, playing, startBuild } = setup();
      await startBuild();
      eventBus.emit({ type: 'game:reset' });
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      const [build] = playing();

      service.onLoadingComplete();
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      expect(playing()).toEqual([build]);
    });

    it('leaves a game reset during loading to the hand-over from the main theme', async () => {
      BackgroundMusicService.playMainTheme();
      const { eventBus, playing } = setup();
      eventBus.emit({ type: 'game:reset' });
      await flush();
      expect(playing()).toHaveLength(0);
      expect(FakeHtmlAudio.instances[0].pause).not.toHaveBeenCalled();
    });

    it('keeps the wave track when a wave starts during the gap after the main theme', async () => {
      const { service, playing, waveStarted } = setup();
      service.onLoadingComplete();
      await waveStarted();
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(1);
      expect(playing()[0].buffer?.url).toMatch(/^w\d\.mp3$/);
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

    it('starts nothing at volume 0 and brings the phase track back when it is raised', async () => {
      const { service, playing, startBuild, waveStarted, waveCompleted } = setup();
      await startBuild();
      service.setVolume(0);
      expect(playing()).toHaveLength(0);

      // A bot at 75x: wave after wave, no crossfade into silence
      await waveStarted();
      await waveCompleted();
      await waveStarted();
      expect(playing()).toHaveLength(0);

      service.setVolume(0.5);
      await flush();
      frame(NOW + BACKGROUND_MUSIC.phaseFadeDuration);
      expect(playing()).toHaveLength(1);
      expect(playing()[0].buffer?.url).toMatch(/^w\d\.mp3$/);
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

    it('loads every track but the main theme once up front', () => {
      reg.manual = true;
      setup();
      expect(reg.pending.map((p) => p.url).sort()).toEqual(['b1.mp3', 'b2.mp3', 'boss.mp3', 'moon.mp3', 'over.mp3', 'w1.mp3', 'w2.mp3', 'w3.mp3']);
    });

    it('drops a phase change that was stopped while its track was still loading', async () => {
      reg.manual = true;
      const { service, playing, waveStarted } = setup();
      await waveStarted();
      service.stop();

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
