import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MovementComponent } from './movement.component';
import { GameObject } from '../core/game-object';
import { TransformComponent } from './transform.component';
import { ComponentType } from '../core/component';
import { StatusEffect } from '../models/status-effects';
import type { GeoPosition } from '../models/game.types';

class TestGameObject extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

describe('MovementComponent', () => {
  let gameObject: TestGameObject;
  let movement: MovementComponent;

  beforeEach(() => {
    gameObject = new TestGameObject();
    movement = new MovementComponent(gameObject);
  });

  it('setPath sets path and initial position', () => {
    const path = [
      { lat: 1, lon: 2, height: 3 },
      { lat: 1.001, lon: 2.001, height: 4 },
    ];

    movement.setPath(path);

    expect(movement.path).toEqual(path);
    expect(movement.currentIndex).toBe(0);
    expect(movement.progress).toBe(0);

    const transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    expect(transform?.position).toEqual(path[0]);
    expect(transform?.terrainHeight).toBe(3);
  });

  it('uses speedMps from constructor defaults and setter', () => {
    expect(movement.speedMps).toBe(0);
    movement.speedMps = 7.5;
    expect(movement.speedMps).toBe(7.5);
  });

  it('update/move follows the path over time', () => {
    const path = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];
    movement.setPath(path);
    movement.speedMps = 1;

    const result = movement.move(1000, 0);

    const transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    expect(result).toBe('moving');
    expect(transform.position.lat).toBeGreaterThan(0);
    expect(transform.position.lat).toBeLessThan(path[1].lat);
    expect(movement.progress).toBeGreaterThan(0);
  });

  it('hasReachedEnd is false at start and true at end', () => {
    const path = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];
    movement.setPath(path);
    movement.speedMps = 2000;

    expect(movement.getPathProgress()).toBe(0);

    const result = movement.move(1000, 0);

    expect(result).toBe('reached_end');
    expect(movement.getPathProgress()).toBe(1);
  });

  it('applies slow status effects and removes expired effects (game-time)', () => {
    const slow: StatusEffect = {
      type: 'slow',
      value: 0.5,
      duration: 1000,
      startTime: 1000, // game-time ms
    };

    movement.applyStatusEffect(slow);
    expect(movement.isSlowed(1500)).toBe(true);   // 500ms elapsed: still active
    expect(movement.isSlowed(2500)).toBe(false);  // 1500ms elapsed: expired

    movement.removeExpiredEffects(2500);
    expect(movement.statusEffects.length).toBe(0);
  });

  describe('applyStatusEffect — DOT/refresh stacking semantics', () => {
    it('slow effects do NOT stack — a new slow replaces the existing one', () => {
      const slowA: StatusEffect = {
        type: 'slow', value: 0.3, duration: 1000, startTime: 0, sourceId: 'tower-A',
      };
      const slowB: StatusEffect = {
        type: 'slow', value: 0.7, duration: 2000, startTime: 500, sourceId: 'tower-B',
      };
      movement.applyStatusEffect(slowA);
      movement.applyStatusEffect(slowB);
      // Only ONE slow entry survives — the second one (refresh)
      expect(movement.statusEffects.filter(e => e.type === 'slow').length).toBe(1);
      const surviving = movement.statusEffects.find(e => e.type === 'slow')!;
      expect(surviving.value).toBe(0.7);
      expect(surviving.duration).toBe(2000);
      expect(surviving.startTime).toBe(500);
      expect(surviving.sourceId).toBe('tower-B');
    });

    it('poison effects do NOT stack — a new poison replaces the existing one', () => {
      const poisonA: StatusEffect = {
        type: 'poison', value: 5, duration: 3000, startTime: 0, sourceId: 'tower-A',
      };
      const poisonB: StatusEffect = {
        type: 'poison', value: 12, duration: 4000, startTime: 1000, sourceId: 'tower-B',
      };
      movement.applyStatusEffect(poisonA);
      movement.applyStatusEffect(poisonB);
      expect(movement.statusEffects.filter(e => e.type === 'poison').length).toBe(1);
      const surviving = movement.statusEffects.find(e => e.type === 'poison')!;
      expect(surviving.value).toBe(12);
      expect(surviving.duration).toBe(4000);
      expect(surviving.sourceId).toBe('tower-B');
    });

    it('slow and poison live independently — applying one does not displace the other', () => {
      const slow: StatusEffect  = { type: 'slow',   value: 0.4, duration: 1000, startTime: 0 };
      const poison: StatusEffect = { type: 'poison', value: 5,   duration: 2000, startTime: 0 };
      movement.applyStatusEffect(slow);
      movement.applyStatusEffect(poison);
      expect(movement.statusEffects.length).toBe(2);
      expect(movement.statusEffects.some(e => e.type === 'slow')).toBe(true);
      expect(movement.statusEffects.some(e => e.type === 'poison')).toBe(true);
    });

    it('non-slow/poison effects from the SAME source refresh in place', () => {
      const burnA: StatusEffect = {
        type: 'burn', value: 3, duration: 500, startTime: 0, sourceId: 'flame-tower-1',
      };
      const burnRefresh: StatusEffect = {
        type: 'burn', value: 7, duration: 1200, startTime: 400, sourceId: 'flame-tower-1',
      };
      movement.applyStatusEffect(burnA);
      movement.applyStatusEffect(burnRefresh);
      expect(movement.statusEffects.length).toBe(1);
      expect(movement.statusEffects[0].value).toBe(7);
      expect(movement.statusEffects[0].duration).toBe(1200);
    });

    it('non-slow/poison effects from DIFFERENT sources stack independently', () => {
      const burnA: StatusEffect = {
        type: 'burn', value: 3, duration: 1000, startTime: 0, sourceId: 'flame-tower-1',
      };
      const burnB: StatusEffect = {
        type: 'burn', value: 5, duration: 1500, startTime: 0, sourceId: 'flame-tower-2',
      };
      movement.applyStatusEffect(burnA);
      movement.applyStatusEffect(burnB);
      expect(movement.statusEffects.length).toBe(2);
    });

    it('updateStatusEffects reports slow + poison flags simultaneously', () => {
      movement.applyStatusEffect({
        type: 'slow', value: 0.6, duration: 1000, startTime: 0,
      });
      movement.applyStatusEffect({
        type: 'poison', value: 5, duration: 1000, startTime: 0,
      });
      const result = movement.updateStatusEffects(500);
      expect(result.isSlowed).toBe(true);
      expect(result.isPoisoned).toBe(true);
      expect(result.slowMultiplier).toBeCloseTo(0.4, 6); // 1 - 0.6
    });

    it('expired effects are compacted out by updateStatusEffects', () => {
      movement.applyStatusEffect({
        type: 'slow', value: 0.5, duration: 1000, startTime: 0,
      });
      movement.applyStatusEffect({
        type: 'poison', value: 3, duration: 5000, startTime: 0,
      });
      // gameTime 2000: slow expired (>= 1000 elapsed), poison still active
      const result = movement.updateStatusEffects(2000);
      expect(result.isSlowed).toBe(false);
      expect(result.isPoisoned).toBe(true);
      expect(movement.statusEffects.length).toBe(1);
      expect(movement.statusEffects[0].type).toBe('poison');
    });

    it('freeze counts as slowed for movement purposes', () => {
      movement.applyStatusEffect({
        type: 'freeze', value: 1.0, duration: 1000, startTime: 0, sourceId: 'ice',
      });
      const result = movement.updateStatusEffects(500);
      expect(result.isSlowed).toBe(true);
    });
  });

  it('handles edge cases for empty and single-point paths', () => {
    const transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    const initialPosition = { ...transform.position };

    movement.setPath([]);
    expect(movement.getPathProgress()).toBe(0);
    expect(movement.move(1000, 0)).toBe('moving');
    expect(transform.position).toEqual(initialPosition);

    const singlePoint = { lat: 5, lon: 6, height: 7 };
    movement.setPath([singlePoint]);
    expect(movement.getPathProgress()).toBe(0);
    expect(movement.move(1000, 0)).toBe('moving');
    expect(transform.position).toEqual(singlePoint);
  });

  describe('heading hold', () => {
    // 22 m north, then 29 m east, at a real latitude so lat/lon rounding is realistic.
    const corner: GeoPosition[] = [
      { lat: 48.776, lon: 9.183 },
      { lat: 48.7762, lon: 9.183 },
      { lat: 48.7762, lon: 9.1834 },
    ];
    const STEP_MS = 16.667;
    let transform: TransformComponent;
    const target = () => (transform as unknown as { targetRotation: number }).targetRotation;

    beforeEach(() => {
      transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      movement.setPath(corner);
      movement.speedMps = 50; // ~0.83 m per step, ~27 steps on the first segment
    });

    /** Steps `n` times; per step, whether lookAt ran and whether a waypoint was crossed. */
    function walk(n: number): { looked: boolean; crossed: boolean }[] {
      const spy = vi.spyOn(transform, 'lookAt');
      const steps: { looked: boolean; crossed: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const calls = spy.mock.calls.length;
        const idx = movement.currentIndex;
        movement.move(STEP_MS, 0);
        steps.push({ looked: spy.mock.calls.length > calls, crossed: movement.currentIndex !== idx });
      }
      spy.mockRestore();
      return steps;
    }

    it('derives the heading on the first two steps and around a waypoint, and holds it in between', () => {
      const steps = walk(50);
      const cross = steps.findIndex((s) => s.crossed);
      expect(cross).toBeGreaterThan(2);

      // First step (faces the waypoint), second step (first movement
      // direction), the crossing step (chord) and the first step that stays
      // on the new segment.
      const looked = steps.flatMap((s, i) => (s.looked ? [i] : []));
      expect(looked).toEqual([0, 1, cross, cross + 1]);
    });

    it('holds what a per-step derivation gives, up to lat/lon rounding', () => {
      movement.setLateralOffset(1.5);
      let prevLat = transform.position.lat;
      let prevLon = transform.position.lon;
      let crossedAt = -1;
      for (let i = 0; i < 50; i++) {
        const idx = movement.currentIndex;
        movement.move(STEP_MS, 0);
        if (movement.currentIndex !== idx) crossedAt = i;
        const { lat, lon } = transform.position;
        if (i > 0) {
          // The target move() used to set on every step.
          const dLat = lat - prevLat;
          const dLon = lon - prevLon;
          const perStep = Math.atan2(-(lon + dLon - lon), lat + dLat - lat);
          if (i === crossedAt || i === crossedAt + 1) {
            expect(target()).toBe(perStep); // derived on this step, bit for bit
          } else {
            expect(Math.abs(target() - perStep)).toBeLessThan(1e-6);
          }
        }
        prevLat = lat;
        prevLon = lon;
      }
      expect(crossedAt).toBeGreaterThan(0);
    });

    it('derives the heading again after the position jumps (setLateralOffset, setPath)', () => {
      walk(5); // held by now
      movement.setLateralOffset(2);
      expect(walk(4).map((s) => s.looked)).toEqual([true, true, false, false]);

      movement.setPath(corner);
      expect(walk(4).map((s) => s.looked)).toEqual([true, true, false, false]);
    });

    it('keeps deriving while lookAt rejects the step, and holds once it accepts one', () => {
      walk(1); // first step faces the waypoint
      const real = transform.lookAt.bind(transform);
      let rejections = 3;
      const spy = vi
        .spyOn(transform, 'lookAt')
        .mockImplementation((t) => (rejections-- > 0 ? false : real(t)));

      for (let i = 0; i < 6; i++) movement.move(STEP_MS, 0);
      expect(spy).toHaveBeenCalledTimes(4); // three rejected, one accepted, then held
    });

    it('does not hold while steps are too short for a heading (crawling, frozen)', () => {
      walk(1);
      movement.speedMps = 0.2; // ~3 mm per step, under lookAt's 1e-7 deg
      expect(walk(5).some((s) => s.looked)).toBe(false);

      movement.speedMps = 50;
      expect(walk(3).map((s) => s.looked)).toEqual([true, false, false]);
    });

    it('keeps the held heading across a pause', () => {
      walk(5);
      const held = target();

      movement.pause();
      expect(walk(3).some((s) => s.looked)).toBe(false);
      movement.resume();
      expect(walk(3).some((s) => s.looked)).toBe(false);
      expect(target()).toBe(held);
    });
  });
});
