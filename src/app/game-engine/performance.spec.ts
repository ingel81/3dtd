import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { GameEventBus } from './game-event-bus';
import { EntityManager } from '../managers/entity-manager';
import { GameObject } from '../core/game-object';

// ─── Test Entity for EntityManager benchmarks ───

class PerfEntity extends GameObject {
  constructor() {
    super('tower');
  }
  update(_dt: number): void {
    // minimal work
    Math.sqrt(this.id.length);
  }
  destroy(): void {
    super.destroy();
  }
}

class PerfEntityManager extends EntityManager<PerfEntity> {}

// ─── Performance Tests ───

describe('Performance Regression Tests', () => {
  describe('EntityManager with 100+ entities', () => {
    let manager: PerfEntityManager;

    beforeEach(() => {
      manager = new PerfEntityManager();
    });

    it('should add 200 entities in under 50ms', () => {
      const start = performance.now();
      for (let i = 0; i < 200; i++) {
        manager.add(new PerfEntity());
      }
      const elapsed = performance.now() - start;

      expect(manager.getAll()).toHaveLength(200);
      expect(elapsed).toBeLessThan(50);
    });

    it('should update 200 entities in under 20ms', () => {
      for (let i = 0; i < 200; i++) {
        manager.add(new PerfEntity());
      }

      const start = performance.now();
      manager.update(16); // ~1 frame
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(20);
    });

    it('should remove 200 entities in under 50ms', () => {
      const entities: PerfEntity[] = [];
      for (let i = 0; i < 200; i++) {
        const e = new PerfEntity();
        manager.add(e);
        entities.push(e);
      }

      const start = performance.now();
      for (const e of entities) {
        manager.remove(e);
      }
      const elapsed = performance.now() - start;

      expect(manager.getAll()).toHaveLength(0);
      expect(elapsed).toBeLessThan(50);
    });

    it('should getById for 200 entities in under 5ms', () => {
      const ids: string[] = [];
      for (let i = 0; i < 200; i++) {
        const e = new PerfEntity();
        manager.add(e);
        ids.push(e.id);
      }

      const start = performance.now();
      for (const id of ids) {
        manager.getById(id);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });

  describe('GameEventBus with many events', () => {
    let bus: GameEventBus;

    beforeEach(() => {
      bus = new GameEventBus();
    });

    it('should register 100 handlers and emit 100 events in under 50ms', () => {
      const handlers = Array.from({ length: 100 }, () => vi.fn());
      for (const handler of handlers) {
        bus.on('enemy:died', handler);
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        bus.emit({
          type: 'enemy:died',
          enemy: { id: `enemy-${i}` } as never,
          credits: 10,
        });
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      // Each handler should have been called 100 times
      for (const handler of handlers) {
        expect(handler).toHaveBeenCalledTimes(100);
      }
    });

    it('should handle 1000 emit calls with single handler in under 20ms', () => {
      const handler = vi.fn();
      bus.on('enemy:died', handler);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        bus.emit({
          type: 'enemy:died',
          enemy: { id: `enemy-${i}` } as never,
          credits: 10,
        });
      }
      const elapsed = performance.now() - start;

      expect(handler).toHaveBeenCalledTimes(1000);
      expect(elapsed).toBeLessThan(20);
    });

    it('should process deferred queue of 500 events in under 30ms', () => {
      const handler = vi.fn();
      bus.on('enemy:died', handler);

      // Queue 500 deferred events
      for (let i = 0; i < 500; i++) {
        bus.emitDeferred({
          type: 'enemy:died',
          enemy: { id: `enemy-${i}` } as never,
          credits: 10,
        });
      }

      const start = performance.now();
      bus.processQueue();
      const elapsed = performance.now() - start;

      expect(handler).toHaveBeenCalledTimes(500);
      expect(elapsed).toBeLessThan(30);
    });

    it('should subscribe/unsubscribe 200 handlers without degradation', () => {
      const start = performance.now();
      const subscriptions = [];
      for (let i = 0; i < 200; i++) {
        subscriptions.push(bus.on('enemy:died', vi.fn()));
      }
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
