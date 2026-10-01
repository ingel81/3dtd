import { describe, it, expect } from 'vitest';
import { CoopRunCounts } from './coop-run-counts';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { createMainEventBus } from '../sim/client/view-events';
import type { EnemyView } from '../sim/client/views';

const ROSTER = [
  { id: 'host', name: 'Host', spawnIds: ['north'] },
  { id: 'guest', name: 'Guest', spawnIds: ['south'] },
];

function counts() {
  const bus = createMainEventBus();
  const runCounts = new CoopRunCounts({
    mirror: { killCreditPlayer: () => 'guest', creditsOf: (id) => (id === 'host' ? 10 : 20) },
    inGame: () => true,
    roster: () => ROSTER,
    playerId: () => 'host',
    leftIds: () => new Set(),
    laneColorOf: () => '#fff',
  });
  runCounts.wire(bus, new SubscriptionBag());
  return { bus, runCounts };
}

const enemyOn = (id: string, routeId: string) => ({ id, movement: { routeId } }) as unknown as EnemyView;

describe('CoopRunCounts', () => {
  it('gives a leak to the lane whose route the enemy walks, by its route id', () => {
    const { bus, runCounts } = counts();
    bus.emit({ type: 'enemy:reached-base', enemy: enemyOn('enemy-1', 'south'), damage: 1 });
    bus.emit({ type: 'enemy:reached-base', enemy: enemyOn('enemy-2', 'north'), damage: 1 });
    bus.emit({ type: 'enemy:reached-base', enemy: enemyOn('enemy-3', 'south'), damage: 1 });
    // A route no lane has, and none (a debug placement)
    bus.emit({ type: 'enemy:reached-base', enemy: enemyOn('enemy-4', 'east'), damage: 1 });
    bus.emit({ type: 'enemy:reached-base', enemy: enemyOn('enemy-5', ''), damage: 1 });
    expect([...runCounts.waveLeaks()]).toEqual([['guest', 2], ['host', 1]]);
  });

  it('counts a kill for the player the mirror credits, and each player\'s gold in the table', () => {
    const { bus, runCounts } = counts();
    bus.emit({ type: 'enemy:died', enemy: enemyOn('enemy-1', 'north'), credits: 5, killedBy: { kind: 'tower', towerId: 'tower-1' } });
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    const rows = runCounts.summary()!;
    expect(rows.map((r) => [r.id, r.kills, r.gold])).toEqual([['host', 0, 10], ['guest', 1, 20]]);
  });
});
