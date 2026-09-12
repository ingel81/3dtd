import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { SpatialAudioManager } from './spatial-audio.manager';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { AUDIO_LIMITS, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';

/**
 * Characterization of the spatial audio facade: registration and buffer
 * sharing, one-shot playback with its limits (distance culling, anti-flood,
 * per-sample polyphony, projectile budget, voice stealing), loops with the
 * enemy budget and distance pausing, master volume, stop and dispose.
 *
 * Real three.js math and scene graph; only the Web Audio classes are fakes
 * (jsdom has no AudioContext). Loads succeed synchronously unless a URL is
 * marked as failing.
 */

interface FakeParam { setValueAtTime: Mock }
interface FakeNode { connect: Mock }
interface FakeContext {
  state: string;
  currentTime: number;
  destination: object;
  resume: Mock;
  createGain: Mock;
  createDynamicsCompressor: Mock;
}
interface FakeListener extends Object3D {
  context: FakeContext;
  gain: { connect: Mock; disconnect: Mock };
}
interface FakeAudio extends Object3D {
  isPlaying: boolean;
  buffer: { duration: number } | null;
  volume: number;
  loop: boolean;
  offset: number;
  refDistance?: number;
  maxDistance?: number;
  disconnected: boolean;
}

const reg = vi.hoisted(() => ({
  listeners: [] as FakeListener[],
  positional: [] as FakeAudio[],
  global: [] as FakeAudio[],
  loads: [] as string[],
  failing: new Set<string>(),
  durations: new Map<string, number>(),
  playMode: 'ok' as 'ok' | 'silent' | 'throw',
}));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  const param = (): FakeParam => ({ setValueAtTime: vi.fn() });

  class Listener extends three.Object3D {
    context: FakeContext;
    gain = { connect: vi.fn(), disconnect: vi.fn() };
    constructor() {
      super();
      const context: FakeContext = {
        state: 'running',
        currentTime: 0,
        destination: { name: 'destination' },
        resume: vi.fn(async () => { context.state = 'running'; }),
        createGain: vi.fn(() => ({ gain: param(), connect: vi.fn() })),
        createDynamicsCompressor: vi.fn(() => ({
          threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
          connect: vi.fn(),
        })),
      };
      this.context = context;
      reg.listeners.push(this as unknown as FakeListener);
    }
  }

  class AudioBase extends three.Object3D {
    isPlaying = false;
    buffer: { duration: number } | null = null;
    volume = 1;
    loop = false;
    offset = 0;
    refDistance?: number;
    maxDistance?: number;
    disconnected = false;
    setBuffer(b: { duration: number }) { this.buffer = b; return this; }
    setVolume(v: number) { this.volume = v; return this; }
    setLoop(l: boolean) { this.loop = l; return this; }
    setRefDistance(v: number) { this.refDistance = v; return this; }
    setRolloffFactor() { return this; }
    setDistanceModel() { return this; }
    setMaxDistance(v: number) { this.maxDistance = v; return this; }
    play() {
      if (reg.playMode === 'throw') throw new Error('play failed');
      if (reg.playMode === 'ok') this.isPlaying = true;
      return this;
    }
    pause() { this.isPlaying = false; return this; }
    stop() { this.isPlaying = false; return this; }
    disconnect() { this.disconnected = true; return this; }
  }

  class PositionalAudio extends AudioBase {
    constructor(_listener: unknown) {
      super();
      reg.positional.push(this as unknown as FakeAudio);
    }
  }

  class Audio extends AudioBase {
    constructor(_listener: unknown) {
      super();
      reg.global.push(this as unknown as FakeAudio);
    }
  }

  class AudioLoader {
    load(url: string, onLoad: (b: { duration: number }) => void, _p?: unknown, onError?: (e: unknown) => void) {
      reg.loads.push(url);
      if (reg.failing.has(url)) onError?.(new Error(`404 ${url}`));
      else onLoad({ duration: reg.durations.get(url) ?? 0.3 });
    }
  }

  return { ...three, AudioListener: Listener, PositionalAudio, Audio, AudioLoader };
});

