import { describe, expect, it } from 'vitest';
import { BOT_SKIPPED_RESEARCH, ResearchPickStrategy } from './research-pick.strategy';
import { BOT_CONFIGS, BotSkillLevel } from '../../bots/tower-bot.interface';
import { createEmptySnapshot, GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { getAllResearchIds } from '../../../configs/research/research-tree.config';
import { HERO } from '../../../configs/hero.config';

const SKILLS: BotSkillLevel[] = ['beginner', 'expert'];

/** A snapshot with a research center, free slots, plenty of credits and `completed` done. */
function stateWith(completed: string[], armorMix = false): GameStateSnapshot {
  const state = createEmptySnapshot();
  state.player.credits = 1_000_000;
  state.research = {
    ...state.research,
    completedIds: completed,
    centerLevel: 1,
    slotsUsed: 0,
    maxSlots: 3,
  };
  if (armorMix) {
    state.expectedArmorDistribution = { unarmored: 0.2, light: 0.2, heavy: 0.2, fortified: 0.2, ethereal: 0.2 };
  }
  return state;
}

describe('ResearchPickStrategy', () => {
  it('leaves the mercenary research to the player: bots never hire the hero', () => {
    expect(BOT_SKIPPED_RESEARCH.has(HERO.researchId)).toBe(true);
  });

  it('never picks it, even when it is the only research left', () => {
    const allButHero = getAllResearchIds().filter((id) => id !== HERO.researchId);
    for (const skill of SKILLS) {
      const strategy = new ResearchPickStrategy(BOT_CONFIGS[skill]);
      for (const armorMix of [false, true]) {
        const state = stateWith(allButHero, armorMix);
        expect(strategy.canExecute(state)).toBe(false);
        expect(strategy.execute(state)).toBeNull();
      }
    }
  });

  it('picks something else while it is available', () => {
    // Its prerequisites are done, as early as the bot can get there
    const state = stateWith(['gatling-tech', 'siege-engineering'], true);
    for (const skill of ['expert', 'expert'] as BotSkillLevel[]) {
      const action = new ResearchPickStrategy(BOT_CONFIGS[skill]).execute(state);
      expect(action?.type).toBe('research-start');
      expect(action?.researchId).not.toBe(HERO.researchId);
    }
  });
});
