import { describe, expect, it } from 'vitest';
import { damageTypeIcon } from './damage-type-icon';
import { DAMAGE_TYPES } from '../../configs/combat/combat.types';

describe('damageTypeIcon', () => {
  it('gives every damage type an icon of its own', () => {
    const icons = DAMAGE_TYPES.map((type) => damageTypeIcon(type));
    expect(new Set(icons).size).toBe(DAMAGE_TYPES.length);
  });

  it('maps a damage type to its icon and falls back to the sword', () => {
    expect(damageTypeIcon('fire')).toBe('flame');
    expect(damageTypeIcon('ice')).toBe('snowflake');
    expect(damageTypeIcon('lightning')).toBe('bolt');
    expect(damageTypeIcon('unknown')).toBe('sword');
  });
});
