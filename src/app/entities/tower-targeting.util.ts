/**
 * Tower-Targeting-Regeln, die von Gameplay UND AI gebraucht werden.
 * Liegt bewusst in entities/, damit ai/ → entities/ importieren kann
 * ohne den umgekehrten Weg (entities/ → ai/) zu öffnen.
 */

import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';

/** Tower-Typen, die durch das `aa-retrofit`-Research zusätzlich Air-Targeting bekommen. */
const AA_RETROFIT_TOWERS: ReadonlySet<TowerTypeId> = new Set<TowerTypeId>(['dual-gatling']);

/**
 * Liefert true, wenn der Tower Air-Units beschießen darf.
 *
 * Das statische `canTargetAir`-Flag in der Tower-Config ist die Baseline.
 * Das `aa-retrofit`-Research whitelisted `dual-gatling`, sodass dieser Tower
 * nach Freischaltung ebenfalls Air-Targets angreifen kann.
 */
export function canTargetAirEffective(
  typeId: TowerTypeId,
  airTargetingUnlocked: boolean,
): boolean {
  const cfg = TOWER_TYPES[typeId];
  if (cfg.canTargetAir ?? false) return true;
  return airTargetingUnlocked && AA_RETROFIT_TOWERS.has(typeId);
}
