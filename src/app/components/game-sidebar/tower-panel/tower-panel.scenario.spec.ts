import { describe, expect, it } from 'vitest';
import { damageTypeIcon } from '../../icon/damage-type-icon';
import { TOWER_TYPES, type TowerTypeId } from '../../../configs/tower-types.config';

/**
 * Playtest 328 (docs/REVIEW_SPRINT_2026-09-14.md) replayed: the damage type
 * tile of the tower panel draws damageTypeIcon of the tower's damage type
 * (tower-panel.component.html). Explosion is the eight-point `burst`, the
 * star `sparkle`, the drop `splash` (icon.component.ts).
 */
describe('Damage type icon in the tower panel, playtest 328 replayed', () => {
  const iconOf = (id: TowerTypeId) => damageTypeIcon(TOWER_TYPES[id].damageType);

  it('Cannon explosion, Magic star, Ice snowflake, Poison drop, Lightning bolt', () => {
    expect(iconOf('cannon')).toBe('burst');
    expect(iconOf('magic')).toBe('sparkle');
    expect(iconOf('ice')).toBe('snowflake');
    expect(iconOf('poison')).toBe('splash');
    expect(iconOf('lightning')).toBe('bolt');
  });
});
