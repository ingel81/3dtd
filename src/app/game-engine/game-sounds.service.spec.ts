import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BACKGROUND_MUSIC } from '../configs/background-music.config';
import { GameEventBus } from './game-event-bus';
import { GameSoundsService } from './game-sounds.service';
import {
  ABILITY_CAST_SOUNDS,
  CHEAT_QUIET_MS,
  DEATH_SOUNDS,
  GAME_OVER_STINGER_DELAY_MS,
  GOLEM_FOOTSTEP,
  HIT_SOUNDS,
  MOMENT_SOUNDS,
  WORLD_SOUNDS,
} from '../configs/game-sounds.config';
import { getEnemyType } from '../configs/enemy-types.config';
import { BLOOD_MOON_FIRST_WAVE } from '../configs/blood-moon.config';
import type { ThreeTilesEngine } from '../three-engine';
import type { Enemy } from '../entities/enemy.entity';

const AT = { lat: 1, lon: 2, height: 3 };

function enemy(typeId: string, worm: { group: { remaining: number } } | null = null): Enemy {
  return { typeConfig: getEnemyType(typeId), position: AT, worm } as unknown as Enemy;
}

function setup() {
  const bus = new GameEventBus();
  const audio = {
    registerSound: vi.fn(),
    playAtGeo: vi.fn(() => Promise.resolve(null)),
    playGlobal: vi.fn(() => Promise.resolve(null)),
    playAt: vi.fn(() => Promise.resolve(null)),
    geoToLocalPosition: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
  };
  const service = new GameSoundsService(bus, { spatialAudio: audio } as unknown as ThreeTilesEngine);
  const at = () => audio.playAtGeo.mock.calls.map((c) => (c as unknown[])[0]);
  const global = () => audio.playGlobal.mock.calls.map((c) => (c as unknown[])[0]);
  return { bus, audio, service, at, global };
}

