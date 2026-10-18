import type { EnemyTypeId } from '../configs/enemy-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { ResearchTreeId } from '../configs/research/research-tree.config';
import type { Messages } from './messages/en';

/*
 * Names by an id that came as a plain string (a save, a log, the network,
 * the simulation's events): the id itself where this build has no text for
 * it, an older or a newer id.
 */

export function towerName(t: Messages, id: string): string {
  return t.names.towers[id as TowerTypeId] ?? id;
}

export function enemyName(t: Messages, id: string): string {
  return t.names.enemies[id as EnemyTypeId] ?? id;
}

export function researchName(t: Messages, id: string): string {
  return t.research[id as ResearchTreeId]?.name ?? id;
}

export function researchDescription(t: Messages, id: string): string {
  return t.research[id as ResearchTreeId]?.description ?? '';
}
