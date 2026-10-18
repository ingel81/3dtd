import {
  TARGETING_STRATEGIES,
  TargetingStrategyConfig,
  TowerTypeConfig,
  UpgradeId,
  type UpgradeText,
} from '../../../configs/tower-types.config';
import { VETERAN_RANKS, veteranLevel, veteranRank } from '../../../configs/veteran-ranks.config';
import type { UpgradeHint } from '../../../services/upgrade-hint.service';
import type { UpgradeRefusal } from '../../../utils/player-actions';
import type { TdIconName } from '../../icon/icon.component';
import type { Messages } from '../../../i18n/messages/en';
import type { ResearchTreeId } from '../../../configs/research/research-tree.config';

/**
 * Compute effective DPS for the tower-detail tile. Beam towers (Fire) use
 * damagePerSecond directly, a laser its cold damage per second; projectile
 * towers use damage × fireRate.
 */
export function towerDps(tower: {
  typeConfig: TowerTypeConfig;
  combat: { damage: number; fireRate: number };
}): number {
  const cfg = tower.typeConfig;
  if (cfg.attackType === 'beam') {
    return cfg.damagePerSecond ?? 0;
  }
  // A laser's damage is per second, cold; the fire rate is its heat-up
  if (cfg.attackType === 'laser') return tower.combat.damage;
  // A saw's damage is per second and arm, times its chain speed
  // A stream's damage is per second at full drive, times its drive track
  if (cfg.attackType === 'stream') return tower.combat.damage * tower.combat.fireRate;
  if (cfg.attackType === 'saw') return tower.combat.damage * tower.combat.fireRate * (cfg.sawArms?.length ?? 1);
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
export function veteranView(t: Messages, kills: number): VeteranView {
  const level = veteranLevel(kills);
  const rank = veteranRank(level);
  const next = veteranRank(level + 1);
  const from = rank?.minKills ?? 0;
  return {
    level,
    name: rank ? t.veteranRanks[rank.level] : t.hud.tower.recruit,
    icon: rank ? veteranIcon(rank.chevrons, rank.star) : 'caretU',
    gold: rank?.metal === 'gold',
    kills,
    nextAt: next?.minKills ?? null,
    progress: next ? (kills - from) / (next.minKills - from) : 1,
  };
}

/** Tooltip of the rank row: the ladder, and that it changes nothing in combat. */
export function veteranTooltip(t: Messages): string {
  return t.hud.tower.rankTip(VETERAN_RANKS.map((rank) => `${t.veteranRanks[rank.level]} ${rank.minKills}`).join(' | '));
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
const TIER_RESEARCH: Record<number, ResearchTreeId> = {
  2: 'advanced-weaponry',
  3: 'master-engineering',
  4: 'advanced-engineering',
  5: 'transcendent-tech',
};

/** Tooltip einer gesperrten Upgrade-Stufe; null, solange sie freigeschaltet ist. */
export function upgradeTierLockReason(t: Messages, requiredTier: number, maxUnlockedTier: number): string | null {
  if (maxUnlockedTier >= requiredTier) return null;
  const research = TIER_RESEARCH[requiredTier];
  return research ? t.hud.tower.requires(t.research[research].name) : null;
}

/** What the upgrade section shows of the last U press or tile click (UpgradeHintService). */
export interface UpgradeHintView {
  /** The tile that was bought, it flashes; null for none */
  flashId: UpgradeId | null;
  /** Alternates per purchase: two classes with the same animation restart it */
  flashAlt: boolean;
  /** Why nothing was bought, null when it was or when it shows nothing for this tower */
  refusalText: string | null;
}

const NO_HINT_VIEW: UpgradeHintView = { flashId: null, flashAlt: false, refusalText: null };

/** The last U press or tile click as the panel of `tower` shows it; nothing when it was another tower. */
export function upgradeHintView(
  t: Messages,
  hint: UpgradeHint | null,
  tower: { id: string; typeConfig: { upgrades: readonly { id: UpgradeId; text: UpgradeText }[] } },
): UpgradeHintView {
  if (!hint || hint.towerId !== tower.id) return NO_HINT_VIEW;
  const name = (id: UpgradeId) => {
    const upgrade = tower.typeConfig.upgrades.find((u) => u.id === id);
    return upgrade ? t.upgrades[upgrade.text].name : id;
  };
  return {
    flashId: hint.upgradeId,
    flashAlt: hint.seq % 2 === 0,
    refusalText: hint.refusal ? upgradeRefusalText(t, hint.refusal, name) : null,
  };
}

/** The line in the upgrade section when U or a tile click bought nothing. */
export function upgradeRefusalText(t: Messages, refusal: UpgradeRefusal, upgradeName: (id: UpgradeId) => string): string {
  const says = t.hud.tower;
  switch (refusal.kind) {
    case 'credits':
      return says.needCredits(refusal.missing, upgradeName(refusal.upgradeId));
    case 'tier': {
      const research = TIER_RESEARCH[refusal.tier];
      return says.researchTier(research ? t.research[research].name : says.tierN(refusal.tier));
    }
    case 'maxed':
      return says.maxed;
    case 'building':
      return says.underConstruction;
  }
}
