import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { Vector3 } from 'three';
import { Enemy } from '../entities/enemy.entity';
import { Tower } from '../entities/tower.entity';
import { Projectile } from '../entities/projectile.entity';
import { GeoPosition } from '../models/game.types';
import { GameEventBus, SubscriptionBag } from './game-event-bus';

describe('GameEventBus', () => {
  let bus: GameEventBus;

  const mockEnemy = { id: 'enemy-1' } as Enemy;
  const mockTower = { id: 'tower-1' } as Tower;
  const mockProjectile = { id: 'proj-1' } as Projectile;
  const mockPosition: GeoPosition = { lat: 10, lon: 20, height: 5 };

  beforeEach(() => {
    bus = new GameEventBus();
  });

  describe('Basics', () => {
    it('on() registers handler and emit() calls it', () => {
      const handler = vi.fn();
      const event = { type: 'enemy:died', enemy: mockEnemy, credits: 100 } as const;

      bus.on('enemy:died', handler);
      bus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('off() removes handler', () => {
      const handler = vi.fn();
      const event = { type: 'enemy:died', enemy: mockEnemy, credits: 100 } as const;

      bus.on('enemy:died', handler);
      bus.off('enemy:died', handler);
      bus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('emits with correct payload (type-safe)', () => {
      const handler = vi.fn();
      const event = {
        type: 'tower:placed',
        tower: mockTower,
        position: mockPosition,
        cost: 50,
      } as const;

      bus.on('tower:placed', handler);
      bus.emit(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('supports multiple listeners for same event type', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const event = { type: 'projectile:hit', projectile: mockProjectile, target: mockEnemy, damage: 10, damageType: 'physical' as const } as const;

      bus.on('projectile:hit', handlerA);
      bus.on('projectile:hit', handlerB);
      bus.emit(event);

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe('Deferred Events', () => {
    it('emitDeferred() does not dispatch immediately', () => {
      const handler = vi.fn();
      const event = {
        type: 'audio:play',
        sound: 'boom',
        lat: 1,
        lon: 2,
        height: 3,
      } as const;

      bus.on('audio:play', handler);
      bus.emitDeferred(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('processQueue() dispatches queued events and clears queue (FIFO)', () => {
      const calls: string[] = [];
      bus.on('audio:play', (event) => calls.push(event.sound));

      bus.emitDeferred({ type: 'audio:play', sound: 'first', lat: 0, lon: 0, height: 0 });
      bus.emitDeferred({ type: 'audio:play', sound: 'second', lat: 0, lon: 0, height: 0 });

      expect(bus.getQueueSize()).toBe(2);

      bus.processQueue();

      expect(calls).toEqual(['first', 'second']);
      expect(bus.getQueueSize()).toBe(0);
    });
  });

  describe('Owner-based Subscriptions', () => {
    it('subscribe(owner, type, handler) works like on()', () => {
      const owner = {};
      const handler = vi.fn();
      const event = { type: 'game:started' } as const;

      bus.subscribe(owner, 'game:started', handler);
      bus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribeAll(owner) removes all subscriptions for owner', () => {
      const owner = {};
      const handler = vi.fn();
      const event = { type: 'game:started' } as const;

      bus.subscribe(owner, 'game:started', handler);
      bus.unsubscribeAll(owner);
      bus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('owners are independent', () => {
      const ownerA = {};
      const ownerB = {};
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const event = { type: 'game:started' } as const;

      bus.subscribe(ownerA, 'game:started', handlerA);
      bus.subscribe(ownerB, 'game:started', handlerB);

      bus.unsubscribeAll(ownerA);
      bus.emit(event);

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe('EventSubscription', () => {
    it('dispose() removes handler', () => {
      const handler = vi.fn();
      const event = { type: 'game:over', reason: 'quit' } as const;

      const subscription = bus.on('game:over', handler);
      subscription.dispose();
      bus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('double dispose() does not crash', () => {
      const handler = vi.fn();
      const subscription = bus.on('game:over', handler);

      expect(() => subscription.dispose()).not.toThrow();
      expect(() => subscription.dispose()).not.toThrow();
    });
  });

  describe('SubscriptionBag', () => {
    it('add() stores subscriptions and size is correct', () => {
      const bag = new SubscriptionBag();
      bag.add(bus.on('game:started', vi.fn()));
      bag.add(bus.on('game:over', vi.fn()));

      expect(bag.size).toBe(2);
    });

    it('disposeAll() removes all subscriptions', () => {
      const bag = new SubscriptionBag();
      const handler = vi.fn();
      bag.add(bus.on('game:started', handler));
      bag.add(bus.on('game:over', handler));

      bag.disposeAll();
      expect(bag.size).toBe(0);

      bus.emit({ type: 'game:started' });
      bus.emit({ type: 'game:over', reason: 'quit' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onAny (debug)', () => {
    it('receives all events regardless of type', () => {
      const anyHandler = vi.fn();
      const typedHandler = vi.fn();

      bus.onAny(anyHandler);
      bus.on('credits:changed', typedHandler);

      bus.emit({ type: 'credits:changed', credits: 200, delta: 50 });
      bus.emit({ type: 'health:changed', health: 80, delta: -10 });

      expect(anyHandler).toHaveBeenCalledTimes(2);
      expect(typedHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear()', () => {
    it('removes all listeners and clears deferred queue', () => {
      const handler = vi.fn();
      bus.on('audio:play', handler);
      bus.emitDeferred({ type: 'audio:play', sound: 'hello', lat: 0, lon: 0, height: 0 });

      bus.clear();

      expect(bus.getQueueSize()).toBe(0);
      bus.processQueue();
      bus.emit({ type: 'audio:play', sound: 'later', lat: 0, lon: 0, height: 0 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Metrics', () => {
    it('enableMetrics(), getMetrics(), resetMetrics() work correctly', () => {
      bus.enableMetrics();

      bus.on('enemy:died', vi.fn());
      bus.on('audio:play', vi.fn());

      bus.emit({ type: 'enemy:died', enemy: mockEnemy, credits: 100 });
      bus.emitDeferred({ type: 'audio:play', sound: 'sfx', lat: 1, lon: 1, height: 0 });

      let metrics = bus.getMetrics();
      expect(metrics.eventsEmitted).toBe(1);
      expect(metrics.eventsDeferred).toBe(1);
      expect(metrics.listenerCalls).toBe(1);
      expect(metrics.queueSize).toBe(1);
      expect(metrics.listenerCount).toBe(2);

      bus.processQueue();
      metrics = bus.getMetrics();
      expect(metrics.eventsEmitted).toBe(2);
      expect(metrics.listenerCalls).toBe(2);
      expect(metrics.queueSize).toBe(0);

      bus.resetMetrics();
      metrics = bus.getMetrics();
      expect(metrics.eventsEmitted).toBe(0);
      expect(metrics.eventsDeferred).toBe(0);
      expect(metrics.listenerCalls).toBe(0);
    });

    it('getListenerCount() and hasListeners() work with/without filter', () => {
      expect(bus.getListenerCount()).toBe(0);
      expect(bus.hasListeners('wave:started')).toBe(false);

      bus.on('wave:started', vi.fn());
      bus.on('wave:completed', vi.fn());

      expect(bus.getListenerCount()).toBe(2);
      expect(bus.getListenerCount('wave:started')).toBe(1);
      expect(bus.hasListeners('wave:started')).toBe(true);
      expect(bus.hasListeners('tower:sold')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('emit without listeners does not crash', () => {
      expect(() => bus.emit({ type: 'game:started' })).not.toThrow();
    });

    it('duplicate subscribe with same handler does not crash and is idempotent', () => {
      const handler = vi.fn();
      bus.on('game:started', handler);
      bus.on('game:started', handler);

      bus.emit({ type: 'game:started' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('processQueue() with empty queue does not crash', () => {
      expect(() => bus.processQueue()).not.toThrow();
    });

    it('listener can remove itself during emit without crash', () => {
      const handler = vi.fn(() => {
        bus.off('vfx:explosion', handler as unknown as (e: never) => void);
      });
      const secondary = vi.fn();

      bus.on('vfx:explosion', handler);
      bus.on('vfx:explosion', secondary);

      bus.emit({ type: 'vfx:explosion', position: new Vector3(1, 2, 3), radius: 5 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(secondary).toHaveBeenCalledTimes(1);
    });
  });
});
