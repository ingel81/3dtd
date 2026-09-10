/**
 * Training Client Service
 *
 * Einstieg ins Training für Spiel, Facades und Debug-Fenster. Hier liegt nur,
 * was Templates und Game-Loop synchron lesen: die Signale und Weiterleitungen.
 * WebSocket-Client, StrategyBot und alle Strategien stecken in
 * `training-session.ts` und werden erst per dynamischem Import geladen, wenn
 * ein Bot aktiviert oder eine Backend-Verbindung aufgebaut wird. Im normalen
 * Spiel passiert beides nie, der Code bleibt damit aus dem Spiel-Chunk.
 *
 * Aus `training-session.ts`, `bots/` und `strategies/` kommt deshalb außerhalb
 * der Session nur `import type` (Guard in `training-client.service.spec.ts`).
 */

import { Injectable, Injector, WritableSignal, inject, runInInjectionContext, signal } from '@angular/core';
import { GameStateSnapshot } from '../core/models/game-state-snapshot';
import { WaveConfig } from '../core/models/wave-config';
import { UpgradeId } from '../../configs/tower-types.config';
import { GameStateManager } from '../../managers/game-state.manager';
import { TowerPlacementService } from '../../services/tower-placement.service';
import { StrategicPlacementService } from '../../services/world/strategic-placement.service';
import { OsmStreetService } from '../../services/location/osm-street.service';
import { ThreeTilesEngine } from '../../three-engine';
import { Tower } from '../../entities/tower.entity';
import type { BotSkillLevel } from './bots/tower-bot.interface';
import type { TrainingSession } from './training-session';

/** Training statistics from backend */
export interface TrainingStats {
  episode: number;
  avgReward: number;
  bestReward: number;
  gamesPlayed: number;
  winRate: number;
  currentBotType: string;
}

/**
 * Callback interface for component-level operations that the service delegates back.
 * These are operations that depend on the component (e.g., startWave, upgradeTower, restartGame).
 */
export interface TrainingComponentCallbacks {
  startWave: () => void;
  upgradeTower: (tower: Tower, upgradeId: UpgradeId) => boolean;
  restartGame: () => void;
}

/** Abhängigkeiten, die nicht per DI kommen (component-scoped oder erst beim Start bekannt). */
export interface TrainingDeps {
  gameState: GameStateManager;
  towerPlacement: TowerPlacementService;
  strategicPlacement: StrategicPlacementService;
  osmService: OsmStreetService;
  callbacks: TrainingComponentCallbacks;
}

/** Zustand, den Templates und Facades lesen. Geschrieben wird er von der Session. */
export interface TrainingSignals {
  readonly isConnected: WritableSignal<boolean>;
  readonly displayId: WritableSignal<number | null>;
  readonly stats: WritableSignal<TrainingStats | null>;
  readonly botEnabled: WritableSignal<boolean>;
  readonly botSkillLevel: WritableSignal<BotSkillLevel>;
  readonly botStats: WritableSignal<{ towersPlaced: number; goldSpent: number }>;
  readonly botAutoMode: WritableSignal<boolean>;
}

@Injectable() // Provided in TowerDefenseComponent alongside AIDataCollectorService
export class TrainingClientService implements TrainingSignals {
  private readonly injector = inject(Injector);

  // === CONNECTION SIGNALS ===
  readonly isConnected = signal(false);
  readonly displayId = signal<number | null>(null);
  readonly stats = signal<TrainingStats | null>(null);

  // === BOT SIGNALS ===
  readonly botEnabled = signal(false);
  readonly botSkillLevel = signal<BotSkillLevel>('strategist');
  readonly botStats = signal({ towersPlaced: 0, goldSpent: 0 });
  readonly botAutoMode = signal(false);

