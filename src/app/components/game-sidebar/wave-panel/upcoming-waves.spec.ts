import { describe, it, expect } from 'vitest';
import { BLOOD_MOON_NOTE, NEXT_WAVE_MARKS, markIconSize, mutatorNote, peekUpcomingWaves, shownPeek, type WavePeek } from './upcoming-waves';
import { WAVE_MUTATORS } from '../../../configs/wave-mutators.config';
import { BudgetWaveSource } from '../../../director/sources/budget/budget-source';
import { planRowForWave } from '../../../director/sources/budget/run-plan';

/**
 * The facts come from the source the run plays; this module only words them.
 * The spec drives both together, because the marks are only right when the
 * source's answer and the wording fit each other. The budget source is the
 * default; it names every wave of its run plan ahead.
 */
const source = new BudgetWaveSource();
const peekWaves = (currentWave: number, count: number, bloodMoon = true) =>
  peekUpcomingWaves(source.peek({ fromWave: currentWave + 1, count }), bloodMoon);
const rowCount = (wave: number) => Object.values(planRowForWave(wave)!.enemies).reduce((sum, n) => sum + n, 0);

// What the detail line's card says, by its parts
const section = (peek: WavePeek, title: string) => peek.tooltip.sections?.find((s) => s.title === title);
const stat = (peek: WavePeek, label: string) => peek.tooltip.stats?.find((s) => s.label === label)?.value;
const banners = (peek: WavePeek) => (peek.tooltip.banners ?? []).map((b) => b.text);
const counters = (peek: WavePeek, armor: string) =>
  section(peek, 'Weak to')?.rows.find((r) => r.label === armor)?.chips?.map((c) => c.label);

