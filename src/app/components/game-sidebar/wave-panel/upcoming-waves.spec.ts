import { describe, it, expect } from 'vitest';
import { peekUpcomingWaves } from './upcoming-waves';
import { CURRICULUM_FORCED_THROUGH_WAVE, templateObjectForWave } from '../../../configs/wave-curriculum.config';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';

describe('peekUpcomingWaves', () => {
  it('shows the two waves after the current one', () => {
    const peeks = peekUpcomingWaves(0);
    expect(peeks.map((p) => p.wave)).toEqual([1, 2]);
    expect(peeks[0]).toMatchObject({
      name: 'Zombie Horde',
      description: templateObjectForWave(1)?.description,
    });
  });

  it('lists the armor glyphs of a ground wave without the air mark', () => {
    const [w1] = peekUpcomingWaves(0);
    expect(w1.armorIcons).toContain(ARMOR_TYPE_UI.unarmored.icon);
    expect(w1.armorIcons).not.toContain('✈️');
  });

  it('marks a wave with air units', () => {
    const [, w7] = peekUpcomingWaves(5);
    expect(w7).toMatchObject({ wave: 7, name: 'Bat Swarm' });
    expect(w7.armorIcons).toBe(`${ARMOR_TYPE_UI.light.icon} ✈️`);
  });

  it('stops where the curriculum ends', () => {
    const last = CURRICULUM_FORCED_THROUGH_WAVE;
    expect(peekUpcomingWaves(last - 1).map((p) => p.wave)).toEqual([last]);
    expect(peekUpcomingWaves(last)).toEqual([]);
  });
});
