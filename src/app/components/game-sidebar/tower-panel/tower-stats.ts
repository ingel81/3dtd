import {
  TARGETING_STRATEGIES,
  TargetingStrategyConfig,
  TowerTypeConfig,
} from '../../../configs/tower-types.config';
import type { TdIconName } from '../../icon/icon.component';

/** Map a damage-type to its td-icon name (config holds an emoji glyph). */
const DAMAGE_TYPE_ICON: Record<string, TdIconName> = {
  physical: 'sword',
  pierce: 'target',
  siege: 'bolt',
  magic: 'bolt',
  fire: 'flame',
  ice: 'splash',
  poison: 'skull',
};

export function damageTypeIcon(type: string): TdIconName {
  return DAMAGE_TYPE_ICON[type] ?? 'sword';
}

/**
 * Compute effective DPS for the tower-detail tile. Beam towers (Fire) use
 * damagePerSecond directly; projectile towers use damage × fireRate.
 */
export function towerDps(tower: {
  typeConfig: TowerTypeConfig;
  combat: { damage: number; fireRate: number };
}): number {
  const cfg = tower.typeConfig;
  if (cfg.attackType === 'beam') {
    return cfg.damagePerSecond ?? 0;
  }
  return tower.combat.damage * tower.combat.fireRate;
}

/**
 * Targeting-Buttons eines Towers. Air-Priorität gibt es nur für Tower, die
 * laut Basis-Config Boden und Luft treffen.
 */
export function targetingStrategiesFor(config: TowerTypeConfig): TargetingStrategyConfig[] {
  const canTargetAir = config.canTargetAir ?? false;
  const canTargetGround = config.canTargetGround ?? true;

  return TARGETING_STRATEGIES.filter((strategy) => {
    if (strategy.id === 'air-priority') {
      return canTargetAir && canTargetGround;
    }
    return true;
  });
}

/** Research, das eine Upgrade-Stufe freischaltet (Stufe 1 ist frei). */
const TIER_RESEARCH: Record<number, string> = {
  2: 'Advanced Weaponry',
  3: 'Master Engineering',
  4: 'Advanced Engineering',
  5: 'Transcendent Tech',
};

/** Tooltip einer gesperrten Upgrade-Stufe; null, solange sie freigeschaltet ist. */
export function upgradeTierLockReason(requiredTier: number, maxUnlockedTier: number): string | null {
  if (maxUnlockedTier >= requiredTier) return null;
  const research = TIER_RESEARCH[requiredTier];
  return research ? `Requires: ${research}` : null;
}
