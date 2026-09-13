import { describe, it, expect } from 'vitest';
import { peekUpcomingWaves } from './upcoming-waves';
import { CURRICULUM_FORCED_THROUGH_WAVE, templateObjectForWave } from '../../../configs/wave-curriculum.config';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { DPS_RAMP_COUNT } from '../../../ai/core/templates';

describe('peekUpcomingWaves', () => {
  it('shows the two waves after the current one', () => {
    const peeks = peekUpcomingWaves(0, 0);
    expect(peeks.map((p) => p.wave)).toEqual([1, 2]);
    expect(peeks[0]).toMatchObject({ name: 'Zombie Horde', known: true, boss: false });
    expect(peeks[0].tooltip.startsWith(templateObjectForWave(1)!.description)).toBe(true);
  });

  it('lists armor badges and what the armor is weak to', () => {
    const [w1] = peekUpcomingWaves(0, 0);
    expect(w1.armors).toEqual([{ icon: ARMOR_TYPE_UI.unarmored.icon, label: 'Unarmored' }]);
    expect(w1.weakTo).toBe('Fire, Poison, Pierce');
    expect(w1.air).toBe(false);
  });

  it('marks a wave with air units', () => {
    const [, w7] = peekUpcomingWaves(5, 0);
    expect(w7).toMatchObject({ wave: 7, name: 'Bat Swarm', air: true });
    expect(w7.armors.map((a) => a.label)).toEqual(['Light']);
  });

  it('opens the count range with the tower DPS the way the director does', () => {
    const [lo, full] = templateObjectForWave(1)!.countRange;
    // No defense: the ramp floor, 10% of the range
    expect(peekUpcomingWaves(0, 0)[0].count).toBe(`${lo}–${Math.round(lo + (full - lo) * 0.1)}`);
    // Half the ramp
    expect(peekUpcomingWaves(0, DPS_RAMP_COUNT / 2)[0].count).toBe(`${lo}–${Math.round(lo + (full - lo) * 0.5)}`);
    // The whole template from DPS_RAMP_COUNT on
    expect(peekUpcomingWaves(0, DPS_RAMP_COUNT * 3)[0].count).toBe(`${lo}–${full}`);
  });

  it('says in the tooltip that the gate can send fewer', () => {
    const [w1] = peekUpcomingWaves(0, 0);
    expect(w1.tooltip).toMatch(/A weak defense can get fewer than \d+\./);
  });

  it('weighs a mixed wave by HP and names the counters per armor in the tooltip', () => {
    const [, w30] = peekUpcomingWaves(28, 0);
    expect(w30).toMatchObject({ name: 'Boss: Herbert', boss: true });
    expect(w30.armors.length).toBeGreaterThan(1);
    expect(w30.weakTo).not.toBe('');
    expect(w30.tooltip).toContain('Fortified: Siege, Magic.');
  });

  it('adds the split of the skeletons to the W19 tooltip', () => {
    const [w19] = peekUpcomingWaves(18, 0);
    expect(w19).toMatchObject({ wave: 19, name: 'Skeleton Swarm' });
    expect(w19.tooltip).toContain('Skeleton: Splits into 2 minions on death.');
  });

  it('shows what is known past the curriculum instead of nothing', () => {
    const last = CURRICULUM_FORCED_THROUGH_WAVE;
    const [w30, w31] = peekUpcomingWaves(last - 1, 0);
    expect(w30.known).toBe(true);
    expect(w31).toMatchObject({
      wave: last + 1,
      name: "Director's pick",
      known: false,
      boss: false,
      count: null,
      note: 'Template picked at wave start · boss W35',
    });
  });

  it('marks the boss waves past the curriculum, every fifth from W31', () => {
    const [w34, w35] = peekUpcomingWaves(33, 0);
    expect(w34).toMatchObject({ boss: false, note: 'Template picked at wave start · boss W35' });
    expect(w35).toMatchObject({ wave: 35, name: 'Boss wave', boss: true, known: false });
  });
});
