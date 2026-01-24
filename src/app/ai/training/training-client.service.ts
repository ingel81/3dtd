/**
 * Training Client Service
 *
 * Connects to local Python training backend via WebSocket.
 * Only used during development for AI training.
 *
 * If backend is not running, gracefully falls back to local inference.
 */

import { Injectable, inject, signal } from '@angular/core';
import { Subject, firstValueFrom, timeout, take } from 'rxjs';
import { AIDataCollectorService } from '../core/ai-data-collector.service';
import { GameStateSnapshot } from '../core/models/game-state-snapshot';
import { WaveConfig } from '../core/models/wave-config';
import { WaveResult } from '../core/models/wave-result';
import { ENEMY_TYPES } from '../../models/enemy-types';

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

@Injectable() // Provided in TowerDefenseComponent alongside AIDataCollectorService
export class TrainingClientService {
  private dataCollector = inject(AIDataCollectorService);

  private socket: WebSocket | null = null;
  private clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // === SIGNALS ===
  readonly isConnected = signal(false);
  readonly isConnecting = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly displayId = signal<number | null>(null);
  readonly stats = signal<TrainingStats | null>(null);
  readonly lastModelVersion = signal<string | null>(null);

  // === SUBJECTS FOR ASYNC RESPONSES ===
  private pendingWaveConfig = new Subject<WaveConfig>();
  private pendingExport = new Subject<{ path: string; version: string }>();
  private resetRequested = new Subject<void>();

  /** Observable that emits when server requests episode reset */
  readonly onReset$ = this.resetRequested.asObservable();

  // === PUBLIC API ===

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

  private cleanup(): void {
    this.socket = null;
    this.sessionId.set(null);
    this.displayId.set(null);
    this.isConnected.set(false);
    this.isConnecting.set(false);
  }
}
