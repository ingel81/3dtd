import { describe, expect, it } from 'vitest';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { BotPerception } from '../../perception/bot-perception';
import { BOT_CONFIGS } from '../../bots/tower-bot.interface';
import { emptySides, expectedMetres, sum, threatFromWaves, towerCapacity } from '../../decision/value';
import type { DecisionContext } from '../tower-strategy.interface';
import { IDLE_WAVES, TowerSellStrategy } from './tower-sell.strategy';

function tower(id: string, typeId: TowerTypeId, damage: number, levels = 0) {
  return {
    id,
    typeConfig: TOWER_TYPES[typeId],
    combat: { kills: 0, damageDealt: damage },
    getUpgradeLevel: () => levels,
  };
}

/** A perception that saw IDLE_WAVES waves, each tower dealing `damage` per wave */
function seen(towers: ReturnType<typeof tower>[]): BotPerception {
  const perception = new BotPerception();
  for (let wave = 1; wave <= IDLE_WAVES; wave++) {
    perception.onWaveStarted(wave);
    perception.onWaveCompleted(towers.map((t) => ({ id: t.id, combat: { kills: 0, damageDealt: t.combat.damageDealt * wave } })));
  }
  return perception;
}

/** The context of towers on these metres: their capacity is the defense's */
function context(metres: Record<string, number>, type: TowerTypeId = 'archer'): DecisionContext {
  const capacity = Object.values(metres)
    .reduce((acc, m) => sum(acc, towerCapacity(TOWER_TYPES[type], {}, false, { ground: m, air: m })), emptySides());
  return {
    threat: threatFromWaves([{
      wave: 1, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
      enemies: [['zombie', 1]], hpByArmor: [['unarmored', 5000]],
    }]),
    capacity,
    metresByTower: new Map(Object.entries(metres).map(([id, m]) => [id, { ground: m, air: m }])),
    routes: 1,
    routeMetres: 700,
  };
}

const unlocked = (ids: TowerTypeId[]) => Object.fromEntries((Object.keys(TOWER_TYPES) as TowerTypeId[]).map((id) => [id, ids.includes(id)]));
const state = (phase: string, waveNumber: number, credits: number, ids: TowerTypeId[] = ['archer']) => ({
  phase, waveNumber, player: { credits },
  research: { towerUnlocked: unlocked(ids), airTargetingUnlocked: false },
}) as unknown as GameStateSnapshot;

function strategy(towers: ReturnType<typeof tower>[]) {
  const world = { towerManager: { getAll: () => towers }, perception: seen(towers) };
  return new TowerSellStrategy(world as never, BOT_CONFIGS.expert);
}

describe('TowerSellStrategy', () => {
  const full = expectedMetres('archer', 1);

  it('sells a tower that sees little and did almost nothing, and then waits its cooldown', () => {
    const towers = [tower('blind', 'archer', 1), tower('a', 'archer', 500), tower('b', 'archer', 500)];
    const sell = strategy(towers);
    const [proposal] = sell.propose(state('wave', 4, 0), context({ blind: full * 0.1, a: full, b: full }));
    expect(proposal.kind).toBe('rule');
    expect(proposal.act()).toEqual(expect.objectContaining({ type: 'sell', towerId: 'blind' }));
    expect(sell.propose(state('wave', 4, 0), context({ blind: full * 0.1, a: full, b: full }))).toEqual([]);
  });

  it('keeps a quiet tower that sees the route: a backstop at the HQ end', () => {
    const towers = [tower('backstop', 'archer', 1), tower('a', 'archer', 500)];
    expect(strategy(towers).propose(state('wave', 4, 0), context({ backstop: full, a: full }))).toEqual([]);
  });

  it('makes room at its pace, in the build phase, for a type worth much more', () => {
    const { base, perWave } = BOT_CONFIGS.expert.buildTempo;
    const wave = 2;
    const towers = Array.from({ length: base + perWave * wave }, (_, i) => tower(`a${i}`, 'archer', 300));
    const metres = Object.fromEntries(towers.map((t) => [t.id, full]));
    const rich = state('setup', wave, 5000, ['archer', 'magic']);
    const [proposal] = strategy(towers).propose(rich, context(metres));
    expect(proposal?.act()).toEqual(expect.objectContaining({ type: 'sell' }));
    // Not in a wave, not without the gold for the better tower, not for an upgraded tower
    expect(strategy(towers).propose(state('wave', wave, 5000, ['archer', 'magic']), context(metres))).toEqual([]);
    expect(strategy(towers).propose(state('setup', wave, 10, ['archer', 'magic']), context(metres))).toEqual([]);
    const upgraded = towers.map((t) => tower(t.id, 'archer', 300, 1));
    expect(strategy(upgraded).propose(rich, context(metres))).toEqual([]);
  });

  it('does not sell what it just built', () => {
    const towers = [tower('blind', 'archer', 1), tower('a', 'archer', 500)];
    const world = { towerManager: { getAll: () => towers }, perception: new BotPerception() };
    expect(new TowerSellStrategy(world as never, BOT_CONFIGS.expert).propose(state('wave', 4, 0), context({ blind: 0, a: full }))).toEqual([]);
  });
});