describe('peekUpcomingWaves', () => {
  it('shows the waves after the current one, as many as asked for', () => {
    const peeks = peekWaves(0, NEXT_WAVE_MARKS);
    expect(peeks.map((p) => p.wave)).toEqual([1, 2, 3, 4, 5]);
    expect(peeks[0]).toMatchObject({ name: 'Zombie Horde', known: true, boss: false });
    const [fact] = source.peek({ fromWave: 1, count: 1 });
    expect(peeks[0].tooltip).toMatchObject({ title: 'Zombie Horde', category: 'Wave 1', flavor: fact.description });
    expect(peekWaves(7, 2).map((p) => p.wave)).toEqual([8, 9]);
  });

  it('lists the armors and the damage types the wave is weak to', () => {
    const [w1] = peekWaves(0, 1);
    expect(w1.armors).toEqual(['Unarmored']);
    expect(w1.armorLabel).toBe('Unarmored');
    expect(w1.weakToTypes).toEqual(['fire', 'poison', 'pierce']);
    expect(w1.weakTo).toBe('Fire, Poison, Pierce');
    expect(counters(w1, 'Unarmored')).toEqual(['Fire', 'Poison', 'Pierce']);
    expect(w1.air).toBe(false);
  });

  it('marks a wave with air units', () => {
    const [, w7] = peekWaves(5, 2);
    expect(w7).toMatchObject({ wave: 7, name: 'Bat Swarm', air: true });
    expect(w7.armors).toEqual(['Light']);
    expect(section(w7, 'Enemies')!.rows[0].detail).toBe('Light | air');
  });

  it('shows the count of the plan row, on the mark and in the tooltip', () => {
    const [w1] = peekWaves(0, 1);
    expect(w1.count).toBe(`${rowCount(1)}`);
    expect(stat(w1, 'ENEMIES')).toBe(`${rowCount(1)}`);
  });

  it('weighs a mixed wave by HP, sums up the armors and names the counters per armor in the tooltip', () => {
    const [, w10] = peekWaves(8, 2);
    expect(w10).toMatchObject({ name: 'Boss: Herbert', boss: true });
    expect(w10.armors.length).toBeGreaterThan(1);
    expect(w10.armorLabel).toBe(`${w10.armors[0]} +${w10.armors.length - 1}`);
    expect(w10.weakToTypes.length).toBeGreaterThan(0);
    expect(w10.tooltip.accent).toBe('gold');
    // One row per armor of the wave, each with its own counters
    expect(section(w10, 'Weak to')!.rows.length).toBe(w10.armors.length);
    expect(counters(w10, 'Fortified')).toEqual(['Siege', 'Magic']);
  });

  it('names the boss of W20 and W30, not Herbert (TODO E41)', () => {
    const [w20] = peekWaves(19, 1);
    const [w30] = peekWaves(29, 1);
    expect(w20).toMatchObject({ name: 'Boss: Ooze', boss: true });
    expect(w30).toMatchObject({ name: 'Boss: Skarnax', boss: true });
  });

  it('says what each enemy and the whole wave cost the HQ (TODO E49)', () => {
    const [w1] = peekWaves(0, 1);
    const n = rowCount(1);
    expect(section(w1, 'Enemies')!.rows.map((r) => [r.label.replace(/^\d+× /, ''), r.value])).toEqual([['Zombie', '−2'], ['Zombie v2', '−2']]);
    expect(section(w1, 'Enemies')!.rows.map((r) => Number(r.label.split('×')[0])).reduce((a, b) => a + b, 0)).toBe(n);
    expect(stat(w1, 'HQ MAX')).toBe(`−${n * 2}`);
  });

  it('adds the split of the skeletons to the W19 tooltip', () => {
    const [w19] = peekWaves(18, 1);
    expect(w19).toMatchObject({ wave: 19, name: 'Skeleton Swarm' });
    expect(section(w19, 'Enemies')!.rows.find((r) => r.label.endsWith('Skeleton'))!.note).toBe('Splits into 2 minions on death');
  });

  it('knows the waves past the campaign as well', () => {
    const [w30, w31] = peekWaves(29, 2);
    expect(w30.known).toBe(true);
    expect(w31).toMatchObject({ wave: 31, name: planRowForWave(31)!.name, known: true, boss: false });
    expect(w31.count).toBe(`${rowCount(31)}`);
    expect(w31.armors.length).toBeGreaterThan(0);
  });

  it('marks the boss waves past the campaign by the plan, and names them', () => {
    const [w39, w40] = peekWaves(38, 2);
    expect(w39.boss).toBe(false);
    expect(w40).toMatchObject({ wave: 40, name: 'Boss: Golem King', boss: true, known: true });
  });

  it('marks the blood moon waves, W14 and every seventh after, with the look in the tooltip', () => {
    const peeks = peekWaves(12, NEXT_WAVE_MARKS);
    expect(peeks.filter((p) => p.bloodMoon).map((p) => p.wave)).toEqual([14]);
    const w14 = peeks.find((p) => p.wave === 14)!;
    expect(banners(w14)).toContain(BLOOD_MOON_NOTE);
    expect(banners(peeks.find((p) => p.wave === 13)!)).not.toContain(BLOOD_MOON_NOTE);

    // Past the campaign as well
    const [, w35] = peekWaves(33, 2);
    expect(w35).toMatchObject({ wave: 35, bloodMoon: true });
    expect(banners(w35)).toContain(BLOOD_MOON_NOTE);
  });

  it('leaves the blood moon off the line while its look is switched off', () => {
    const w14 = peekWaves(13, 1, false)[0];
    expect(w14.bloodMoon).toBe(false);
    expect(banners(w14)).not.toContain(BLOOD_MOON_NOTE);
  });

  it('names the mutator of a blood moon wave, look on or off, and says what it does', () => {
    for (const look of [true, false]) {
      const [w13, w14] = peekWaves(12, 2, look);
      expect(w13.mutator).toBeNull();
      expect(w14.mutator).toBe(WAVE_MUTATORS.swift.name);
      expect(banners(w14)[0]).toBe(mutatorNote(WAVE_MUTATORS.swift));
    }
    expect(peekWaves(20, 1)[0].mutator).toBe(WAVE_MUTATORS.swarm.name);
  });
});

describe('shownPeek', () => {
  const peeks = peekWaves(0, NEXT_WAVE_MARKS);

  it('details the next wave by default', () => {
    expect(shownPeek(peeks, null, null)?.wave).toBe(1);
  });

  it('follows the pointer over the clicked mark, and back to it', () => {
    expect(shownPeek(peeks, null, 3)?.wave).toBe(3);
    expect(shownPeek(peeks, 4, 3)?.wave).toBe(4);
  });

  it('falls back to the next wave once the clicked one is past', () => {
    expect(shownPeek(peekWaves(3, NEXT_WAVE_MARKS), null, 3)?.wave).toBe(4);
  });

  it('shows nothing without waves', () => {
    expect(shownPeek([], null, null)).toBeNull();
  });
});

describe('markIconSize', () => {
  it('keeps the icons at 10 px up to two and shrinks three to 8 px, so they fit the 28 px mark', () => {
    const peek = (boss: boolean, air: boolean, bloodMoon: boolean) => ({ boss, air, bloodMoon });
    expect(markIconSize(peek(true, false, false))).toBe(10);
    expect(markIconSize(peek(true, false, true))).toBe(10);
    expect(markIconSize(peek(true, true, true))).toBe(8);
    // Three icons and their two 2 px gaps against the 28 px mark
    expect(3 * markIconSize(peek(true, true, true)) + 2 * 2).toBeLessThanOrEqual(28);
    expect(2 * markIconSize(peek(false, true, true)) + 2).toBeLessThanOrEqual(28);
  });
});
