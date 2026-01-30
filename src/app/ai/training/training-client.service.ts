/**
 * Training Client Service
 *
 * Connects to local Python training backend via WebSocket.
 * Also manages the StrategyBot lifecycle and action execution.
 *
 * Only used during development for AI training.
 * If backend is not running, gracefully falls back to local inference.
 */

import { Injectable, inject, signal } from '@angular/core';
import { Subject, firstValueFrom, timeout, take } from 'rxjs';
import { AIDataCollectorService } from '../core/ai-data-collector.service';
import { GameStateSnapshot } from '../core/models/game-state-snapshot';
import { WaveConfig } from '../core/models/wave-config';
import { WaveResult } from '../core/models/wave-result';
import { ENEMY_TYPES } from '../../models/enemy-types';
import { ITowerBot, TowerAction, BotSkillLevel } from './bots/tower-bot.interface';
import { StrategyBotFactory } from './bots/strategy-bot.factory';
import { TOWER_TYPES, UpgradeId } from '../../configs/tower-types.config';
import { GeoPosition } from '../../models/game.types';
import { GameStateManager } from '../../managers/game-state.manager';
import { EventSubscription } from '../../game-engine';
import { TowerPlacementService } from '../../services/tower-placement.service';
import { StrategicPlacementService } from '../../services/strategic-placement.service';
import { OsmStreetService } from '../../services/osm-street.service';
import { ThreeTilesEngine } from '../../three-engine';
import { Tower } from '../../entities/tower.entity';

/** Training backend default port */
const DEFAULT_BACKEND_URL = 'ws://localhost:3001';

/** Connection timeout in ms */
const CONNECTION_TIMEOUT = 5000;

/** Message timeout in ms */
const MESSAGE_TIMEOUT = 10000;

/** Training statistics from backend */
export interface TrainingStats {
  episode: number;
  avgReward: number;
  bestReward: number;
  gamesPlayed: number;
  winRate: number;
  currentBotType: string;
}

/** Message types for WebSocket protocol */
type ClientMessage =
  | { type: 'connect'; clientId: string; gameVersion: string }
  | { type: 'state'; data: GameStateSnapshot }
  | { type: 'result'; data: WaveResult }
  | { type: 'game_start'; difficulty: 'easy' | 'normal' | 'hard'; enemyBaseHp: Record<string, number> }
  | { type: 'game_over'; won: boolean; waves: number }
  | { type: 'request_stats' }
  | { type: 'request_export'; version: string };

type ServerMessage =
  | { type: 'connected'; sessionId: string; displayId?: number }
  | { type: 'wave_config'; data: WaveConfig }
  | { type: 'reset' }
  | { type: 'stats'; data: TrainingStats }
  | { type: 'model_exported'; path: string; version: string }
  | { type: 'error'; message: string };

/**
 * Callback interface for component-level operations that the service delegates back.
 * These are operations that depend on the component (e.g., startWave, upgradeTower, restartGame).
 */
export interface TrainingComponentCallbacks {
  startWave: () => void;
  upgradeTower: (tower: Tower, upgradeId: UpgradeId) => boolean;
  restartGame: () => void;
}

@Injectable() // Provided in TowerDefenseComponent alongside AIDataCollectorService
export class TrainingClientService {
  private dataCollector = inject(AIDataCollectorService);

  private socket: WebSocket | null = null;
  private clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // === CONNECTION SIGNALS ===
  readonly isConnected = signal(false);
  readonly isConnecting = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly displayId = signal<number | null>(null);
  readonly stats = signal<TrainingStats | null>(null);
  readonly lastModelVersion = signal<string | null>(null);

  // === BOT SIGNALS ===
  readonly botEnabled = signal(false);
  readonly botSkillLevel = signal<BotSkillLevel>('strategist');
  readonly botStats = signal({ towersPlaced: 0, goldSpent: 0 });
  readonly botAutoMode = signal(false);

  // === BOT STATE ===
  private currentBot: ITowerBot | null = null;
  private botFactory!: StrategyBotFactory;

  // === EXTERNAL DEPENDENCIES (set via initialize()) ===
  private gameState!: GameStateManager;
  private towerPlacement!: TowerPlacementService;
  private engine: ThreeTilesEngine | null = null;
  private callbacks!: TrainingComponentCallbacks;

  // === EVENT SUBSCRIPTIONS (cleanup on disconnect/re-connect) ===
  private eventSubscriptions: EventSubscription[] = [];

