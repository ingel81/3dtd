/**
 * Bot Client Service
 *
 * Einstieg in die Bot-Läufe für Spiel, Facades und Debug-Fenster. Hier liegt nur,
 * was Templates und Game-Loop synchron lesen: die Signale und Weiterleitungen.
 * WebSocket-Client, StrategyBot und alle Strategien stecken in
 * `bot-session.ts` und werden erst per dynamischem Import geladen, wenn
 * ein Bot aktiviert oder eine Backend-Verbindung aufgebaut wird. Im normalen
 * Spiel passiert beides nie, der Code bleibt damit aus dem Spiel-Chunk.
 *
 * Aus `bot-session.ts`, `bots/` und `strategies/` kommt deshalb außerhalb
 * der Session nur `import type` (Guard in `bot-client.service.spec.ts`).
 */

import { Injectable, Injector, WritableSignal, inject, runInInjectionContext, signal } from '@angular/core';
import { GameStateSnapshot } from '../director/models/game-state-snapshot';
import type { RunLog, RunLogRecord } from '../run-log/run-log.types';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerPlacementService } from '../services/tower-placement.service';
import { StrategicPlacementService } from '../services/world/strategic-placement.service';
import { OsmStreetService } from '../services/location/osm-street.service';
import type { BotSkillLevel } from './bots/tower-bot.interface';
import type { BotSession } from './bot-session';

type SessionModule = typeof import('./bot-session');

/** Versuche, den Session-Chunk zu laden, bevor die Runde aufgibt. */
const SESSION_LOAD_ATTEMPTS = 3;

/** Pause vor dem zweiten Versuch, verdoppelt sich danach. */
const SESSION_LOAD_RETRY_MS = 1000;

/**
 * Callback interface for component-level operations that the service delegates back.
 * These are operations that depend on the component (startWave, restartGame).
 * Everything a player could click goes over the command bus instead.
 */
export interface BotCallbacks {
  startWave: () => void;
  restartGame: () => void;
}

/**
 * What a bot needs from the run log: the open run and the records it has not
 * sent yet. Passed in rather than injected, so a spec can drive a session
 * without the Angular injector (docs/RUN_LOG.md).
 */
export interface BotRunLog {
  current(): RunLog | null;
  drain(): RunLogRecord[];
}

/** Abhängigkeiten, die nicht per DI kommen (component-scoped oder erst beim Start bekannt). */
export interface BotDeps {
  gameState: GameStateManager;
  towerPlacement: TowerPlacementService;
  strategicPlacement: StrategicPlacementService;
  osmService: OsmStreetService;
  callbacks: BotCallbacks;
  runLog: BotRunLog;
}

/** Zustand, den Templates und Facades lesen. Geschrieben wird er von der Session. */
export interface BotSignals {
  readonly isConnected: WritableSignal<boolean>;
  readonly displayId: WritableSignal<number | null>;
  readonly botEnabled: WritableSignal<boolean>;
  readonly botSkillLevel: WritableSignal<BotSkillLevel>;
  readonly botStats: WritableSignal<{ towersPlaced: number; goldSpent: number }>;
  readonly botAutoMode: WritableSignal<boolean>;
}

@Injectable() // Provided in TowerDefenseComponent alongside StateSnapshotService
export class BotClientService implements BotSignals {
  private readonly injector = inject(Injector);

  // === CONNECTION SIGNALS ===
  readonly isConnected = signal(false);
  readonly displayId = signal<number | null>(null);

  /** Der Session-Chunk lädt auch nach allen Versuchen nicht (Bot-Debug-Fenster). */
  readonly sessionError = signal<string | null>(null);

  // === BOT SIGNALS ===
  readonly botEnabled = signal(false);
  readonly botSkillLevel = signal<BotSkillLevel>('expert');
  readonly botStats = signal({ towersPlaced: 0, goldSpent: 0 });
  readonly botAutoMode = signal(false);

