import { describe, expect, it } from 'vitest';
import { BOT_SKIPPED_RESEARCH, ResearchPickStrategy } from './research-pick.strategy';
import { BOT_CONFIGS, BotSkillLevel } from '../../bots/tower-bot.interface';
import { createEmptySnapshot, GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { getAllResearchIds, getResearch } from '../../../configs/research/research-tree.config';
import { HERO } from '../../../configs/hero.config';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import { emptySides, sum, threatFromWaves, towerCapacity } from '../../decision/value';
import type { DecisionContext } from '../tower-strategy.interface';

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

describe('the beginner research order', () => {
  it('reaches tier 4, so its upgrades do not stop at level 5', () => {
    // With only gatling-tech every branch stood at the tier-1 ceiling by wave
    // twelve and the bot sat on its gold for the rest of the run.
    const order = new ResearchPickStrategy(BOT_CONFIGS.beginner) as unknown as {
      researchOrderBySkill: Record<string, string[]>;
    };
    const beginner = order.researchOrderBySkill['beginner'] ?? [];

    expect(beginner).toContain('advanced-weaponry');      // tier 2
    expect(beginner).toContain('master-engineering');     // tier 3
    expect(beginner).toContain('advanced-engineering');   // tier 4
    expect(beginner).not.toContain('transcendent-tech');  // not the last tech
  });

  it('brings the prerequisites of the tier line with it', () => {
    const order = new ResearchPickStrategy(BOT_CONFIGS.beginner) as unknown as {
      researchOrderBySkill: Record<string, string[]>;
    };
    const beginner = order.researchOrderBySkill['beginner'] ?? [];

    for (const prerequisite of getResearch('advanced-weaponry')?.prerequisites ?? []) {
      expect(beginner.indexOf(prerequisite)).toBeGreaterThanOrEqual(0);
      expect(beginner.indexOf(prerequisite)).toBeLessThan(beginner.indexOf('advanced-weaponry'));
    }
  });

  it('stays narrower than the expert: no answers to armor types', () => {
    const order = new ResearchPickStrategy(BOT_CONFIGS.beginner) as unknown as {
      researchOrderBySkill: Record<string, string[]>;
    };
    const beginner = order.researchOrderBySkill['beginner'] ?? [];

    expect(beginner).not.toContain('rocketry');       // anti-air
    expect(beginner).not.toContain('aa-retrofit');
    expect(beginner.length).toBeLessThan((order.researchOrderBySkill['expert'] ?? []).length);
  });
});

describe('research as a proposal (B3)', () => {
  /** Ten archers against a wave of zombies, every other tower locked, late enough for every research */
  function archerRun(slotsUsed = 0): { state: GameStateSnapshot; context: DecisionContext } {
    const state = stateWith([]);
    state.waveNumber = 40;
    state.research.slotsUsed = slotsUsed;
    state.research.maxSlots = 1;
    state.research.towerUnlocked = Object.fromEntries(
      (Object.keys(TOWER_TYPES) as TowerTypeId[]).map((id) => [id, id === 'archer'])) as Record<TowerTypeId, boolean>;
    const archer = towerCapacity(TOWER_TYPES.archer, {}, false, { ground: 40, air: 40 });
    let capacity = emptySides();
    for (let i = 0; i < 10; i++) capacity = sum(capacity, archer);
    const context: DecisionContext = {
      threat: threatFromWaves([{
        wave: 41, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
        enemies: [['tank', 1]], hpByArmor: [['heavy', 20000]],
      }]),
      capacity, metresByTower: new Map(), routes: 1, routeMetres: 700,
    };
    return { state, context };
  }

  it('is a buy when it unlocks a tower better per gold than the archer, worth that gain', () => {
    const { state, context } = archerRun();
    const [proposal] = new ResearchPickStrategy(BOT_CONFIGS.expert).propose(state, context);
    expect(proposal.kind).toBe('buy');
    expect(proposal.value).toBeGreaterThan(0);
    expect(proposal.act()?.type).toBe('research-start');
  });

  it('asks for another slot of the research center when every slot is busy', () => {
    const { state, context } = archerRun(1);
    const center = {
      id: 'rc',
      typeConfig: TOWER_TYPES['research-center'],
      getAvailableUpgrades: () => TOWER_TYPES['research-center'].upgrades,
      getNextUpgradeCost: () => 300,
    };
    const world = { towerManager: { getAll: () => [center] } };
    const [slot] = new ResearchPickStrategy(BOT_CONFIGS.expert, world as never).propose(state, context);
    expect(slot.label).toBe('Research slot');
    expect(slot.cost).toBe(300);
    expect(slot.act()).toEqual(expect.objectContaining({ type: 'upgrade', towerId: 'rc', upgradeId: 'research-slots' }));
    // Without a slot to buy, nothing
    expect(new ResearchPickStrategy(BOT_CONFIGS.expert).propose(state, context)).toEqual([]);
  });
});
