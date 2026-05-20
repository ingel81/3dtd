import {
  TEMPLATES,
  NUM_ACTIVE_TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  getTemplate,
  getAvailableTemplateMask,
  lerpRange,
} from './templates';

describe('Phase 5.11 Range-Based Templates', () => {
  it('has exactly 19 active templates (incl. golem_squad, gated via minWave:999)', () => {
    expect(NUM_ACTIVE_TEMPLATES).toBe(19);
    expect(TEMPLATES.length).toBe(19);
  });

  it('has 32 max slots (13 reserved for future expansion)', () => {
    expect(MAX_TEMPLATE_SLOTS).toBe(32);
    expect(MAX_TEMPLATE_SLOTS - NUM_ACTIVE_TEMPLATES).toBe(13);
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

    it('boss_herbert only at wave % 10 == 0', () => {
      expect(getAvailableTemplateMask(15, true, true, [])[17]).toBe(false);
      expect(getAvailableTemplateMask(20, true, true, [])[17]).toBe(true);
    });
  });
});