  // === LAZY SESSION ===
  private deps: BotDeps | null = null;
  private session: BotSession | null = null;
  private sessionModule: Promise<SessionModule | null> | null = null;
  /** Bot-Wunsch, solange die Session nicht steht; der letzte Aufruf gewinnt. */
  private pendingBotSkill: BotSkillLevel | null = null;
  /**
   * Zählt connect/connectToBackend/disconnect. Ein Verbindungsaufbau, der auf
   * den Chunk wartet, läuft danach nur weiter, wenn kein neuerer Wunsch kam.
   */
  private connectionRequest = 0;
  /** Import-Einstieg; der Spec ersetzt ihn, um Ladefehler zu simulieren. */
  private importSession = (): Promise<SessionModule> => import('./bot-session');

  /**
   * Initialize with dependencies that aren't available via DI.
   * Lädt bewusst nichts: jedes Spiel ruft das beim Start.
   */
  initialize(deps: BotDeps): void {
    this.deps = deps;
    if (this.pendingBotSkill) {
      void this.loadSession();
    }
  }

  // === BOT API ===

  /**
   * Enable StrategyBot for automated bot runs
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
   * Bot-Tick pro Sub-Step, siehe BotSession.updateBot.
   * @returns true if bot performed an action
   */
  updateBot(getSnapshot: () => GameStateSnapshot, deltaTime: number): boolean {
    return this.session?.updateBot(getSnapshot, deltaTime) ?? false;
  }

  // === BOT SERVER CONNECTION ===

  /**
   * Connect to bot server and set up event subscriptions (non-blocking)
   */
  async connectToBackend(): Promise<void> {
    const request = ++this.connectionRequest;
    const session = await this.loadSession();
    // Ein disconnect() oder neuerer Aufruf während des Ladens gewinnt.
    if (session && request === this.connectionRequest) {
      await session.connectToBackend();
    }
  }

  /**
   * Connect to bot server (WebSocket only)
   */
  async connect(url?: string): Promise<boolean> {
    const request = ++this.connectionRequest;
    const session = await this.loadSession();
    if (!session || request !== this.connectionRequest) return false;
    return session.connect(url);
  }

  /**
   * Disconnect from backend. Wirkt auch auf einen Verbindungsaufbau, der noch
   * auf den Chunk wartet.
   */
  disconnect(): void {
    ++this.connectionRequest;
    this.session?.disconnect();
  }

  /**
   * Lädt den Session-Chunk (einmal) und legt die Session an, sobald
   * `initialize()` gelaufen ist. Vorher, oder wenn der Chunk nicht lädt, null.
   */
  private async loadSession(): Promise<BotSession | null> {
    this.sessionModule ??= this.importWithRetry();
    const module = await this.sessionModule;
    if (!module) return null;

    if (!this.session && this.deps) {
      const deps = this.deps;
      this.session = runInInjectionContext(this.injector, () => new module.BotSession(this, deps));
      const skill = this.pendingBotSkill;
      this.pendingBotSkill = null;
      if (skill) {
        this.session.enableBot(skill);
      }
    }
    return this.session;
  }

  /**
   * Import mit begrenztem Retry. Ein unbeaufsichtigter Bot-Tab soll einen
   * kurzen Aussetzer überstehen, statt über Nacht untätig zu stehen. Ob ein
   * erneutes `import()` wirklich neu lädt, hängt vom Browser ab (ein
   * fehlgeschlagenes Modul kann gecacht bleiben); deshalb nach dem letzten
   * Versuch die Meldung in `sessionError`. Der nächste Aufruf startet eine
   * neue Runde, statt die Ablehnung zu cachen.
   */
  private async importWithRetry(): Promise<SessionModule | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const module = await this.importSession();
        this.sessionError.set(null);
        return module;
      } catch (error) {
        console.error(
          `[Bots] Failed to load the bot session (attempt ${attempt}/${SESSION_LOAD_ATTEMPTS})`,
          error,
        );
        if (attempt >= SESSION_LOAD_ATTEMPTS) {
          this.sessionModule = null;
          this.sessionError.set('Bot code failed to load, reload the tab');
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, SESSION_LOAD_RETRY_MS * 2 ** (attempt - 1)));
      }
    }
  }
}
