import {
  TEMPLATES,
  NUM_ACTIVE_TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  getTemplate,
  getAvailableTemplateMask,
} from './templates';

describe('Phase 5.10 Templates', () => {
  it('has exactly 18 active templates', () => {
    expect(NUM_ACTIVE_TEMPLATES).toBe(18);
    expect(TEMPLATES.length).toBe(18);
  });

  it('has 32 max slots (14 reserved for future expansion)', () => {
    expect(MAX_TEMPLATE_SLOTS).toBe(32);
    expect(MAX_TEMPLATE_SLOTS - NUM_ACTIVE_TEMPLATES).toBe(14);
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
      expect(t.baseCount).toBeGreaterThan(0);
      expect(t.baseSpawnDelayMs).toBeGreaterThanOrEqual(50);
      expect(t.baseHpMult).toBeGreaterThan(0);
      expect(t.minWave).toBeGreaterThanOrEqual(1);
      expect(t.enemies.length).toBeGreaterThan(0);
    }
  });

  it('getTemplate returns null for invalid indices', () => {
    expect(getTemplate(-1)).toBeNull();
    expect(getTemplate(NUM_ACTIVE_TEMPLATES)).toBeNull();
    expect(getTemplate(MAX_TEMPLATE_SLOTS)).toBeNull();
    expect(getTemplate(999)).toBeNull();
  });

  it('getTemplate returns valid template for slot 0-17', () => {
    for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
      expect(getTemplate(i)).not.toBeNull();
      expect(getTemplate(i)?.id).toBeTruthy();
    }
  });

  describe('getAvailableTemplateMask', () => {
    it('blocks reserve slots (18-31) regardless of state', () => {
      const mask = getAvailableTemplateMask(100, true, true, []);
      for (let i = NUM_ACTIVE_TEMPLATES; i < MAX_TEMPLATE_SLOTS; i++) {
        expect(mask[i]).toBe(false);
      }
    });

    it('blocks templates below their min_wave', () => {
      const mask = getAvailableTemplateMask(1, true, true, []);
      // rat_tide (slot 1) has min_wave=8 — must be blocked at wave 1
      expect(mask[1]).toBe(false);
      // zombie_horde (slot 0) has min_wave=1 — must be allowed
      expect(mask[0]).toBe(true);
    });

    it('blocks antiAir templates when player has no anti-air', () => {
      const mask = getAvailableTemplateMask(20, false, true, []);
      // bat_swarm (slot 6) requires antiAir
      expect(mask[6]).toBe(false);
    });

    it('blocks antiEthereal templates when player has no counter', () => {
      const mask = getAvailableTemplateMask(20, true, false, []);
      // ghost_surge (slot 13) requires antiEthereal
      expect(mask[13]).toBe(false);
    });

    it('enforces cooldown — recently-used templates are blocked', () => {
      const mask = getAvailableTemplateMask(20, true, true, [0, 1]);
      expect(mask[0]).toBe(false); // just used
      expect(mask[1]).toBe(false); // just used
      // But other slots stay open
      expect(mask.some(m => m)).toBe(true);
    });

    it('always allows at least one template (fallback to slot 0)', () => {
      // Even with impossible combo: wave 1 + no capabilities
      const mask = getAvailableTemplateMask(1, false, false, []);
      expect(mask.some(m => m)).toBe(true);
    });

    it('boss_herbert only available at wave % 10 == 0', () => {
      const maskW15 = getAvailableTemplateMask(15, true, true, []);
      const maskW20 = getAvailableTemplateMask(20, true, true, []);
      // slot 17 is boss_herbert
      expect(maskW15[17]).toBe(false);
      expect(maskW20[17]).toBe(true);
    });
  });
});