describe('GameSoundsService', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('registers every sample once', () => {
    const { audio } = setup();
    const ids = audio.registerSound.mock.calls.map((c) => (c as unknown[])[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEATH_SOUNDS.zombie.id);
    expect(ids).toContain(MOMENT_SOUNDS.waveStart.id);
  });

  it('plays the death of the type where a tower killed it, with the kill gold, and nothing on a leak', () => {
    const { bus, at } = setup();
    bus.emit({ type: 'enemy:died', enemy: enemy('zombie'), credits: 5, killedBy: { kind: 'tower' } as never });
    expect(at()).toEqual([DEATH_SOUNDS.zombie.id, WORLD_SOUNDS.coin.id]);

    bus.emit({ type: 'enemy:died', enemy: enemy('zombie'), credits: 5, killedBy: null });
    expect(at()).toHaveLength(2);
  });

  it('plays a worm segment while the worm lives on, the boss death with its last one', () => {
    const { bus, at } = setup();
    const killedBy = { kind: 'tower' } as never;
    bus.emit({ type: 'enemy:died', enemy: enemy('worm', { group: { remaining: 5 } }), credits: 0, killedBy });
    bus.emit({ type: 'enemy:died', enemy: enemy('worm', { group: { remaining: 0 } }), credits: 0, killedBy });
    expect(at()).toEqual([WORLD_SOUNDS.wormSegment.id, DEATH_SOUNDS.skarnax.id]);
  });

  it('plays a split instead of the death for a type that splits', () => {
    const { bus, at } = setup();
    const skeleton = enemy('skeleton');
    bus.emit({ type: 'enemy:died', enemy: skeleton, credits: 0, killedBy: { kind: 'tower' } as never });
    bus.emit({ type: 'enemy:split', enemy: skeleton, children: [] });
    expect(at()).toEqual([WORLD_SOUNDS.skeletonSplit.id]);
  });

  it('plays hits of single shots only, and none on a ghost', () => {
    const { bus, at } = setup();
    const shot = (id: string, target: Enemy) => bus.emit({
      type: 'projectile:hit',
      projectile: { typeConfig: { id } } as never,
      target,
      damage: 1,
      damageType: 'physical' as never,
    });
    shot('arrow', enemy('tank'));
    shot('bullet', enemy('zombie'));
    shot('cannonball', enemy('ghost'));
    expect(at()).toEqual([HIT_SOUNDS.metal.id]);
  });

  it('plays the horn and stomp at a wave start, the blood moon on its waves, the falling horn at the end', () => {
    const { bus, global } = setup();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
    vi.advanceTimersByTime(BACKGROUND_MUSIC.waveStart.leadMs);
    bus.emit({ type: 'wave:started', wave: BLOOD_MOON_FIRST_WAVE, enemyCount: 10 });
    vi.advanceTimersByTime(BACKGROUND_MUSIC.waveStart.leadMs);
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    vi.advanceTimersByTime(BACKGROUND_MUSIC.waveEnd.leadMs);
    expect(global()).toEqual([MOMENT_SOUNDS.waveStart.id, MOMENT_SOUNDS.bloodMoon.id, MOMENT_SOUNDS.waveComplete.id]);
  });

  it('waits a shorter lead at a higher game speed', () => {
    const { bus, global, service } = setup();
    service.setGameSpeedSource(() => 4);
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
    vi.advanceTimersByTime(Math.round(BACKGROUND_MUSIC.waveStart.leadMs / 4));
    expect(global()).toEqual([MOMENT_SOUNDS.waveStart.id]);
  });

  it('waits for the music to fade out before the signal, and drops it on a restore or a reset', () => {
    const { bus, global } = setup();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
    vi.advanceTimersByTime(BACKGROUND_MUSIC.waveStart.leadMs - 1);
    expect(global()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(global()).toEqual([MOMENT_SOUNDS.waveStart.id]);

    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    bus.emit({ type: 'sim:restored', reason: 'live' });
    bus.emit({ type: 'wave:started', wave: 2, enemyCount: 10 });
    bus.emit({ type: 'game:reset' });
    vi.advanceTimersByTime(10_000);
    expect(global()).toEqual([MOMENT_SOUNDS.waveStart.id]);
  });

  it('plays the golem step lower, at its playback rate', () => {
    const { bus, audio } = setup();
    bus.emit({ type: 'enemy:footstep', enemy: enemy('stone-golem') });
    const { id, playbackRate } = GOLEM_FOOTSTEP.sound;
    expect(playbackRate).toBeLessThan(1);
    expect(audio.playAt).toHaveBeenCalledWith(id, { x: 1, y: 2, z: 3 }, 1, playbackRate);
  });

  it('plays the cast of an ability at its target', () => {
    const { bus, at } = setup();
    bus.emit({ type: 'ability:used', abilityId: 'emp', strikeId: 1, target: AT, radiusM: 10, warningMs: 500 });
    expect(at()).toEqual([ABILITY_CAST_SOUNDS.emp!.id]);
  });

  it('chimes when an ability has a charge again, not on its unlock', () => {
    const { bus, global } = setup();
    const status = (unlocked: boolean, charges: number) => ({
      type: 'ability:state-changed' as const,
      abilities: [{ id: 'emp', unlocked, charges, maxCharges: 1, wavesUntilCharge: 0, pending: false, launchSite: true }] as never,
    });
    bus.emit(status(false, 0));
    bus.emit(status(true, 1));
    bus.emit(status(true, 0));
    expect(global()).toEqual([]);
    bus.emit(status(true, 1));
    expect(global()).toEqual([MOMENT_SOUNDS.abilityReady.id]);
  });

  it('takes a restored state as the new baseline: no chime, no hero sound (replay in, out, a seek)', () => {
    const { bus, global } = setup();
    const status = (charges: number, restored?: true) => ({
      type: 'ability:state-changed' as const,
      abilities: [{ id: 'emp', unlocked: true, charges, maxCharges: 1, wavesUntilCharge: 0, pending: false, launchSite: true }] as never,
      ...(restored ? { restored } : {}),
    });
    bus.emit(status(0));
    bus.emit(status(1, true));
    const hero = (hired: boolean, ammo: string, restored?: true) => ({
      type: 'hero:state-changed' as const,
      hero: { unlocked: true, hired, ammo } as never,
      ...(restored ? { restored } : {}),
    });
    bus.emit(hero(false, 'standard'));
    bus.emit(hero(true, 'incendiary', true));
    expect(global()).toEqual([]);
    // After the baseline a real change sounds as before
    bus.emit(status(0));
    bus.emit(status(1));
    expect(global()).toEqual([MOMENT_SOUNDS.abilityReady.id]);
  });

  it('plays the HQ destroyed at game over, then the stinger, and drops the stinger on a reset', () => {
    const { bus, global } = setup();
    bus.emit({ type: 'game:over' } as never);
    expect(global()).toEqual([MOMENT_SOUNDS.hqDestroyed.id]);
    vi.advanceTimersByTime(GAME_OVER_STINGER_DELAY_MS);
    expect(global()).toEqual([MOMENT_SOUNDS.hqDestroyed.id, MOMENT_SOUNDS.gameOver.id]);

    bus.emit({ type: 'game:over' } as never);
    bus.emit({ type: 'game:reset' });
    vi.advanceTimersByTime(GAME_OVER_STINGER_DELAY_MS);
    expect(global()).toHaveLength(3);
  });

  it('keeps the cheat buttons and what follows from them silent, then sounds again', () => {
    const { bus, global } = setup();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    bus.emit({ type: 'debug:complete-all-research' });
    bus.emit({ type: 'research:completed', playerId: 'local', local: true, researchId: 'x' } as never);
    expect(global()).toEqual([]);

    now += CHEAT_QUIET_MS;
    bus.emit({ type: 'research:completed', playerId: 'local', local: true, researchId: 'y' } as never);
    expect(global()).toEqual([MOMENT_SOUNDS.researchComplete.id]);
  });

  it('stops listening on destroy', () => {
    const { bus, service, global } = setup();
    service.destroy();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
    expect(global()).toEqual([]);
  });
});
