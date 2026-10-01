import { describe, expect, it } from 'vitest';
import { CoopRoom, type CoopRoomHost } from './coop-room';
import { GameEventBus } from '../../game-engine';
import { CreditsLedger } from './credits-ledger';

/** A room over `players` in a world with `spawns` */
function room(players: string[], spawns = ['spawn-1', 'spawn-2', 'spawn-3']) {
  const bus = new GameEventBus();
  const host: CoopRoomHost = {
    eventBus: bus,
    creditsLedger: new CreditsLedger(bus),
    players: () => players,
    localPlayerId: () => players[0],
    leaveTowers: () => undefined,
    spawnIds: () => spawns,
  };
  return new CoopRoom(host);
}

describe('CoopRoom lanes (docs/LANES_PLAN.md)', () => {
  it('alone, every spawn point is a lane of the player', () => {
    const r = room(['local']);
    expect(r.laneSpawns).toEqual(['spawn-1', 'spawn-2', 'spawn-3']);
    expect(r.laneSpawnsOf('local')).toEqual(['spawn-1', 'spawn-2', 'spawn-3']);
    expect(r.laneOwnerOf('spawn-2')).toBe('local');
  });

  it('in coop a player has as many lanes as they took, in roster order, a spawn once', () => {
    const r = room(['a', 'b']);
    expect(r.laneSpawns).toEqual([]);
    r.setLanes([['b', 'spawn-2'], ['a', 'spawn-3'], ['a', 'spawn-1'], ['b', 'spawn-1'], ['x', 'spawn-4']]);
    expect(r.laneSpawns).toEqual(['spawn-3', 'spawn-1', 'spawn-2']);
    expect(r.laneSpawnsOf('a')).toEqual(['spawn-3', 'spawn-1']);
    expect(r.laneSpawnsOf('b')).toEqual(['spawn-2']);
    expect(r.laneOwnerOf('spawn-1')).toBe('a');
    expect(r.laneOwnerOf('spawn-4')).toBeNull();
  });

  it('closes every lane of a player who left', () => {
    const r = room(['a', 'b']);
    r.setLanes([['a', 'spawn-1'], ['a', 'spawn-2'], ['b', 'spawn-3']]);
    r.playerLeft('a');
    expect(r.laneSpawns).toEqual(['spawn-3']);
    expect(r.laneSpawnsOf('a')).toEqual([]);
  });
});
