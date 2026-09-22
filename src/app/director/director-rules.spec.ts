import { describe, it, expect } from 'vitest';
import { decideWave, type TieBreak } from './director-rules';
import { NUM_ACTIVE_TEMPLATES } from './templates';

describe('decideWave', () => {
  /** The first `n` templates as candidates. */
  const first = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('only ever picks a candidate', () => {
    // The candidate list carries the campaign pin, the requirements, the boss
    // cadence and the template cooldown. Picking outside it ships a wave the
    // designer explicitly excluded — e.g. an air wave against a ground-only
    // defense.
    for (let i = 0; i < 200; i++) {
      const d = decideWave(first(3), 12, [0, 1]);
      expect(d.templateIdx).toBeLessThan(3);
      expect(d.templateIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every factor inside [0,1]', () => {
    // The decoder interpolates these into designer ranges; out-of-range values
    // would silently extrapolate past the range the designer authored.
    for (const wave of [1, 30, 60, 200]) {
      for (let i = 0; i < 100; i++) {
        const d = decideWave(first(6), wave, []);
        for (const f of [d.factors.count, d.factors.spawn, d.factors.hp, d.factors.variation]) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('never repeats the template of the wave just played', () => {
    // Variety is enforced rather than rewarded: the old reward function had a
    // variation term and the candidate list has a cooldown, and waves still
    // came out repetitive.
    //
    // Seit STALENESS_SLACK darf ein etwas jüngeres Template mitspielen — aber
    // nie das der letzten Welle. Index 1 lief zuletzt.
    const picks = new Set<number>();
    for (let i = 0; i < 200; i++) {
      picks.add(decideWave(first(4), 9, [0, 1]).templateIdx);
    }
    expect(picks.has(1)).toBe(false);
    expect(picks.has(2) && picks.has(3)).toBe(true);   // die Ältesten bleiben die Regel
  });

  it('prefers the oldest but lets the loop reach a slightly younger one', () => {
    // Der Sinn des Slack: Wer immer nur den Ältesten nimmt, spielt jedes
    // Template gleich oft, egal was der Regler will. Zwei Wellen Spielraum
    // machen die Rotation atmungsfähig, ohne sie aufzugeben.
    const headroom = new Map([[0, 0.1], [2, 0.9], [3, 0.9]]);
    const d = decideWave(first(4), 40, [0, 1], () => 0, { prefer: 'harder', headroom });
    expect(d.templateIdx).toBe(0);     // eine Welle jünger, aber die schlechteste Deckung
  });

  it('falls back to the oldest of the used templates when all are recent', () => {
    // Index 0 is the stalest of the two, so it must come back rather than the
    // director stalling or picking a template that was not a candidate.
    const picks = new Set<number>();
    for (let i = 0; i < 50; i++) {
      picks.add(decideWave(first(2), 9, [0, 1]).templateIdx);
    }
    expect(picks).toEqual(new Set([0]));
  });

  it('ramps difficulty with the wave number', () => {
    // The player never heals, so HP is a whole-run budget and difficulty is a
    // curve — something written down, not inferred per wave.
    const mean = (wave: number, key: 'count' | 'hp') => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += decideWave(first(6), wave, []).factors[key];
      return sum / 300;
    };
    expect(mean(60, 'count')).toBeGreaterThan(mean(1, 'count'));
    expect(mean(60, 'hp')).toBeGreaterThan(mean(1, 'hp'));
  });

  it('tightens the spawn delay as the run progresses', () => {
    const mean = (wave: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += decideWave(first(6), wave, []).factors.spawn;
      return sum / 300;
    };
    expect(mean(60)).toBeLessThan(mean(1));
  });

  it('holds the ramp flat past its end instead of overshooting', () => {
    const at = (wave: number) => decideWave(first(6), wave, [], () => 0.5).factors.count;
    expect(at(200)).toBeCloseTo(at(60), 6);
  });

  it('survives an empty candidate list without throwing', () => {
    // Defensive: candidateTemplates never returns an empty list. Shipping the
    // designer's first template beats shipping nothing at all.
    const d = decideWave([], 5, []);
    expect(d.templateIdx).toBe(0);
    expect(d.templateIdx).toBeLessThan(NUM_ACTIVE_TEMPLATES);
  });

  it('is deterministic given a fixed random source', () => {
    const fixed = () => 0.5;
    const a = decideWave(first(6), 20, [1], fixed);
    const b = decideWave(first(6), 20, [1], fixed);
    expect(a).toEqual(b);
  });

  it('varies successive waves at the same wave number', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(decideWave(first(6), 20, []).factors.count);
    expect(seen.size).toBeGreaterThan(1);
  });

  describe('reports how it picked, for the decision explainer', () => {
    it('counts the candidates and the tie among templates outside the history', () => {
      // `tied` zählt weiter die exakt Ältesten (vier unbenutzte), auch wenn
      // der Slack mehr zur Wahl stellt; `lastRanWavesAgo` gehört dagegen dem
      // Gewählten, und der kann seit dem Slack ein etwas jüngerer sein.
      const { why } = decideWave(first(6), 40, [0, 1], () => 0);
      expect(why).toMatchObject({ candidates: 6, history: 2, tied: 4 });
    });

    it('reports the age of the template it actually picked', () => {
      const oldest = decideWave(first(6), 40, [0, 1], () => 0.99);
      expect(oldest.why.lastRanWavesAgo).toBeNull();     // ein unbenutztes
      const younger = decideWave(first(6), 40, [0, 1], () => 0);
      expect(younger.templateIdx).toBe(0);
      expect(younger.why.lastRanWavesAgo).toBe(2);       // lief vor zwei Wellen
    });

    it('says how long ago the pick last ran when every candidate is recent', () => {
      // Slot 0 ran two waves ago, slot 1 last wave: 0 is the stalest.
      const d = decideWave(first(2), 40, [0, 1]);
      expect(d.templateIdx).toBe(0);
      expect(d.why).toMatchObject({ candidates: 2, lastRanWavesAgo: 2, tied: 1 });
    });

    it('reports the ramp position it used', () => {
      const ramp = (wave: number) => {
        const { why } = decideWave(first(6), wave, []);
        return why.ramp;
      };
      expect(ramp(30)).toBeCloseTo(0.5, 6);
      expect(ramp(200)).toBe(1);
    });

    it('marks the empty-list fallback', () => {
      const d = decideWave([], 5, []);
      expect(d.why).toMatchObject({ candidates: 0 });
    });
  });

  describe('the tie between equally stale candidates', () => {
    // Vier unbenutzte Templates, also vier gleich alte Kandidaten. Ohne
    // Gleichstand greift der Tie-Break nicht, und das ist der Punkt: Die
    // Älteste-zuerst-Regel behält immer Vorrang.
    const headroom = new Map([[0, 0.9], [1, 0.1], [2, 0.5], [3, 0.7]]);
    const tie = (prefer: 'harder' | 'easier'): TieBreak => ({ prefer, headroom });

    it('takes the template the defense covers worst when the loop wants harder', () => {
      const d = decideWave(first(4), 40, [], () => 0, tie('harder'));
      expect(d.templateIdx).toBe(1);          // headroom 0.1
      expect(d.why.tied).toBe(4);             // die Staleness-Aussage bleibt
    });

    it('takes the one it covers best when the loop wants easier', () => {
      const d = decideWave(first(4), 40, [], () => 0, tie('easier'));
      expect(d.templateIdx).toBe(0);          // headroom 0.9
    });

    it('still rolls the dice without a tie break', () => {
      const picks = new Set<number>();
      for (let i = 0; i < 40; i++) picks.add(decideWave(first(4), 40, [], Math.random).templateIdx);
      expect(picks.size).toBeGreaterThan(1);
    });

    it('never picks the template of the wave just played', () => {
      // Template 1 hat die wenigste Luft, lief aber gerade. Template 0
      // gewinnt, egal was der Regler lieber hätte.
      const d = decideWave(first(2), 40, [1], () => 0, tie('harder'));
      expect(d.templateIdx).toBe(0);
    });

    it('treats a template with no reading as fully covered', () => {
      // Die vorsichtige Annahme: Ein unbekanntes Template wird nicht zum
      // Favoriten für "härter".
      const sparse: TieBreak = { prefer: 'harder', headroom: new Map([[0, 0.4]]) };
      expect(decideWave(first(3), 40, [], () => 0, sparse).templateIdx).toBe(0);
    });
  });
});
