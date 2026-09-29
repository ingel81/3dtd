import { Injectable, inject } from '@angular/core';
import type { UpgradeId } from '../configs/tower-types.config';
import type { Tower } from '../entities/tower.entity';
import { SimClient } from '../sim/client/sim-client.service';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import {
  upgradePlan,
  upgradeRefusal,
  upgradeTrackRefusal,
  type UpgradeRefusal,
} from '../utils/player-actions';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { UpgradeHintService } from './upgrade-hint.service';
import { uiSound } from './ui-sound';

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
 * The player's upgrade purchases, from the U key (HotkeyService) and from a
 * click on an upgrade tile in the tower or research panel (the game
 * component), with one answer for both on the map and in the panel: the
 * track and its new level rise over the tower and its tile flashes, or the
 * reason nothing was bought rises there and shows in the tower's panel
 * (UpgradeHintService). The bots buy through the facade and get neither.
 *
 * Provided by the game component.
 */
@Injectable()
export class TowerUpgradeService {
  private readonly sim = inject(SimClient);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly store = inject(TowerDefenseStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly upgradeHint = inject(UpgradeHintService);

  /**
   * A click on an upgrade tile: buys that track `times` in a row as far as
   * the credits go (Shift 5, Ctrl 10, TODO E45), or says why not
   * (upgradeTrackRefusal), also on a tile that looks disabled.
   * @returns true when it bought
   */
  buy(tower: Tower, upgradeId: UpgradeId, times = 1): boolean {
    const credits = this.store.credits();
    const maxTier = this.researchStore.maxUpgradeTier();
    const plan = upgradePlan(tower, credits, maxTier, times, upgradeId);
    if (plan.length === 0) {
      const refusal = upgradeTrackRefusal(tower, upgradeId, credits, maxTier);
      if (refusal) this.refuse(tower, refusal);
      return false;
    }
    return this.purchase(tower, plan);
  }

  /**
   * U: buys the first track the player can afford (firstAffordableUpgrade),
   * `times` in a row as far as the credits go, or says why there is none
   * (upgradeRefusal).
   * @returns true when it bought or showed the reason
   */
  buyFirst(tower: Tower, times = 1): boolean {
    const credits = this.store.credits();
    const maxTier = this.researchStore.maxUpgradeTier();
    const plan = upgradePlan(tower, credits, maxTier, times, null);
    if (plan.length > 0) return this.purchase(tower, plan);
    const refusal = upgradeRefusal(tower, credits, maxTier);
    if (!refusal) return false;
    this.refuse(tower, refusal);
    return true;
  }

  /**
   * One command per step of the plan (upgradePlan counted the credits and
   * the levels); the simulation checks each again. They act at the next
   * tick, so the levels over the tower come from the plan: the shadow tower
   * still has the ones before.
   */
  private purchase(tower: Tower, plan: readonly UpgradeId[]): boolean {
    const levels = new Map<UpgradeId, number>();
    for (const upgradeId of plan) {
      this.sim.bus.emit({ type: 'command:upgrade-tower', towerId: tower.id, upgradeId });
      levels.set(upgradeId, (levels.get(upgradeId) ?? 0) + 1);
    }
    if (levels.size === 0) return false;
    for (const upgradeId of levels.keys()) this.upgradeHint.bought(tower.id, upgradeId);
    const [[first, count]] = levels;
    const name = tower.typeConfig.upgrades.find((u) => u.id === first)?.name ?? first;
    const text = levels.size > 1
      ? `${[...levels.values()].reduce((a, b) => a + b, 0)} UPGRADES`
      : `${name.toUpperCase()} ${count > 1 ? `+${count}` : `LV ${tower.getUpgradeLevel(first) + 1}`}`;
    this.floatOverTower(tower, text, UPGRADE_TEXT.bought);
    return true;
  }

  private refuse(tower: Tower, refusal: UpgradeRefusal): void {
    uiSound.play(refusal.kind === 'credits' ? 'noMoney' : 'denied');
    this.upgradeHint.refused(tower.id, refusal);
    this.floatOverTower(tower, refusalLabel(refusal), UPGRADE_TEXT.refused);
  }

  private floatOverTower(tower: Tower, text: string, color: string): void {
    const effects = this.engineInit.getEngine()?.effects;
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