const NEAR = new Vector3(10, 0, 0);
const FAR = new Vector3(AUDIO_LIMITS.maxAudibleDistance + 1, 0, 0);
let now = 1000;

function setup() {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const manager = new SpatialAudioManager(scene, camera);
  const listener = reg.listeners[reg.listeners.length - 1];
  const bus = new GameEventBus();
  manager.setEventBus(bus);
  const debug: { eventType: string; soundId: string; details?: string }[] = [];
  bus.on('debug:sound', (e) => debug.push({ eventType: e.eventType, soundId: e.soundId, details: e.details }));
  const debugEvents = () => {
    bus.processQueue();
    return debug;
  };
  /** Register a sound and wait until its buffer is there. */
  const ready = async (id: string, url: string, config: Parameters<SpatialAudioManager['registerSound']>[2] = {}) => {
    manager.registerSound(id, url, config);
    await manager.getBuffer(id);
  };
  return { scene, camera, manager, listener, debugEvents, ready };
}

function lastPositional(): FakeAudio {
  return reg.positional[reg.positional.length - 1];
}

beforeEach(() => {
  reg.listeners.length = 0;
  reg.positional.length = 0;
  reg.global.length = 0;
  reg.loads.length = 0;
  reg.failing.clear();
  reg.durations.clear();
  reg.playMode = 'ok';
  now = 1000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SpatialAudioManager', () => {
  describe('construction', () => {
    it('hangs the listener on the camera and routes it through a limiter to the output', () => {
      const { scene, camera, manager, listener } = setup();

      expect(listener.parent).toBe(camera);
      expect(manager.getListener()).toBe(listener);
      expect(manager.getScene()).toBe(scene);

      const preGain = listener.context.createGain.mock.results[0].value as FakeNode;
      const limiter = listener.context.createDynamicsCompressor.mock.results[0].value as FakeNode;
      expect(listener.gain.disconnect).toHaveBeenCalled();
      expect(listener.gain.connect).toHaveBeenCalledWith(preGain);
      expect(preGain.connect).toHaveBeenCalledWith(limiter);
      expect(limiter.connect).toHaveBeenCalledWith(listener.context.destination);
    });
  });

  describe('registration', () => {
    it('loads a registered sound and merges its config over the defaults', async () => {
      const { manager } = setup();
      manager.registerSound('hit', 'hit.mp3', { volume: 0.5, refDistance: 20 });

      await expect(manager.getBuffer('hit')).resolves.toEqual({ duration: 0.3 });
      expect(manager.getSoundConfig('hit')).toMatchObject({
        refDistance: 20,
        rolloffFactor: SPATIAL_AUDIO_DEFAULTS.rolloffFactor,
        maxDistance: SPATIAL_AUDIO_DEFAULTS.maxDistance,
        distanceModel: SPATIAL_AUDIO_DEFAULTS.distanceModel,
        volume: 0.5,
        loop: SPATIAL_AUDIO_DEFAULTS.loop,
      });
    });

    it('shares one buffer between ids registered for the same file', async () => {
      const { manager } = setup();
      manager.registerSound('enemy-1_spawn', 'spawn.mp3');
      manager.registerSound('enemy-2_spawn', 'spawn.mp3');

      const [a, b] = await Promise.all([manager.getBuffer('enemy-1_spawn'), manager.getBuffer('enemy-2_spawn')]);
      expect(a).toBe(b);
      expect(reg.loads.filter((u) => u === 'spawn.mp3')).toHaveLength(1);
      expect(manager.getSoundPoolStats().cachedBuffers).toBe(1);
    });

    it('answers null for ids it does not know', async () => {
      const { manager } = setup();
      await expect(manager.getBuffer('nope')).resolves.toBeNull();
      expect(manager.getSoundConfig('nope')).toBeNull();
    });

    it('answers null once a file failed all load retries', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      reg.failing.add('broken.mp3');
      const { manager } = setup();
      manager.registerSound('broken', 'broken.mp3');

      const buffer = manager.getBuffer('broken');
      await vi.advanceTimersByTimeAsync(3000);
      await expect(buffer).resolves.toBeNull();
      expect(reg.loads.filter((u) => u === 'broken.mp3')).toHaveLength(4);
    });

    it('plays nothing for a file that failed, without rejecting', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      reg.failing.add('broken.mp3');
      const { scene, manager } = setup();
      manager.registerSound('broken', 'broken.mp3');
      manager.registerSound('broken_loop', 'broken.mp3');

      const oneShot = manager.playAt('broken', NEAR);
      const global = manager.playGlobal('broken');
      const loop = manager.createLoop('broken_loop', NEAR);
      await vi.advanceTimersByTimeAsync(3000);

      await expect(oneShot).resolves.toBeNull();
      await expect(global).resolves.toBeNull();
      await expect(loop).resolves.toBeNull();
      expect(scene.children).toHaveLength(0);
      expect(manager.getActiveSoundCount()).toBe(0);
    });
  });

  describe('one-shots', () => {
    it('plays at a position and cleans up once the sample is over', async () => {
      const { scene, manager, debugEvents, ready } = setup();
      await ready('hit', 'hit.mp3', { volume: 0.8 });
      manager.setMasterVolume(0.5);

      const audio = (await manager.playAt('hit', NEAR, 0.5)) as unknown as FakeAudio;

      expect(audio.isPlaying).toBe(true);
      expect(audio.volume).toBeCloseTo(0.8 * 0.5 * 0.5);
      expect(audio.loop).toBe(false);
      expect(audio.refDistance).toBe(SPATIAL_AUDIO_DEFAULTS.refDistance);
      expect(audio.parent?.position.equals(NEAR)).toBe(true);
      expect(scene.children).toContain(audio.parent);
      expect(manager.isPlaying('hit')).toBe(true);
      expect(manager.getActiveSoundCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(300 + 100 - 1);
      expect(manager.isPlaying('hit')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.isPlaying('hit')).toBe(false);
      expect(manager.getActiveSoundCount()).toBe(0);
      expect(scene.children).toHaveLength(0);
      expect(audio.disconnected).toBe(true);
      expect(debugEvents().map((e) => e.eventType)).toEqual(['play', 'stop']);
    });

    it('returns null for an unregistered sound', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { manager } = setup();
      await expect(manager.playAt('nope', NEAR)).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
    });

    it('culls sounds beyond the audible distance', async () => {
      const { scene, manager, debugEvents, ready } = setup();
      await ready('hit', 'hit.mp3');

      await expect(manager.playAt('hit', FAR)).resolves.toBeNull();
      expect(scene.children).toHaveLength(0);
      expect(debugEvents()).toEqual([expect.objectContaining({ eventType: 'distance_culled', soundId: 'hit' })]);
    });

    it('sets a max distance only for sounds that have one', async () => {
      const { manager, ready } = setup();
      await ready('open', 'a.mp3');
      await ready('capped', 'b.mp3', { maxDistance: 200 });

      await manager.playAt('open', NEAR);
      expect(lastPositional().maxDistance).toBeUndefined();
      await manager.playAt('capped', NEAR);
      expect(lastPositional().maxDistance).toBe(200);
    });

    it('drops a retrigger of the same sample inside its flood window, across sound ids', async () => {
      const { manager, debugEvents, ready } = setup();
      await ready('enemy-1_spawn', 'spawn.mp3', { minIntervalMs: 50 });
      await ready('enemy-2_spawn', 'spawn.mp3', { minIntervalMs: 50 });

      expect(await manager.playAt('enemy-1_spawn', NEAR)).not.toBeNull();
      expect(await manager.playAt('enemy-2_spawn', NEAR)).toBeNull();
      expect(debugEvents().at(-1)).toMatchObject({ eventType: 'budget_exceeded', soundId: 'enemy-2_spawn' });

      now += 50;
      expect(await manager.playAt('enemy-2_spawn', NEAR)).not.toBeNull();
    });

    it.each([
      [0.1, 10],
      [1, 50],
      [4, 80],
    ])('derives the flood window from a %ss sample as %sms', async (seconds, windowMs) => {
      reg.durations.set('s.mp3', seconds);
      const { manager, ready } = setup();
      await ready('s', 's.mp3');

      expect(await manager.playAt('s', NEAR)).not.toBeNull();
      now += windowMs - 1;
      expect(await manager.playAt('s', NEAR)).toBeNull();
      now += 1;
      expect(await manager.playAt('s', NEAR)).not.toBeNull();
    });

    it('caps concurrent instances of one sample and frees the slot when one ends', async () => {
      const { manager, ready } = setup();
      await ready('s', 's.mp3', { maxInstances: 2, minIntervalMs: 0 });

      expect(await manager.playAt('s', NEAR)).not.toBeNull();
      expect(await manager.playAt('s', NEAR)).not.toBeNull();
      expect(await manager.playAt('s', NEAR)).toBeNull();

      await vi.advanceTimersByTimeAsync(400);
      expect(await manager.playAt('s', NEAR)).not.toBeNull();
    });

    it.each([
      [0.3, 8],
      [1, 4],
      [2, 2],
    ])('derives the polyphony cap from a %ss sample as %i', async (seconds, cap) => {
      reg.durations.set('s.mp3', seconds);
      const { manager, ready } = setup();
      await ready('s', 's.mp3', { minIntervalMs: 0 });

      let started = 0;
      while ((await manager.playAt('s', NEAR)) && started < 100) started++;
      expect(started).toBe(cap);
    });

    it('counts projectile sounds against their own budget', async () => {
      const { manager, debugEvents, ready } = setup();
      expect(manager.isProjectileSound('arrow')).toBe(true);
      expect(manager.isProjectileSound('zombie_walk')).toBe(false);
      await ready('arrow', 'arrow.mp3', { maxInstances: 1000, minIntervalMs: 0 });

      for (let i = 0; i < AUDIO_LIMITS.maxProjectileSounds; i++) {
        expect(await manager.playAt('arrow', NEAR)).not.toBeNull();
      }
      expect(await manager.playAt('arrow', NEAR)).toBeNull();
      expect(manager.getProjectileSoundStats()).toEqual({
        current: AUDIO_LIMITS.maxProjectileSounds,
        max: AUDIO_LIMITS.maxProjectileSounds,
      });
      expect(debugEvents().at(-1)?.details).toContain('projectile budget');

      await vi.advanceTimersByTimeAsync(400);
      expect(manager.getProjectileSoundStats().current).toBe(0);
    });

    it('steals the oldest one-shot when all voices are busy', async () => {
      const { manager, debugEvents, ready } = setup();
      const max = AUDIO_LIMITS.maxConcurrentOneShots;
      for (let i = 0; i <= max; i++) {
        await ready(`v${i}`, 'v.mp3', { maxInstances: 1000, minIntervalMs: 0 });
      }
      for (let i = 0; i < max; i++) await manager.playAt(`v${i}`, NEAR);

      expect(await manager.playAt(`v${max}`, NEAR)).not.toBeNull();

      expect(manager.getActiveSoundCount()).toBe(max);
      expect(manager.isPlaying('v0')).toBe(false);
      expect(manager.isPlaying('v1')).toBe(true);
      expect(manager.isPlaying(`v${max}`)).toBe(true);
      expect(debugEvents()).toContainEqual(expect.objectContaining({ soundId: 'v0', details: 'voice-stolen' }));
    });

    it.each(['silent', 'throw'] as const)('treats a play() that does not start (%s) as a failure', async (mode) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { scene, manager, ready } = setup();
      await ready('arrow', 'arrow.mp3', { maxInstances: 1, minIntervalMs: 0 });

      reg.playMode = mode;
      expect(await manager.playAt('arrow', NEAR)).toBeNull();
      expect(manager.getActiveSoundCount()).toBe(0);
      expect(manager.getProjectileSoundStats().current).toBe(0);
      expect(scene.children).toHaveLength(0);

      // The polyphony slot was given back: the single allowed instance plays.
      reg.playMode = 'ok';
      expect(await manager.playAt('arrow', NEAR)).not.toBeNull();
    });

    it('stop(id) ends only the one-shots of that id', async () => {
      const { manager, ready } = setup();
      await ready('a', 'a.mp3', { minIntervalMs: 0 });
      await ready('b', 'b.mp3');
      await manager.playAt('a', NEAR);
      await manager.playAt('a', NEAR);
      await manager.playAt('b', NEAR);

      manager.stop('a');

      expect(manager.isPlaying('a')).toBe(false);
      expect(manager.isPlaying('b')).toBe(true);
      expect(manager.getActiveSoundCount()).toBe(1);
      manager.stop('unknown');
      expect(manager.getActiveSoundCount()).toBe(1);
    });

    it('drops finished one-shots and resumes the context when the tab is visible again', async () => {
      const { manager, listener, ready } = setup();
      await ready('hit', 'hit.mp3');
      const audio = (await manager.playAt('hit', NEAR)) as unknown as FakeAudio;
      audio.isPlaying = false; // the browser ended it while the tab was throttled
      listener.context.state = 'suspended';
      expect(manager.getActiveSoundCount()).toBe(1);

      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(manager.getActiveSoundCount()).toBe(0);
      expect(listener.context.resume).toHaveBeenCalled();
    });

    it('resumes a suspended context before playing', async () => {
      const { manager, listener, ready } = setup();
      await ready('hit', 'hit.mp3');
      listener.context.state = 'suspended';

      await manager.playAt('hit', NEAR);
      expect(listener.context.resume).toHaveBeenCalledOnce();

      await manager.resumeContext();
      expect(listener.context.resume).toHaveBeenCalledOnce();
    });
  });

  describe('geo and distance', () => {
    it('plays at geo positions once a converter is set', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { manager, ready } = setup();
      await ready('hit', 'hit.mp3');

      expect(manager.geoToLocalPosition(1, 2, 3)).toBeNull();
      expect(await manager.playAtGeo('hit', 10, 0, 0)).toBeNull();

      manager.setGeoToLocal((lat, lon, height) => new Vector3(lat, height, lon));
      expect(manager.geoToLocalPosition(1, 2, 3)).toEqual(new Vector3(1, 3, 2));
      const audio = (await manager.playAtGeo('hit', 10, 5, 0)) as unknown as FakeAudio;
      expect(audio.parent?.position).toEqual(new Vector3(10, 0, 5));
    });

    it('measures from the camera and treats the max audible distance as inclusive', () => {
      const { manager } = setup();
      expect(manager.getDistanceToCamera(new Vector3(3, 4, 0))).toBe(5);
      expect(manager.isWithinAudibleDistance(new Vector3(AUDIO_LIMITS.maxAudibleDistance, 0, 0))).toBe(true);
      expect(manager.isWithinAudibleDistance(FAR)).toBe(false);
    });
  });

  describe('global one-shots', () => {
    it('plays without position and disconnects after the sample', async () => {
      const { scene, manager, ready } = setup();
      await ready('ui', 'ui.mp3', { volume: 0.5 });
      manager.setMasterVolume(0.5);

      const audio = (await manager.playGlobal('ui', 2)) as unknown as FakeAudio;

      expect(audio.isPlaying).toBe(true);
      expect(audio.volume).toBeCloseTo(0.5);
      expect(scene.children).toHaveLength(0);
      expect(manager.getActiveSoundCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(400);
      expect(audio.disconnected).toBe(true);
      expect(await manager.playGlobal('nope')).toBeNull();
    });

    it('stopAll stops and disconnects a global one-shot that is still playing', async () => {
      const { manager, ready } = setup();
      await ready('ui', 'ui.mp3');
      const audio = (await manager.playGlobal('ui')) as unknown as FakeAudio;

      manager.stopAll();

      expect(audio.isPlaying).toBe(false);
      expect(audio.disconnected).toBe(true);
    });

    it('stopAll also stops a looping global sound', async () => {
      const { manager, ready } = setup();
      await ready('ambience', 'ambience.mp3', { loop: true });
      const audio = (await manager.playGlobal('ambience')) as unknown as FakeAudio;
      await vi.advanceTimersByTimeAsync(1000);
      expect(audio.isPlaying).toBe(true);

      manager.stopAll();

      expect(audio.isPlaying).toBe(false);
      expect(audio.disconnected).toBe(true);
    });

    it('forgets a global one-shot once its sample is over', async () => {
      const { manager, ready } = setup();
      await ready('ui', 'ui.mp3');
      const audio = (await manager.playGlobal('ui')) as unknown as FakeAudio;
      await vi.advanceTimersByTimeAsync(400);
      const stop = vi.spyOn(audio as unknown as { stop: () => void }, 'stop');

      manager.stopAll();

      expect(stop).not.toHaveBeenCalled();
    });
  });

  describe('loops', () => {
    it('starts a looping sound and hands out a distinct handle per loop', async () => {
      const { manager, ready } = setup();
      await ready('fire', 'fire.mp3', { volume: 0.6 });
      manager.setMasterVolume(0.5);

      const h1 = await manager.createLoop('fire', NEAR, { volumeMultiplier: 0.5 });
      const audio = lastPositional();
      const h2 = await manager.createLoop('fire', NEAR);

      expect(typeof h1).toBe('string');
      expect(h2).not.toBe(h1);
      expect(audio.isPlaying).toBe(true);
      expect(audio.loop).toBe(true);
      expect(audio.volume).toBeCloseTo(0.6 * 0.5 * 0.5);
      expect(audio.offset).toBe(0);
      expect(manager.getActiveSoundCount()).toBe(2);
      expect(manager.getSoundPoolStats()).toMatchObject({ activeLoops: 2, activeOneShots: 0 });
    });

    it('starts at a random offset when asked', async () => {
      reg.durations.set('fire.mp3', 4);
      vi.spyOn(Math, 'random').mockReturnValue(0.25);
      const { manager, ready } = setup();
      await ready('fire', 'fire.mp3');

      await manager.createLoop('fire', NEAR, { randomStart: true });
      expect(lastPositional().offset).toBe(1);
    });

    it('returns null for unknown sounds and out-of-range positions', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');

      expect(await manager.createLoop('nope', NEAR)).toBeNull();
      expect(await manager.createLoop('zombie_walk', FAR)).toBeNull();
      expect(manager.getEnemySoundStats().current).toBe(0);
      expect(manager.getActiveSoundCount()).toBe(0);
    });

    it('reserves the enemy budget per enemy loop and refuses once it is full', async () => {
      const { manager, ready } = setup();
      expect(manager.isEnemySound('Zombie_Walk')).toBe(true);
      expect(manager.isEnemySound('arrow')).toBe(false);
      await ready('zombie_walk', 'walk.mp3');

      const handles: (string | null)[] = [];
      for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) {
        handles.push(await manager.createLoop('zombie_walk', NEAR));
      }
      expect(handles.every((h) => h !== null)).toBe(true);
      expect(manager.canPlayEnemySound()).toBe(false);
      expect(await manager.createLoop('zombie_walk', NEAR)).toBeNull();

      manager.stopLoop(handles[0]!);
      expect(manager.getEnemySoundStats().current).toBe(AUDIO_LIMITS.maxEnemySounds - 1);
      expect(await manager.createLoop('zombie_walk', NEAR)).not.toBeNull();
    });

    it('pauses a loop that leaves the audible range and resumes it on return', async () => {
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');
      const handle = (await manager.createLoop('zombie_walk', NEAR))!;
      const audio = lastPositional();

      manager.updateLoopPosition(handle, FAR);
      expect(manager.isLoopPaused(handle)).toBe(true);
      expect(audio.isPlaying).toBe(false);
      expect(audio.parent?.position.equals(FAR)).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(0);

      manager.updateLoopPosition(handle, NEAR);
      expect(manager.isLoopPaused(handle)).toBe(false);
      expect(audio.isPlaying).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(1);
    });

    it('cannot resume an enemy loop while the enemy budget is full', async () => {
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');
      const paused = (await manager.createLoop('zombie_walk', NEAR))!;
      manager.pauseLoop(paused);
      const others: string[] = [];
      for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) {
        others.push((await manager.createLoop('zombie_walk', NEAR))!);
      }

      expect(manager.resumeLoop(paused)).toBe(false);
      expect(manager.isLoopPaused(paused)).toBe(true);

      manager.stopLoop(others[0]);
      expect(manager.resumeLoop(paused)).toBe(true);
      expect(manager.isLoopPaused(paused)).toBe(false);
    });

    it('tolerates unknown handles, running loops and double stops without skewing the budget', async () => {
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');
      const a = (await manager.createLoop('zombie_walk', NEAR))!;
      const b = (await manager.createLoop('zombie_walk', NEAR))!;

      expect(manager.resumeLoop('nope')).toBe(true);
      expect(manager.resumeLoop(b)).toBe(true);
      expect(manager.isLoopPaused('nope')).toBe(false);
      manager.pauseLoop('nope');
      manager.updateLoopPosition('nope', FAR);
      manager.stopLoop('nope');

      // A paused enemy loop already gave its budget back; stopping it must not again.
      manager.pauseLoop(a);
      manager.stopLoop(a);
      manager.stopLoop(a);
      expect(manager.getEnemySoundStats().current).toBe(1);
      expect(manager.getActiveSoundCount()).toBe(1);
    });

    it('applies a master volume change to running loops but not to paused ones', async () => {
      const { manager, ready } = setup();
      await ready('fire', 'fire.mp3', { volume: 0.8 });
      const running = (await manager.createLoop('fire', NEAR))!;
      const runningAudio = lastPositional();
      const paused = (await manager.createLoop('fire', NEAR))!;
      const pausedAudio = lastPositional();
      manager.pauseLoop(paused);
      expect(manager.isLoopPaused(running)).toBe(false);

      manager.setMasterVolume(0.5);
      expect(runningAudio.volume).toBeCloseTo(0.4);
      expect(pausedAudio.volume).toBeCloseTo(0.8);

      manager.setMasterVolume(3);
      expect(manager.masterVolume).toBe(1);
      manager.setMasterVolume(-1);
      expect(manager.masterVolume).toBe(0);
      expect(runningAudio.volume).toBe(0);
    });
  });

  describe('enemy budget', () => {
    it('registers up to the cap and never counts below zero', () => {
      const { manager } = setup();
      for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) {
        expect(manager.registerEnemySound()).toBe(true);
      }
      expect(manager.registerEnemySound()).toBe(false);
      expect(manager.getEnemySoundStats()).toEqual({ current: AUDIO_LIMITS.maxEnemySounds, max: AUDIO_LIMITS.maxEnemySounds });

      for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds + 3; i++) manager.unregisterEnemySound();
      expect(manager.getEnemySoundStats().current).toBe(0);
      expect(manager.canPlayEnemySound()).toBe(true);
    });
  });

  describe('stopAll and dispose', () => {
    it('stopAll ends one-shots and loops and releases their budgets', async () => {
      const { scene, manager, ready } = setup();
      await ready('arrow', 'arrow.mp3');
      await ready('zombie_walk', 'walk.mp3');
      await manager.playAt('arrow', NEAR);
      await manager.createLoop('zombie_walk', NEAR);
      const loopAudio = lastPositional();

      manager.stopAll();

      expect(manager.getActiveSoundCount()).toBe(0);
      expect(scene.children).toHaveLength(0);
      expect(loopAudio.disconnected).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(0);
      expect(manager.getProjectileSoundStats().current).toBe(0);
    });

    it('dispose detaches the listener from the camera and forgets registered sounds', async () => {
      const { camera, manager, listener, ready } = setup();
      await ready('fire', 'fire.mp3');
      await manager.createLoop('fire', NEAR);

      manager.dispose();

      expect(listener.parent).toBeNull();
      expect(camera.children).not.toContain(listener);
      expect(manager.getActiveSoundCount()).toBe(0);
      expect(manager.getSoundConfig('fire')).toBeNull();
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
