import { describe, expect, it } from 'vitest';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import { WaveSeriesRecorder } from './wave-series';
import type { KilledBy } from '../game-engine/events/event-types';

describe('WaveSeriesRecorder (TODO E46)', () => {
  function setup() {
    const bus = new GameEventBus();
    const recorder = new WaveSeriesRecorder();
    const towers: Record<string, number> = { ann: 0, bob: 0 };
    let hq = 500;
    recorder.attach(bus, new SubscriptionBag(), {
      players: () => ['ann', 'bob'],
      killCredit: (by: KilledBy) => (by.kind === 'tower' && by.towerId.startsWith('b') ? 'bob' : 'ann'),
      towersOf: (id) => towers[id],
      hqHealth: () => hq,
    });
    const kill = (towerId: string) =>
      bus.emit({ type: 'enemy:died', enemy: { id: 'e' } as never, credits: 5, killedBy: { kind: 'tower', towerId } });
    const gold = (playerId: string, delta: number, source: string) =>
      bus.emit({ type: 'credits:changed', credits: 0, delta, source, playerId, local: playerId === 'ann' } as never);
    return { bus, recorder, towers, kill, gold, setHq: (v: number) => { hq = v; } };
  }

  it('keeps each player’s kills, towers and earned gold at the end of every wave, counted from the start', () => {
    const { bus, recorder, towers, kill, gold, setHq } = setup();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 3 });
    kill('a1');
    kill('b1');
    kill('b1');
    gold('ann', 5, 'kill');
    gold('bob', 10, 'kill');
    gold('bob', -60, 'build');
    gold('ann', 1000, 'cheat');
    towers['bob'] = 2;
    bus.emit({ type: 'wave:completed', wave: 1, credits: 30, perfect: true, closeCall: false, hpLost: 0 });
    bus.emit({ type: 'wave:started', wave: 2, enemyCount: 1 });
    kill('a1');
    gold('ann', 30, 'wave-bonus');
    setHq(420);
    // The HQ falls inside wave 2: no wave:completed
    bus.emit({ type: 'game:over', reason: 'base-destroyed' } as never);

    expect(recorder.points).toEqual([
      { wave: 1, hqHealth: 500, players: { ann: { kills: 1, towers: 0, goldEarned: 5 }, bob: { kills: 2, towers: 2, goldEarned: 10 } } },
      { wave: 2, hqHealth: 420, players: { ann: { kills: 2, towers: 0, goldEarned: 35 }, bob: { kills: 2, towers: 2, goldEarned: 10 } } },
    ]);
  });

  it('starts over on a reset', () => {
    const { bus, recorder, kill } = setup();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 1 });
    kill('a1');
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    bus.emit({ type: 'game:reset' });
    expect(recorder.points).toEqual([]);
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 0 });
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    expect(recorder.points[0].players['ann'].kills).toBe(0);
  });
});
