/**
 * Wave Director Service
 *
 * Central AI service that determines wave configurations.
 * Uses ONNX Runtime Web for inference, falls back to rules otherwise.
 *
 * IMPORTANT: This service is completely OPTIONAL.
 * The game works fine without it - WaveManager has its own default logic.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { generateFallbackWave, getWaveDifficulty } from './fallback-rules';
import { explainWaveDecision, DecisionExplanation, formatExplanationForUI } from './decision-explainer';
import { encodeGameState, ENCODED_STATE_SIZE } from './game-state-encoder';
import { EnemyTypeId } from '../../models/enemy-types';

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'fallback';

/** AI Mode */
type AIMode = 'inference' | 'fallback' | 'training' | 'disabled';

/** Constants matching backend config.py */
const AI_CONSTANTS = {
  KILL_TIME_MIN: 2.0,
  KILL_TIME_MAX: 5.0,
  SPAWN_DELAY_MIN: 500,
  SPAWN_DELAY_MAX: 2000,
  VARIATION_MAX: 0.3,
  HEALTH_MULTIPLIER_MAX: 20.0,
};

/** Enemy base HP - must match config.py ENEMY_BASE_HP */
const ENEMY_BASE_HP: Record<string, number> = {
  zombie: 80,
  bat: 25,
  tank: 250,
  wallsmasher: 200,
  penguin: 30,
  herbert: 500,
};

/** Enemy type order - must match backend model output */
const ENEMY_TYPES: EnemyTypeId[] = ['zombie', 'bat', 'tank', 'wallsmasher', 'penguin', 'herbert'];

