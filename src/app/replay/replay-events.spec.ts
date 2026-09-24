import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { isPresentationEvent, presentationEvent } from './replay-events';
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
      'audio:play', 'ability:used', 'ability:impact', 'health:changed', 'enemy:split', 'hero:level-up',
    ] as const) {
      expect(isPresentationEvent(type)).toBe(true);
    }
  });

  it('leaves out state, commands and the ability snapshots', () => {
    for (const type of [
      'enemy:died', 'enemy:spawned', 'tower:placed', 'wave:started', 'credits:changed',
      'command:place-tower', 'ability:state-changed', 'ability:rejected', 'research:progress',
      'hero:kill', 'hero:state-changed', 'command:hero-move',
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

  it('turns a split into a stub of the dead enemy\'s place and type', () => {
    const typeConfig = { id: 'skeleton', canBleed: false };
    const enemy = { position: { lat: 48.1, lon: 9.2 }, transform: { terrainHeight: 250 }, heightOffset: 1.5, typeConfig };
    const kept = presentationEvent({ type: 'enemy:split', enemy: enemy as never, children: [{}] as never });
    expect(kept).toEqual({
      type: 'enemy:split',
      enemy: { position: { lat: 48.1, lon: 9.2 }, transform: { terrainHeight: 250 }, heightOffset: 1.5, typeConfig },
      children: [],
    });
    // Later moves of the (pooled or dead) enemy do not reach the stub
    enemy.position.lat = 0;
    expect((kept as { enemy: { position: { lat: number } } }).enemy.position.lat).toBe(48.1);
  });
});
