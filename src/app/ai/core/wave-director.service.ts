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
import { EnemyTypeId, getEnemyType } from '../../models/enemy-types';

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

/**
 * Enemy base HP — must match config.py ENEMY_BASE_HP.
 * Expanded from 6 to all 16 enemies for Phase 5.5 (full armor-type coverage).
 */
const ENEMY_BASE_HP: Record<string, number> = {
  zombie: 80,
  rat: 5,
  penguin: 30,
  wallsmasher: 200,
  bat: 25,
  hornet: 80,
  spider: 60,
  'zombie-soldier': 160,
  tank: 250,
  bear: 300,
  dragon: 450,
  mech: 500,
  mammoth: 400,
  herbert: 500,
  ghost: 120,
  wraith: 100,
};

/**
 * Enemy type order — must match backend model output.
 * Order matters: NN output logits[i] corresponds to ENEMY_TYPES[i].
 */
const ENEMY_TYPES: EnemyTypeId[] = [
  'zombie', 'rat', 'penguin',                           // Unarmored (3)
  'wallsmasher', 'bat', 'hornet', 'spider',             // Light (4, air: bat+hornet)
  'zombie-soldier', 'tank', 'bear', 'dragon', 'mech',   // Heavy (5, air: dragon)
  'mammoth', 'herbert',                                  // Fortified (2, boss: herbert)
  'ghost', 'wraith',                                     // Ethereal (2)
];

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
  private recentEnemyTypes: EnemyTypeId[] = []; // Track recent (dominant) types for variety
  private readonly TYPE_COOLDOWN_WAVES = 6; // Don't repeat same dominant type within N waves (expanded pool → longer cooldown)

  // ==================== Mixed-Wave Decoder (Top-K) ====================
  /** Min prob to include a type as a separate group in mixed waves */
  private readonly MIXED_WAVE_THRESHOLD = 0.15;
  /** Max number of enemy groups per wave */
  private readonly MAX_GROUPS = 3;

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
        config = await this.runInference(state);
      } else {
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


    // Create ONNX tensor (shape: [1, 74])
    const inputTensor = new this.ort.Tensor('float32', encoded, [1, ENCODED_STATE_SIZE]);

    // Run inference
    const feeds = { state: inputTensor };
    const results = await this.session.run(feeds);

    // Get output tensor (name: 'action')
    const outputTensor = results.action;
    const output = outputTensor.data as Float32Array;

    // Debug: Log raw model output

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
    // Extract enemy logits (16 types) and raw continuous params (4)
    const numEnemies = ENEMY_TYPES.length;
    const enemyLogits = Array.from(output.slice(0, numEnemies));
    const rawParams = output.slice(numEnemies, numEnemies + 4);

    // Apply softmax to get enemy probabilities
    let enemyProbs = this.softmax(enemyLogits);

    // Apply fairness-gate mask (only allow enemies with available counter-tech)
    enemyProbs = this.applyFairnessMask(enemyProbs, state);

    // Apply sigmoid transforms to continuous params (matching backend server.py)
    const killTime = AI_CONSTANTS.KILL_TIME_MIN +
      this.sigmoid(rawParams[0]) * (AI_CONSTANTS.KILL_TIME_MAX - AI_CONSTANTS.KILL_TIME_MIN);
    const countFactor = this.sigmoid(rawParams[1]);
    const delayFactor = this.sigmoid(rawParams[2]);
    const variation = this.sigmoid(rawParams[3]) * AI_CONSTANTS.VARIATION_MAX;

    // Calculate total enemy count first (shared across groups)
    const towerCount = Math.max(1, state.defense.towerCount);
    const minCount = Math.max(5, towerCount + 1);
    const maxCount = Math.min(50, towerCount * 7);
    const totalCount = Math.round(minCount + countFactor * (maxCount - minCount));

    // Top-K multi-group selection (Mixed Waves) — falls back to single-group
    // when waveNumber<2 (zombie-only) or when threshold filters all enemies.
    const groups = this.selectEnemyGroupsTopK(enemyProbs, totalCount, state.waveNumber);

    // Track dominant (first) type for cooldown
    if (groups.length > 0) {
      this.recentEnemyTypes.push(groups[0].type);
      if (this.recentEnemyTypes.length > this.TYPE_COOLDOWN_WAVES) {
        this.recentEnemyTypes.shift();
      }
    }

    const maxProb = Math.max(...enemyProbs);

    // Calculate spawn delay
    const spawnDelay = Math.round(
      AI_CONSTANTS.SPAWN_DELAY_MIN +
      delayFactor * (AI_CONSTANTS.SPAWN_DELAY_MAX - AI_CONSTANTS.SPAWN_DELAY_MIN)
    );

    // Calculate health multiplier per group (DPS-relative, different for air vs ground)
    const enemies = groups.map(g => {
      const isAir = this.isAirEnemy(g.type);
      const effectiveDPS = isAir
        ? Math.max(10, state.defense.antiAirDPS)
        : Math.max(25, state.defense.totalDPS);
      const enemyHP = effectiveDPS * killTime;
      const baseHP = ENEMY_BASE_HP[g.type];
      const healthMultiplier = Math.min(
        enemyHP / baseHP,
        AI_CONSTANTS.HEALTH_MULTIPLIER_MAX
      );
      return {
        type: g.type,
        count: g.count,
        healthMultiplier: Math.round(healthMultiplier * 100) / 100,
      };
    });

    // Determine archetype from dominant type
    const archetype = this.inferArchetypeFromType(groups[0]?.type ?? 'zombie', totalCount);

    return {
      enemies,
      totalCount,
      spawnDelay,
      spawnDelayVariation: variation,
      // Pattern for mixed waves — hardcoded 'interleaved' for now (AB AB AB)
      pattern: enemies.length > 1 ? 'interleaved' : undefined,
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
   * Check if an enemy type is an air unit (via config).
   * Used to decide effective DPS in HP-multiplier calculation.
   */
  private isAirEnemy(type: EnemyTypeId): boolean {
    return !!getEnemyType(type)?.isAirUnit;
  }

  /**
   * Check if an enemy type is allowed given current research state.
   * Fairness: don't spawn enemies the player has no counter for.
   */
  private isEnemyAllowed(type: EnemyTypeId, state: GameStateSnapshot): boolean {
    const cfg = getEnemyType(type);
    if (!cfg) return false;
    const research = state.research;
    if (!research) return true; // safety: no research state → allow all

    // Air enemies: require ice, rocket, or AA Retrofit perk
    if (cfg.isAirUnit) {
      const hasAntiAir =
        research.towerUnlocked['ice'] ||
        research.towerUnlocked['rocket'] ||
        research.airTargetingUnlocked;
      if (!hasAntiAir) return false;
    }

    // Ethereal enemies: require magic or ice counter
    if (cfg.armorType === 'ethereal') {
      const hasEtherealCounter =
        research.towerUnlocked['magic'] ||
        research.towerUnlocked['ice'];
      if (!hasEtherealCounter) return false;
    }

    return true;
  }

  /**
   * Zero out probabilities for enemies blocked by fairness-gates, then renormalize.
   * Returns the original probs if nothing survives (caller falls back).
   */
  private applyFairnessMask(probs: number[], state: GameStateSnapshot): number[] {
    const masked = probs.map((p, i) => this.isEnemyAllowed(ENEMY_TYPES[i], state) ? p : 0);
    const sum = masked.reduce((a, b) => a + b, 0);
    if (sum <= 0) return probs;  // nothing allowed — fall back to original
    return masked.map(p => p / sum);
  }

  /**
   * Select enemy groups via Top-K (Mixed Waves).
   * - Wave 0-1: single zombie group (training-wheels)
   * - Wave 2-3: single group from limited pool (unarmored only)
   * - Wave 4+: Top-K groups (probs > threshold, max MAX_GROUPS)
   *
   * Counts allocated proportionally to probabilities.
   * Returns at least one group (falls back to argmax if threshold filters all).
   */
  private selectEnemyGroupsTopK(
    probs: number[],
    totalCount: number,
    waveNumber: number,
  ): { type: EnemyTypeId; count: number }[] {
    // Early wave: force zombie only
    if (waveNumber < 2) {
      return [{ type: 'zombie', count: totalCount }];
    }

    // Waves 2-3: single-type from unarmored pool (easier for player to handle)
    if (waveNumber < 4) {
      const type = this.selectEnemyTypeWithVariety(probs, waveNumber);
      return [{ type, count: totalCount }];
    }

    // Wave 4+: Top-K selection
    const candidates = probs
      .map((p, i) => ({ type: ENEMY_TYPES[i], prob: p }))
      .filter(c => c.prob > this.MIXED_WAVE_THRESHOLD)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, this.MAX_GROUPS);

    // Threshold filtered everything → single-group fallback via argmax
    if (candidates.length === 0) {
      const type = this.selectEnemyTypeWithVariety(probs, waveNumber);
      return [{ type, count: totalCount }];
    }

    // Allocate counts proportionally to probabilities (last group gets remainder)
    const probSum = candidates.reduce((s, c) => s + c.prob, 0);
    const groups: { type: EnemyTypeId; count: number }[] = [];
    let allocated = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const count = i === candidates.length - 1
        ? Math.max(1, totalCount - allocated)
        : Math.max(1, Math.round(totalCount * (c.prob / probSum)));
      groups.push({ type: c.type, count });
      allocated += count;
    }
    return groups;
  }

  /**
   * Select enemy type with variety rules (matching backend server.py).
   * Respects fairness-mask: enemies with prob=0 are skipped.
   */
  private selectEnemyTypeWithVariety(probs: number[], waveNumber: number): EnemyTypeId {
    // Early waves: force zombie (always unarmored, safe choice)
    if (waveNumber < 2) {
      return 'zombie';
    }

    // Waves 2-3: limited to unarmored enemies only (zombie, rat, penguin)
    // Index-based so it survives pool changes
    if (waveNumber < 4) {
      const allowedTypes: EnemyTypeId[] = ['zombie', 'rat', 'penguin'];
      const allowed = allowedTypes
        .map(t => ENEMY_TYPES.indexOf(t))
        .filter(i => i >= 0);
      const allowedProbs = allowed.map(i => probs[i]);
      const bestAllowedIdx = allowed[allowedProbs.indexOf(Math.max(...allowedProbs))];
      return ENEMY_TYPES[bestAllowedIdx];
    }

    // Sort indices by probability (descending). Masked-out enemies have prob=0.
    const sortedIndices = probs
      .map((p, i) => ({ prob: p, idx: i }))
      .filter(x => x.prob > 0)   // skip fairness-blocked enemies
      .sort((a, b) => b.prob - a.prob)
      .map(x => x.idx);

    if (sortedIndices.length === 0) {
      // All blocked (fallback) — just return zombie
      return 'zombie';
    }

    // Find best type not on cooldown
    for (const idx of sortedIndices) {
      const candidateType = ENEMY_TYPES[idx];
      if (!this.recentEnemyTypes.includes(candidateType)) {
        return candidateType;
      }
    }

    // All on cooldown, just pick the best
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
  }
}
