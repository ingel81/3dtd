/**
 * Bot Session
 *
 * WebSocket-Client zum lokalen Python-Bot-Server plus StrategyBot:
 * Lebenszyklus, Entscheidungs-Tick und Ausführung der Bot-Actions.
 *
 * Wird ausschließlich per dynamischem Import aus dem BotClientService
 * geladen, sobald ein Bot aktiviert oder eine Backend-Verbindung aufgebaut
 * wird. Ein statischer Import von hier (oder aus bots/, strategies/) zieht den
 * ganzen Baum zurück in den Spiel-Chunk.
 */

import { inject, signal } from '@angular/core';
import { StateSnapshotService } from '../director/state-snapshot.service';
import { GameStateSnapshot } from '../director/models/game-state-snapshot';
import { BUILD_VERSION } from '../configs/build-info.config';
import { ITowerBot, TowerAction, BotSkillLevel } from './bots/tower-bot.interface';
import { StrategyBotFactory } from './bots/strategy-bot.factory';
import { TOWER_TYPES, UpgradeId } from '../configs/tower-types.config';
import { GeoPosition } from '../models/game.types';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EventSubscription } from '../game-engine';
import { TowerPlacementService } from '../services/tower-placement.service';
import { useDirectorParams } from '../director/director-params';
import { toJsonl } from '../run-log/run-log.export';
import type {
  BotCallbacks,
  BotDeps,
  BotRunLog,
  BotSignals,
} from './bot-client.service';

/** Bot server default port */
const DEFAULT_BACKEND_URL = 'ws://localhost:3001';

/** Connection timeout in ms */
const CONNECTION_TIMEOUT = 5000;

/** How long a client waits for the `run_config` of its next run. */
const RUN_CONFIG_TIMEOUT_MS = 5000;

/** Message types for WebSocket protocol */
type ClientMessage =
  | { type: 'connect'; clientId: string; gameVersion: string }
  /**
   * The run log of this client, as JSONL lines: everything written since the
   * last send. Goes out after every wave and once more when the run ends, so
   * a frozen or closed tab costs the server at most the running wave
   * (docs/RUN_LOG.md).
   */
  | { type: 'run_log'; runId: string; lines: string[]; final: boolean }
  | { type: 'game_over'; won: boolean; waves: number }
  | { type: 'status'; wave: number; enemiesAlive: number; phase: string };

type ServerMessage =
  | { type: 'connected'; sessionId: string; displayId?: number; runState?: 'running' | 'paused' }
  /**
   * What the next run plays: which bot, which seed, which director parameter
   * set. Per client, not broadcast — the whole point of a batch is that every
   * client runs a different seed (BALANCING_PLAN.md, section 5).
   */
  | { type: 'run_config'; bot?: BotSkillLevel; seed?: number; directorParams?: string }
  | { type: 'control'; action: 'start' | 'stop' | 'reload' | 'set_timescale' | 'set_rendering'; value?: number | boolean }
  | { type: 'error'; message: string };

/**
 * Muss in einem Injection-Context entstehen (`store`, `stateSnapshots` per
 * `inject()`); der BotClientService legt sie über `runInInjectionContext`
 * an. Die Signale in `signals` gehören dem Service: die Session schreibt nur
 * hinein, damit Templates und Game-Loop sie lesen können, bevor es sie gibt.
 */
export class BotSession {
  private readonly stateSnapshots = inject(StateSnapshotService);
  private readonly store = inject(TowerDefenseStore);

  private socket: WebSocket | null = null;
  private clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Reconnect state
  private intentionalDisconnect = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;

  // === CONNECTION STATE (the UI-facing part lives in `signals`) ===
  readonly isConnecting = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  // === BOT STATE ===
  private currentBot: ITowerBot | null = null;
  private readonly botFactory: StrategyBotFactory;

  // === EXTERNAL DEPENDENCIES ===
  private readonly gameState: GameStateManager;
  private readonly towerPlacement: TowerPlacementService;
  private readonly callbacks: BotCallbacks;
  private readonly runLog: BotRunLog;

  // === EVENT SUBSCRIPTIONS (cleanup on disconnect/re-connect) ===
  private eventSubscriptions: EventSubscription[] = [];

