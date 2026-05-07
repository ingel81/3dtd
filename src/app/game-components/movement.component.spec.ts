import { describe, it, expect, beforeEach } from 'vitest';
import { MovementComponent } from './movement.component';
import { GameObject } from '../core/game-object';
import { TransformComponent } from './transform.component';
import { ComponentType } from '../core/component';
import { StatusEffect } from '../models/status-effects';

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
});
