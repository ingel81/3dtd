import {
  HERO,
  HERO_AMMO,
  HERO_AMMO_ORDER,
  HeroAmmoId,
  HeroStatus,
  heroLevelFor,
} from '../../../configs/hero.config';
import { ARMOR_TYPE_UI, DAMAGE_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { DAMAGE_MATRIX } from '../../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES, ArmorType } from '../../../configs/combat/combat.types';

/** One button of the ammo switch. */
export interface HeroAmmoButton {
  id: HeroAmmoId;
  /** Standard, Explosive, Rune */
  label: string;
  /** The damage type it deals */
  damageLabel: string;
  /** Colour of the damage type (DAMAGE_TYPE_UI) */
  color: string;
  active: boolean;
  /** Tooltip and accessible name: what it is best against among his ammo */
  tooltip: string;
}

/** What the hero panel shows, derived outside the template. */
export interface HeroPanelView {
  name: string;
  level: number;
  maxLevel: number;
  kills: number;
  /** "12 / 70 kills" toward the next level, "Top level" at the top */
  xpLabel: string;
  /** Share of the way to the next level, 0 to 100 */
  xpPercent: number;
  /** Damage per second of the loaded ammo with his level, before the matrix */
  dps: number;
  rangeM: number;
  /** On his way to an ordered spot, or holding it */
  status: string;
  ammo: HeroAmmoButton[];
}

export function heroPanelView(status: HeroStatus): HeroPanelView {
  const ammo = HERO_AMMO[status.ammo];
  const damage = ammo.damage * heroLevelFor(status.kills).damageMultiplier;
  const top = status.xpToNext === null;
  return {
    name: HERO.name,
    level: status.level,
    maxLevel: status.maxLevel,
    kills: status.kills,
    xpLabel: top ? 'Top level' : `${status.xp} / ${status.xpToNext} kills`,
    xpPercent: top ? 100 : Math.min(100, (status.xp / status.xpToNext!) * 100),
    dps: Math.round(damage * ammo.fireRate),
    rangeM: HERO.rangeM,
    status: status.mode === 'travel' ? 'On his way' : 'Holding his post',
    ammo: HERO_AMMO_ORDER.map((id) => ammoButton(id, id === status.ammo)),
  };
}

/** Armors this ammo hits hardest of all his ammo, by the damage matrix. */
export function bestArmorsFor(id: HeroAmmoId): ArmorType[] {
  const own = DAMAGE_MATRIX[HERO_AMMO[id].damageType];
  return ARMOR_TYPES.filter((armor) =>
    HERO_AMMO_ORDER.every((other) => own[armor] >= DAMAGE_MATRIX[HERO_AMMO[other].damageType][armor]),
  );
}

function ammoButton(id: HeroAmmoId, active: boolean): HeroAmmoButton {
  const ammo = HERO_AMMO[id];
  const damage = DAMAGE_TYPE_UI[ammo.damageType];
  const best = bestArmorsFor(id).map((armor) => ARMOR_TYPE_UI[armor].label).join(', ');
  return {
    id,
    label: ammo.name.replace(/ rounds$/, ''),
    damageLabel: damage.label,
    color: damage.color,
    active,
    tooltip: `${ammo.name}: ${damage.label} damage, his best against ${best}`,
  };
}
