/**
 * Tower-Targeting-Regeln, die von Gameplay UND AI gebraucht werden.
 * Liegt bewusst in entities/, damit ai/ → entities/ importieren kann
 * ohne den umgekehrten Weg (entities/ → ai/) zu öffnen.
 */

import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { getTowerPath } from '../configs/tower-paths.config';

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

/**
 * Liefert true, wenn der Tower Boden-Units beschießen darf: das `canTargetGround`-Flag der Config, oder ein
 * Pfad mit `groundDamageShare` (Rocket „Multirole“, configs/tower-paths.config.ts).
 */
export function canTargetGroundEffective(typeId: TowerTypeId, pathId: string | null | undefined): boolean {
  if (TOWER_TYPES[typeId].canTargetGround ?? true) return true;
  return (getTowerPath(pathId)?.groundDamageShare ?? 0) > 0;
}

/**
 * Anteil seines Schadens, den ein Schuss eines Towers mit Pfad `pathId` einem Boden-Gegner macht: 1, außer
 * der Pfad gibt einem Luft-Tower den Boden mit `groundDamageShare`.
 */
export function groundDamageShareOf(pathId: string | null | undefined): number {
  return getTowerPath(pathId)?.groundDamageShare ?? 1;
}
