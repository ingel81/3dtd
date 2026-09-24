import { GameEventBus, SubscriptionBag } from '../game-engine';
import type { GameEvent } from '../game-engine/game-event-bus';
import { GameStateManager } from './game-state.manager';
import { CommandLog, type CommandLogEntry } from './game-state/command-log';
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
 * und ruft `dispose()` beim Cleanup. Der Spielzustand liegt im GSM, alle
 * Operationen delegieren dorthin.
 *
 * Sub-step boundary (docs/EVENT_SYSTEM.md, "Befehlsgrenze und Befehlslog"):
 * a command takes effect between two complete sub-steps, never inside one.
 * One that arrives while a step runs (a listener reacting to a sim event)
 * waits in `pending` until the GSM ends the step with endStep(). One from
 * the UI between frames is at a boundary already and runs at once. Every
 * command (and every cheat handled here) is written to the CommandLog as it
 * takes effect, refused ones as well.
 */
export class GameCommandsHandler {
  private readonly subs = new SubscriptionBag();
  /** Command type to what it does, see on() */
  private readonly executors = new Map<string, (event: GameEvent) => void>();
  /** A sub-step is running, see beginStep() */
  private inStep = false;
  /** Commands that arrived during the running step, in arrival order */
  private readonly pending: GameEvent[] = [];

  constructor(
    private readonly gsm: GameStateManager,
    private readonly eventBus: GameEventBus,
    private readonly log: CommandLog = new CommandLog(),
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
    this.pending.length = 0;
  }

  /** A sub-step starts: commands wait for its end from here. */
  beginStep(): void {
    this.inStep = true;
  }

  /**
   * The sub-step is complete, checks included: the boundary. The commands
   * that came in during it take effect now, in arrival order. One they
   * emit in turn runs at once, the step is over.
   */
  endStep(): void {
    this.inStep = false;
    if (this.pending.length === 0) return;
    for (const event of this.pending) this.execute(event);
    this.pending.length = 0;
  }

  /**
   * Run a logged command again through the same path as the live one, for a
   * re-simulation that has reached the entry's boundary. It is logged again,
   * so a faithful re-simulation writes the same log.
   */
  replay(entry: CommandLogEntry): void {
    this.receive(entry.command as unknown as GameEvent);
  }

  /** Subscribe `type` to the boundary and the log, `run` is what it does. */
  private on<T extends GameEvent['type']>(type: T, run: (event: Extract<GameEvent, { type: T }>) => void): void {
    this.executors.set(type, run as (event: GameEvent) => void);
    this.subs.add(this.eventBus.on(type, this.receive as (event: Extract<GameEvent, { type: T }>) => void));
  }

  private readonly receive = (event: GameEvent): void => {
    if (this.inStep) {
      this.pending.push(event);
      return;
    }
    this.execute(event);
  };

  private execute(event: GameEvent): void {
    const run = this.executors.get(event.type);
    if (!run) return;
    this.log.record(event);
    // Caught like a throwing listener on the bus: a held command runs from
    // the GSM's loop, and one bad command must not stop the frame
    try {
      run(event);
    } catch (err) {
      console.error(`[GameCommandsHandler] '${event.type}' threw:`, err);
    }
  }

