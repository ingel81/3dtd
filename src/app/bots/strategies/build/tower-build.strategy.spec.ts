import { describe, expect, it, vi } from 'vitest';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { BOT_CONFIGS } from '../../bots/tower-bot.interface';
import { emptySides, threatFromWaves } from '../../decision/value';
import type { DecisionContext } from '../tower-strategy.interface';
import { TowerBuildStrategy } from './tower-build.strategy';

const unlocked = (ids: TowerTypeId[]) =>
  Object.fromEntries((Object.keys(TOWER_TYPES) as TowerTypeId[]).map((id) => [id, ids.includes(id)])) as Record<TowerTypeId, boolean>;

function state(ids: TowerTypeId[], towerCount = 0, waveNumber = 5): GameStateSnapshot {
  return {
    waveNumber,
    defense: { towerCount },
    research: { towerUnlocked: unlocked(ids), airTargetingUnlocked: false },
  } as unknown as GameStateSnapshot;
}

const context = (enemies: [string, number][], hp: [string, number][]): DecisionContext => ({
  threat: threatFromWaves([{
    wave: 1, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
    enemies, hpByArmor: hp as never,
  }]),
  capacity: emptySides(),
  metresByTower: new Map(),
  routes: 1,
  routeMetres: 700,
});

const best = { position: { lat: 48, lon: 9 }, reason: 'spot' };

function strategy(maxTowers = 40, standing = 0) {
  const placement = { findDistributedPositions: vi.fn(() => [best]), findStrategicPositions: vi.fn(() => [best]) };
  const towers = Array.from({ length: standing }, () => ({ typeConfig: TOWER_TYPES.archer }));
  const world = { getSpawnPoints: () => [], getCachedPaths: () => new Map(), towerManager: { getAll: () => towers } };
  const build = new TowerBuildStrategy(placement as never, world as never, { ...BOT_CONFIGS.expert, maxTowers }, 'distributed');
  return { build, placement };
}

describe('TowerBuildStrategy', () => {
  const zombies = context([['zombie', 1]], [['unarmored', 5000]]);

  it('proposes one tower of each unlocked combat type, at its cost', () => {
    const proposals = strategy().build.propose(state(['archer', 'cannon', 'research-center']), zombies);
    expect(proposals.map((p) => p.label).sort()).toEqual([TOWER_TYPES.archer.name, TOWER_TYPES.cannon.name].sort());
    expect(proposals.every((p) => p.kind === 'buy' && p.value > 0)).toBe(true);
    expect(proposals.find((p) => p.label === TOWER_TYPES.cannon.name)!.cost).toBe(TOWER_TYPES.cannon.cost);
  });

  it('proposes nothing at the tower cap', () => {
    expect(strategy(5).build.propose(state(['archer'], 5), zombies)).toEqual([]);
  });

  it('keeps the pace of a player: no more fighting towers by a wave than the tempo allows', () => {
    const { base, perWave } = BOT_CONFIGS.expert.buildTempo;
    const allowed = base + perWave * 2;
    expect(strategy(40, allowed - 1).build.propose(state(['archer'], allowed - 1, 2), zombies)).toHaveLength(1);
    expect(strategy(40, allowed).build.propose(state(['archer'], allowed, 2), zombies)).toEqual([]);
  });

  it('values a tower that cannot hurt the coming wave at nothing', () => {
    const bats = context([['bat', 1]], [['light', 5000]]);
    const cannon = strategy().build.propose(state(['cannon']), bats)[0];
    expect(cannon.value).toBe(0);
  });

  it('looks for the spot only when the arbiter takes the buy', () => {
    const { build, placement } = strategy();
    const [archer] = build.propose(state(['archer']), zombies);
    expect(placement.findDistributedPositions).not.toHaveBeenCalled();
    expect(archer.act()).toEqual(expect.objectContaining({ type: 'place', towerType: 'archer', position: { x: 9, z: 48 } }));
    expect(placement.findDistributedPositions).toHaveBeenCalledTimes(1);
  });
});
