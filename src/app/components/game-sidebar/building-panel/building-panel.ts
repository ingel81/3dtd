import { ABILITIES, ABILITY_IDS, type AbilityId, type AbilityStatus } from '../../../configs/abilities.config';
import type { TowerTypeId } from '../../../configs/tower-types.config';
import { abilityButtonView } from '../../ability-bar/ability-button';

/** An ability that launches from the selected building, one line in its panel. */
export interface BuildingAbilityRow {
  id: AbilityId;
  name: string;
  /** Its key, upper case */
  hotkey: string;
  /** What its button in the ability bar says: "ready", "recharges in 2 waves" */
  status: string;
}

/**
 * The researched abilities that launch from a building of `typeId`
 * (AbilityConfig.launchFrom), in ABILITIES order, with the state their
 * button shows. Empty for a building nothing launches from.
 */
export function buildingAbilityRows(
  typeId: TowerTypeId,
  statuses: Readonly<Record<AbilityId, AbilityStatus>>,
  waveActive: boolean,
): BuildingAbilityRow[] {
  return ABILITY_IDS
    .filter((id) => ABILITIES[id].launchFrom === typeId && statuses[id].unlocked)
    .map((id) => {
      const config = ABILITIES[id];
      return {
        id,
        name: config.name,
        hotkey: config.hotkey.toUpperCase(),
        status: abilityButtonView(config, statuses[id], waveActive, false).status,
      };
    });
}
