import { describe, it, expect } from 'vitest';
import { PlayerBotWorld } from './bot-world';
import { GameRng } from '../utils/game-rng';
import { createEmptySnapshot } from '../director/models/game-state-snapshot';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { packet, towerDto } from '../sim/client/mirror/testing/mirror-packets';
import { Tower } from '../entities/tower.entity';

const SPAWN_A = { id: 'a', name: 'A', lat: 48.0, lon: 9.0 };
const SPAWN_B = { id: 'b', name: 'B', lat: 48.1, lon: 9.1 };
const PATH_A = [{ lat: 48.0, lon: 9.0 }, { lat: 48.05, lon: 9.05 }];
const PATH_B = [{ lat: 48.1, lon: 9.1 }, { lat: 48.05, lon: 9.05 }];
const SEED = 1234;

function tower(ownerId: string): Tower {
  const t = new Tower({ lat: 48.05, lon: 9.05, height: 0 }, 'archer');
  t.ownerId = ownerId;
  return t;
}

/**
 * A game with `players`, `local` at this client, lanes a and b in roster
 * order, as the mirror has it after one packet: the towers, an enemy on each
 * route (route index 0 is spawn a, 1 is spawn b), the credits.
 */
function game(players: string[], local = players[0], owners = [players[0], players[players.length - 1]]) {
  const towers = owners.map(tower);
  const mirror = new SimMirror();
  mirror.setWorld(['a', 'b'], new Map([['a', PATH_A], ['b', PATH_B]]));
  mirror.applyState(packet({
    scalars: {
      players,
      localPlayerId: local,
      credits: players.map((_, i) => 100 * (i + 1)),
      laneSpawns: players.length > 1 ? ['a', 'b'] : [],
      laneOwners: players.length > 1 ? players.slice(0, 2) : [],
      seed: SEED,
    },
    towerStates: towers.map(towerDto),
    enemies: [{ num: 1, type: 'zombie', route: 0 }, { num: 2, type: 'zombie', route: 1 }],
  }));
  const world = new PlayerBotWorld({
    mirror,
    spawnPoints: () => [SPAWN_A, SPAWN_B],
    paths: () => new Map([['a', PATH_A], ['b', PATH_B]]),
    routes: { previewSweep: () => null },
    peek: () => [],
    metresUnderFire: () => new Map(),
  });
  return { mirror, towers, world };
}

describe('PlayerBotWorld, single player', () => {
  it('passes the whole game through: every tower, spawn, route and enemy, the run\'s bot stream', () => {
    const { mirror, towers, world } = game(['local']);
    expect(world.coop).toBe(false);
    expect(world.towerManager.getAll().map((t) => t.id)).toEqual(towers.map((t) => t.id));
    expect(world.enemyManager.getAlive().map((e) => e.id)).toEqual(['enemy-1', 'enemy-2']);
    expect(world.getSpawnPoints()).toHaveLength(2);
    expect([...world.getCachedPaths().keys()]).toEqual(['a', 'b']);
    expect(world.rng).toBe(mirror.rng);
  });

  it('draws the bot stream of the run seed on the main thread, the sequence the simulation had', () => {
    const { world } = game(['local']);
    const expected = new GameRng(SEED).stream('bot');
    const roll = world.rng.stream('bot');
    expect([roll(), roll()]).toEqual([expected(), expected()]);
  });

  it('leaves the snapshot as it is', () => {
    const { world } = game(['local']);
    const snapshot = createEmptySnapshot();
    expect(world.view(snapshot)).toBe(snapshot);
  });
});

describe('PlayerBotWorld, coop', () => {
  it('sees only its own towers, its own lane and the enemies on it', () => {
    const { towers, world } = game(['host', 'guest'], 'guest');
    expect(world.coop).toBe(true);
    expect(world.towerManager.getAll().map((t) => t.id)).toEqual([towers[1].id]);
    expect(world.getSpawnPoints().map((s) => s.id)).toEqual(['b']);
    expect([...world.getCachedPaths().keys()]).toEqual(['b']);
    expect(world.enemyManager.getAlive().map((e) => e.id)).toEqual(['enemy-2']);
  });

  it('rolls its own dice and leaves the run\'s bot stream alone', () => {
    const { mirror, world } = game(['host', 'guest'], 'host');
    const before = mirror.rng.getState();
    const roll = world.rng.stream('bot');
    for (let i = 0; i < 5; i++) roll();
    expect(mirror.rng.getState()).toEqual(before);
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
    const { world } = game(['host', 'guest'], 'guest', ['host']);
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
