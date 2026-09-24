import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { CommandLog, LOCAL_PLAYER_ID, toPlainData } from './command-log';
import { GameObject } from '../../core/game-object';

class FakeEntity extends GameObject {
  constructor() {
    super('tower');
  }
}

describe('CommandLog', () => {
  it('stamps each command with the steps run so far and the player', () => {
    let step = 0;
    const log = new CommandLog(() => step);
    log.record({ type: 'command:hire-hero' });
    step = 42;
    log.record({ type: 'command:tower-trigger', held: true } as { type: string }, 'guest');

    expect(log.entries).toEqual([
      { step: 0, playerId: LOCAL_PLAYER_ID, command: { type: 'command:hire-hero' } },
      { step: 42, playerId: 'guest', command: { type: 'command:tower-trigger', held: true } },
    ]);
    log.clear();
    expect(log.length).toBe(0);
  });

  it('keeps a copy, so later changes to the event do not reach the log', () => {
    const log = new CommandLog();
    const command = { type: 'command:hero-move', target: { lat: 1, lon: 2 } };
    log.record(command);
    command.target.lat = 9;
    expect(log.entries[0].command).toEqual({ type: 'command:hero-move', target: { lat: 1, lon: 2 } });
  });
});

describe('toPlainData', () => {
  it('copies plain data, leaves functions out and keeps an entity as its id', () => {
    const entity = new FakeEntity();
    const command = {
      type: 'command:hero-move',
      target: { lat: 1, lon: 2 },
      path: [{ x: 1 }, { x: 2 }],
      onDone: () => undefined,
      unit: entity,
    };
    const plain = toPlainData(command) as Record<string, unknown>;
    expect(plain).toEqual({
      type: 'command:hero-move',
      target: { lat: 1, lon: 2 },
      path: [{ x: 1 }, { x: 2 }],
      unit: { id: entity.id },
    });
    expect(plain['target']).not.toBe(command.target);
  });

  it('stops at a depth no command reaches', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const plain = JSON.stringify(toPlainData(deep));
    expect(plain.includes('leaf')).toBe(false);
  });
});
