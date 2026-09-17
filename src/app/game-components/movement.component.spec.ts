import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MovementComponent } from './movement.component';
import { GameObject } from '../core/game-object';
import { TransformComponent } from './transform.component';
import { ComponentType } from '../core/component';
import { StatusEffect } from '../models/status-effects';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoHeading } from '../utils/geo-utils';
import { corridorConfig, getRouteProfile, lateralLimit } from '../utils/route-corridor';

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

  it('faces along its segment right after setPath, before any step', () => {
    const transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    // Due east, not the default heading 0 (north)
    movement.setPath([
      { lat: 0, lon: 0, height: 0 },
      { lat: 0, lon: 0.001, height: 0 },
    ]);
    const facing = transform.rotation;
    expect(Math.abs(facing)).toBeCloseTo(Math.PI / 2, 6);
    // It is the heading it walks with, on its lane: no turn once it starts
    movement.setLateralFactor(0.5);
    movement.speedMps = 5;
    for (let i = 0; i < 10; i++) {
      movement.move(16.667, 0);
      transform.update(16.667);
    }
    expect(transform.rotation).toBeCloseTo(facing, 6);

    // Part-way along a later segment (a split child), heading south
    const other = new TestGameObject();
    const late = new MovementComponent(other);
    late.setPath([
      { lat: 0, lon: 0, height: 0 },
      { lat: 0, lon: 0.001, height: 0 },
      { lat: -0.001, lon: 0.001, height: 0 },
    ], 1, 0.5);
    expect(Math.abs(other.getComponent<TransformComponent>(ComponentType.TRANSFORM)!.rotation)).toBeCloseTo(Math.PI, 6);
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

    it('a replacing effect keeps the DoT tick phase of the entry it replaces', () => {
      movement.applyStatusEffect({
        type: 'poison', value: 5, duration: 4000, startTime: 0, sourceId: 'tower-A',
      });
      movement.statusEffects[0].tickAccumMs = 320;
      movement.applyStatusEffect({
        type: 'poison', value: 8, duration: 4000, startTime: 100, sourceId: 'tower-B',
      });
      expect(movement.statusEffects[0].value).toBe(8);
      expect(movement.statusEffects[0].tickAccumMs).toBe(320);
    });

    it('refreshStatusEffect writes into the entry of the same source, without a new object', () => {
      movement.refreshStatusEffect('burn', 7, 3000, 0, 'fire-1');
      const entry = movement.statusEffects[0];
      entry.tickAccumMs = 250;

      movement.refreshStatusEffect('burn', 9, 3000, 16, 'fire-1');
      expect(movement.statusEffects).toHaveLength(1);
      expect(movement.statusEffects[0]).toBe(entry);
      expect(entry).toMatchObject({ value: 9, startTime: 16, tickAccumMs: 250 });

      movement.refreshStatusEffect('burn', 7, 3000, 16, 'fire-2');
      expect(movement.statusEffects).toHaveLength(2);
    });

    it('updateStatusEffects reports burn until it expires', () => {
      movement.refreshStatusEffect('burn', 7, 3000, 0, 'fire-1');
      expect(movement.isBurning(2999)).toBe(true);
      expect(movement.updateStatusEffects(2999).isBurning).toBe(true);
      expect(movement.updateStatusEffects(3000).isBurning).toBe(false);
      expect(movement.statusEffects).toHaveLength(0);
    });

    it('freeze halts: multiplier 0 until it runs out, and it is no slow', () => {
      movement.applyStatusEffect({
        type: 'freeze', value: 1.0, duration: 1000, startTime: 0, sourceId: 'ice',
      });
      const result = movement.updateStatusEffects(500);
      expect(result).toMatchObject({ isFrozen: true, isHalted: true, isSlowed: false, slowMultiplier: 0 });
      expect(movement.isFrozen(500)).toBe(true);
      expect(movement.isHalted(500)).toBe(true);
      expect(movement.isSlowed(500)).toBe(false);
      expect(movement.getSlowMultiplier(500)).toBe(0);

      expect(movement.updateStatusEffects(1000)).toMatchObject({ isFrozen: false, isHalted: false, slowMultiplier: 1 });
      expect(movement.isHalted(1000)).toBe(false);
    });

    it('freeze wins over a slow in either order', () => {
      movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 5000, startTime: 0 });
      movement.applyStatusEffect({ type: 'freeze', value: 1, duration: 1000, startTime: 0, sourceId: 'a' });
      expect(movement.updateStatusEffects(100).slowMultiplier).toBe(0);
      expect(movement.getSlowMultiplier(100)).toBe(0);

      movement.statusEffects.reverse();
      expect(movement.updateStatusEffects(100).slowMultiplier).toBe(0);
      expect(movement.getSlowMultiplier(100)).toBe(0);

      // Thaws into the slow that is still on
      expect(movement.updateStatusEffects(1000)).toMatchObject({ isSlowed: true, isHalted: false, slowMultiplier: 0.5 });
      expect(movement.getSlowMultiplier(1000)).toBe(0.5);
    });

    it('stun halts like a freeze and says so apart from it', () => {
      movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 5000, startTime: 0 });
      movement.applyStatusEffect({ type: 'stun', value: 1, duration: 1000, startTime: 0, sourceId: 'emp' });
      expect(movement.updateStatusEffects(500)).toMatchObject({
        isStunned: true, isFrozen: false, isHalted: true, slowMultiplier: 0,
      });
      expect(movement.isStunned(500)).toBe(true);
      expect(movement.isFrozen(500)).toBe(false);
      expect(movement.isHalted(500)).toBe(true);
      expect(movement.getSlowMultiplier(500)).toBe(0);
      expect(movement.isHalted(1000)).toBe(false);
      expect(movement.getSlowMultiplier(1000)).toBe(0.5);
    });

    it('a frozen enemy stays where it is', () => {
      movement.setPath([{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }]);
      movement.speedMps = 5;
      movement.applyStatusEffect({ type: 'freeze', value: 1, duration: 1000, startTime: 0, sourceId: 'a' });
      const status = movement.updateStatusEffects(0);
      movement.move(16.667, 0, status.slowMultiplier);
      expect(movement.progress).toBe(0);
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

    /** The step is on the arc of the corner (RouteCorners), from the distance along the path. */
    const onArc = (): boolean => {
      const { corners } = getRouteProfile(corner);
      const arc = corners.arcOf[1];
      const along = movement.getDistanceAlongPath();
      return arc >= 0 && along > corners.from[arc] && along < corners.to[arc];
    };

    /** Steps `n` times; per step, whether lookAt ran and whether it ended on the corner's arc. */
    function walk(n: number): { looked: boolean; arc: boolean }[] {
      const spy = vi.spyOn(transform, 'lookAt');
      const steps: { looked: boolean; arc: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const calls = spy.mock.calls.length;
        movement.move(STEP_MS, 0);
        steps.push({ looked: spy.mock.calls.length > calls, arc: onArc() });
      }
      spy.mockRestore();
      return steps;
    }

    it('derives the heading on the first two steps, along the corner\'s arc and off it, and holds it in between', () => {
      const steps = walk(50);
      const first = steps.findIndex((s) => s.arc);
      const last = steps.length - 1 - [...steps].reverse().findIndex((s) => s.arc);
      expect(first).toBeGreaterThan(2);
      expect(last).toBeGreaterThan(first + 3);

      // Second step (first movement direction; setPath already faced the
      // waypoint, so the first step does not), every step on the arc (its
      // direction turns), the step off it (chord) and the first step that
      // stays on the new segment.
      const arc = Array.from({ length: last - first + 1 }, (_, k) => first + k);
      const looked = steps.flatMap((s, i) => (s.looked ? [i] : []));
      expect(looked).toEqual([1, ...arc, last + 1, last + 2]);
    });

    it('holds what a per-step derivation gives, up to lat/lon rounding, and faces along the arc on it', () => {
      movement.setLateralFactor(0.5); // 1.5 m of the default 3 m
      const { corners } = getRouteProfile(corner);
      const arc = corners.arcOf[1];
      /** The target facing along the arc, `along` m from the start of the path. */
      const alongArc = (along: number, lat: number, lon: number) => {
        const phi = ((along - corners.from[arc]) * corners.turn[arc]) / (corners.to[arc] - corners.from[arc]);
        const dLat = corners.alongLat[arc] * Math.cos(phi) + corners.insideLat[arc] * Math.sin(phi);
        const dLon = corners.alongLon[arc] * Math.cos(phi) + corners.insideLon[arc] * Math.sin(phi);
        return -geoHeading({ lat, lon }, { lat: lat + dLat, lon: lon + dLon });
      };
      let prevLat = transform.position.lat;
      let prevLon = transform.position.lon;
      let offArcAt = -1;
      let wasOnArc = false;
      for (let i = 0; i < 50; i++) {
        movement.move(STEP_MS, 0);
        const arc = onArc();
        if (wasOnArc && !arc) offArcAt = i;
        wasOnArc = arc;
        const { lat, lon } = transform.position;
        if (i > 0) {
          // The target move() used to set on every step.
          const dLat = lat - prevLat;
          const dLon = lon - prevLon;
          // Metric like lookAt since the cos(lat) fix; this used to pin the raw degree-delta angle
          const perStep = -geoHeading({ lat, lon }, { lat: lat + dLat, lon: lon + dLon });
          if (arc) {
            // Along the arc where the step ends, not along the chord of the step
            expect(target()).toBeCloseTo(alongArc(movement.getDistanceAlongPath(), lat, lon), 9);
          } else if (i === offArcAt || i === offArcAt + 1) {
            expect(target()).toBe(perStep); // derived on this step, bit for bit
          } else {
            expect(Math.abs(target() - perStep)).toBeLessThan(1e-6);
          }
        }
        prevLat = lat;
        prevLon = lon;
      }
      expect(offArcAt).toBeGreaterThan(0);
    });

    it('derives the heading again after the position jumps (setLateralFactor, setPath)', () => {
      walk(5); // held by now
      movement.setLateralFactor(0.7);
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

  describe('lateral spread', () => {
    const LAT = 48.776;
    const LON = 9.183;
    const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(LAT * DEG_TO_RAD);
    const STEP_MS = 16.667;
    let transform: TransformComponent;

    beforeEach(() => {
      transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    });

    /**
     * Waypoints going north from (LAT, LON), `lengths` metres apart, half
     * width per segment on the right (east) and, unless given, the same on
     * the left (west).
     */
    function northbound(lengths: number[], right: (number | undefined)[], left = right): RouteWaypoint[] {
      const path: RouteWaypoint[] = [{ lat: LAT, lon: LON, corridorLeft: left[0], corridorRight: right[0] }];
      let lat = LAT;
      for (let i = 0; i < lengths.length; i++) {
        lat += lengths[i] / METERS_PER_DEGREE_LAT;
        path.push({ lat, lon: LON, corridorLeft: left[i + 1], corridorRight: right[i + 1] });
      }
      return path;
    }

    /** Metres east of the centre line of a northbound path. */
    const eastOfCentre = () => (transform.position.lon - LON) * M_PER_DEG_LON;

    function walk(steps: number): void {
      for (let i = 0; i < steps; i++) movement.move(STEP_MS, 0);
    }

    it('spreads by the width of the corridor, not by a fixed distance', () => {
      movement.speedMps = 10;
      movement.setLateralFactor(1);

      movement.setPath(northbound([100], [6]));
      walk(30);
      expect(eastOfCentre()).toBeCloseTo(lateralLimit(6), 2);

      movement.setPath(northbound([100], [2]));
      walk(30);
      expect(eastOfCentre()).toBeCloseTo(lateralLimit(2), 2);
    });

    it('spreads to each side by the width on that side', () => {
      // Narrow on the left (west), wide on the right (east).
      const path = northbound([100], [6], [2]);
      movement.speedMps = 10;

      movement.setLateralFactor(1);
      movement.setPath(path);
      walk(30);
      expect(eastOfCentre()).toBeCloseTo(lateralLimit(6), 2);

      movement.setLateralFactor(-0.5);
      movement.setPath(path);
      walk(30);
      expect(eastOfCentre()).toBeCloseTo(-0.5 * lateralLimit(2), 2);
    });

    it('offsets at a right angle and by the stated length on every heading', () => {
      // East-bound, so the offset runs south. Scaling both axes by cos(lat)
      // made it 1.5 times too long at this latitude.
      movement.setPath([{ lat: LAT, lon: LON }, { lat: LAT, lon: LON + 100 / M_PER_DEG_LON }]);
      movement.speedMps = 10;
      movement.setLateralFactor(1);
      walk(30);

      expect((LAT - transform.position.lat) * METERS_PER_DEGREE_LAT)
        .toBeCloseTo(lateralLimit(corridorConfig.defaultHalfWidth), 2);
    });

    it('moves in before the street narrows instead of jumping', () => {
      movement.setPath(northbound([60, 60], [6, 2]));
      movement.speedMps = 5;
      movement.setLateralFactor(1);

      const offsets: number[] = [];
      for (let i = 0; i < 2000; i++) {
        if (movement.move(STEP_MS, 0) === 'reached_end') break;
        offsets.push(eastOfCentre());
        // Tolerance: eastOfCentre() scales by cos(lat) at the start, 60 m south.
        if (movement.currentIndex === 1) expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(lateralLimit(2) + 1e-4);
      }

      expect(offsets[10]).toBeCloseTo(lateralLimit(6), 2);
      let largestStep = 0;
      for (let i = 1; i < offsets.length; i++) largestStep = Math.max(largestStep, Math.abs(offsets[i] - offsets[i - 1]));
      // 5 m/s moves 8.3 cm per step, so the taper allows 4.2 cm sideways.
      expect(largestStep).toBeLessThanOrEqual(corridorConfig.taper * 5 * (STEP_MS / 1000) + 1e-4);
      expect(largestStep).toBeGreaterThan(0);
    });

    it('holds the heading along the taper and derives it where the taper starts', () => {
      movement.setPath(northbound([60, 60], [6, 2]));
      movement.speedMps = 5;
      movement.setLateralFactor(1);
      const spy = vi.spyOn(transform, 'lookAt');
      for (let i = 0; i < 2000; i++) {
        if (movement.move(STEP_MS, 0) === 'reached_end') break;
      }
      // First step and the one after, taper start and the one after, the
      // waypoint and the one after. Not one per step (about 1400).
      expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
      spy.mockRestore();
    });
  });

  describe('start part-way along the path', () => {
    // Three 100 m segments going north, ground rising 10 m per waypoint
    const LAT = 48.776;
    const path: RouteWaypoint[] = [0, 1, 2, 3].map((i) => ({
      lat: LAT + (i * 100) / METERS_PER_DEGREE_LAT,
      lon: 9.183,
      height: 10 + i * 10,
    }));
    let transform: TransformComponent;

    beforeEach(() => {
      transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    });

    it('starts on the given segment and progress, on the centre line', () => {
      movement.setPath(path, 1, 0.25);

      expect(movement.path).toBe(path); // shared, not a sub-path copy
      expect(movement.currentIndex).toBe(1);
      expect(movement.progress).toBe(0.25);
      expect(movement.getPathProgress()).toBeCloseTo(125 / 300, 3);
      expect(transform.position.lat).toBeCloseTo(path[1].lat + 0.25 * (path[2].lat - path[1].lat), 12);
      expect(transform.position.lon).toBe(path[1].lon);
      expect(transform.terrainHeight).toBeCloseTo(22.5, 9);
    });

    it('walks on from there to the end of the path', () => {
      movement.setPath(path, 2, 0.5);
      movement.speedMps = 10; // 1 m per 100 ms step, 50 m to go

      let steps = 0;
      while (movement.move(100, 0) !== 'reached_end' && steps < 1000) {
        expect(movement.currentIndex).toBe(2);
        steps++;
      }
      expect(steps).toBeGreaterThanOrEqual(48);
      expect(steps).toBeLessThanOrEqual(51);
    });

    it('clamps a start past the last segment onto its end', () => {
      movement.setPath(path, 7, 1.5);
      expect(movement.currentIndex).toBe(2);
      expect(movement.progress).toBe(1);
      expect(movement.move(16, 0)).toBe('reached_end');
    });

    it('reads back the lateral factor it was given, clamped', () => {
      movement.setLateralFactor(-0.4);
      expect(movement.getLateralFactor()).toBe(-0.4);
      movement.setLateralFactor(3);
      expect(movement.getLateralFactor()).toBe(1);
    });
  });

  describe('corner arcs', () => {
    const LAT = 48.776;
    const LON = 9.183;
    const COS = Math.cos(LAT * DEG_TO_RAD);
    const STEP_MS = 16.667;
    const SPEED = 5; // 8.3 cm per step
    const LANES = [-1, -0.5, 0, 0.5, 1];

    /** A waypoint `east`/`north` metres from (LAT, LON), half widths left and right of the segment it starts. */
    const at = (east: number, north: number, left?: number, right = left): RouteWaypoint => ({
      lat: LAT + north / METERS_PER_DEGREE_LAT,
      lon: LON + east / (METERS_PER_DEGREE_LAT * COS),
      corridorLeft: left,
      corridorRight: right,
    });

    /** Metres east and north of (LAT, LON), flat, as the lanes are offset. */
    const metres = (p: { lat: number; lon: number }) => ({
      e: (p.lon - LON) * METERS_PER_DEGREE_LAT * COS,
      n: (p.lat - LAT) * METERS_PER_DEGREE_LAT,
    });

    /** A route through the `points` (metres east, north), each segment `left`/`right` wide. */
    const route = (points: [number, number][], left?: number, right = left): RouteWaypoint[] =>
      points.map(([e, n]) => at(e, n, left, right));

    /** Points from (east, north) on, `lengths` apart, each turning `turns` degrees (right positive) from the heading before. */
    function polyline(east: number, north: number, heading: number, lengths: number[], turns: number[]): [number, number][] {
      const points: [number, number][] = [[east, north]];
      let h = heading;
      lengths.forEach((length, i) => {
        h += ((turns[i] ?? 0) * Math.PI) / 180;
        east += length * Math.sin(h);
        north += length * Math.cos(h);
        points.push([east, north]);
      });
      return points;
    }

    /** How far apart two headings are, radians, 0 to pi. */
    const turned = (a: number, b: number) => {
      let d = a - b;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      return Math.abs(d);
    };

    const targetOf = (transform: TransformComponent) =>
      (transform as unknown as { targetRotation: number }).targetRotation;

    interface Walk {
      /** Per step: how far it moved (m), how far its progress along the path went (m), how far its heading target turned (rad) */
      steps: { moved: number; progress: number; turned: number }[];
      positions: { e: number; n: number }[];
      rotation: number;
    }

    /** Walk `path` in lane `factor` at SPEED to the end. */
    function walkLane(path: RouteWaypoint[], factor: number, roundsCorners = true): Walk {
      const walker = new TestGameObject();
      const walking = new MovementComponent(walker, roundsCorners);
      const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      walking.setLateralFactor(factor);
      walking.setPath(path);
      walking.speedMps = SPEED;
      // The first step moves from the centre line into the lane
      walking.move(STEP_MS, 0);
      let last = metres(transform.position);
      let heading = targetOf(transform);
      let distance = walking.getDistanceAlongPath();
      const result: Walk = { steps: [], positions: [last], rotation: 0 };
      for (let i = 0; i < 100_000 && walking.move(STEP_MS, 0) === 'moving'; i++) {
        const here = metres(transform.position);
        result.steps.push({
          moved: Math.hypot(here.e - last.e, here.n - last.n),
          progress: walking.getDistanceAlongPath() - distance,
          turned: turned(targetOf(transform), heading),
        });
        result.positions.push(here);
        last = here;
        heading = targetOf(transform);
        distance = walking.getDistanceAlongPath();
      }
      result.rotation = heading;
      return result;
    }

    /**
     * The heading a step may turn at once beyond what the arcs turn it. On an
     * arc an enemy faces along it; the step off the arc faces along its
     * chord, which a lane still moving in or out, by up to the taper, tilts.
     */
    const jolt = (path: RouteWaypoint[]) => Math.atan(getRouteProfile(path).taper);

    /**
     * The steps of `walk` that move further than `speed` or turn further
     * than `turn` per metre of progress, `jolt` rad of turn at once aside.
     * Per metre of progress, not per step: advance() carries the share of a
     * segment it overshoots onto the next one, so a step onto a longer
     * segment goes further along the path, as it did before the arcs.
     */
    function beyond(walk: Walk, speed: number, turn: number, jolt = 0): string[] {
      return walk.steps.flatMap(({ moved, progress, turned: t }, i) => [
        ...(moved > speed * progress + 1e-9 ? [`step ${i} moved ${moved.toFixed(3)} m for ${progress.toFixed(3)} m`] : []),
        ...(t > turn * progress + jolt + 1e-9 ? [`step ${i} turned ${t.toFixed(3)} rad for ${progress.toFixed(3)} m`] : []),
      ]);
    }

    /**
     * Fastest a lane may move per metre of progress on `path`. On an arc a
     * lane `e` m inside runs (R - e) times the angle per metre and changes
     * its offset by at most the taper: at most (R + o) * turn / length +
     * taper, with `o` the widest outer limit over the arc. Off the arcs
     * hypot(1, taper). All up to the flat metres of the lanes against the
     * haversine ones of progress.
     */
    function speedBound(path: RouteWaypoint[]): number {
      const profile = getRouteProfile(path);
      const { corners, segmentLengths, cumulativeLength, taper } = profile;
      let bound = Math.hypot(1, taper);
      for (let g = 0; g < corners.radius.length; g++) {
        const outer = corners.inside[g] > 0 ? profile.left : profile.right;
        let widest = 0;
        for (let i = 0; i < segmentLengths.length; i++) {
          if (cumulativeLength[i + 1] >= corners.from[g] && cumulativeLength[i] <= corners.to[g]) {
            widest = Math.max(widest, outer.segment[i]);
          }
        }
        const rate = corners.turn[g] / (corners.to[g] - corners.from[g]);
        bound = Math.max(bound, (corners.radius[g] + widest) * rate + taper);
      }
      return bound * 1.002;
    }

    /** Fastest the heading may turn per metre of progress: on an arc its turn over its stretch of route. */
    function turnBound(path: RouteWaypoint[]): number {
      const { corners } = getRouteProfile(path);
      let bound = 0;
      for (let g = 0; g < corners.radius.length; g++) {
        bound = Math.max(bound, corners.turn[g] / (corners.to[g] - corners.from[g]));
      }
      return bound * 1.01;
    }

    it('rounds a right angle to either side without a jump, in every lane', () => {
      // 40 m north, then 40 m east (a right turn) or west (a left turn)
      for (const east of [40, -40]) {
        const path = route([[0, 0], [0, 40], [east, 40]]);
        const { corners } = getRouteProfile(path);
        expect(corners.arcOf[1]).toBe(0);
        expect(corners.inside[0]).toBe(east > 0 ? 1 : -1);
        for (const factor of LANES) {
          const walk = walkLane(path, factor);
          // Before: a lane 3 m off the line jumped 4.2 m at the waypoint, and
          // the heading turned by up to 90 degrees in one step.
          expect(beyond(walk, speedBound(path), turnBound(path), jolt(path)), `${east} ${factor}`).toEqual([]);
          expect(turned(walk.rotation, east > 0 ? -Math.PI / 2 : Math.PI / 2), `${east} ${factor}`).toBeLessThan(1e-6);
        }
      }
    });

    it('holds the formation: every lane goes round the same centre, the inner one the short way, the outer one the long way', () => {
      const path = route([[0, 0], [0, 40], [40, 40]]);
      const { corners } = getRouteProfile(path);
      const limit = lateralLimit(corridorConfig.defaultHalfWidth);
      // Even widths: the radius at least the inner limit, and the outside keeps all of its room
      expect(corners.radius[0]).toBeGreaterThanOrEqual(limit - 1e-9);
      expect(corners.shaveLeft[0]).toBe(0);

      const onArc = (factor: number) => {
        const walker = new TestGameObject();
        const walking = new MovementComponent(walker);
        const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
        walking.setLateralFactor(factor);
        walking.setPath(path);
        walking.advance(corners.from[0]);
        const start = targetOf(transform);
        let last = metres(transform.position);
        let length = 0;
        // Up to the end of the arc; the straight after it starts 21 um further
        // east, where the waypoint's cos(lat) scales the longitude
        const stepM = (corners.to[0] - corners.from[0]) / 200;
        for (let i = 0; i < 199; i++) {
          walking.advance(stepM);
          const here = metres(transform.position);
          length += Math.hypot(here.e - last.e, here.n - last.n);
          last = here;
        }
        return { length, turn: turned(targetOf(transform), start) };
      };
      // Right is the inside. Turned by the angle of 199 of 200 steps, in every lane.
      const turn = (Math.PI / 2) * (199 / 200);
      const radius = corners.radius[0];
      for (const factor of [-1, 0, 1]) expect(onArc(factor).turn).toBeCloseTo(turn, 6);
      expect(onArc(0).length).toBeCloseTo(turn * radius, 3);
      expect(onArc(-1).length).toBeCloseTo(turn * (radius + limit), 3);
      // The inner lane gives up its shave in the middle of the arc, and moves
      // out to the limit again towards its ends
      const inner = onArc(1).length;
      expect(inner).toBeGreaterThanOrEqual(turn * (radius - limit) - 1e-9);
      expect(inner).toBeLessThan(onArc(0).length);
    });

    it('leaves the progress along the path as it was, every step', () => {
      const path = route([[0, 0], [0, 40], [40, 40], [40, 80], [0, 110]], 3, 6);
      for (const factor of [-1, 0, 1]) {
        const rounding = new MovementComponent(new TestGameObject());
        const sharp = new MovementComponent(new TestGameObject(), false);
        for (const walking of [rounding, sharp]) {
          walking.setLateralFactor(factor);
          walking.setPath(path);
          walking.speedMps = SPEED;
        }
        let steps = 0;
        for (;;) {
          const a = rounding.move(STEP_MS, 0);
          const b = sharp.move(STEP_MS, 0);
          expect(a).toBe(b);
          expect(rounding.currentIndex).toBe(sharp.currentIndex);
          expect(rounding.progress).toBe(sharp.progress);
          expect(rounding.getPathProgress()).toBe(sharp.getPathProgress());
          if (a === 'reached_end') break;
          steps++;
        }
        expect(steps).toBeGreaterThan(1000);
      }
    });

    it('stands where the progress puts it, whatever the steps that led there', () => {
      const path = route([[0, 0], [0, 40], [30, 45]], 4, 6);
      const { cumulativeLength } = getRouteProfile(path);
      const to = cumulativeLength[1] + 0.7; // on the arc
      const places = [0.01, 0.37, 2.5].map((stepM) => {
        const walker = new TestGameObject();
        const walking = new MovementComponent(walker);
        walking.setLateralFactor(-0.8);
        walking.setPath(path);
        const whole = Math.floor(to / stepM);
        for (let i = 0; i < whole; i++) walking.advance(stepM);
        walking.advance(to - walking.getDistanceAlongPath());
        return metres(walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!.position);
      });
      for (const place of places.slice(1)) {
        expect(place.e).toBeCloseTo(places[0].e, 6);
        expect(place.n).toBeCloseTo(places[0].n, 6);
      }
    });

    it('rounds a corner the band lays, with pieces of 1 m and small wiggles around it, on one wide arc', () => {
      // Stations every 2 m wiggling by half a degree either way, 1 m from the
      // corner to the stations beside it (bandPath)
      const wiggles = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? 0.5 : -0.5));
      const points = polyline(0, 0, 0, [...new Array(15).fill(2), 1, 1, ...new Array(15).fill(2)], [
        ...wiggles(15), 0, 90, ...wiggles(15),
      ]);
      const path = route(points);
      const { corners, segmentLengths } = getRouteProfile(path);
      const corner = 16;
      const arc = corners.arcOf[corner];
      expect(arc).toBeGreaterThanOrEqual(0);
      // One arc over the pieces beside the corner, not half of a 1 m piece
      expect(corners.arcOf[corner - 1]).toBe(arc);
      expect(corners.arcOf[corner + 1]).toBe(arc);
      expect(corners.turn[arc]).toBeCloseTo(Math.PI / 2, 1);
      const halfPiece = (segmentLengths[corner] / 2) / Math.tan(Math.PI / 4);
      expect(corners.radius[arc]).toBeGreaterThan(4 * halfPiece);
      expect(outsideLimits(path)).toEqual([]);
      for (const factor of LANES) {
        expect(beyond(walkLane(path, factor), speedBound(path), turnBound(path), jolt(path)), `${factor}`).toEqual([]);
      }
      // The outer lane runs at most about two and a half times as fast through it
      expect(speedBound(path)).toBeLessThan(2.6);
    });

    it('follows a curve of small kinks on arcs wider than the limit', () => {
      // 90 degrees to the right in twelve kinks of 7.5 degrees, 4 m apart: a
      // curve of about 30 m radius
      const path = route(polyline(0, 0, 0, [20, ...new Array(12).fill(4), 20], [0, ...new Array(12).fill(7.5), 0]), 4, 6);
      const { corners } = getRouteProfile(path);
      expect(corners.radius.length).toBeGreaterThan(0);
      expect(corners.radius.length).toBeLessThan(12);
      expect(Math.max(...corners.radius)).toBeGreaterThan(4 * lateralLimit(6));
      for (const factor of LANES) {
        // Before: 0.3 to 0.6 m sideways at each kink in one step
        expect(beyond(walkLane(path, factor), speedBound(path), turnBound(path), jolt(path)), `${factor}`).toEqual([]);
      }
    });

    it('keeps the arcs of an S-bend apart', () => {
      // 45 degrees right, 3 m on, 45 degrees left
      const path = route(polyline(0, 0, 0, [30, 3, 30], [0, 45, -45]));
      const { corners } = getRouteProfile(path);
      expect(corners.radius.length).toBe(2);
      expect(corners.arcOf[1]).not.toBe(corners.arcOf[2]);
      expect(corners.inside[corners.arcOf[1]]).toBe(1);
      expect(corners.inside[corners.arcOf[2]]).toBe(-1);
      expect(corners.to[corners.arcOf[1]]).toBeLessThanOrEqual(corners.from[corners.arcOf[2]] + 1e-9);
    });

    it('fits the arcs of two corners onto a short segment between them', () => {
      // North 30 m, 2 m east, north again: a right and a left turn
      const path = route([[0, 0], [0, 30], [2, 30], [2, 60]]);
      const profile = getRouteProfile(path);
      const { corners } = profile;
      const half = profile.segmentLengths[1] / 2;
      expect(corners.arcIn[1]).toBeCloseTo(half, 9);
      expect(corners.arcOut[1]).toBeCloseTo(half, 9);
      // The clamp leaves a radius of about half the segment, 1 m, and the
      // lanes on the inside that much room over the arc
      const [right, left] = [corners.arcOf[1], corners.arcOf[2]];
      expect(corners.radius[right]).toBeCloseTo(1, 2);
      expect(corners.capRight[right]).toBe(corners.radius[right]);
      expect(corners.capLeft[left]).toBe(corners.radius[left]);

      for (const factor of LANES) {
        // Where the taper towards the arcs starts and ends, a lane turns by up
        // to atan(taper) at once, as at any taper
        expect(beyond(walkLane(path, factor), speedBound(path), turnBound(path), jolt(path)), `${factor}`).toEqual([]);
      }
    });

    /**
     * Places on the arcs of `path` no limit of the sharp route holds, for
     * every lane: beside a segment, over a point of it, within the limit
     * there on its side, or past a waypoint within the limit of the outside
     * of its turn.
     */
    function outsideLimits(path: RouteWaypoint[]): string[] {
      const profile = getRouteProfile(path);
      const { corners, segmentLengths, cumulativeLength, taper } = profile;
      const limitAt = (side: 'left' | 'right', i: number, s: number) => Math.min(
        profile[side].segment[i], profile[side].node[i] + taper * s, profile[side].node[i + 1] + taper * (segmentLengths[i] - s),
      );
      const points = path.map(metres);
      const found: string[] = [];
      for (let g = 0; g < corners.radius.length; g++) {
        for (const factor of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
          const walker = new TestGameObject();
          const walking = new MovementComponent(walker);
          const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
          walking.setLateralFactor(factor);
          for (let j = 0; j <= 40; j++) {
            const s = corners.from[g] + ((corners.to[g] - corners.from[g]) * j) / 40;
            let i = 0;
            while (i < segmentLengths.length - 1 && s > cumulativeLength[i + 1]) i++;
            walking.setPath(path, i, (s - cumulativeLength[i]) / segmentLengths[i]);
            const q = metres(transform.position);
            let held = false;
            for (let seg = 0; seg < segmentLengths.length && !held; seg++) {
              const a = points[seg];
              const b = points[seg + 1];
              const length = Math.hypot(b.e - a.e, b.n - a.n);
              const ue = (b.e - a.e) / length;
              const un = (b.n - a.n) / length;
              const along = (q.e - a.e) * ue + (q.n - a.n) * un;
              const right = (q.e - a.e) * un - (q.n - a.n) * ue;
              // Up to a tenth of a millimetre past its ends: an arc that starts or ends where the path does
              if (along < -1e-4 || along > length + 1e-4) continue;
              const foot = (Math.min(length, Math.max(0, along)) / length) * segmentLengths[seg];
              held = Math.abs(right) <= limitAt(right < 0 ? 'left' : 'right', seg, foot) + 1e-3;
            }
            for (let k = 1; k < path.length - 1 && !held; k++) {
              const [a, w, b] = [points[k - 1], points[k], points[k + 1]];
              const inE = w.e - a.e;
              const inN = w.n - a.n;
              const outE = b.e - w.e;
              const outN = b.n - w.n;
              // Past the end of the segment into it and before the start of the one out of it
              const beyondIn = (q.e - w.e) * inE + (q.n - w.n) * inN >= 0;
              const beforeOut = (q.e - w.e) * outE + (q.n - w.n) * outN <= 0;
              // A right turn has its outside on the left
              const outside = inE * outN - inN * outE < 0 ? 'left' : 'right';
              held = beyondIn && beforeOut && Math.hypot(q.e - w.e, q.n - w.n) <= profile[outside].node[k] + 1e-3;
            }
            if (!held) found.push(`arc ${g} lane ${factor} at ${s.toFixed(2)} m`);
          }
        }
      }
      return found;
    }

    it('keeps every lane within the lateral limit of the sharp route through a corner', () => {
      // Place by place: angles from 10 to 170 degrees both ways, the inner
      // side narrower and wider, no room inside at all, a short and a long
      // segment into the corner after a stretch that narrows both sides.
      const problems: string[] = [];
      let arcs = 0;
      for (const degrees of [10, 45, 90, 135, 170]) {
        for (const sign of [1, -1]) {
          for (const [inner, outer] of [[2, 7], [4.5, 4.5], [7, 2], [1.5, 6]]) {
            for (const lengthIn of [3, 12]) {
              // A right turn (sign 1) has its inside on the right
              const [left, right] = sign > 0 ? [outer, inner] : [inner, outer];
              const path = route(polyline(0, -40, 0, [40, lengthIn, 30], [0, 0, sign * degrees]), left, right);
              path[0].corridorLeft = 3;
              path[0].corridorRight = 3;
              arcs += getRouteProfile(path).corners.radius.length;
              problems.push(...outsideLimits(path).map((p) => `${degrees * sign} ${inner}/${outer} ${lengthIn}: ${p}`));
            }
          }
        }
      }
      expect(problems).toEqual([]);
      expect(arcs).toBe(60); // all but the corners without room inside
    });

    it('keeps every lane within the lateral limit of the sharp route along curves and wiggles', () => {
      // Deterministic pseudo-random polylines of short pieces, as the band lays them
      let seed = 4242;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const problems: string[] = [];
      let arcs = 0;
      for (let r = 0; r < 12; r++) {
        const lengths = Array.from({ length: 30 }, () => 0.5 + random() * 2.5);
        const bend = (random() - 0.5) * 30;
        const turns = lengths.map(() => bend * random() + (random() - 0.5) * 6);
        const path = route(polyline(0, 0, random() * 6, lengths, turns));
        path.forEach((w) => {
          w.corridorLeft = 1 + random() * 6;
          w.corridorRight = 1 + random() * 6;
        });
        arcs += getRouteProfile(path).corners.radius.length;
        problems.push(...outsideLimits(path).map((p) => `route ${r}: ${p}`));
      }
      expect(problems).toEqual([]);
      expect(arcs).toBeGreaterThan(50);
    });

    it('puts a start part-way along the path on the arc, where walking there puts it', () => {
      const path = route([[0, 0], [0, 40], [40, 40]], 5);
      const { cumulativeLength } = getRouteProfile(path);
      const walker = new TestGameObject();
      const walking = new MovementComponent(walker);
      walking.setLateralFactor(0.6);
      walking.setPath(path);
      walking.advance(cumulativeLength[1] + 1);

      const child = new TestGameObject();
      const split = new MovementComponent(child);
      split.setLateralFactor(0.6);
      split.setPath(path, walking.currentIndex, walking.progress);
      const a = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      const b = child.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      expect(b.position.lat).toBe(a.position.lat);
      expect(b.position.lon).toBe(a.position.lon);
      expect(targetOf(b)).toBe(targetOf(a));
    });

    it('walks the sharp line where it does not round corners (the hero)', () => {
      const path = route([[0, 0], [0, 40], [40, 40]]);
      const walk = walkLane(path, 0, false);
      const corner = Math.min(...walk.positions.map((p) => Math.hypot(p.e, p.n - 40)));
      expect(corner).toBeLessThan(SPEED * (STEP_MS / 1000));
    });
  });

  describe('advance by a given distance', () => {
    // Three 100 m segments going north
    const LAT = 48.776;
    const path: RouteWaypoint[] = [0, 1, 2, 3].map((i) => ({
      lat: LAT + (i * 100) / METERS_PER_DEGREE_LAT,
      lon: 9.183,
      height: 0,
    }));

    it('goes exactly that far along the centre line, across waypoints', () => {
      movement.setPath(path);
      expect(movement.advance(40)).toBe('moving');
      expect(movement.getDistanceAlongPath()).toBeCloseTo(40, 6);
      expect(movement.advance(135.5)).toBe('moving');
      expect(movement.currentIndex).toBe(1);
      expect(movement.getDistanceAlongPath()).toBeCloseTo(175.5, 6);
    });

    it('reports the end of the path like move()', () => {
      movement.setPath(path);
      expect(movement.advance(299)).toBe('moving');
      expect(movement.advance(2)).toBe('reached_end');
    });

    it('is what move() does with its own speed', () => {
      const other = new MovementComponent(new TestGameObject());
      movement.setPath(path);
      other.setPath(path);
      movement.speedMps = 7;
      for (let i = 0; i < 50; i++) {
        movement.move(16, 0);
        other.advance(7 * 0.016);
      }
      expect(movement.getDistanceAlongPath()).toBeCloseTo(other.getDistanceAlongPath(), 9);
    });

    it('leaves the pause to the caller: move() holds, advance() still goes', () => {
      movement.setPath(path);
      movement.speedMps = 10;
      movement.pause();
      movement.move(100, 0);
      expect(movement.getDistanceAlongPath()).toBe(0);
      movement.advance(5);
      expect(movement.getDistanceAlongPath()).toBeCloseTo(5, 6);
    });
  });

  describe('seek to a distance', () => {
    // 100 m north, then 3 m and 40 m: waypoints of different lengths
    const LAT = 48.776;
    const path: RouteWaypoint[] = [0, 100, 103, 143].map((m) => ({
      lat: LAT + m / METERS_PER_DEGREE_LAT,
      lon: 9.183,
      height: 0,
    }));

    it('lands on that distance exactly, across waypoints of any length', () => {
      movement.setPath(path);
      const lengths = getRouteProfile(path).cumulativeLength;
      expect(movement.seekDistance(101.5)).toBe('moving');
      expect(movement.currentIndex).toBe(1);
      expect(movement.getDistanceAlongPath()).toBeCloseTo(101.5, 9);
      expect(movement.seekDistance(lengths[2])).toBe('moving');
      expect(movement.currentIndex).toBe(2);
      expect(movement.progress).toBe(0);
    });

    it('reports the end of the path like advance()', () => {
      movement.setPath(path);
      const total = getRouteProfile(path).totalLength;
      expect(movement.seekDistance(total - 0.01)).toBe('moving');
      expect(movement.seekDistance(total)).toBe('reached_end');
      expect(movement.getDistanceAlongPath()).toBeCloseTo(total, 9);
    });

    it('places nothing: the caller does', () => {
      movement.setPath(path);
      const transform = gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      const start = { ...transform.position };
      movement.seekDistance(50);
      expect(transform.position.lat).toBe(start.lat);
      expect(transform.position.lon).toBe(start.lon);
    });
  });
});