  // === SUBJECTS FOR ASYNC RESPONSES ===
  private pendingWaveConfig = new Subject<WaveConfig>();
  private pendingExport = new Subject<{ path: string; version: string }>();
  private resetRequested = new Subject<void>();

  /** Observable that emits when server requests episode reset */
  readonly onReset$ = this.resetRequested.asObservable();

  // === INITIALIZATION ===

  /**
   * Initialize with dependencies that aren't available via DI.
   * Must be called before using bot or connectToBackend features.
   */
  initialize(deps: {
    gameState: GameStateManager;
    towerPlacement: TowerPlacementService;
    strategicPlacement: StrategicPlacementService;
    osmService: OsmStreetService;
    callbacks: TrainingComponentCallbacks;
  }): void {
    this.gameState = deps.gameState;
    this.towerPlacement = deps.towerPlacement;
    this.callbacks = deps.callbacks;

    this.botFactory = new StrategyBotFactory(
      deps.strategicPlacement,
      deps.gameState,
      deps.osmService
    );
  }

  /**
   * Set the engine reference (may be set after initialize, once engine is ready)
   */
  setEngine(engine: ThreeTilesEngine | null): void {
    this.engine = engine;
  }

  // === BOT API ===

  /**
   * Enable StrategyBot for automated training
   */
  enableBot(skillLevel: BotSkillLevel): void {
    if (!this.botFactory) return;
    this.currentBot = this.botFactory.createBot(
      skillLevel,
      this.botAutoMode() // autoStartWaves
    );
    this.botEnabled.set(true);
    this.botSkillLevel.set(skillLevel);
    this.botStats.set({ towersPlaced: 0, goldSpent: 0 });

    console.log(`[Training] StrategyBot enabled: ${skillLevel}, autoMode: ${this.botAutoMode()}`);
  }

  /**
   * Disable StrategyBot
   */
  disableBot(): void {
    this.currentBot = null;
    this.botEnabled.set(false);
    console.log('[Training] StrategyBot disabled');
  }

  /**
   * Reset bot state (for new game / game over)
   */
  resetBot(): void {
    if (this.currentBot) {
      this.currentBot.reset();
      this.botStats.set({ towersPlaced: 0, goldSpent: 0 });
    }
  }

  /**
   * Update bot (called each frame from component's update loop)
   * @returns true if bot performed an action
   */
  updateBot(snapshot: GameStateSnapshot, deltaTime: number): boolean {
    if (!this.botEnabled() || !this.currentBot || !this.gameState) return false;

    const phase = this.gameState.phase();
    if (phase !== 'setup' && phase !== 'wave') return false;

    const action = this.currentBot.update(snapshot, deltaTime);
    if (action) {
      this.executeBotAction(action);
      return true;
    }
    return false;
  }

