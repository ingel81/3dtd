import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  NUM_ACTIVE_TEMPLATES,
  getTemplate,
  candidateTemplates,
  lerpRange,
} from './templates';

describe('Phase 5.11 Range-Based Templates', () => {
  it('has exactly 22 active templates (incl. three boss templates)', () => {
    expect(NUM_ACTIVE_TEMPLATES).toBe(22);
    expect(TEMPLATES.length).toBe(22);
    expect(TEMPLATES.filter((t) => t.bossOnly).map((t) => t.id))
      .toEqual(['boss_herbert', 'boss_golem', 'boss_dragon']);
  });

  it('keeps every slot at its index, skeleton_swarm appended as slot 21', () => {
    // Templates are addressed by index, so a new one goes at the end and none
    // of the others moves.
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'zombie_horde', 'rat_tide', 'penguin_rush', 'light_mix', 'spider_swarm', 'wallsmasher_crew',
      'bat_swarm', 'hornet_strike', 'tank_column', 'bear_pack', 'mech_army', 'dragon_elite',
      'mammoth_siege', 'ghost_surge', 'wraith_storm', 'chaos_wave', 'armor_gauntlet', 'boss_herbert',
      'golem_squad', 'boss_golem', 'boss_dragon', 'skeleton_swarm',
    ]);
    const skeleton = TEMPLATES[21];
    expect(skeleton.enemies).toEqual([['skeleton', 1.0]]);
    expect(skeleton.requires).toBeNull();
    expect(skeleton.bossOnly).toBe(false);
  });

  it('every template has enemy shares summing to ~1.0', () => {
    for (const t of TEMPLATES) {
      const sum = t.enemies.reduce((s, [, share]) => s + share, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.01);
    }
  });

  it('every template has required fields', () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.countRange).toBeDefined();
      expect(t.spawnDelayRange).toBeDefined();
      expect(t.hpMultRange).toBeDefined();
      expect(t.variationRange).toBeDefined();
      expect(t.minWave).toBeGreaterThanOrEqual(1);
      expect(t.enemies.length).toBeGreaterThan(0);
    }
  });

  it('every range has min < max and sane bounds', () => {
    for (const t of TEMPLATES) {
      expect(t.countRange[0]).toBeLessThan(t.countRange[1]);
      expect(t.countRange[0]).toBeGreaterThanOrEqual(1);
      expect(t.spawnDelayRange[0]).toBeLessThan(t.spawnDelayRange[1]);
      expect(t.spawnDelayRange[0]).toBeGreaterThanOrEqual(5);
      expect(t.hpMultRange[0]).toBeLessThan(t.hpMultRange[1]);
      expect(t.hpMultRange[0]).toBeGreaterThan(0);
      expect(t.variationRange[0]).toBeLessThan(t.variationRange[1]);
      expect(t.variationRange[0]).toBeGreaterThanOrEqual(0);
      expect(t.variationRange[1]).toBeLessThanOrEqual(1);
    }
  });

  it('getTemplate returns null for invalid indices', () => {
    expect(getTemplate(-1)).toBeNull();
    expect(getTemplate(NUM_ACTIVE_TEMPLATES)).toBeNull();
  });

  it('lerpRange interpolates correctly', () => {
    expect(lerpRange([0, 100], 0)).toBe(0);
    expect(lerpRange([0, 100], 1)).toBe(100);
    expect(lerpRange([0, 100], 0.5)).toBe(50);
    expect(lerpRange([50, 200], 0.25)).toBeCloseTo(87.5);
  });

  describe('candidateTemplates', () => {
    const live = (
      wave: number,
      air: boolean,
      ethereal: boolean,
      recent: number[] = [],
      forced: string | null = null,
      boss = false,
    ) => candidateTemplates(wave, air, ethereal, recent, forced, boss).indices;

    it('only ever names templates that exist, ascending', () => {
      const all = live(100, true, true);
      for (const i of all) expect(i).toBeLessThan(NUM_ACTIVE_TEMPLATES);
      expect([...all].sort((a, b) => a - b)).toEqual(all);
    });

    it('blocks templates below min_wave', () => {
      expect(live(1, true, true)).not.toContain(1);  // rat_tide min_wave=8
      expect(live(1, true, true)).toContain(0);      // zombie_horde min_wave=1
    });

    it('blocks antiAir templates without anti-air', () => {
      expect(live(20, false, true)).not.toContain(6);   // bat_swarm
    });

    it('blocks antiEthereal templates without magic/ice', () => {
      expect(live(20, true, false)).not.toContain(13);  // ghost_surge
    });

    it('enforces cooldown on recently-used templates', () => {
      const c = live(20, true, true, [0, 1]);
      expect(c).not.toContain(0);
      expect(c).not.toContain(1);
      expect(c.length).toBeGreaterThan(0);
    });

    it('always names at least one template (fallback)', () => {
      expect(live(1, false, false).length).toBeGreaterThan(0);
    });

    const bossSlots = TEMPLATES.flatMap((t, i) => (t.bossOnly ? [i] : []));

    it('blocks boss templates on normal waves', () => {
      expect(live(36, true, true, [], null, false).some((i) => bossSlots.includes(i))).toBe(false);
    });

    it('collapses a boss wave onto the boss templates', () => {
      // Regression: the list used to allow the boss, not force it, so W31-W130
      // produced 0.7 boss waves instead of 10.
      expect(live(35, true, true, [], null, true)).toEqual(bossSlots);
    });

    it('a boss wave respects the requirements and the cooldown', () => {
      const dragon = TEMPLATES.findIndex((t) => t.id === 'boss_dragon');
      const herbert = TEMPLATES.findIndex((t) => t.id === 'boss_herbert');
      expect(live(35, false, true, [], null, true)).not.toContain(dragon);
      const c = live(35, true, true, [herbert], null, true);
      expect(c).not.toContain(herbert);
      expect(c.every((i) => bossSlots.includes(i))).toBe(true);
    });

    it('a boss wave no boss template can serve becomes a normal wave', () => {
      // W15: herbert needs W20, the new bosses W31.
      const c = live(15, true, true, [], null, true);
      expect(c.length).toBeGreaterThan(0);
      expect(c.some((i) => bossSlots.includes(i))).toBe(false);
    });
  });

  describe('candidateTemplates: the reason it reports', () => {
    const idx = (id: string) => TEMPLATES.findIndex((t) => t.id === id);
    const needing = (capability: 'antiAir' | 'antiEthereal', wave: number, boss = false) =>
      TEMPLATES.flatMap((t, i) =>
        t.bossOnly === boss && t.requires === capability && wave >= t.minWave ? [i] : []);

    it('names a campaign pin and the requirement it bypasses', () => {
      const { indices, reason } = candidateTemplates(7, false, true, [], 'bat_swarm', false);
      expect(indices).toEqual([idx('bat_swarm')]);
      expect(reason).toMatchObject({ rule: 'campaign', pinnedLacks: 'antiAir' });
      expect(candidateTemplates(7, true, true, [], 'bat_swarm', false).reason.pinnedLacks).toBeNull();
    });

    it('lists the templates held back by a missing capability', () => {
      const { indices, reason } = candidateTemplates(41, false, false, [], null, false);
      expect(reason.rule).toBe('free');
      expect(reason.heldBack.antiAir).toEqual(needing('antiAir', 41));
      expect(reason.heldBack.antiEthereal).toEqual(needing('antiEthereal', 41));
      for (const i of [...reason.heldBack.antiAir, ...reason.heldBack.antiEthereal]) {
        expect(indices).not.toContain(i);
      }
    });

    it('does not list templates minWave or the boss rule exclude anyway', () => {
      // Bat Swarm opens at W7: at W5 the requirement is not what holds it back.
      expect(candidateTemplates(5, false, true, []).reason.heldBack.antiAir).not.toContain(idx('bat_swarm'));
      // On a boss wave only boss templates are candidates.
      expect(candidateTemplates(35, false, true, [], null, true).reason.heldBack.antiAir)
        .toEqual(needing('antiAir', 35, true));
    });

    it('marks a boss wave, and one no boss template can serve', () => {
      expect(candidateTemplates(35, true, true, [], null, true).reason.rule).toBe('boss');
      expect(candidateTemplates(15, true, true, [], null, true).reason)
        .toMatchObject({ rule: 'free', bossUnavailable: true });
    });

    it('reports a waived cooldown', () => {
      // W1 has one eligible template; having just run it starves the list.
      const { indices, reason } = candidateTemplates(1, true, true, [idx('zombie_horde')]);
      expect(indices).toContain(idx('zombie_horde'));
      expect(reason.cooldownWaived).toBe(true);
      expect(candidateTemplates(1, true, true, []).reason.cooldownWaived).toBe(false);
    });
  });
});
