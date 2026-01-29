import { describe, it, expect, vi } from 'vitest';

vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
  },
  InstancedMesh: class {},
}));

import { Tower } from './tower.entity';
import { TransformComponent, CombatComponent, RenderComponent } from '../game-components';
import { ComponentType } from '../core/component';
import { getTowerType } from '../configs/tower-types.config';

const position = { lat: 10, lon: 20, height: 5 };

describe('Tower entity', () => {
  it('constructs a tower with correct type and position', () => {
    const tower = new Tower(position, 'archer');

    expect(tower.type).toBe('tower');
    expect(tower.transform.position).toEqual(position);
  });

  it('has Transform, Combat, and Render components', () => {
    const tower = new Tower(position, 'archer');

    expect(tower.getComponent(ComponentType.TRANSFORM)).toBeInstanceOf(TransformComponent);
    expect(tower.getComponent(ComponentType.COMBAT)).toBeInstanceOf(CombatComponent);
    expect(tower.getComponent(ComponentType.RENDER)).toBeInstanceOf(RenderComponent);
  });

  it('typeConfig matches tower-types.config values', () => {
    const tower = new Tower(position, 'archer');
    const config = getTowerType('archer');

    expect(tower.typeConfig).toBe(config);
    expect(tower.combat.damage).toBe(config.damage);
    expect(tower.combat.range).toBe(config.range);
    expect(tower.combat.fireRate).toBe(config.fireRate);
  });

  it('creates different tower types correctly (archer, cannon, fire)', () => {
    const archer = new Tower(position, 'archer');
    const cannon = new Tower(position, 'cannon');
    const fire = new Tower(position, 'fire');

    expect(archer.typeConfig.id).toBe('archer');
    expect(cannon.typeConfig.id).toBe('cannon');
    expect(fire.typeConfig.id).toBe('fire');

    expect(archer.combat.damage).toBe(getTowerType('archer').damage);
    expect(cannon.combat.damage).toBe(getTowerType('cannon').damage);
    expect(fire.combat.range).toBe(getTowerType('fire').range);
  });
});