  /**
   * Execute bot action
   */
  executeBotAction(action: TowerAction): void {
    if (!this.gameState || !this.callbacks) return;
    switch (action.type) {
      case 'place':
        if (action.position && action.towerType) {
          // Convert grid coordinates (x, z) back to GeoPosition (lon, lat)
          // CRITICAL: Get terrain height for accurate placement!
          if (!this.engine) {
            console.warn(`[Bot] ⛔ Engine not initialized - ${action.reason}`);
            break;
          }

          const terrainHeight = this.engine.getTerrainHeightAtGeo(action.position.z, action.position.x);

          if (terrainHeight === null) {
            console.warn(`[Bot] ⛔ Cannot get terrain height at position - ${action.reason}`);
            break;
          }

          const geoPos: GeoPosition = {
            lat: action.position.z,
            lon: action.position.x,
            height: terrainHeight
          };

          // Validate using TowerPlacementService with height (prevents building on rooftops!)
          const validation = this.towerPlacement.validateTowerPositionWithHeight(geoPos);

          if (!validation.valid) {
            console.warn(`[Bot] ⛔ Position invalid: ${validation.reason} - ${action.reason}`);
            break;
          }

          // Check if player has enough credits BEFORE placement
          const towerConfig = TOWER_TYPES[action.towerType];
          if (!towerConfig || this.gameState.credits() < towerConfig.cost) {
            console.warn(`[Bot] ⛔ Not enough credits (${this.gameState.credits()}/${towerConfig?.cost}) - ${action.reason}`);
            break;
          }

          const tower = this.gameState.placeTower(geoPos, action.towerType);

          if (tower) {
            console.log(`[Bot] ✅ Placed ${action.towerType} at ${action.reason || 'position'}`);

            // Update stats
            this.botStats.update(stats => ({
              towersPlaced: stats.towersPlaced + 1,
              goldSpent: stats.goldSpent + towerConfig.cost
            }));
          } else {
            console.error(`[Bot] ⛔ Placement failed after validation passed! - ${action.reason}`);
          }
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
          if (this.gameState.credits() < upgradeCost) {
            console.warn(`[Bot] ⛔ Not enough credits for upgrade: ${this.gameState.credits()}/${upgradeCost} - ${action.reason}`);
            break;
          }

          // Attempt upgrade (this deducts credits if successful)
          const success = this.callbacks.upgradeTower(tower, action.upgradeId as UpgradeId);

          if (success) {
            console.log(`[Bot] ✅ Upgraded ${tower.typeConfig.name} with ${upgrade.name} - ${action.reason}`);

            // Update bot stats (only if successful)
            this.botStats.update(stats => ({
              ...stats,
              goldSpent: stats.goldSpent + upgradeCost
            }));
          } else {
            console.error(`[Bot] ⛔ Upgrade failed unexpectedly - ${action.reason}`);
          }
        }
        break;

      case 'sell':
        // TODO: Implement sell execution
        console.log('[Bot] Sell requested:', action);
        break;

      case 'wait':
        // Do nothing
        break;

      case 'start-wave': {
        // Auto-start next wave (only if in setup phase!)
        const currentPhase = this.gameState.phase();
        if (currentPhase === 'setup') {
          console.log(`[Bot] ${action.reason || 'Auto-starting wave'}`);
          this.callbacks.startWave();
        } else {
          // Silently ignore - wave already active
        }
        break;
      }
    }
  }

  // === TRAINING BACKEND CONNECTION ===

  /**
   * Connect to training backend and set up event subscriptions (non-blocking)
   */
  async connectToBackend(): Promise<void> {
    if (!this.gameState) return;

    try {
      // Clean up previous event subscriptions on re-connect
      this.disposeEventSubscriptions();

      const connected = await this.connect();
      if (connected) {
        console.log('[AI] Connected to training backend');

        // Notify backend of game start (sends enemy base HP config)
        this.notifyGameStart('normal');

        // Only enable fast speed and bot if bot=auto mode is active
        if (this.botAutoMode()) {
          // Enable training mode with 75x timescale for maximum training speed (don't persist to localStorage)
          this.gameState.setTrainingTimescale(75.0, false);
          console.log('[AI] Training mode enabled (75x speed)');

          // Enable StrategyBot for automated training
          this.enableBot('strategist');
        } else {
          console.log('[AI] Connected to training backend (manual play mode - no bot, 1x speed)');
        }

        // Subscribe to wave completion events to send results to backend
        this.eventSubscriptions.push(this.gameState.getEventBus().on('wave:completed', async (_event) => {
          console.log('[Wave] Wave completed! Bot will prepare for next wave...');

          if (this.isConnected()) {
            // Get the wave result from data collector
            const history = this.dataCollector.getWaveHistory();
            if (history.length > 0) {
              const latestResult = history[history.length - 1];

              // Add current state (after wave) to result for learning
              const currentState = this.dataCollector.getStateSnapshot();
              const resultWithState = {
                ...latestResult,
                stateAfter: currentState
              };

              console.log('[AI] Sending wave result to backend:', resultWithState);
              await this.sendWaveResult(resultWithState);
              console.log('[AI] Sent wave result + state to backend');
            }
          }
        }));

        // Subscribe to game over events
        this.eventSubscriptions.push(this.gameState.getEventBus().on('game:over', async (_event) => {
          if (this.isConnected()) {
            // Send game over notification
            console.log('[AI] Sending game over to backend:', {
              won: false,
              waveNumber: this.gameState.waveManager.waveNumber()
            });
            this.notifyGameOver(false, this.gameState.waveManager.waveNumber());
            console.log('[AI] Sent game over to backend');

            // Also send the final wave result if available
            const history = this.dataCollector.getWaveHistory();
            if (history.length > 0) {
              const latestResult = history[history.length - 1];
              console.log('[AI] Sending final wave result to backend:', latestResult);
              await this.sendWaveResult(latestResult);
              console.log('[AI] Sent final wave result to backend');
            }
          }
        }));

        // Subscribe to episode reset from training backend
        this.onReset$.subscribe(() => {
          console.log('[AI] Episode reset - restarting game');
          this.callbacks.restartGame();
          this.notifyGameStart('normal');
        });
      } else {
        console.log('[AI] Training backend not available, using local inference');
      }
    } catch (error) {
      console.warn('[AI] Failed to connect to training backend', error);
    }
  }

