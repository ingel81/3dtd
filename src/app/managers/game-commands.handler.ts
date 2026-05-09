import { GameEventBus, SubscriptionBag } from '../game-engine';
import { GameStateManager } from './game-state.manager';
import { getResearch } from '../configs/research/research-tree.config';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';

/**
 * GameCommandsHandler — Command-Bus-Adapter für GameStateManager.
 *
 * Vorher waren die `command:*`- und `debug:*`-Subscriptions inline in
 * GameStateManager.initialize() definiert (~150 Zeilen). Diese Klasse
 * trennt den "Game-Loop-Owner" (GSM) vom "Command-Bus-Adapter".
 *
 * Konstruktion: GSM erzeugt eine Instanz nach seiner eigenen Initialisierung
 * und ruft `dispose()` beim Cleanup. Der Handler hält keinen eigenen State —
 * alle Operationen delegieren auf GSM.
 */
export class GameCommandsHandler {
  private readonly subs = new SubscriptionBag();

  constructor(
    private readonly gsm: GameStateManager,
    private readonly eventBus: GameEventBus,
  ) {
    this.attachTowerCommands();
    this.attachResearchCommands();
    this.attachWaveCommands();
    this.attachDebugCommands();
  }

  dispose(): void {
    this.subs.disposeAll();
  }

  private attachTowerCommands(): void {
    this.subs.add(this.eventBus.on('command:place-tower', (event) => {
      this.gsm.placeTower(
        { lat: event.position.lat, lon: event.position.lon, height: event.position.height },
        event.typeId,
        event.rotation ?? 0,
      );
    }));

    this.subs.add(this.eventBus.on('command:sell-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.gsm.sellTower(tower);
      }
    }));

    this.subs.add(this.eventBus.on('command:upgrade-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (!tower) return;

      const upgradeId = event.upgradeId;
      const cost = tower.getNextUpgradeCost(upgradeId);
      if (cost <= 0 || !tower.canUpgrade(upgradeId)) return;

      // Tier-Gating: research-slots (Research Center) ist immer erlaubt.
      // Reguläre Tower-Upgrades brauchen ein passendes Upgrade-Tier-Research.
      // Phase 5.16: 25-Level-Tracks in 5er-Bändern (Mirror von
      // GameSidebarComponent.getRequiredUpgradeTier — synchron halten).
      //   L1-5 = T1, L6-10 = T2, L11-15 = T3, L16-20 = T4, L21-25 = T5
      if (upgradeId !== 'research-slots') {
        const currentLevel = tower.getUpgradeLevel(upgradeId);
        const requiredTier =
          currentLevel >= 20 ? 5 :
          currentLevel >= 15 ? 4 :
          currentLevel >= 10 ? 3 :
          currentLevel >= 5  ? 2 : 1;
        if (this.gsm.researchManager.getMaxUpgradeTier() < requiredTier) return;
      }

      if (this.gsm.spendCredits(cost)) {
        const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
        const previousLevel = tower.getUpgradeLevel(upgradeId);
        tower.applyUpgrade(upgradeId);

        // Research-Center-Slot-Upgrade
        if (upgrade?.effect.stat === 'research-slots' && tower.typeConfig.id === 'research-center') {
          this.gsm.researchManager.upgradeCenter();
        }

        // Range-Änderung → LOS-Cells neu berechnen, damit Targeting den neuen
        // Range nutzt; rangeSquaredGeo für Sleep-/Wake-Checks aktualisieren.
        if (upgrade?.effect.stat === 'range') {
          this.gsm.recomputeTowerRangeAfterUpgrade(tower);
        }

        this.eventBus.emit({
          type: 'tower:upgraded',
          tower,
          level: previousLevel + 1,
          cost,
        });
      }
    }));
  }

  private attachResearchCommands(): void {
    this.subs.add(this.eventBus.on('command:start-research', (event) => {
      const validation = this.gsm.researchManager.canStartResearch(event.researchId, this.gsm.credits());
      if (!validation.canStart) return;

      const research = getResearch(event.researchId);
      if (research && this.gsm.spendCredits(research.cost)) {
        this.gsm.researchManager.startResearch(event.researchId);
      }
    }));

    this.subs.add(this.eventBus.on('command:cancel-research', (event) => {
      const refund = this.gsm.researchManager.cancelResearch(event.researchId);
      if (refund > 0) {
        this.gsm.addCredits(refund);
      }
    }));
  }

  private attachWaveCommands(): void {
    this.subs.add(this.eventBus.on('command:start-wave', (event) => {
      if (event.config) {
        this.gsm.startWave(event.config);
      } else {
        this.gsm.beginWave();
      }
    }));

    this.subs.add(this.eventBus.on('command:restart-game', () => {
      this.gsm.reset();
    }));
  }

  private attachDebugCommands(): void {
    this.subs.add(this.eventBus.on('debug:add-credits', (event) => {
      this.gsm.addCredits(event.amount);
    }));

    this.subs.add(this.eventBus.on('debug:add-health', (event) => {
      const oldHealth = this.gsm.baseHealth();
      const newHealth = Math.max(0, oldHealth + event.amount);
      this.gsm.baseHealth.set(newHealth);
      this.eventBus.emit({
        type: 'health:changed',
        health: newHealth,
        delta: newHealth - oldHealth,
      });
    }));

    this.subs.add(this.eventBus.on('debug:complete-all-research', () => {
      this.gsm.researchManager.completeAllResearch();
    }));

    this.subs.add(this.eventBus.on('debug:max-upgrade-all-towers', () => {
      for (const tower of this.gsm.towerManager.getAll()) {
        let rangeChanged = false;
        for (const upgrade of tower.typeConfig.upgrades) {
          while (tower.canUpgrade(upgrade.id)) {
            if (!tower.applyUpgrade(upgrade.id)) break;
            if (upgrade.effect.stat === 'range') rangeChanged = true;
            if (upgrade.effect.stat === 'research-slots' && tower.typeConfig.id === 'research-center') {
              this.gsm.researchManager.upgradeCenter();
            }
          }
        }
        if (rangeChanged) {
          this.gsm.recomputeTowerRangeAfterUpgrade(tower);
        }
        this.eventBus.emit({ type: 'tower:upgraded', tower, level: 0, cost: 0 });
      }
    }));
  }
}

// Re-export tu Helper-Konstanten, falls weitere Module das brauchen.
export { METERS_PER_DEGREE_LAT, DEG_TO_RAD };
