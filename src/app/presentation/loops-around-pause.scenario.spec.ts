import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { AUDIO_LIMITS, OOZE_SOUNDS } from '../configs/audio.config';
import { getEnemyType } from '../configs/enemy-types.config';
import { EnemySounds } from './enemy-sounds';
import { OozeSounds } from './ooze-sounds';

/**
 * Playtest 546 and 548 (fix session 2026-09-14): what the player hears of
 * the enemies' own loops around the pause, with the presentation's
 * EnemySounds and OozeSounds on the real SpatialAudioManager. The pause
 * reaches the loops as holdLoops (PresentationHost.setPaused); the camera is
 * the listener and flies while the game stands. The presenter runs only in
 * frames with a sub-step, none in the pause.
 *
 * Real three.js math and scene graph; only the Web Audio classes are fakes
 * (jsdom has no AudioContext), as in spatial-audio.manager.spec.ts.
 */

interface FakeParam { setValueAtTime: Mock }
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

let now = 1000;

function setup() {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const manager = new SpatialAudioManager(scene, camera);
  return { camera, manager };
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
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Enemy and ooze loops around the pause (playtest 546, 548)', () => {
  const D = AUDIO_LIMITS.maxAudibleDistance;
  const flyTo = (camera: PerspectiveCamera, x: number) => {
    camera.position.set(x, 0, 0);
    camera.updateMatrixWorld(true);
  };
  /** createLoop awaits the context and the buffer. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('546: an enemy whose walk loop began out of earshot is heard once the camera flies to it', async () => {
    const { camera, manager } = setup();
    const sounds = new EnemySounds();
    const zombie = getEnemyType('zombie');
    const at = new Vector3(3 * D, 0, 0);
    const frame = () => sounds.present(7, zombie, true, at, 0, 0, 0, 16, manager);

    frame();
    await manager.getBuffer('enemy-zombie_moving');
    await settle();
    frame();
    expect(reg.positional).toHaveLength(0);

    // A waiting loop is moved every third frame (EnemySounds)
    flyTo(camera, 3 * D - 10);
    for (let i = 0; i < 3; i++) frame();
    expect(lastPositional().isPlaying).toBe(true);
    expect(lastPositional().parent?.position.x).toBe(3 * D);

    // It stops walking: the loop ends
    sounds.present(7, zombie, false, at, 0, 0, 0, 16, manager);
    expect(lastPositional().isPlaying).toBe(false);
  });

  it('548: the bubbling stands in the pause; an ooze reached meanwhile bubbles only once the game goes on', async () => {
    const { camera, manager } = setup();
    const sounds = new OozeSounds();
    sounds.register(manager);
    await manager.getBuffer(OOZE_SOUNDS.bubble.id);
    sounds.follow('ooze-1', manager, 10, 0, 0);
    await settle();
    const first = lastPositional();
    expect(first.isPlaying).toBe(true);

    manager.holdLoops(true);
    expect(first.isPlaying).toBe(false);

    // The camera flies to a second ooze. Were the presenter to run in the
    // pause, the loop would wait without audio until the game goes on
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
