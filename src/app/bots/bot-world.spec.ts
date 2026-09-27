import { describe, it, expect } from 'vitest';
import { PlayerBotWorld } from './bot-world';
import { GameRng } from '../utils/game-rng';
import { createEmptySnapshot } from '../director/models/game-state-snapshot';
import type { GameStateManager } from '../managers/game-state.manager';
import type { Tower } from '../entities/tower.entity';

const SPAWN_A = { id: 'a', lat: 48.0, lon: 9.0 };
const SPAWN_B = { id: 'b', lat: 48.1, lon: 9.1 };
const PATH_A = [{ lat: 48.0, lon: 9.0 }, { lat: 48.05, lon: 9.05 }];
const PATH_B = [{ lat: 48.1, lon: 9.1 }, { lat: 48.05, lon: 9.05 }];

function tower(id: string, ownerId: string): Tower {
  return { id, ownerId } as unknown as Tower;
}

function enemy(id: string, path: { lat: number; lon: number }[]) {
  return { id, movement: { path } };
}

/** A game with `players`, `local` at this client, lanes a and b in roster order */
function game(players: string[], local = players[0], towers = [tower('t1', players[0]), tower('t2', players[players.length - 1])]) {
  const rng = new GameRng(1234);
  const lanes = new Map(players.length > 1 ? [[players[0], 'a'], [players[1], 'b']] : []);
  const enemies = [enemy('e1', PATH_A), enemy('e2', PATH_B)];
  const credits = new Map(players.map((id, i) => [id, 100 * (i + 1)]));
  const fake = {
    players,
    localPlayerId: local,
    rng,
    gameTimeMs: 0,
    towerManager: { getAll: () => towers },
    enemyManager: { getAlive: () => enemies },
    abilityManager: {},
    heroManager: {},
    getSpawnPoints: () => [SPAWN_A, SPAWN_B],
    getCachedPaths: () => new Map([['a', PATH_A], ['b', PATH_B]]),
    laneSpawnOf: (id: string) => lanes.get(id) ?? null,
    creditsOf: (id: string) => credits.get(id) ?? 0,
    researchOf: () => ({ airTargetingUnlocked: false }),
    heroOf: () => ({ getDefenseProfile: () => null }),
  };
  return { fake, world: new PlayerBotWorld(fake as unknown as GameStateManager) };
}

describe('PlayerBotWorld, single player', () => {
  it('passes the whole game through: every tower, spawn, route and enemy, the run\'s bot stream', () => {
    const { fake, world } = game(['local']);
    expect(world.coop).toBe(false);
    expect(world.towerManager).toBe(fake.towerManager);
    expect(world.enemyManager).toBe(fake.enemyManager);
    expect(world.getSpawnPoints()).toHaveLength(2);
    expect([...world.getCachedPaths().keys()]).toEqual(['a', 'b']);
    expect(world.rng).toBe(fake.rng);
  });

  it('leaves the snapshot as it is', () => {
    const { world } = game(['local']);
    const snapshot = createEmptySnapshot();
    expect(world.view(snapshot)).toBe(snapshot);
  });
});

describe('PlayerBotWorld, coop', () => {
  it('sees only its own towers, its own lane and the enemies on it', () => {
    const { world } = game(['host', 'guest'], 'guest');
    expect(world.coop).toBe(true);
    expect(world.towerManager.getAll().map((t) => t.id)).toEqual(['t2']);
    expect(world.getSpawnPoints().map((s) => s.id)).toEqual(['b']);
    expect([...world.getCachedPaths().keys()]).toEqual(['b']);
    expect(world.enemyManager.getAlive().map((e) => e.id)).toEqual(['e2']);
  });

  it('rolls its own dice and leaves the run\'s bot stream alone (it goes into the state hash)', () => {
    const { fake, world } = game(['host', 'guest'], 'host');
    const before = fake.rng.getState();
    const roll = world.rng.stream('bot');
    for (let i = 0; i < 5; i++) roll();
    expect(fake.rng.getState()).toEqual(before);
  });

  it('rolls other dice than the partner\'s bot, the same again for the same run', () => {
    const host = game(['host', 'guest'], 'host').world.rng.stream('bot')();
    const guest = game(['host', 'guest'], 'guest').world.rng.stream('bot')();
    const hostAgain = game(['host', 'guest'], 'host').world.rng.stream('bot')();
    expect(host).not.toBe(guest);
    expect(host).toBe(hostAgain);
  });

  it('reads its own credits and the defense of its own towers from the snapshot', () => {
    // The partner has a tower, the guest none
    const { world } = game(['host', 'guest'], 'guest', [tower('t1', 'host')]);
    const snapshot = createEmptySnapshot();
    snapshot.player.credits = 300;
    snapshot.defense.towerCount = 1;
    snapshot.vulnerabilities.airDefenseGap = false;
    const view = world.view(snapshot);
    expect(view.player.credits).toBe(200);
    expect(view.player.lives).toBe(snapshot.player.lives);
    expect(view.defense.towerCount).toBe(0);
    expect(view.vulnerabilities.airDefenseGap).toBe(true);
    expect(view.waveNumber).toBe(snapshot.waveNumber);
    expect(snapshot.player.credits).toBe(300);
  });
});
