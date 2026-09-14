import {
  TARGETING_STRATEGIES,
  TargetingStrategyConfig,
  TowerTypeConfig,
  UpgradeId,
} from '../../../configs/tower-types.config';
import { RECRUIT_NAME, VETERAN_RANKS, veteranLevel, veteranRank } from '../../../configs/veteran-ranks.config';
import type { UpgradeHint } from '../../../services/upgrade-hint.service';
import type { UpgradeRefusal } from '../../../utils/player-actions';
import type { TdIconName } from '../../icon/icon.component';

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

/** Anzeige-Werte des Tower-Details, ein Schnappschuss des mutablen Entities. */
export interface TowerStats {
  damage: number;
  fireRate: number;
  range: number;
  dps: number;
  kills: number;
  sellValue: number;
}

export function towerStats(tower: {
  typeConfig: TowerTypeConfig;
  combat: { damage: number; fireRate: number; range: number; kills: number };
  getSellValue(): number;
}): TowerStats {
  return {
    damage: tower.combat.damage,
    fireRate: tower.combat.fireRate,
    range: tower.combat.range,
    dps: towerDps(tower),
    kills: tower.combat.kills,
    sellValue: tower.getSellValue(),
  };
}

/** Rank row of the tower detail: insignia, name and the way to the next rank. */
export interface VeteranView {
  level: number;
  name: string;
  icon: TdIconName;
  gold: boolean;
  kills: number;
  /** Kills the next rank needs, null at the top */
  nextAt: number | null;
  /** Share of the way from this rank to the next, 0 to 1; 1 at the top */
  progress: number;
}

/** The insignia of a rank as a td-icon, drawn like the badge over the tower. */
function veteranIcon(chevrons: number, star: boolean): TdIconName {
  if (star) return 'star';
  if (chevrons >= 3) return 'chevrons3';
  if (chevrons === 2) return 'chevrons2';
  return 'caretU';
}

/** Rank row for a kill count. Below the first rank the single chevron stands for the one to come. */
export function veteranView(kills: number): VeteranView {
  const level = veteranLevel(kills);
  const rank = veteranRank(level);
  const next = veteranRank(level + 1);
  const from = rank?.minKills ?? 0;
  return {
    level,
    name: rank?.name ?? RECRUIT_NAME,
    icon: rank ? veteranIcon(rank.chevrons, rank.star) : 'caretU',
    gold: rank?.metal === 'gold',
    kills,
    nextAt: next?.minKills ?? null,
    progress: next ? (kills - from) / (next.minKills - from) : 1,
  };
}

/** Tooltip of the rank row: the ladder, and that it changes nothing in combat. */
export const VETERAN_TOOLTIP =
  'Rank from killing blows, cosmetic only: ' +
  VETERAN_RANKS.map((rank) => `${rank.name} ${rank.minKills}`).join(' · ');

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

/** What the upgrade section shows of the last U press (UpgradeHintService). */
export interface UpgradeKeyView {
  /** The tile U bought, it flashes; null for none */
  flashId: UpgradeId | null;
  /** Alternates per press: two classes with the same animation restart it */
  flashAlt: boolean;
  /** Why U bought nothing, null when it bought or shows nothing for this tower */
  refusalText: string | null;
}

const NO_KEY_VIEW: UpgradeKeyView = { flashId: null, flashAlt: false, refusalText: null };

/** The last U press as the panel of `tower` shows it; nothing when it was another tower. */
export function upgradeKeyView(
  hint: UpgradeHint | null,
  tower: { id: string; typeConfig: { upgrades: readonly { id: UpgradeId; name: string }[] } },
): UpgradeKeyView {
  if (!hint || hint.towerId !== tower.id) return NO_KEY_VIEW;
  const name = (id: UpgradeId) => tower.typeConfig.upgrades.find((u) => u.id === id)?.name ?? id;
  return {
    flashId: hint.upgradeId,
    flashAlt: hint.seq % 2 === 0,
    refusalText: hint.refusal ? upgradeRefusalText(hint.refusal, name) : null,
  };
}

/** The line in the upgrade section when U bought nothing. */
export function upgradeRefusalText(refusal: UpgradeRefusal, upgradeName: (id: UpgradeId) => string): string {
  switch (refusal.kind) {
    case 'credits':
      return `Need ${refusal.missing} more credits for ${upgradeName(refusal.upgradeId)}`;
    case 'tier':
      return `Research ${TIER_RESEARCH[refusal.tier] ?? `tier ${refusal.tier}`} for the next levels`;
    case 'maxed':
      return 'Fully upgraded';
  }
}
