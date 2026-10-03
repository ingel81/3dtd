import { describe, expect, it } from 'vitest';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { BotPerception } from '../../perception/bot-perception';
import { GIFT_MIN, GIFT_SHARE, GiftStrategy } from './gift.strategy';

/** A wave in which `mine` enemies leaked on route 'a' (the bot's) and `theirs` on route 'b' */
function perception(mine: number, theirs: number): BotPerception {
  const seen = new BotPerception((routeId) => routeId === 'a');
  seen.onWaveStarted(1);
  const leak = (routeId: string, i: number) => seen.onEnemyArrived({
    id: `${routeId}${i}`, movement: { routeId, getPathProgress: () => 1 }, typeConfig: {}, health: { maxHp: 10 },
    getEffectiveArmorType: () => 'light',
  });
  for (let i = 0; i < mine; i++) leak('a', i);
  for (let i = 0; i < theirs; i++) leak('b', i);
  seen.onWaveCompleted([]);
  return seen;
}

const state = (credits: number, phase = 'setup', waveNumber = 1) =>
  ({ phase, waveNumber, player: { credits } }) as unknown as GameStateSnapshot;

function gift(seen: BotPerception, partnerCredits: number) {
  const world = { perception: seen, partners: () => [{ id: 'bob', credits: partnerCredits, lanes: ['b'] }] };
  return new GiftStrategy(world as never);
}

describe('GiftStrategy', () => {
  it('sends a share of its gold to a partner who leaked more and runs short, once a wave', () => {
    const s = gift(perception(0, 5), 50);
    expect(s.execute(state(1000))).toEqual(expect.objectContaining({ type: 'give-credits', to: 'bob', amount: 1000 * GIFT_SHARE }));
    expect(s.canExecute(state(1000))).toBe(false);
    expect(s.canExecute(state(1000, 'setup', 2))).toBe(true);
  });

  it('keeps its gold when the partner held as well, has enough, or it has little itself', () => {
    expect(gift(perception(3, 3), 50).canExecute(state(1000))).toBe(false);
    expect(gift(perception(0, 5), 600).canExecute(state(1000))).toBe(false);
    expect(gift(perception(0, 5), 0).canExecute(state(GIFT_MIN - 1))).toBe(false);
    expect(gift(perception(0, 5), 50).canExecute(state(1000, 'wave'))).toBe(false);
  });

  it('sends nothing alone', () => {
    const world = { perception: perception(0, 5), partners: () => [] };
    expect(new GiftStrategy(world as never).canExecute(state(1000))).toBe(false);
  });
});
