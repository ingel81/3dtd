import { describe, it, expect } from 'vitest';
import { NEXT_WAVE_MARKS, peekUpcomingWaves, shownPeek } from './upcoming-waves';
import { CURRICULUM_FORCED_THROUGH_WAVE, isBossWave, templateObjectForWave } from '../../../configs/wave-curriculum.config';
import { DPS_RAMP_COUNT } from '../../../ai/core/templates';

describe('peekUpcomingWaves', () => {
  it('shows the waves after the current one, as many as asked for', () => {
    const peeks = peekUpcomingWaves(0, 0, NEXT_WAVE_MARKS);
    expect(peeks.map((p) => p.wave)).toEqual([1, 2, 3, 4, 5]);
    expect(peeks[0]).toMatchObject({ name: 'Zombie Horde', known: true, boss: false });
    expect(peeks[0].tooltip.startsWith(templateObjectForWave(1)!.description)).toBe(true);
    expect(peekUpcomingWaves(7, 0, 2).map((p) => p.wave)).toEqual([8, 9]);
  });

  it('lists the armors and the damage types the wave is weak to', () => {
    const [w1] = peekUpcomingWaves(0, 0, 1);
    expect(w1.armors).toEqual(['Unarmored']);
    expect(w1.armorLabel).toBe('Unarmored');
    expect(w1.weakToTypes).toEqual(['fire', 'poison', 'pierce']);
    expect(w1.weakTo).toBe('Fire, Poison, Pierce');
    expect(w1.tooltip).toContain('Weak to Fire, Poison, Pierce.');
    expect(w1.air).toBe(false);
  });

  it('marks a wave with air units', () => {
    const [, w7] = peekUpcomingWaves(5, 0, 2);
    expect(w7).toMatchObject({ wave: 7, name: 'Bat Swarm', air: true });
    expect(w7.armors).toEqual(['Light']);
  });

  it('opens the count range with the tower DPS the way the director does', () => {
    const [lo, full] = templateObjectForWave(1)!.countRange;
    // No defense: the ramp floor, 10% of the range
    expect(peekUpcomingWaves(0, 0, 1)[0].count).toBe(`${lo}–${Math.round(lo + (full - lo) * 0.1)}`);
    // Half the ramp
    expect(peekUpcomingWaves(0, DPS_RAMP_COUNT / 2, 1)[0].count).toBe(`${lo}–${Math.round(lo + (full - lo) * 0.5)}`);
    // The whole template from DPS_RAMP_COUNT on
    expect(peekUpcomingWaves(0, DPS_RAMP_COUNT * 3, 1)[0].count).toBe(`${lo}–${full}`);
  });

  it('says in the tooltip that the gate can send fewer', () => {
    const [w1] = peekUpcomingWaves(0, 0, 1);
    expect(w1.tooltip).toMatch(/A weak defense can get fewer than \d+\./);
  });

  it('weighs a mixed wave by HP, sums up the armors and names the counters per armor in the tooltip', () => {
    const [, w30] = peekUpcomingWaves(28, 0, 2);
    expect(w30).toMatchObject({ name: 'Boss: Herbert', boss: true });
    expect(w30.armors.length).toBeGreaterThan(1);
    expect(w30.armorLabel).toBe(`${w30.armors[0]} +${w30.armors.length - 1}`);
    expect(w30.weakToTypes.length).toBeGreaterThan(0);
    expect(w30.tooltip).toContain('Fortified: Siege, Magic.');
  });

  it('adds the split of the skeletons to the W19 tooltip', () => {
    const [w19] = peekUpcomingWaves(18, 0, 1);
    expect(w19).toMatchObject({ wave: 19, name: 'Skeleton Swarm' });
    expect(w19.tooltip).toContain('Skeleton: Splits into 2 minions on death.');
  });

  it('shows what is known past the curriculum instead of nothing', () => {
    const last = CURRICULUM_FORCED_THROUGH_WAVE;
    const [w30, w31] = peekUpcomingWaves(last - 1, 0, 2);
    expect(w30.known).toBe(true);
    expect(w31).toMatchObject({
      wave: last + 1,
      name: "Director's pick",
      known: false,
      boss: false,
      count: null,
      armors: [],
      weakToTypes: [],
      note: 'Template picked at wave start',
    });
    expect(w31.tooltip).toContain('Next boss wave: W35.');
  });

  it('marks the boss waves past the curriculum, every fifth from W31', () => {
    const [w34, w35] = peekUpcomingWaves(33, 0, 2);
    expect(w34).toMatchObject({ boss: false, note: 'Template picked at wave start' });
    expect(w35).toMatchObject({ wave: 35, name: 'Boss wave', boss: true, known: false });
  });

  it('always has the next boss wave on the line past the curriculum', () => {
    for (let current = CURRICULUM_FORCED_THROUGH_WAVE; current < CURRICULUM_FORCED_THROUGH_WAVE + 20; current++) {
      const peeks = peekUpcomingWaves(current, 0, NEXT_WAVE_MARKS);
      expect(peeks.some((p) => p.boss && isBossWave(p.wave))).toBe(true);
    }
  });
});

describe('shownPeek', () => {
  const peeks = peekUpcomingWaves(0, 0, NEXT_WAVE_MARKS);

  it('details the next wave by default', () => {
    expect(shownPeek(peeks, null, null)?.wave).toBe(1);
  });

  it('follows the pointer over the clicked mark, and back to it', () => {
    expect(shownPeek(peeks, null, 3)?.wave).toBe(3);
    expect(shownPeek(peeks, 4, 3)?.wave).toBe(4);
  });

  it('falls back to the next wave once the clicked one is past', () => {
    expect(shownPeek(peekUpcomingWaves(3, 0, NEXT_WAVE_MARKS), null, 3)?.wave).toBe(4);
  });

  it('shows nothing without waves', () => {
    expect(shownPeek([], null, null)).toBeNull();
  });
});
