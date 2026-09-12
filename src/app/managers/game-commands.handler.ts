import { GameEventBus, SubscriptionBag } from '../game-engine';
import { requiredUpgradeTier } from '../configs/tower-types.config';
import { GameStateManager } from './game-state.manager';
import { getResearch } from '../configs/research/research-tree.config';

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
    this.attachAbilityCommands();
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
      // Die Bandregel lebt in requiredUpgradeTier() — Sidebar und Trainings-Bot
      // nutzen dieselbe Funktion, damit die drei nicht auseinanderlaufen.
      if (upgradeId !== 'research-slots') {
        const requiredTier = requiredUpgradeTier(tower.getUpgradeLevel(upgradeId));
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

    // Queued researches are charged when they start (sub-step, see
    // ResearchManager.startQueued), so neither command touches the credits.
    this.subs.add(this.eventBus.on('command:queue-research', (event) => {
      this.gsm.researchManager.queueResearch(event.researchId);
    }));

    this.subs.add(this.eventBus.on('command:unqueue-research', (event) => {
      this.gsm.researchManager.unqueueResearch(event.researchId);
    }));
  }

  private attachAbilityCommands(): void {
    // The manager validates (research, charge, wave, route in reach) and
    // answers with ability:used or ability:rejected.
    this.subs.add(this.eventBus.on('command:use-ability', (event) => {
      this.gsm.abilityManager.use(event.abilityId, {
        lat: event.target.lat,
        lon: event.target.lon,
        height: event.target.height,
      });
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
