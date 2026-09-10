import { describe, it, expect, beforeEach } from 'vitest';
import { HealthComponent } from './health.component';
import { GameObject } from '../core/game-object';

class TestGameObject extends GameObject {
  constructor() {
    super('enemy');
  }
}

describe('HealthComponent', () => {
  let gameObject: TestGameObject;

  beforeEach(() => {
    gameObject = new TestGameObject();
  });

  it('constructor sets maxHp and currentHp', () => {
    const health = new HealthComponent(gameObject, 100);
    expect(health.maxHp).toBe(100);
    expect(health.hp).toBe(100);
  });

  it('takeDamage reduces HP but not below 0', () => {
    const health = new HealthComponent(gameObject, 50);
    const dead = health.takeDamage(80);

    expect(health.hp).toBe(0);
    expect(dead).toBe(true);
  });

  it('heal increases HP but not above maxHp', () => {
    const health = new HealthComponent(gameObject, 100);
    health.takeDamage(40);
    health.heal(50);

    expect(health.hp).toBe(100);
  });

  it('isDead is true when HP is 0', () => {
    const health = new HealthComponent(gameObject, 10);
    health.takeDamage(10);

    expect(health.isDead).toBe(true);
  });

  it('healthPercent returns correct fraction', () => {
    const health = new HealthComponent(gameObject, 200);
    health.takeDamage(50);

    expect(health.healthPercent).toBeCloseTo(0.75, 5);
  });

  it('mirrors isDead into a DeathFlagSink on every HP write', () => {
    const sink = { deadFlag: true };
    const health = new HealthComponent(gameObject, 30, sink);
    expect(sink.deadFlag).toBe(false);

    health.takeDamage(30);
    expect(sink.deadFlag).toBe(true);
    expect(sink.deadFlag).toBe(health.isDead);

    health.heal(5);
    expect(sink.deadFlag).toBe(false);

    health.setHp(0);
    expect(sink.deadFlag).toBe(true);

    health.resetMaxHp(40);
    expect(sink.deadFlag).toBe(false);
  });

  it('handles edge cases for 0 and negative damage', () => {
    const health = new HealthComponent(gameObject, 100);
    health.setHp(60);

    health.takeDamage(0);
    expect(health.hp).toBe(60);

    health.takeDamage(-10);
    expect(health.hp).toBe(70);
  });
});
