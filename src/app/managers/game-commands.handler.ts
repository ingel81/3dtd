import { GameEventBus, SubscriptionBag } from '../game-engine';
import { GameStateManager } from './game-state.manager';
import { getResearch } from '../configs/research/research-tree.config';
import { ABILITIES } from '../configs/abilities.config';
import { HERO } from '../configs/hero.config';

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
    this.attachHeroCommands();
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
        event.plinthHeight ?? 0,
        event.plinthOverhang ?? [],
      );
    }));

    this.subs.add(this.eventBus.on('command:sell-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.gsm.sellTower(tower);
      }
    }));

    // Kosten, Tier-Gating und tower:upgraded: TowerLifecycle.upgrade()
    this.subs.add(this.eventBus.on('command:upgrade-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.gsm.upgradeTower(tower, event.upgradeId);
      }
    }));

    this.subs.add(this.eventBus.on('command:set-targeting', (event) => {
      const tower = this.gsm.towerManager.getById(event.towerId);
      if (!tower) return;
      if (event.strategy) tower.targetingStrategy = event.strategy;
      if (event.airSubStrategy) tower.airSubStrategy = event.airSubStrategy;
    }));

    this.subs.add(this.eventBus.on('command:set-hold-fire', (event) => {
      const tower = this.gsm.towerManager.getById(event.towerId);
      if (tower) this.gsm.setTowerHoldFire(tower, event.holdFire);
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

  private attachHeroCommands(): void {
    // The manager validates (research, credits, route in reach) and answers
    // with hero:state-changed or hero:rejected. The way to a move target is
    // computed here, inside the command, from the routes alone.
    this.subs.add(this.eventBus.on('command:hire-hero', () => {
      this.gsm.heroManager.hire();
    }));

    this.subs.add(this.eventBus.on('command:hero-move', (event) => {
      this.gsm.heroManager.moveTo({
        lat: event.target.lat,
        lon: event.target.lon,
        height: event.target.height,
      });
    }));

    this.subs.add(this.eventBus.on('command:hero-ammo', (event) => {
      this.gsm.heroManager.setAmmo(event.ammo);
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
      this.gsm.adjustBaseHealth(event.amount);
    }));

    this.subs.add(this.eventBus.on('debug:complete-all-research', () => {
      this.gsm.researchManager.completeAllResearch();
    }));

    this.subs.add(this.eventBus.on('debug:max-upgrade-all-towers', () => {
      this.gsm.maxUpgradeAllTowers();
    }));

    // The ability's research with its prerequisites (the research unlocks it
    // with full charges), then full charges again on every further click
    this.subs.add(this.eventBus.on('debug:ready-ability', (event) => {
      this.gsm.researchManager.completeResearch(ABILITIES[event.abilityId].researchId);
      this.gsm.abilityManager.refillCharges(event.abilityId);
    }));

    // Between waves only; refused otherwise, see GameStateManager.jumpToWave
    this.subs.add(this.eventBus.on('debug:jump-to-wave', (event) => {
      this.gsm.jumpToWave(event.wave, event.grantGold);
    }));

    // The hero's research with its prerequisites, then the hire for free;
    // once he is hired a further click changes nothing
    this.subs.add(this.eventBus.on('debug:ready-hero', () => {
      this.gsm.researchManager.completeResearch(HERO.researchId);
      if (this.gsm.heroManager.checkHire() === null) this.gsm.heroManager.hire(0);
    }));
  }
}
