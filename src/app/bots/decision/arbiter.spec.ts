import { describe, expect, it, vi } from 'vitest';
import { arbitrate, Proposal, ProposalKind, SAVE_MARGIN } from './arbiter';

function proposal(kind: ProposalKind, label: string, cost = 0, value = 0, act: Proposal['act'] = () => ({ type: 'place', reason: label })): Proposal {
  return { kind, label, cost, value, act };
}

const reasonOf = (input: Parameters<typeof arbitrate>[0]) => arbitrate(input).reason ?? '';

describe('arbitrate', () => {
  it('takes a rule before anything else, in the order given, past one that cannot act', () => {
    const proposals = [
      proposal('buy', 'cheap tower', 10, 100),
      proposal('rule', 'nuke', 0, 0, () => null),
      proposal('rule', 'frost'),
      proposal('rule', 'emp'),
    ];
    expect(reasonOf({ proposals, credits: 1000, safe: true })).toBe('frost');
  });

  it('takes the buy with the most value per gold, not the most value', () => {
    const proposals = [proposal('buy', 'upgrade', 400, 40), proposal('buy', 'tower', 100, 20)];
    expect(reasonOf({ proposals, credits: 1000, safe: true })).toMatch(/^tower \(value\/gold/);
  });

  it('saves for a dearer buy that is clearly better per gold, and starts the wave meanwhile', () => {
    const tower = vi.fn(() => ({ type: 'place' as const, reason: 'archer' }));
    const proposals = [
      proposal('buy', 'archer', 50, 10, tower),
      proposal('buy', 'magic', 200, 10 * 4 * SAVE_MARGIN * 1.1),
      proposal('wave', 'next wave', 0, 0, () => ({ type: 'start-wave', reason: 'go' })),
    ];
    expect(arbitrate({ proposals, credits: 100, safe: true }).type).toBe('start-wave');
    expect(tower).not.toHaveBeenCalled();
    expect(reasonOf({ proposals: proposals.slice(0, 2), credits: 100, safe: true })).toMatch(/^Saving for magic/);
  });

  it('does not save for the far future', () => {
    const proposals = [proposal('buy', 'archer', 50, 10), proposal('buy', 'chaos', 5000, 100000)];
    expect(reasonOf({ proposals, credits: 100, safe: true })).toMatch(/^archer/);
  });

  it('researches while the last wave held, and builds first while it leaked', () => {
    const proposals = [proposal('research', 'research', 100), proposal('buy', 'tower', 100, 10)];
    expect(reasonOf({ proposals, credits: 500, safe: true })).toBe('research');
    expect(reasonOf({ proposals, credits: 500, safe: false })).toMatch(/^tower/);
  });

  it('researches after a leak when there is nothing to buy', () => {
    const proposals = [proposal('research', 'research', 100)];
    expect(reasonOf({ proposals, credits: 500, safe: false })).toBe('research');
  });

  it('starts the wave once nothing else acts, and waits without a wave to start', () => {
    const wave = proposal('wave', 'next wave', 0, 0, () => ({ type: 'start-wave', reason: 'go' }));
    expect(arbitrate({ proposals: [proposal('buy', 'tower', 500, 10), wave], credits: 100, safe: true }).type)
      .toBe('start-wave');
    expect(arbitrate({ proposals: [], credits: 100, safe: true })).toEqual({ type: 'wait', reason: 'Nothing worth doing' });
  });

  it('ranks buys by their value after the spread, drawn once per buy', () => {
    const proposals = [proposal('buy', 'a', 100, 10), proposal('buy', 'b', 100, 9)];
    const draws: number[] = [];
    const jitter = (value: number) => { draws.push(value); return value === 9 ? 20 : value; };
    expect(reasonOf({ proposals, credits: 500, safe: true, jitter })).toMatch(/^b/);
    expect(draws).toEqual([10, 9]);
  });

  it('skips a buy whose action cannot be worked out (no spot) for the next best', () => {
    const proposals = [proposal('buy', 'blocked', 100, 100, () => null), proposal('buy', 'other', 100, 50)];
    expect(reasonOf({ proposals, credits: 500, safe: true })).toMatch(/^other/);
  });
});
