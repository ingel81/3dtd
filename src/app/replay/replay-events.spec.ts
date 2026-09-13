import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { isPresentationEvent, presentationEvent, toPlainData } from './replay-events';
import { GameObject } from '../core/game-object';
import type { GameEvent } from '../game-engine/game-event-bus';

class FakeEntity extends GameObject {
  constructor() {
    super('tower');
  }
}

describe('isPresentationEvent', () => {
  it('keeps what the effect services show or play', () => {
    for (const type of [
      'vfx:projectile-impact', 'vfx:blood', 'vfx:muzzle-flash', 'vfx:chain-lightning',
      'audio:play', 'ability:used', 'ability:impact', 'health:changed', 'enemy:split',
    ] as const) {
      expect(isPresentationEvent(type)).toBe(true);
    }
  });

  it('leaves out state, commands and the ability snapshots', () => {
    for (const type of [
      'enemy:died', 'enemy:spawned', 'tower:placed', 'wave:started', 'credits:changed',
      'command:place-tower', 'ability:state-changed', 'ability:rejected', 'research:progress',
    ] as const) {
      expect(isPresentationEvent(type)).toBe(false);
    }
  });

  it('takes a vfx or ability event that does not exist yet', () => {
    expect(isPresentationEvent('vfx:frost-nova' as never)).toBe(true);
    expect(isPresentationEvent('ability:laser-sweep' as never)).toBe(true);
  });
});

describe('presentationEvent', () => {
  it('keeps the event object itself', () => {
    const event: GameEvent = { type: 'audio:play', sound: 'arrow', lat: 1, lon: 2, height: 3 };
    expect(presentationEvent(event)).toBe(event);
  });

  it('drops an event that holds a live entity', () => {
    const event = { type: 'vfx:tower-glow', tower: new FakeEntity() } as unknown as GameEvent;
    expect(presentationEvent(event)).toBeNull();
  });

  it('turns a split into a stub of the dead enemy\'s place', () => {
    const enemy = { position: { lat: 48.1, lon: 9.2 }, transform: { terrainHeight: 250 }, heightOffset: 1.5 };
    const kept = presentationEvent({ type: 'enemy:split', enemy: enemy as never, children: [{}] as never });
    expect(kept).toEqual({
      type: 'enemy:split',
      enemy: { position: { lat: 48.1, lon: 9.2 }, transform: { terrainHeight: 250 }, heightOffset: 1.5 },
      children: [],
    });
    // Later moves of the (pooled or dead) enemy do not reach the stub
    enemy.position.lat = 0;
    expect((kept as { enemy: { position: { lat: number } } }).enemy.position.lat).toBe(48.1);
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