  /** A run ended and the config of the next one has not arrived yet. */
  private pendingRunConfig = false;
  private runConfigTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly signals: BotSignals, deps: BotDeps) {
    this.gameState = deps.gameState;
    this.towerPlacement = deps.towerPlacement;
    this.callbacks = deps.callbacks;
    this.runLog = deps.runLog;

    this.botFactory = new StrategyBotFactory(
      deps.strategicPlacement,
      deps.gameState,
      deps.osmService
    );
  }

  // === BOT API ===

  /**
   * Enable StrategyBot for automated bot runs
   */
  enableBot(skillLevel: BotSkillLevel): void {
    this.currentBot = this.botFactory.createBot(
      skillLevel,
      this.signals.botAutoMode() // autoStartWaves
    );
    this.signals.botEnabled.set(true);
    this.signals.botSkillLevel.set(skillLevel);
    this.signals.botStats.set({ towersPlaced: 0, goldSpent: 0 });
  }

  /**
   * Disable StrategyBot
   */
  disableBot(): void {
    this.currentBot = null;
    this.signals.botEnabled.set(false);
  }

  /**
   * Reset bot state (for new game / game over)
   */
  resetBot(): void {
    if (this.currentBot) {
      this.currentBot.reset();
      this.signals.botStats.set({ towersPlaced: 0, goldSpent: 0 });
    }
  }

  /**
   * Update bot (called each frame from component's update loop)
   * @returns true if bot performed an action
   */
  /**
   * `deltaTime` is GAME-TIME ms passed by the engine sub-step loop —
   * the bot's reactionTimeMs and strategy cooldowns are authored in
   * game-time, so this matches semantics directly with no scaling.
   */
  updateBot(getSnapshot: () => GameStateSnapshot, deltaTime: number): boolean {
    if (!this.signals.botEnabled() || !this.currentBot) return false;
    // Towers and waves wait for the corridor build of a new location (CorridorBuild).
    if (this.gameState.corridorPending()) return false;

    const phase = this.store.phase();
    if (phase !== 'setup' && phase !== 'wave') return false;

    // Tick timers first and bail before touching the snapshot. At timescale 75
    // the sub-step loop runs ~200 ticks per rendered frame, and a snapshot is
    // an expensive thing to build (full defense analysis, per-armor effective
    // DPS, a route-grid reach query) — building one per tick just to discover
    // the bot is still in reaction cooldown was pure waste.
    if (!this.currentBot.tickCooldown(deltaTime)) return false;

    // Cooldown already advanced above, so pass 0 to avoid double-ticking.
    const action = this.currentBot.update(getSnapshot(), 0);
    if (action) {
      this.executeBotAction(action);
      return true;
    }
    return false;
  }

  /**
   * Execute bot action
   */
  private executeBotAction(action: TowerAction): void {
    switch (action.type) {
      case 'place':
        if (action.position && action.towerType) {
          // Convert grid coordinates (x, z) back to GeoPosition (lon, lat).
          // The tower stands on the surface there (in DevWorld the roof),
          // on the highest point of its footprint with a plinth below, and
          // the same rules as the mouse preview and the click decide,
          // with the ground under the footprint: rooftops are valid spots,
          // a wall or a drop under its inner half is not.
          const placement = this.towerPlacement.placementAt(action.position.z, action.position.x, action.towerType);

          if (!placement) {
            console.warn(`[Bot] ⛔ Cannot get terrain height at position - ${action.reason}`);
            break;
          }

          const { footprint, result: validation } = placement;
          const geoPos: GeoPosition = {
            lat: action.position.z,
            lon: action.position.x,
            height: footprint.footY
          };

          if (!validation.valid) {
            console.warn(`[Bot] ⛔ Position invalid: ${validation.reason} - ${action.reason}`);
            break;
          }

          // Check if player has enough credits BEFORE placement
          const towerConfig = TOWER_TYPES[action.towerType];
          if (!towerConfig || this.store.credits() < towerConfig.cost) {
            console.warn(`[Bot] ⛔ Not enough credits (${this.store.credits()}/${towerConfig?.cost}) - ${action.reason}`);
            break;
          }

          // Through the command bus, like a click. The run log reads the
          // commands of a run, so a bot that goes past them writes a log with
          // holes in it (docs/RUN_LOG.md).
          this.gameState.getEventBus().emit({
            type: 'command:place-tower',
            position: geoPos,
            typeId: action.towerType,
            plinthHeight: footprint.plinthHeight,
            plinthOverhang: footprint.overhang,
          });
          this.signals.botStats.update(stats => ({
            towersPlaced: stats.towersPlaced + 1,
            goldSpent: stats.goldSpent + towerConfig.cost
          }));
          // Silent fail: bot strategies reason about LOS/collision themselves;
          // placement failures happen and are recovered from naturally.
        }
        break;

      case 'upgrade':
        if (action.towerId && action.upgradeId) {
          // Find tower by ID
          const tower = this.gameState.towerManager.getAll().find(t => t.id === action.towerId);

          if (!tower) {
            console.warn(`[Bot] ⛔ Tower not found: ${action.towerId} - ${action.reason}`);
            break;
          }

          // Get upgrade details for validation
          const upgrade = tower.typeConfig.upgrades.find(u => u.id === action.upgradeId);

          if (!upgrade) {
            console.warn(`[Bot] ⛔ Upgrade not found: ${action.upgradeId} - ${action.reason}`);
            break;
          }

          // Check if tower can be upgraded (not at max level)
          if (!tower.canUpgrade(action.upgradeId as UpgradeId)) {
            console.warn(`[Bot] ⛔ Upgrade at max level: ${tower.typeConfig.name} ${upgrade.name} - ${action.reason}`);
            break;
          }

          // Check if we can afford it (dynamic cost based on level)
          const upgradeCost = tower.getNextUpgradeCost(action.upgradeId as UpgradeId);
          if (this.store.credits() < upgradeCost) {
            console.warn(`[Bot] ⛔ Not enough credits for upgrade: ${this.store.credits()}/${upgradeCost} - ${action.reason}`);
            break;
          }

          // Through the command bus, like a click on the upgrade tile
          this.gameState.getEventBus().emit({
            type: 'command:upgrade-tower',
            towerId: tower.id,
            upgradeId: action.upgradeId as UpgradeId,
          });
          this.signals.botStats.update(stats => ({
            ...stats,
            goldSpent: stats.goldSpent + upgradeCost
          }));
        }
        break;

      case 'sell':
        if (action.towerId) {
          const tower = this.gameState.towerManager.getAll().find(t => t.id === action.towerId);
          if (!tower) {
            console.warn(`[Bot] ⛔ Sell: tower not found: ${action.towerId}`);
            break;
          }
          this.gameState.getEventBus().emit({ type: 'command:sell-tower', towerId: tower.id });
        }
        break;

      case 'wait':
        // Do nothing
        break;

      case 'start-wave': {
        // Auto-start next wave (only if in setup phase!)
        const currentPhase = this.store.phase();
        if (currentPhase === 'setup') {
          this.callbacks.startWave();
        } else {
          // Silently ignore - wave already active
        }
        break;
      }

      case 'research-start': {
        // Start a research via EventBus command
        if (action.researchId) {
          this.gameState.getEventBus().emit({
            type: 'command:start-research',
            researchId: action.researchId,
          });
        }
        break;
      }

      case 'research-cancel': {
        if (action.researchId) {
          this.gameState.getEventBus().emit({
            type: 'command:cancel-research',
            researchId: action.researchId,
          });
        }
        break;
      }

      case 'hire-hero':
        this.gameState.getEventBus().emit({ type: 'command:hire-hero' });
        break;

      case 'hero-move':
        if (action.position) {
          this.gameState.getEventBus().emit({
            type: 'command:hero-move',
            target: { lat: action.position.z, lon: action.position.x },
          });
        }
        break;

      case 'hero-ammo':
        if (action.ammo) {
          this.gameState.getEventBus().emit({ type: 'command:hero-ammo', ammo: action.ammo });
        }
        break;

      case 'use-ability': {
        // The AbilityManager validates and snaps the aim to the route, as for a click
        if (action.abilityId && action.position) {
          this.gameState.getEventBus().emit({
            type: 'command:use-ability',
            abilityId: action.abilityId,
            target: { lat: action.position.z, lon: action.position.x },
          });
        }
        break;
      }
    }
  }

  // === BOT SERVER CONNECTION ===

  /**
   * Connect to bot server and set up event subscriptions (non-blocking)
   */
  async connectToBackend(): Promise<void> {
    try {
      // Clean up previous event subscriptions on re-connect
      this.disposeEventSubscriptions();

      const connected = await this.connect();
      if (connected) {

        // Initial state is paused — the `connected` message from the backend
        // carries the authoritative runState and handleConnected applies
        // it (auto-starts the bot if backend is already 'running').
        this.gameState.setGameSpeed(1.0, false);

        // Every finished wave sends what the run log wrote since the last one
        this.eventSubscriptions.push(this.gameState.getEventBus().onLive('wave:completed', () => {
          this.sendRunLog(false);
        }));

        // Subscribe to game over events
        this.eventSubscriptions.push(this.gameState.getEventBus().onLive('game:over', () => {
          if (this.signals.isConnected()) {
            // The wave the base fell in has no wave:completed; the run log
            // writes its block when the run ends, and this send carries it.
            // Ending it here rather than waiting for the log's own listener:
            // the two run in subscription order, and a send that came first
            // left the end record behind in the collector.
            this.runLog.endRun();
            this.sendRunLog(true);
            this.notifyGameOver(false, this.store.waveNumber());

            // The next run waits for its `run_config`. Restarting right here
            // opened the next run log before the server's answer arrived, so
            // its head carried the previous run's bot and a seed that
            // `rng.reset` overwrote a moment later: every bot run was labelled
            // one run late and none of them was reproducible.
            if (this.signals.botEnabled()) {
              this.awaitRunConfig();
            }
          }
        }));
      } else {
        // No game-over subscription needed
      }
    } catch (error) {
      console.warn('[AI] Failed to connect to bot server', error);
    }
  }

  // === WEBSOCKET API ===

  /**
   * Connect to bot server
   *
   * @param url WebSocket URL (default: ws://localhost:3001)
   * @returns Promise that resolves when connected, rejects on error
   */
  async connect(url: string = DEFAULT_BACKEND_URL): Promise<boolean> {
    if (this.signals.isConnected() || this.isConnecting()) {
      return this.signals.isConnected();
    }

    this.isConnecting.set(true);
    this.connectionError.set(null);

    return new Promise((resolve, _reject) => {
      try {
        this.socket = new WebSocket(url);

        const timeoutId = setTimeout(() => {
          this.cleanup();
          this.connectionError.set('Connection timeout');
          this.isConnecting.set(false);
          resolve(false);
        }, CONNECTION_TIMEOUT);

        this.socket.onopen = () => {
          clearTimeout(timeoutId);

          // Send connect message
          this.send({
            type: 'connect',
            clientId: this.clientId,
            gameVersion: BUILD_VERSION,
          });

          this.intentionalDisconnect = false;  // fresh connection → reconnect allowed
          this.signals.isConnected.set(true);
          this.isConnecting.set(false);
          this.startStatusPush();
          resolve(true);
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as ServerMessage;
            this.handleMessage(msg);
          } catch (e) {
            console.error('[WS-Debug] Failed to parse message', e);
          }
        };

        this.socket.onerror = (error) => {
          clearTimeout(timeoutId);
          console.warn('[WS-Debug] onerror fired', error);
          this.connectionError.set('Connection failed');
          this.isConnecting.set(false);
          resolve(false);
        };

        this.socket.onclose = (event) => {
          console.warn('[WS-Debug] onclose fired', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          this.cleanup();
          // Auto-reconnect unless this was an intentional disconnect().
          // Backend might have been restarted — keep trying so dashboard can
          // resume control once it comes back.
          if (!this.intentionalDisconnect) {
            this.scheduleReconnect(url);
          }
        };
      } catch (error) {
        console.error('[Bots] Failed to create WebSocket', error);
        this.connectionError.set('Failed to create connection');
        this.isConnecting.set(false);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from backend
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.runConfigTimer !== null) {
      clearTimeout(this.runConfigTimer);
      this.runConfigTimer = null;
    }
    this.pendingRunConfig = false;
    if (this.socket) {
      this.socket.close();
    }
    this.cleanup();
  }

  /**
   * Schedule a reconnect with exponential backoff (1s → 2s → 4s → … → 30s).
   * Runs until the connection succeeds or disconnect() is called. Calls the
   * full connectToBackend() so event subscriptions get rebuilt.
   */
  private scheduleReconnect(_url: string): void {
    if (this.reconnectTimer !== null) return;  // already scheduled
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(5, attempt - 1)));
    console.log(`[Bots] Reconnect attempt ${attempt} in ${delay}ms`);
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connectToBackend();
      if (this.signals.isConnected()) {
        console.log('[Bots] Reconnected successfully');
        this.reconnectAttempts = 0;
      } else if (!this.intentionalDisconnect) {
        this.scheduleReconnect(_url);
      }
    }, delay);
  }

  /**
   * Send what the run log wrote since the last send.
   *
   * The log itself is the data (docs/RUN_LOG.md); the server only writes the
   * lines to disk. `final` marks the send that carries the end record.
   */
  sendRunLog(final: boolean): void {
    if (!this.signals.isConnected()) return;
    const run = this.runLog.current();
    if (!run) return;
    const fresh = this.runLog.drain();
    if (fresh.length === 0 && !final) return;
    this.send({
      type: 'run_log',
      runId: run.head.runId,
      lines: toJsonl(fresh).split('\n').filter(Boolean),
      final,
    });
  }

  /**
   * Notify backend of game over
   */
  notifyGameOver(won: boolean, waves: number): void {
    if (!this.signals.isConnected()) return;

    this.send({ type: 'game_over', won, waves });
  }

  // === PRIVATE METHODS ===

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[Bots] Cannot send - not connected');
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'connected':
        this.sessionId.set(msg.sessionId);
        if (msg.displayId !== undefined) {
          this.signals.displayId.set(msg.displayId);
        }
        // Phase 5.14: Training clients go headless by default. GPU/CPU cost
        // drops to near-zero for the 3D scene, so many more tabs can train
        // in parallel on one machine. User can re-enable via Game-Header
        // toggle or dashboard per-client control. Not a tab the player plays
        // themselves (`?bot=manual`, botAutoMode off): DevWorld connects to a
        // running bot server all the same, and their view went dark.
        if (this.signals.botAutoMode()) this.store.renderingEnabled.set(false);

        // Apply backend-authoritative training state. If backend says 'running',
        // auto-enable bot; otherwise stay paused until Dashboard Start.
        if (msg.runState === 'running') {
          this.handleControlCommand('start');
        } else {
          this.handleControlCommand('stop');
        }
        break;

      case 'run_config':
        this.applyRunConfig(msg);
        break;

      case 'control':
        this.handleControlCommand(msg.action, msg.value);
        break;

      case 'error':
        console.error('[Bots] Backend error:', msg.message);
        this.connectionError.set(msg.message);
        break;
    }
  }

  /**
   * What the next run plays. The seed goes into the run's own random source,
   * so a batch is repeatable; the parameter set only ever applies to a bot
   * run, never to a player's game (director-params.ts).
   */
  private applyRunConfig(config: { bot?: BotSkillLevel; seed?: number; directorParams?: string }): void {
    if (config.bot) {
      this.signals.botSkillLevel.set(config.bot);
      if (this.signals.botEnabled()) this.enableBot(config.bot);
    }
    if (typeof config.seed === 'number') {
      // Not `reset`: the restart below resets the source itself and would
      // draw its own seed over this one.
      this.gameState.rng.useNextSeed(config.seed);
    }
    if (config.directorParams && !useDirectorParams(config.directorParams)) {
      console.warn(`[Bots] unknown director parameter set '${config.directorParams}', keeping the current one`);
    }
    // Everything the head has to name is set now, so the run starts here. The
    // first config of a tab lands in a game that `?devworld` already started;
    // restarting it throws away nothing but an empty board.
    this.startConfiguredRun();
  }

  /**
   * Wait for the config of the next run, then start it.
   *
   * The server answers a `game_over` with a `run_config`, so the wait is one
   * round trip. If it never comes, the tab must not sit in the game-over
   * screen for the rest of the batch: after the timeout the run starts with
   * what the client has, which is a repeat of the last config.
   */
  private awaitRunConfig(): void {
    this.pendingRunConfig = true;
    if (this.runConfigTimer !== null) clearTimeout(this.runConfigTimer);
    this.runConfigTimer = setTimeout(() => {
      if (!this.pendingRunConfig) return;
      console.warn('[Bots] no run_config within 5s, starting the next run with the last one');
      this.startConfiguredRun();
    }, RUN_CONFIG_TIMEOUT_MS);
  }

  /** Start the run the last `run_config` describes. */
  private startConfiguredRun(): void {
    this.pendingRunConfig = false;
    if (this.runConfigTimer !== null) {
      clearTimeout(this.runConfigTimer);
      this.runConfigTimer = null;
    }
    // `botAutoMode` too, not only `botEnabled`: the first config of a tab can
    // arrive while the bot is still being loaded, and that first run then kept
    // a head without a bot and with the wrong seed. A human who connected by
    // hand has neither flag set and keeps playing undisturbed.
    if (!this.signals.botEnabled() && !this.signals.botAutoMode()) return;
    this.callbacks.restartGame();
  }

  /**
   * Handle control commands from the dashboard.
   * 'reload'        → hard-refresh tab (cleanest engine+tiles reset).
   * 'stop'          → disable bot, timescale=1.
   * 'start'         → enable bot, timescale=75.
   * 'set_timescale' → set timescale to value (global speed control).
   * 'set_rendering' → enable/disable per-frame 3D rendering (headless mode).
   */
  private handleControlCommand(
    action: 'start' | 'stop' | 'reload' | 'set_timescale' | 'set_rendering',
    value?: number | boolean,
  ): void {
    console.log('[Bots] Control command received:', action, value);
    if (action === 'reload') {
      setTimeout(() => window.location.reload(), 100);
      return;
    }
    if (action === 'stop') {
      this.gameState.setGameSpeed(1.0, false);
      this.disableBot();
      return;
    }
    if (action === 'start') {
      this.gameState.setGameSpeed(75.0, false);
      this.enableBot('expert');
      return;
    }
    if (action === 'set_timescale' && typeof value === 'number' && value > 0) {
      this.gameState.setGameSpeed(value, false);
      return;
    }
    if (action === 'set_rendering' && typeof value === 'boolean') {
      this.store.renderingEnabled.set(value);
      return;
    }
  }

  /**
   * Dispose all event bus subscriptions (cleanup on disconnect/re-connect)
   */
  private disposeEventSubscriptions(): void {
    for (const sub of this.eventSubscriptions) {
      sub.dispose();
    }
    this.eventSubscriptions = [];
  }

  private cleanup(): void {
    this.disposeEventSubscriptions();
    this.stopStatusPush();
    this.socket = null;
    this.sessionId.set(null);
    this.signals.displayId.set(null);
    this.signals.isConnected.set(false);
    this.isConnecting.set(false);
  }

  /**
   * Phase 5.14: push a compact status snapshot to the backend once per
   * wall-clock second so the dashboard can show live wave number +
   * enemies-alive per client (without per-event flooding).
   */
  private statusPushTimer: ReturnType<typeof setInterval> | null = null;

  private startStatusPush(): void {
    if (this.statusPushTimer !== null) return;
    this.statusPushTimer = setInterval(() => {
      if (!this.signals.isConnected()) return;
      const waveNum = this.gameState.waveNumber();
      const enemiesAlive = this.gameState.enemyManager.getAliveCount();
      const phase = this.gameState.phase();
      this.send({ type: 'status', wave: waveNum, enemiesAlive, phase });
    }, 1000);
  }

  private stopStatusPush(): void {
    if (this.statusPushTimer !== null) {
      clearInterval(this.statusPushTimer);
      this.statusPushTimer = null;
    }
  }
}
