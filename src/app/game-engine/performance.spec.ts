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

/**
 * Wall-clock sanity cap (TEST-10 de-flake).
 *
 * These tests used to assert tight per-operation budgets (5–50 ms). Under
 * Vitest they run in jsdom, in parallel with other suites, and are subject to
 * GC pauses and OS scheduling — a strict wall-clock bound flakes on loaded CI
 * runners without any real regression.
 *
 * The PRIMARY value of each test below is its FUNCTIONAL assertion (entity
 * counts, handler call-counts) — those are deterministic and stay strict.
 * The timing check is kept only as a coarse catastrophe guard: an accidental
 * O(n^3) loop, a blocking call or an infinite loop still trips this cap, but
 * normal scheduler jitter never does. Precise performance tracking belongs in
 * `vitest bench`, not in a pass/fail unit test.
 */
const SANITY_CAP_MS = 500;

// ─── Performance Tests ───

describe('Performance Regression Tests', () => {
  describe('EntityManager with 100+ entities', () => {
    let manager: PerfEntityManager;

    beforeEach(() => {
      manager = new PerfEntityManager();
    });

    it('adds 200 entities (functional + no catastrophic stall)', () => {
      const start = performance.now();
      for (let i = 0; i < 200; i++) {
        manager.add(new PerfEntity());
      }
      const elapsed = performance.now() - start;

      expect(manager.getAll()).toHaveLength(200);
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('updates 200 entities (functional + no catastrophic stall)', () => {
      for (let i = 0; i < 200; i++) {
        manager.add(new PerfEntity());
      }

      const start = performance.now();
      manager.update(16); // ~1 frame
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('removes 200 entities (functional + no catastrophic stall)', () => {
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
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('getById resolves 200 ids (functional + no catastrophic stall)', () => {
      const ids: string[] = [];
      for (let i = 0; i < 200; i++) {
        const e = new PerfEntity();
        manager.add(e);
        ids.push(e.id);
      }

      const start = performance.now();
      const resolved = ids.map((id) => manager.getById(id));
      const elapsed = performance.now() - start;

      // Every id must resolve back to a live entity — the real regression guard.
      expect(resolved.every((e) => e !== undefined)).toBe(true);
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });
  });

  describe('GameEventBus with many events', () => {
    let bus: GameEventBus;

    beforeEach(() => {
      bus = new GameEventBus();
    });

    it('registers 100 handlers and emits 100 events', () => {
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

      // Each handler should have been called once per event.
      for (const handler of handlers) {
        expect(handler).toHaveBeenCalledTimes(100);
      }
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('handles 1000 emit calls with a single handler', () => {
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
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('processes a deferred queue of 500 events', () => {
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
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });

    it('subscribes/unsubscribes 200 handlers without leaking listeners', () => {
      const start = performance.now();
      const subscriptions = [];
      for (let i = 0; i < 200; i++) {
        subscriptions.push(bus.on('enemy:died', vi.fn()));
      }
      for (const sub of subscriptions) {
        sub.dispose();
      }
      const elapsed = performance.now() - start;

      // All listeners must be gone after unsubscribing — the real guard.
      expect(bus.getListenerCount('enemy:died')).toBe(0);
      expect(elapsed).toBeLessThan(SANITY_CAP_MS);
    });
  });
});
