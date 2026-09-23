import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { SpatialAudioManager } from './spatial-audio.manager';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { AUDIO_LIMITS, OOZE_SOUNDS, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';
import { OozeSounds } from '../ooze-sounds';
import { AudioComponent, LoopFlagSink } from '../../game-components/audio.component';
import { TransformComponent } from '../../game-components/transform.component';
import { GameObject } from '../../core/game-object';
import { ComponentType } from '../../core/component';

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
    playbackRate = 1;
    setPlaybackRate(v: number) { this.playbackRate = v; return this; }
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
/** A loop handle nothing was created under */
const NO_LOOP = 999_999;
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

/** A game object with a geo position, to carry an AudioComponent. */
class Walker extends GameObject {
  readonly transform: TransformComponent;
  constructor() {
    super('enemy');
    this.transform = this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
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

    it('stretches the flood window with the game speed, so 4x plays a sample as densely as 1x', async () => {
      const { manager, ready } = setup();
      await ready('s', 's.mp3', { minIntervalMs: 50 });
      manager.setTimescale(4);

      expect(await manager.playAt('s', NEAR)).not.toBeNull();
      now += 199;
      expect(await manager.playAt('s', NEAR)).toBeNull();
      now += 1;
      expect(await manager.playAt('s', NEAR)).not.toBeNull();
    });

    it('creates no voice at all while sound effects are at 0', async () => {
      const { manager, ready } = setup();
      await ready('s', 's.mp3');
      manager.setMasterVolume(0);
      expect(await manager.playAt('s', NEAR)).toBeNull();
      expect(await manager.playGlobal('s')).toBeNull();
      manager.setMasterVolume(0.5);
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

    it('keeps no polyphony slot and no flood window for a trigger the projectile budget refused', async () => {
      const { manager, ready } = setup();
      await ready('arrow', 'arrow.mp3', { maxInstances: 1000, minIntervalMs: 0 });
      await ready('bullet', 'bullet.mp3', { maxInstances: 2, minIntervalMs: 50 });
      for (let i = 0; i < AUDIO_LIMITS.maxProjectileSounds; i++) await manager.playAt('arrow', NEAR);

      for (let i = 0; i < 3; i++) {
        expect(await manager.playAt('bullet', NEAR)).toBeNull();
      }
      // The arrows end and free the budget; the clock has not moved.
      await vi.advanceTimersByTimeAsync(400);

      expect(await manager.playAt('bullet', NEAR)).not.toBeNull();
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

    it('steals the oldest one-shot without priority first, one with priority only when every voice has it', async () => {
      const { manager, debugEvents, ready } = setup();
      const max = AUDIO_LIMITS.maxConcurrentOneShots;
      await ready('boom', 'boom.mp3', { priority: true, maxInstances: 1000, minIntervalMs: 0 });
      await ready('hit', 'hit.mp3', { maxInstances: 1000, minIntervalMs: 0 });
      await ready('late', 'late.mp3', { minIntervalMs: 0 });

      // The boom is the oldest; the next sound takes the first hit's voice
      await manager.playAt('boom', NEAR);
      for (let i = 1; i < max; i++) await manager.playAt('hit', NEAR);
      expect(await manager.playAt('late', NEAR)).not.toBeNull();
      expect(manager.getActiveSoundCount()).toBe(max);
      expect(manager.isPlaying('boom')).toBe(true);
      const stolen = () => debugEvents().filter((e) => e.details === 'voice-stolen').map((e) => e.soundId);
      expect(stolen()).toEqual(['hit']);

      // Only priority voices busy: the oldest of them goes
      manager.stopAll();
      for (let i = 0; i < max; i++) await manager.playAt('boom', NEAR);
      expect(await manager.playAt('late', NEAR)).not.toBeNull();
      expect(manager.getActiveSoundCount()).toBe(max);
      expect(stolen()).toEqual(['hit', 'boom']);
    });

    it('plays a sound with an audible distance of its own out to that distance, and no further', async () => {
      const { manager, debugEvents, ready } = setup();
      await ready('boom', 'boom.mp3', { audibleDistance: 1500, minIntervalMs: 0 });

      expect(await manager.playAt('boom', FAR)).not.toBeNull();
      expect(await manager.playAt('boom', new Vector3(1501, 0, 0))).toBeNull();
      expect(debugEvents().at(-1)).toMatchObject({ eventType: 'distance_culled', soundId: 'boom' });
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

    it('plays at a playback rate and cleans up once the slower sample is over', async () => {
      const { manager, ready } = setup();
      await ready('growl', 'growl.mp3');
      const audio = (await manager.playAt('growl', NEAR, 1, 0.5)) as unknown as FakeAudio & { playbackRate: number };
      expect(audio.playbackRate).toBe(0.5);

      // 0.3 s at half speed: 0.6 s
      await vi.advanceTimersByTimeAsync(600 + 100 - 1);
      expect(manager.isPlaying('growl')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.isPlaying('growl')).toBe(false);
    });

    it('stopOneShot ends that one-shot only, and nothing once it is over', async () => {
      const { manager, ready } = setup();
      await ready('a', 'a.mp3', { minIntervalMs: 0 });
      const first = (await manager.playAt('a', NEAR))!;
      const second = (await manager.playAt('a', NEAR))!;

      manager.stopOneShot(first);
      expect(manager.getActiveSoundCount()).toBe(1);
      expect((first as unknown as FakeAudio).disconnected).toBe(true);
      expect((second as unknown as FakeAudio).disconnected).toBe(false);

      manager.stopOneShot(first);
      expect(manager.getActiveSoundCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(300 + 100);
      manager.stopOneShot(second);
      expect(manager.getActiveSoundCount()).toBe(0);
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

      manager.setGeoToLocal((lat, lon, height, target) => target.set(lat, height, lon));
      expect(manager.geoToLocalPosition(1, 2, 3)).toEqual(new Vector3(1, 3, 2));
      const into = new Vector3();
      expect(manager.geoToLocalPosition(4, 5, 6, into)).toBe(into);
      expect(into).toEqual(new Vector3(4, 6, 5));
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

      // A number, and never 0: callers may test a handle for truthiness
      expect(typeof h1).toBe('number');
      expect(h1).toBeGreaterThan(0);
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

    it('returns null for an unknown sound; one out of range waits without audio and joins in earshot', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');

      expect(await manager.createLoop('nope', NEAR)).toBeNull();
      const far = await manager.createLoop('zombie_walk', FAR);
      expect(far).not.toBeNull();
      expect(manager.isLoopPaused(far!)).toBe(true);
      expect(reg.positional).toHaveLength(0);
      expect(manager.getEnemySoundStats().current).toBe(0);
      expect(manager.getActiveSoundCount()).toBe(1);

      manager.updateLoopPosition(far!, NEAR);
      expect(lastPositional().isPlaying).toBe(true);
      expect(lastPositional().parent?.position.equals(NEAR)).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(1);
    });

    it('reserves the enemy budget per enemy loop; one beyond it waits until a slot frees', async () => {
      const { manager, ready } = setup();
      expect(manager.isEnemySound('Zombie_Walk')).toBe(true);
      expect(manager.isEnemySound('arrow')).toBe(false);
      await ready('zombie_walk', 'walk.mp3');

      const handles: (number | null)[] = [];
      for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) {
        handles.push(await manager.createLoop('zombie_walk', NEAR));
      }
      expect(handles.every((h) => h !== null)).toBe(true);
      expect(manager.canPlayEnemySound()).toBe(false);
      const late = (await manager.createLoop('zombie_walk', NEAR))!;
      expect(manager.isLoopPaused(late)).toBe(true);
      expect(reg.positional).toHaveLength(AUDIO_LIMITS.maxEnemySounds);

      manager.stopLoop(handles[0]!);
      expect(manager.getEnemySoundStats().current).toBe(AUDIO_LIMITS.maxEnemySounds - 1);
      manager.updateLoopPosition(late, NEAR);
      expect(manager.isLoopPaused(late)).toBe(false);
      expect(lastPositional().isPlaying).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(AUDIO_LIMITS.maxEnemySounds);
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
      const others: number[] = [];
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

      expect(manager.resumeLoop(NO_LOOP)).toBe(true);
      expect(manager.resumeLoop(b)).toBe(true);
      expect(manager.isLoopPaused(NO_LOOP)).toBe(false);
      manager.pauseLoop(NO_LOOP);
      manager.updateLoopPosition(NO_LOOP, FAR);
      manager.stopLoop(NO_LOOP);

      // A paused enemy loop already gave its budget back; stopping it must not again.
      manager.pauseLoop(a);
      manager.stopLoop(a);
      manager.stopLoop(a);
      expect(manager.getEnemySoundStats().current).toBe(1);
      expect(manager.getActiveSoundCount()).toBe(1);
    });

    it('holds every loop while the game is paused, the enemy budget with it', async () => {
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');
      await ready('fire', 'fire.mp3');
      const walk = (await manager.createLoop('zombie_walk', NEAR))!;
      const walkAudio = lastPositional();
      const flame = (await manager.createLoop('fire', NEAR))!;
      const flameAudio = lastPositional();

      manager.holdLoops(true);
      expect(manager.isLoopPaused(walk)).toBe(true);
      expect(manager.isLoopPaused(flame)).toBe(true);
      expect(walkAudio.isPlaying).toBe(false);
      expect(flameAudio.isPlaying).toBe(false);
      expect(manager.getEnemySoundStats().current).toBe(0);

      // Neither a position update in range nor resumeLoop wakes one meanwhile
      manager.updateLoopPosition(walk, NEAR);
      expect(manager.resumeLoop(flame)).toBe(false);
      expect(walkAudio.isPlaying).toBe(false);
      expect(flameAudio.isPlaying).toBe(false);

      manager.holdLoops(false);
      expect(walkAudio.isPlaying).toBe(true);
      expect(flameAudio.isPlaying).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(1);
    });

    it('moves a held loop but leaves one out of earshot paused when the game goes on', async () => {
      const { manager, ready } = setup();
      await ready('fire', 'fire.mp3');
      const handle = (await manager.createLoop('fire', NEAR))!;
      const audio = lastPositional();

      manager.holdLoops(true);
      manager.updateLoopPosition(handle, FAR);
      expect(audio.parent?.position.equals(FAR)).toBe(true);

      manager.holdLoops(false);
      expect(manager.isLoopPaused(handle)).toBe(true);
      manager.updateLoopPosition(handle, NEAR);
      expect(audio.isPlaying).toBe(true);
    });

    it('lets a loop created while held wait, without audio or an enemy-budget slot', async () => {
      const { manager, ready } = setup();
      await ready('zombie_walk', 'walk.mp3');
      manager.holdLoops(true);

      const handle = (await manager.createLoop('zombie_walk', NEAR))!;
      expect(manager.isLoopPaused(handle)).toBe(true);
      expect(reg.positional).toHaveLength(0);
      expect(manager.getEnemySoundStats().current).toBe(0);

      manager.holdLoops(false);
      expect(lastPositional().isPlaying).toBe(true);
      expect(manager.getEnemySoundStats().current).toBe(1);
      manager.stopLoop(handle);
      expect(manager.getEnemySoundStats().current).toBe(0);
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

    it('resumes a paused loop at the master volume set meanwhile (volume changed in the pause)', async () => {
      const { manager, ready } = setup();
      await ready('fire', 'fire.mp3', { volume: 0.8 });
      const handle = (await manager.createLoop('fire', NEAR))!;
      const audio = lastPositional();

      manager.holdLoops(true);
      manager.setMasterVolume(0.5);
      expect(audio.volume).toBeCloseTo(0.8);

      manager.holdLoops(false);
      expect(manager.isLoopPaused(handle)).toBe(false);
      expect(audio.volume).toBeCloseTo(0.4);
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

    it('dispose stops listening for the tab coming back', () => {
      const { manager, listener } = setup();
      manager.dispose();
      listener.context.state = 'suspended';

      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(listener.context.resume).not.toHaveBeenCalled();
    });
  });
});

/**
 * Playtest 546 and 548 (fix session 2026-09-14): what the player hears
 * around the pause. The pause reaches the loops as holdLoops
 * (GameStateManager's pause sync, see its spec; the boss intro and the replay
 * pause the same way); the camera is the listener and flies while the game
 * stands.
 */
describe('SpatialAudioManager around the pause (playtest 546, 548)', () => {
  const D = AUDIO_LIMITS.maxAudibleDistance;
  const flyTo = (camera: PerspectiveCamera, x: number) => {
    camera.position.set(x, 0, 0);
    camera.updateMatrixWorld(true);
  };
  /** createLoop awaits the context and the buffer. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('546: nothing starts while the camera flies over enemies in the pause; in earshot they walk on after it', async () => {
    const { camera, manager, ready } = setup();
    await ready('zombie_walk', 'walk.mp3');
    const there = new Vector3(3 * D, 0, 0);
    // One zombie beside the camera, one that walked by and is out of earshot over there now
    await manager.createLoop('zombie_walk', NEAR);
    const here = lastPositional();
    const walker = (await manager.createLoop('zombie_walk', new Vector3(20, 0, 0)))!;
    const away = lastPositional();
    manager.updateLoopPosition(walker, there);
    expect(away.isPlaying).toBe(false);

    manager.holdLoops(true);
    flyTo(camera, 3 * D - 10);
    expect(here.isPlaying).toBe(false);
    expect(away.isPlaying).toBe(false);

    manager.holdLoops(false);
    expect(away.isPlaying).toBe(true);
    expect(here.isPlaying).toBe(false);
  });

  it('546: a zombie that started walking out of earshot joins once the camera is near and the game goes on', async () => {
    const { camera, manager, ready } = setup();
    await ready('zombie_walk', 'walk.mp3');
    const there = new Vector3(3 * D, 0, 0);
    // EnemyEntity.startMoving plays its walk loop once (AudioComponent.play); out of earshot it waits
    const walker = (await manager.createLoop('zombie_walk', there))!;
    expect(reg.positional).toHaveLength(0);

    manager.holdLoops(true);
    flyTo(camera, 3 * D - 10);
    manager.updateLoopPosition(walker, there);
    expect(reg.positional).toHaveLength(0);

    manager.holdLoops(false);
    expect(manager.isLoopPaused(walker)).toBe(false);
    expect(lastPositional().isPlaying).toBe(true);
  });

  it('546: an enemy whose walk loop began out of earshot is heard once the camera flies to it', async () => {
    const { camera, manager } = setup();
    manager.setGeoToLocal((lat, lon, height, target) => target.set(lat, height, lon));
    const zombie = new Walker();
    zombie.transform.setPosition(3 * D, 0, 0);
    const sink: LoopFlagSink = { hasAudioLoops: false };
    const audio = new AudioComponent(zombie, sink);
    audio.registerSound('moving', 'walk.mp3', { loop: true });
    audio.initialize(manager);
    await manager.getBuffer(`${zombie.id}_moving`);

    await audio.play('moving', true);
    expect(sink.hasAudioLoops).toBe(true);
    audio.update(16);
    expect(reg.positional).toHaveLength(0);

    // A waiting loop is moved every third sub-step (AudioComponent)
    flyTo(camera, 3 * D - 10);
    for (let i = 0; i < 3; i++) audio.update(16);
    expect(lastPositional().isPlaying).toBe(true);
    expect(lastPositional().parent?.position.x).toBe(3 * D);
  });

  it('546: walk and flame loops come back at the SFX volume set in the pause', async () => {
    const { manager, ready } = setup();
    await ready('zombie_walk', 'walk.mp3', { volume: 0.6 });
    await ready('fire', 'fire.mp3', { volume: 0.8 });
    await manager.createLoop('zombie_walk', NEAR);
    const walk = lastPositional();
    await manager.createLoop('fire', NEAR);
    const flame = lastPositional();

    manager.holdLoops(true);
    manager.setMasterVolume(0.25);
    manager.holdLoops(false);

    expect(walk.isPlaying && flame.isPlaying).toBe(true);
    expect(walk.volume).toBeCloseTo(0.15);
    expect(flame.volume).toBeCloseTo(0.2);
  });

  it('548: the bubbling stands in the pause; an ooze reached meanwhile bubbles only once the game goes on', async () => {
    const { camera, manager } = setup();
    const sounds = new OozeSounds(new GameEventBus());
    sounds.register(manager);
    await manager.getBuffer(OOZE_SOUNDS.bubble.id);
    sounds.follow('ooze-1', manager, 10, 0, 0);
    await settle();
    const first = lastPositional();
    expect(first.isPlaying).toBe(true);

    manager.holdLoops(true);
    expect(first.isPlaying).toBe(false);

    // The camera flies to a second ooze. OozeBodies.present runs only in
    // frames with a sub-step, none in the pause (GameStateManager spec); were
    // it called, the loop would wait without audio until the game goes on.
    flyTo(camera, 3 * D);
    sounds.follow('ooze-2', manager, 3 * D + 5, 0, 0);
    await settle();
    expect(reg.positional).toHaveLength(1);

    manager.holdLoops(false);
    const second = lastPositional();
    expect(second).not.toBe(first);
    expect(second.isPlaying).toBe(true);
    // Left behind, out of earshot
    expect(first.isPlaying).toBe(false);
  });
});

/**
 * Every enemy with a walk sound holds a loop, also out of earshot
 * (AudioComponent.update() each sub-step, EnemyManager). With enemy slots
 * free, each position update of a waiting loop checks its distance to the
 * camera. That check reads the camera's world matrix as the last drawn frame
 * left it (ThreeTilesEngine.render()), and asks the camera nothing.
 */
describe('SpatialAudioManager: waiting enemy loops each sub-step', () => {
  const D = AUDIO_LIMITS.maxAudibleDistance;
  const ENEMIES = 50;
  const SUB_STEPS = 4;
  const THERE = new Vector3(3 * D, 0, 0);

  async function waitingZombies() {
    const context = setup();
    await context.ready('zombie_walk', 'walk.mp3');
    const handles: number[] = [];
    for (let i = 0; i < ENEMIES; i++) handles.push((await context.manager.createLoop('zombie_walk', THERE))!);
    const subStep = () => {
      for (const handle of handles) context.manager.updateLoopPosition(handle, THERE);
    };
    return { ...context, subStep };
  }

  it('checks the distance of every waiting loop each sub-step without asking the camera for its position', async () => {
    const { camera, manager, subStep } = await waitingZombies();
    const checks = vi.spyOn(manager['playback'], 'isWithinAudibleDistance');
    const worldPosition = vi.spyOn(camera, 'getWorldPosition');
    const updateWorldMatrix = vi.spyOn(camera, 'updateWorldMatrix');
    const updateMatrixWorld = vi.spyOn(camera, 'updateMatrixWorld');

    for (let i = 0; i < SUB_STEPS; i++) subStep();

    expect(checks).toHaveBeenCalledTimes(ENEMIES * SUB_STEPS);
    expect(worldPosition).toHaveBeenCalledTimes(0);
    expect(updateWorldMatrix).toHaveBeenCalledTimes(0);
    expect(updateMatrixWorld).toHaveBeenCalledTimes(0);
    expect(reg.positional).toHaveLength(0);
    expect(manager.getEnemySoundStats().current).toBe(0);
  });

  it('hears from where the camera stood at the last drawn frame; the next frame lets the loops join', async () => {
    const { camera, manager, subStep } = await waitingZombies();

    // The controls moved the camera; render() updates its matrix
    camera.position.set(3 * D - 10, 0, 0);
    subStep();
    expect(reg.positional).toHaveLength(0);

    camera.updateMatrixWorld();
    subStep();
    expect(reg.positional).toHaveLength(AUDIO_LIMITS.maxEnemySounds);
    expect(manager.getEnemySoundStats().current).toBe(AUDIO_LIMITS.maxEnemySounds);
  });
});
