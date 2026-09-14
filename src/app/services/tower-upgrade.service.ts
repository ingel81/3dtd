import { Injectable, inject } from '@angular/core';
import type { UpgradeId } from '../configs/tower-types.config';
import type { Tower } from '../entities/tower.entity';
import { GameStateManager } from '../managers/game-state.manager';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { firstAffordableUpgrade, upgradeRefusal, type UpgradeRefusal } from '../utils/player-actions';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { UpgradeHintService } from './upgrade-hint.service';

/**
 * Text rising over the tower after a purchase: --td-gold-light for what it
 * bought, --td-warn-orange when it bought nothing. Starts `lift` metres above
 * the tower's shoot height.
 */
const UPGRADE_TEXT = {
  bought: '#D9BC68',
  refused: '#C96A3A',
  durationMs: 1600,
  floatSpeed: 1.3,
  scale: 0.8,
  lift: 3,
} as const;

/** The short reason over the tower when nothing was bought; the panel line says more. */
function refusalLabel(refusal: UpgradeRefusal): string {
  switch (refusal.kind) {
    case 'credits': return `NEED ${refusal.missing} CREDITS`;
    case 'tier': return 'NEEDS RESEARCH';
    case 'maxed': return 'FULLY UPGRADED';
  }
}

/**
 * The player's upgrade purchases, and their answer on the map and in the
 * panel: the track and its new level rise over the tower and its tile
 * flashes, or the reason nothing was bought rises there and shows in the
 * tower's panel (UpgradeHintService). The bots buy through the facade and
 * get neither.
 *
 * Provided by the game component, because the facade it drives is.
 */
@Injectable()
export class TowerUpgradeService {
  private readonly facade = inject(TowerDefenseFacadeService);
  private readonly gameState = inject(GameStateManager);
  private readonly store = inject(TowerDefenseStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly upgradeHint = inject(UpgradeHintService);

  /**
   * U: buys the first track the player can afford (firstAffordableUpgrade),
   * or says why there is none (upgradeRefusal).
   * @returns true when it bought or showed the reason
   */
  buyFirst(tower: Tower): boolean {
    const credits = this.store.credits();
    const maxTier = this.researchStore.maxUpgradeTier();
    const upgradeId = firstAffordableUpgrade(tower, credits, maxTier);
    if (upgradeId) return this.purchase(tower, upgradeId);
    const refusal = upgradeRefusal(tower, credits, maxTier);
    if (!refusal) return false;
    this.refuse(tower, refusal);
    return true;
  }

  private purchase(tower: Tower, upgradeId: UpgradeId): boolean {
    if (!this.facade.upgradeTower(tower, upgradeId)) return false;
    this.upgradeHint.bought(tower.id, upgradeId);
    const name = tower.typeConfig.upgrades.find((u) => u.id === upgradeId)?.name ?? upgradeId;
    // The command ran synchronously on the bus, the level is the new one
    this.floatOverTower(tower, `${name.toUpperCase()} LV ${tower.getUpgradeLevel(upgradeId)}`, UPGRADE_TEXT.bought);
    return true;
  }

  private refuse(tower: Tower, refusal: UpgradeRefusal): void {
    this.upgradeHint.refused(tower.id, refusal);
    this.floatOverTower(tower, refusalLabel(refusal), UPGRADE_TEXT.refused);
  }

  private floatOverTower(tower: Tower, text: string, color: string): void {
    const effects = this.gameState.tilesEngine?.effects;
    if (!effects) return;
    const { lat, lon, height = 0 } = tower.position;
    const top = height + Math.max(tower.typeConfig.shootHeight, 0) + UPGRADE_TEXT.lift;
    effects.spawnFloatingText(text, lat, lon, top, {
      color,
      duration: UPGRADE_TEXT.durationMs,
      floatSpeed: UPGRADE_TEXT.floatSpeed,
      scale: UPGRADE_TEXT.scale,
    });
  }
}