  private attachTowerCommands(): void {
    this.on('command:place-tower', (event) => {
      this.gsm.placeTower(
        { lat: event.position.lat, lon: event.position.lon, height: event.position.height },
        event.typeId,
        event.rotation ?? 0,
        event.plinthHeight ?? 0,
        event.plinthOverhang ?? [],
      );
    });

    this.on('command:sell-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.gsm.sellTower(tower);
      }
    });

    // Kosten, Tier-Gating und tower:upgraded: TowerLifecycle.upgrade()
    this.on('command:upgrade-tower', (event) => {
      const tower = this.gsm.towerManager.getAll().find(t => t.id === event.towerId);
      if (tower) {
        this.gsm.upgradeTower(tower, event.upgradeId);
      }
    });

    this.on('command:set-targeting', (event) => {
      const tower = this.gsm.towerManager.getById(event.towerId);
      if (!tower) return;
      if (event.strategy) tower.targetingStrategy = event.strategy;
      if (event.airSubStrategy) tower.airSubStrategy = event.airSubStrategy;
    });

    this.on('command:set-hold-fire', (event) => {
      const tower = this.gsm.towerManager.getById(event.towerId);
      if (tower) this.gsm.setTowerHoldFire(tower, event.holdFire);
    });

    // Manning a tower (docs/TOWER_CONTROL.md): get in and out, aim, trigger
    this.on('command:man-tower', (event) => {
      const tower = this.gsm.towerManager.getById(event.towerId);
      if (tower) this.gsm.manTower(tower);
    });

    this.on('command:leave-tower', () => {
      this.gsm.leaveTower();
    });

    this.on('command:tower-trigger', (event) => {
      this.gsm.setMannedTrigger(event.held);
    });

    this.on('command:tower-aim', (event) => {
      this.gsm.setMannedAim(event.heading, event.pitch);
    });
  }

  private attachResearchCommands(): void {
    this.on('command:start-research', (event) => {
      const validation = this.gsm.researchManager.canStartResearch(event.researchId, this.gsm.credits());
      if (!validation.canStart) return;

      const research = getResearch(event.researchId);
      if (research && this.gsm.spendCredits(research.cost, 'research')) {
        this.gsm.researchManager.startResearch(event.researchId);
      }
    });

    this.on('command:cancel-research', (event) => {
      const refund = this.gsm.researchManager.cancelResearch(event.researchId);
      if (refund > 0) {
        this.gsm.addCredits(refund, 'research-refund');
      }
    });

    // Queued researches are charged when they start (sub-step, see
    // ResearchManager.startQueued), so neither command touches the credits.
    this.on('command:queue-research', (event) => {
      this.gsm.researchManager.queueResearch(event.researchId);
    });

    this.on('command:unqueue-research', (event) => {
      this.gsm.researchManager.unqueueResearch(event.researchId);
    });

    this.on('command:move-queued-research', (event) => {
      this.gsm.researchManager.moveQueued(event.researchId, event.toIndex);
    });
  }

  private attachAbilityCommands(): void {
    // The manager validates (research, charge, wave, route in reach) and
    // answers with ability:used or ability:rejected.
    this.on('command:use-ability', (event) => {
      this.gsm.abilityManager.use(event.abilityId, {
        lat: event.target.lat,
        lon: event.target.lon,
        height: event.target.height,
      });
    });
  }

  private attachHeroCommands(): void {
    // The manager validates (research, credits, route in reach) and answers
    // with hero:state-changed or hero:rejected. The way to a move target is
    // computed here, inside the command, from the routes alone.
    this.on('command:hire-hero', () => {
      this.gsm.heroManager.hire();
    });

    this.on('command:hero-move', (event) => {
      this.gsm.heroManager.moveTo({
        lat: event.target.lat,
        lon: event.target.lon,
        height: event.target.height,
      });
    });

    this.on('command:hero-ammo', (event) => {
      this.gsm.heroManager.setAmmo(event.ammo);
    });
  }

  private attachWaveCommands(): void {
    this.on('command:start-wave', (event) => {
      if (event.config) {
        this.gsm.startWave(event.config);
      } else {
        this.gsm.beginWave();
      }
    });

    this.on('command:restart-game', () => {
      this.gsm.reset();
    });
  }

  private attachDebugCommands(): void {
    this.on('debug:add-credits', (event) => {
      // Taking more than there is would leave the player in the red
      this.gsm.addCredits(Math.max(event.amount, -this.gsm.credits()), 'cheat');
    });

    this.on('debug:add-health', (event) => {
      this.gsm.adjustBaseHealth(event.amount);
    });

    this.on('debug:complete-all-research', () => {
      this.gsm.researchManager.completeAllResearch();
    });

    this.on('debug:max-upgrade-all-towers', () => {
      this.gsm.maxUpgradeAllTowers();
    });

    // The ability's research with its prerequisites (the research unlocks it
    // with full charges), then full charges again on every further click
    this.on('debug:ready-ability', (event) => {
      this.gsm.researchManager.completeResearch(ABILITIES[event.abilityId].researchId);
      this.gsm.abilityManager.refillCharges(event.abilityId);
    });

    // Between waves only; refused otherwise, see GameStateManager.jumpToWave
    this.on('debug:jump-to-wave', (event) => {
      this.gsm.jumpToWave(event.wave, event.grantGold);
    });

    // The hero's research with its prerequisites, then the hire for free;
    // once he is hired a further click changes nothing
    this.on('debug:ready-hero', () => {
      this.gsm.researchManager.completeResearch(HERO.researchId);
      if (this.gsm.heroManager.checkHire() === null) this.gsm.heroManager.hire(0);
    });
  }
}
