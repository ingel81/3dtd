import type { DamageType } from '../../configs/combat/combat.types';
import type { TdIconName } from './icon.component';

/**
 * td-icon per damage type (DAMAGE_TYPE_UI holds emoji glyphs). One icon per
 * type, so a row of them, like the weaknesses in the NEXT line of the WAVE
 * panel, tells the types apart. Complete per DamageType.
 */
export const DAMAGE_TYPE_ICON: Readonly<Record<DamageType, TdIconName>> = {
  physical: 'sword',
  pierce: 'target',
  siege: 'burst',
  magic: 'sparkle',
  fire: 'flame',
  ice: 'snowflake',
  poison: 'splash',
  lightning: 'bolt',
  chaos: 'shuffle',
};

/** Icon of a damage type; an unknown one gets the sword. */
export function damageTypeIcon(type: string): TdIconName {
  return DAMAGE_TYPE_ICON[type as DamageType] ?? 'sword';
}
