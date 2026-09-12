import {
  TEMPLATES,
  NUM_ACTIVE_TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  getTemplate,
  getAvailableTemplateMask,
  describeTemplateMask,
  lerpRange,
} from './templates';

describe('Phase 5.11 Range-Based Templates', () => {
  it('has exactly 21 active templates (incl. three boss templates)', () => {
    expect(NUM_ACTIVE_TEMPLATES).toBe(21);
    expect(TEMPLATES.length).toBe(21);
    expect(TEMPLATES.filter((t) => t.bossOnly).map((t) => t.id))
      .toEqual(['boss_herbert', 'boss_golem', 'boss_dragon']);
  });

  it('has 32 max slots (11 reserved for future expansion)', () => {
    expect(MAX_TEMPLATE_SLOTS).toBe(32);
    expect(MAX_TEMPLATE_SLOTS - NUM_ACTIVE_TEMPLATES).toBe(11);
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
    expect(getTemplate(MAX_TEMPLATE_SLOTS)).toBeNull();
  });

  it('lerpRange interpolates correctly', () => {
    expect(lerpRange([0, 100], 0)).toBe(0);
    expect(lerpRange([0, 100], 1)).toBe(100);
    expect(lerpRange([0, 100], 0.5)).toBe(50);
    expect(lerpRange([50, 200], 0.25)).toBeCloseTo(87.5);
  });

  describe('getAvailableTemplateMask', () => {
    it('blocks reserve slots regardless of state', () => {
      const mask = getAvailableTemplateMask(100, true, true, []);
      for (let i = NUM_ACTIVE_TEMPLATES; i < MAX_TEMPLATE_SLOTS; i++) {
        expect(mask[i]).toBe(false);
      }
    });

    it('blocks templates below min_wave', () => {
      const mask = getAvailableTemplateMask(1, true, true, []);
      expect(mask[1]).toBe(false); // rat_tide min_wave=8
      expect(mask[0]).toBe(true);  // zombie_horde min_wave=1
    });

    it('blocks antiAir templates without anti-air', () => {
      const mask = getAvailableTemplateMask(20, false, true, []);
      expect(mask[6]).toBe(false); // bat_swarm
    });

    it('blocks antiEthereal templates without magic/ice', () => {
      const mask = getAvailableTemplateMask(20, true, false, []);
      expect(mask[13]).toBe(false); // ghost_surge
    });

    it('enforces cooldown on recently-used templates', () => {
      const mask = getAvailableTemplateMask(20, true, true, [0, 1]);
      expect(mask[0]).toBe(false);
      expect(mask[1]).toBe(false);
      expect(mask.some(m => m)).toBe(true);
    });

    it('always allows at least one template (fallback)', () => {
      const mask = getAvailableTemplateMask(1, false, false, []);
      expect(mask.some(m => m)).toBe(true);
    });

    const bossSlots = TEMPLATES.flatMap((t, i) => (t.bossOnly ? [i] : []));
    const live = (mask: boolean[]) => mask.flatMap((on, i) => (on ? [i] : []));

    it('blocks boss templates on normal waves', () => {
      const mask = getAvailableTemplateMask(36, true, true, [], null, false);
      expect(live(mask).some((i) => bossSlots.includes(i))).toBe(false);
    });

    it('collapses a boss wave onto the boss templates', () => {
      // Regression: the mask used to allow the boss, not force it, so W31-W130
      // produced 0.7 boss waves instead of 10.
      expect(live(getAvailableTemplateMask(35, true, true, [], null, true))).toEqual(bossSlots);
    });

    it('a boss wave respects capability gates and the cooldown', () => {
      const dragon = TEMPLATES.findIndex((t) => t.id === 'boss_dragon');
      const herbert = TEMPLATES.findIndex((t) => t.id === 'boss_herbert');
      expect(getAvailableTemplateMask(35, false, true, [], null, true)[dragon]).toBe(false);
      const mask = getAvailableTemplateMask(35, true, true, [herbert], null, true);
      expect(mask[herbert]).toBe(false);
      expect(live(mask).every((i) => bossSlots.includes(i))).toBe(true);
    });

    it('a boss wave no boss template can serve becomes a normal wave', () => {
      // W15: herbert needs W20, the new bosses W31.
      const mask = getAvailableTemplateMask(15, true, true, [], null, true);
      expect(live(mask).length).toBeGreaterThan(0);
      expect(live(mask).some((i) => bossSlots.includes(i))).toBe(false);
    });
  });

  describe('describeTemplateMask', () => {
    const idx = (id: string) => TEMPLATES.findIndex((t) => t.id === id);
    const live = (mask: boolean[]) => mask.flatMap((on, i) => (on ? [i] : []));
    const needing = (capability: 'antiAir' | 'antiEthereal', wave: number, boss = false) =>
      TEMPLATES.flatMap((t, i) =>
        t.bossOnly === boss && t.requiresCapability === capability && wave >= t.minWave ? [i] : []);

    it('returns the mask getAvailableTemplateMask returns', () => {
      expect(describeTemplateMask(41, false, true, [0, 1]).mask).toEqual(getAvailableTemplateMask(41, false, true, [0, 1]));
      expect(describeTemplateMask(35, true, true, [], null, true).mask)
        .toEqual(getAvailableTemplateMask(35, true, true, [], null, true));
    });

    it('names a curriculum pin and the capability it bypasses', () => {
      const { mask, reason } = describeTemplateMask(7, false, true, [], 'bat_swarm', false);
      expect(live(mask)).toEqual([idx('bat_swarm')]);
      expect(reason).toMatchObject({ rule: 'curriculum', pinnedLacks: 'antiAir' });
      expect(describeTemplateMask(7, true, true, [], 'bat_swarm', false).reason.pinnedLacks).toBeNull();
    });

    it('lists the templates held back by a missing capability', () => {
      const { mask, reason } = describeTemplateMask(41, false, false, [], null, false);
      expect(reason.rule).toBe('free');
      expect(reason.heldBack.antiAir).toEqual(needing('antiAir', 41));
      expect(reason.heldBack.antiEthereal).toEqual(needing('antiEthereal', 41));
      for (const i of [...reason.heldBack.antiAir, ...reason.heldBack.antiEthereal]) expect(mask[i]).toBe(false);
    });

    it('does not list templates minWave or the boss rule exclude anyway', () => {
      // Bat Swarm opens at W7: at W5 the capability is not what holds it back.
      expect(describeTemplateMask(5, false, true, []).reason.heldBack.antiAir).not.toContain(idx('bat_swarm'));
      // On a boss wave only boss templates are candidates.
      expect(describeTemplateMask(35, false, true, [], null, true).reason.heldBack.antiAir)
        .toEqual(needing('antiAir', 35, true));
    });

    it('marks a boss wave, and one no boss template can serve', () => {
      expect(describeTemplateMask(35, true, true, [], null, true).reason.rule).toBe('boss');
      expect(describeTemplateMask(15, true, true, [], null, true).reason)
        .toMatchObject({ rule: 'free', bossUnavailable: true });
    });

    it('reports a waived cooldown', () => {
      // W1 has one eligible template; having just run it starves the mask.
      const { mask, reason } = describeTemplateMask(1, true, true, [idx('zombie_horde')]);
      expect(mask[idx('zombie_horde')]).toBe(true);
      expect(reason.cooldownWaived).toBe(true);
      expect(describeTemplateMask(1, true, true, []).reason.cooldownWaived).toBe(false);
    });
  });
});