  // === WEBSOCKET API ===

  /**
   * Connect to training backend
   *
   * @param url WebSocket URL (default: ws://localhost:3001)
   * @returns Promise that resolves when connected, rejects on error
   */
  async connect(url: string = DEFAULT_BACKEND_URL): Promise<boolean> {
    if (this.isConnected() || this.isConnecting()) {
      return this.isConnected();
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
          console.log('[WS-Debug] onopen fired, sending connect message');

          // Send connect message
          this.send({
            type: 'connect',
            clientId: this.clientId,
            gameVersion: '1.0.0',
          });

          this.isConnected.set(true);
          this.isConnecting.set(false);
          console.log('[WS-Debug] isConnected=true, resolving promise');
          resolve(true);
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as ServerMessage;
            console.log('[WS-Debug] message received:', msg.type);
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
          console.trace('[WS-Debug] disconnect stacktrace');
          this.cleanup();
        };
      } catch (error) {
        console.error('[Training] Failed to create WebSocket', error);
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
    if (this.socket) {
      this.socket.close();
    }
    this.cleanup();
  }

  /**
   * Request wave config from backend
   *
   * Sends current game state, waits for AI decision.
   */
  async requestWaveConfig(state: GameStateSnapshot): Promise<WaveConfig> {
    if (!this.isConnected()) {
      throw new Error('Not connected to training backend');
    }

    // Send state
    this.send({ type: 'state', data: state });

    // Wait for response
    return firstValueFrom(
      this.pendingWaveConfig.pipe(timeout(MESSAGE_TIMEOUT), take(1))
    );
  }

  /**
   * Send wave result to backend for training
   */
  sendWaveResult(result: WaveResult): void {
    if (!this.isConnected()) return;

    this.send({ type: 'result', data: result });
  }

  /**
   * Notify backend of game start
   */
  notifyGameStart(difficulty: 'easy' | 'normal' | 'hard' = 'normal'): void {
    if (!this.isConnected()) return;

    // Send enemy base HP from game config (single source of truth)
    const enemyBaseHp: Record<string, number> = {};
    for (const [id, config] of Object.entries(ENEMY_TYPES)) {
      enemyBaseHp[id] = config.baseHp;
    }

    this.send({ type: 'game_start', difficulty, enemyBaseHp });
  }

  /**
   * Notify backend of game over
   */
  notifyGameOver(won: boolean, waves: number): void {
    if (!this.isConnected()) return;

    this.send({ type: 'game_over', won, waves });
  }

  /**
   * Request training stats
   */
  requestStats(): void {
    if (!this.isConnected()) return;

    this.send({ type: 'request_stats' });
  }

  /**
   * Request model export
   */
  async requestExport(version: string): Promise<{ path: string; version: string }> {
    if (!this.isConnected()) {
      throw new Error('Not connected to training backend');
    }

    this.send({ type: 'request_export', version });

    return firstValueFrom(
      this.pendingExport.pipe(timeout(30000), take(1)) // Export can take longer
    );
  }

  // === PRIVATE METHODS ===

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[Training] Cannot send - not connected');
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'connected':
        this.sessionId.set(msg.sessionId);
        if (msg.displayId !== undefined) {
          this.displayId.set(msg.displayId);
        }
        console.log(`[Training] Connected as #${msg.displayId ?? '?'}`);
        break;

      case 'wave_config':
        this.pendingWaveConfig.next(msg.data);
        break;

      case 'reset':
        console.log('[Training] Episode reset requested by server');
        this.resetRequested.next();
        break;

      case 'stats':
        this.stats.set(msg.data);
        break;

      case 'model_exported':
        this.lastModelVersion.set(msg.version);
        this.pendingExport.next({ path: msg.path, version: msg.version });
        console.log(`[Training] Model exported: ${msg.version} at ${msg.path}`);
        break;

      case 'error':
        console.error('[Training] Backend error:', msg.message);
        this.connectionError.set(msg.message);
        break;
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
    this.socket = null;
    this.sessionId.set(null);
    this.displayId.set(null);
    this.isConnected.set(false);
    this.isConnecting.set(false);
  }
}