  // === LAZY SESSION ===
  private deps: TrainingDeps | null = null;
  private engine: ThreeTilesEngine | null = null;
  private session: TrainingSession | null = null;
  private sessionModule: Promise<typeof import('./training-session')> | null = null;
  /** enableBot() kam, bevor die Session stand; wird beim Anlegen angewendet. */
  private pendingBotSkill: BotSkillLevel | null = null;

  /**
   * Initialize with dependencies that aren't available via DI.
   * Lädt bewusst nichts: jedes Spiel ruft das beim Start.
   */
  initialize(deps: TrainingDeps): void {
    this.deps = deps;
    if (this.pendingBotSkill) {
      void this.loadSession();
    }
  }

  /**
   * Set the engine reference (may be set after initialize, once engine is ready)
   */
  setEngine(engine: ThreeTilesEngine | null): void {
    this.engine = engine;
    this.session?.setEngine(engine);
  }

  // === BOT API ===

  /**
   * Enable StrategyBot for automated training
   */
  enableBot(skillLevel: BotSkillLevel): void {
    if (this.session) {
      this.session.enableBot(skillLevel);
      return;
    }
    // Keine Session: der Chunk lädt noch, oder `initialize()` lief noch nicht
    // (der Tab baut noch seine Engine). Die Anfrage merken statt verwerfen.
    // Still zurückzukehren ließ vier neu geladene Clients verbunden, beim
    // Dashboard gesund gemeldet und dauerhaft untätig in Setup stehen.
    this.pendingBotSkill = skillLevel;
    void this.loadSession();
  }

  /**
   * Disable StrategyBot
   */
  disableBot(): void {
    this.pendingBotSkill = null;
    this.session?.disableBot();
  }

  /**
   * Reset bot state (for new game / game over)
   */
  resetBot(): void {
    this.session?.resetBot();
  }

  /**
   * Bot-Tick pro Sub-Step, siehe TrainingSession.updateBot.
   * @returns true if bot performed an action
   */
  updateBot(getSnapshot: () => GameStateSnapshot, deltaTime: number): boolean {
    return this.session?.updateBot(getSnapshot, deltaTime) ?? false;
  }

  // === TRAINING BACKEND CONNECTION ===

  /**
   * Connect to training backend and set up event subscriptions (non-blocking)
   */
  async connectToBackend(): Promise<void> {
    const session = await this.loadSession();
    await session?.connectToBackend();
  }

  /**
   * Connect to training backend (WebSocket only)
   */
  async connect(url?: string): Promise<boolean> {
    const session = await this.loadSession();
    return session ? session.connect(url) : false;
  }

  /**
   * Disconnect from backend
   */
  disconnect(): void {
    this.session?.disconnect();
  }

  /**
   * Request wave config from backend
   */
  async requestWaveConfig(state: GameStateSnapshot): Promise<WaveConfig> {
    if (!this.session) {
      throw new Error('Not connected to training backend');
    }
    return this.session.requestWaveConfig(state);
  }

  /**
   * Lädt den Session-Chunk (einmal) und legt die Session an, sobald
   * `initialize()` gelaufen ist. Vorher, oder wenn der Chunk nicht lädt, null.
   */
  private async loadSession(): Promise<TrainingSession | null> {
    this.sessionModule ??= import('./training-session');
    let module: typeof import('./training-session');
    try {
      module = await this.sessionModule;
    } catch (error) {
      // Z. B. alter Tab nach einem Deploy mit neuen Chunk-Hashes. Beim
      // nächsten Versuch neu anfordern statt die Ablehnung zu cachen.
      this.sessionModule = null;
      console.error('[Training] Failed to load the training session', error);
      return null;
    }

    if (!this.session && this.deps) {
      const deps = this.deps;
      this.session = runInInjectionContext(this.injector, () => new module.TrainingSession(this, deps));
      this.session.setEngine(this.engine);
      const skill = this.pendingBotSkill;
      this.pendingBotSkill = null;
      if (skill) {
        this.session.enableBot(skill);
      }
    }
    return this.session;
  }
}