/** ONNX Runtime types (lazy loaded) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InferenceSession = any;

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class WaveDirectorService {
  private dataCollector = inject(AIDataCollectorService);

  // === STATE ===
  private session: InferenceSession | null = null; // ONNX Runtime session
  private ort: OrtModule | null = null; // ONNX Runtime (lazy loaded)
  private recentEnemyTypes: EnemyTypeId[] = []; // Track recent types for variety
  private readonly TYPE_COOLDOWN_WAVES = 2; // Don't repeat same type within N waves

  // === SIGNALS ===
  readonly modelState = signal<ModelState>('not-loaded');
  readonly aiMode = signal<AIMode>('fallback');
  readonly lastDecision = signal<WaveConfig | null>(null);
  readonly lastExplanation = signal<DecisionExplanation | null>(null);
  readonly inferenceTimeMs = signal(0);

  readonly isReady = computed(() => {
    const state = this.modelState();
    return state === 'ready' || state === 'fallback';
  });

  readonly statusText = computed(() => {
    switch (this.modelState()) {
      case 'not-loaded':
        return 'AI nicht geladen';
      case 'loading':
        return 'AI wird geladen...';
      case 'ready':
        return 'AI bereit (ONNX)';
      case 'fallback':
        return 'Regelbasiert (kein Model)';
      case 'error':
        return 'AI Fehler';
    }
  });

  // === DEBUG MODE ===
  private debugMode = signal(false);

  constructor() {
    // Try to load model on startup (but don't block)
    this.initializeAsync();
  }

  /**
   * Initialize AI (async, non-blocking)
   */
  private async initializeAsync(): Promise<void> {
    try {
      await this.loadModel();
    } catch (error) {
      console.warn('[AI] Model loading failed, using fallback', error);
      this.modelState.set('fallback');
      this.aiMode.set('fallback');
    }
  }

  /**
   * Load ONNX Runtime and model
   */
  async loadModel(): Promise<boolean> {
    if (this.modelState() === 'ready') return true;

    this.modelState.set('loading');

    try {
      // Lazy load ONNX Runtime Web
      if (!this.ort) {
        this.ort = await import('onnxruntime-web');

        // Configure WASM paths to use local assets
        this.ort.env.wasm.wasmPaths = '/assets/onnx-wasm/';
        // Suppress WASM internal logs ("Unknown CPU vendor" etc.)
        this.ort.env.logLevel = 'error';

        console.log('[AI] ONNX Runtime Web loaded');
      }

      // Try to load model from assets
      try {
        // Create inference session with WASM backend only (simpler, more compatible)
        const options: { executionProviders: string[]; logSeverityLevel: number } = {
          executionProviders: ['wasm'],
          logSeverityLevel: 3, // ERROR only (suppress "Unknown CPU vendor" warning)
        };

        this.session = await this.ort.InferenceSession.create(
          '/assets/ai/wave-director/wave-director.onnx',
          options
        );

        this.modelState.set('ready');
        this.aiMode.set('inference');
        console.log('[AI] ONNX model loaded successfully');
        return true;
      } catch {
        // Model file not found - use fallback
        console.log('[AI] No model file found, using fallback rules');
        this.modelState.set('fallback');
        this.aiMode.set('fallback');
        return false;
      }
    } catch (error) {
      console.error('[AI] Failed to load ONNX Runtime', error);
      this.modelState.set('error');
      this.aiMode.set('fallback');
      return false;
    }
  }

  /**
   * Get next wave configuration
   *
   * This is the main entry point for wave generation.
   * Returns a WaveConfig based on current game state.
   */
  async getNextWave(): Promise<WaveConfig> {
    const startTime = performance.now();

    try {
      // Get current game state
      const state = this.dataCollector.getStateSnapshot();
      const history = this.dataCollector.getWaveHistory();
      const recentDamage = history.map((h) => h.outcome.damagePercent);

      let config: WaveConfig;

      // Use AI if available, otherwise fallback
      if (this.aiMode() === 'inference' && this.session && this.ort) {
        console.log('[AI] Running ONNX inference...');
        config = await this.runInference(state);
        console.log('[AI] Inference result:', config.enemies[0].type, 'x', config.totalCount);
      } else {
        console.log('[AI] Using fallback rules (mode:', this.aiMode(), ')');
        config = generateFallbackWave(state, recentDamage);
      }

      // Generate explanation
      const explanation = explainWaveDecision(state, config);
      config.explanation = explanation.summary;
      config.confidence = explanation.confidence;

      // Store for UI
      this.lastDecision.set(config);
      this.lastExplanation.set(explanation);

      // Tell data collector about this config
      this.dataCollector.setCurrentWaveConfig(config);

      // Track inference time
      this.inferenceTimeMs.set(performance.now() - startTime);

      // Debug logging
      if (this.debugMode()) {
        console.log('[AI] Wave decision:', config);
        console.log('[AI] Explanation:', formatExplanationForUI(explanation));
      }

      return config;
    } catch (error) {
      console.error('[AI] Error generating wave, using emergency fallback', error);

      // Emergency fallback - simple wave
      return {
        enemies: [{ type: 'zombie', count: 10 }],
        totalCount: 10,
        spawnDelay: 1000,
        spawnDelayVariation: 0.2,
        useGathering: false, // Deprecated
        explanation: 'Notfall-Fallback (AI-Fehler)',
      };
    }
  }

  /**
   * Run ONNX neural network inference
   */
  private async runInference(state: GameStateSnapshot): Promise<WaveConfig> {
    if (!this.ort || !this.session) {
      throw new Error('Model not loaded');
    }

    // Encode state to Float32Array
    const encoded = encodeGameState(state);

    // Debug: Log key input values
    console.log('[AI] Input state:', {
      waveNumber: state.waveNumber,
      towerCount: state.defense.towerCount,
      totalDPS: state.defense.totalDPS,
      livesPercent: state.player.livesPercent,
      encoded_sample: Array.from(encoded.slice(0, 10)), // First 10 values
    });

    // Create ONNX tensor (shape: [1, 74])
    const inputTensor = new this.ort.Tensor('float32', encoded, [1, ENCODED_STATE_SIZE]);

    // Run inference
    const feeds = { state: inputTensor };
    const results = await this.session.run(feeds);

    // Get output tensor (name: 'action')
    const outputTensor = results.action;
    const output = outputTensor.data as Float32Array;

    // Debug: Log raw model output
    console.log('[AI] Raw output:', Array.from(output));

    // Decode output to WaveConfig
    return this.decodeModelOutput(output, state);
  }

  /**
   * Sigmoid activation function
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Decode neural network output to WaveConfig
   *
   * Output format (10 values) - must match backend model.py:
   * [0-5]  Enemy type logits (6 types)
   * [6]    kill_time param (raw, apply sigmoid)
   * [7]    count_factor param (raw, apply sigmoid)
   * [8]    delay_factor param (raw, apply sigmoid)
   * [9]    variation param (raw, apply sigmoid)
   */
  private decodeModelOutput(output: Float32Array, state: GameStateSnapshot): WaveConfig {
    // Extract enemy logits and raw continuous params
    const enemyLogits = Array.from(output.slice(0, 6));
    const rawParams = output.slice(6, 10);

    // Apply softmax to get enemy probabilities
    const enemyProbs = this.softmax(enemyLogits);

    // Apply sigmoid transforms to continuous params (matching backend server.py)
    const killTime = AI_CONSTANTS.KILL_TIME_MIN +
      this.sigmoid(rawParams[0]) * (AI_CONSTANTS.KILL_TIME_MAX - AI_CONSTANTS.KILL_TIME_MIN);
    const countFactor = this.sigmoid(rawParams[1]);
    const delayFactor = this.sigmoid(rawParams[2]);
    const variation = this.sigmoid(rawParams[3]) * AI_CONSTANTS.VARIATION_MAX;

    // Select enemy type with variety rules (like backend)
    let enemyType = this.selectEnemyTypeWithVariety(enemyProbs, state.waveNumber);

    // Track this type for future cooldown
    this.recentEnemyTypes.push(enemyType);
    if (this.recentEnemyTypes.length > this.TYPE_COOLDOWN_WAVES) {
      this.recentEnemyTypes.shift();
    }

    const maxProb = Math.max(...enemyProbs);

    // Calculate count based on tower count (matching backend server.py)
    const towerCount = Math.max(1, state.defense.towerCount);
    const minCount = Math.max(5, towerCount + 1);
    const maxCount = Math.min(50, towerCount * 7);
    const totalCount = Math.round(minCount + countFactor * (maxCount - minCount));

    // Calculate spawn delay
    const spawnDelay = Math.round(
      AI_CONSTANTS.SPAWN_DELAY_MIN +
      delayFactor * (AI_CONSTANTS.SPAWN_DELAY_MAX - AI_CONSTANTS.SPAWN_DELAY_MIN)
    );

    // Calculate health multiplier (DPS-relative HP, matching backend)
    const effectiveDPS = enemyType === 'bat'
      ? Math.max(10, state.defense.antiAirDPS)
      : Math.max(25, state.defense.totalDPS);
    const enemyHP = effectiveDPS * killTime;
    const baseHP = ENEMY_BASE_HP[enemyType];
    const healthMultiplier = Math.min(
      enemyHP / baseHP,
      AI_CONSTANTS.HEALTH_MULTIPLIER_MAX
    );

    // Determine archetype
    const archetype = this.inferArchetypeFromType(enemyType, totalCount);

    return {
      enemies: [{
        type: enemyType,
        count: totalCount,
        healthMultiplier: Math.round(healthMultiplier * 100) / 100,
      }],
      totalCount,
      spawnDelay,
      spawnDelayVariation: variation,
      useGathering: false,
      archetype,
      confidence: maxProb,
      difficultyModifier: 0,
    };
  }

  /**
   * Softmax function for probability distribution
   */
  private softmax(values: number[]): number[] {
    const max = Math.max(...values);
    const exps = values.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  }

  /**
   * Select enemy type with variety rules (matching backend server.py)
   */
  private selectEnemyTypeWithVariety(probs: number[], waveNumber: number): EnemyTypeId {
    // Early waves: force zombie
    if (waveNumber < 2) {
      console.log('[AI] Early wave, forcing zombie');
      return 'zombie';
    }

    // Waves 2-3: limited selection (zombie, tank, penguin)
    if (waveNumber < 4) {
      const allowed = [0, 2, 4]; // zombie, tank, penguin indices
      const allowedProbs = allowed.map(i => probs[i]);
      const bestAllowedIdx = allowed[allowedProbs.indexOf(Math.max(...allowedProbs))];
      console.log('[AI] Limited wave, selecting from allowed types');
      return ENEMY_TYPES[bestAllowedIdx];
    }

    // Sort indices by probability (descending)
    const sortedIndices = probs
      .map((p, i) => ({ prob: p, idx: i }))
      .sort((a, b) => b.prob - a.prob)
      .map(x => x.idx);

    // Find best type not on cooldown
    for (const idx of sortedIndices) {
      const candidateType = ENEMY_TYPES[idx];
      if (!this.recentEnemyTypes.includes(candidateType)) {
        console.log('[AI] Selected', candidateType, '(not on cooldown)');
        return candidateType;
      }
    }

    // All on cooldown, just pick the best
    console.log('[AI] All types on cooldown, picking best:', ENEMY_TYPES[sortedIndices[0]]);
    return ENEMY_TYPES[sortedIndices[0]];
  }

  /**
   * Infer wave archetype from enemy type and count
   */
  private inferArchetypeFromType(
    enemyType: EnemyTypeId,
    totalCount: number
  ): WaveConfig['archetype'] {
    if (enemyType === 'herbert') return 'boss';
    if (enemyType === 'bat') return 'air';
    if (enemyType === 'tank' || enemyType === 'wallsmasher') return 'siege';
    if (enemyType === 'penguin') return 'rush';
    if (totalCount > 30) return 'swarm';
    return 'mixed';
  }

  /**
   * Called after wave completes - for potential online learning
   */
  onWaveCompleted(result: WaveResult): void {
    // Currently just logs - training happens in backend
    if (this.debugMode()) {
      console.log('[AI] Wave result:', result);
      console.log('[AI] Reward would be:', this.calculateReward(result));
    }
  }

  /**
   * Calculate reward for training (preview)
   */
  private calculateReward(result: WaveResult): number {
    const damagePct = result.outcome.damagePercent;

    let reward = 0;

    // Sweet spot: 10-30% damage
    if (damagePct >= 0.1 && damagePct <= 0.3) {
      reward = 1.0;
    } else if (damagePct < 0.1) {
      reward = -0.5 * ((0.1 - damagePct) / 0.1);
    } else if (damagePct > 0.5) {
      reward = -0.5 * ((damagePct - 0.5) / 0.5);
    } else {
      reward = 0.5;
    }

    if (result.outcome.wasCloseCall && result.outcome.playerSurvived) {
      reward += 0.3;
    }

    if (!result.outcome.playerSurvived) {
      reward -= 1.0;
    }

    return reward;
  }

  // === PUBLIC API ===

  /**
   * Enable/disable AI
   */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.session) {
        this.aiMode.set('inference');
      } else {
        this.aiMode.set('fallback');
      }
    } else {
      this.aiMode.set('disabled');
    }
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode.set(enabled);
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.debugMode();
  }

  /**
   * Get difficulty rating for current decision
   */
  getCurrentDifficulty(): number {
    const config = this.lastDecision();
    if (!config) return 0;

    return getWaveDifficulty(config, 1); // Wave number doesn't matter much
  }

  /**
   * Force fallback mode (for testing)
   */
  forceFallbackMode(): void {
    this.aiMode.set('fallback');
    console.log('[AI] Forced to fallback mode');
  }
}
