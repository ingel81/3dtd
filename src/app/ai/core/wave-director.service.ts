/**
 * Wave Director Service
 *
 * Central AI service that determines wave configurations.
 * Uses TensorFlow.js model when available, falls back to rules otherwise.
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

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'fallback';

/** AI Mode */
type AIMode = 'inference' | 'fallback' | 'training' | 'disabled';

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class WaveDirectorService {
  private dataCollector = inject(AIDataCollectorService);

  // === STATE ===
  private model: unknown = null; // TensorFlow model (lazy loaded)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tf: any = null; // TensorFlow.js (lazy loaded)

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
        return 'AI bereit';
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
   * Load TensorFlow.js and model
   */
  async loadModel(): Promise<boolean> {
    if (this.modelState() === 'ready') return true;

    this.modelState.set('loading');

    try {
      // Lazy load TensorFlow.js
      if (!this.tf) {
        this.tf = await import('@tensorflow/tfjs');
        console.log('[AI] TensorFlow.js loaded');
      }

      // Try to load model from assets
      try {
        this.model = await this.tf.loadLayersModel('/assets/ai/wave-director/model.json');
        this.modelState.set('ready');
        this.aiMode.set('inference');
        console.log('[AI] Model loaded successfully');
        return true;
      } catch {
        // Model file not found - use fallback
        console.log('[AI] No model file found, using fallback rules');
        this.modelState.set('fallback');
        this.aiMode.set('fallback');
        return false;
      }
    } catch (error) {
      console.error('[AI] Failed to load TensorFlow.js', error);
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
      if (this.aiMode() === 'inference' && this.model && this.tf) {
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
        useGathering: false, // Deprecated
        explanation: 'Notfall-Fallback (AI-Fehler)',
      };
    }
  }

  /**
   * Run neural network inference
   */
  private async runInference(state: GameStateSnapshot): Promise<WaveConfig> {
    if (!this.tf || !this.model) {
      throw new Error('Model not loaded');
    }

    // Encode state to tensor
    const encoded = encodeGameState(state);

    // Run prediction with memory cleanup
    const output = this.tf.tidy(() => {
      const inputTensor = this.tf!.tensor2d([Array.from(encoded)], [1, ENCODED_STATE_SIZE]);
      const prediction = (this.model as { predict: (x: unknown) => { dataSync: () => Float32Array } }).predict(inputTensor);
      return prediction.dataSync();
    });

    // Decode output to WaveConfig
    return this.decodeModelOutput(output, state.waveNumber);
  }

  /**
   * Decode neural network output to WaveConfig
   */
  private decodeModelOutput(output: Float32Array, _waveNumber: number): WaveConfig {
    // Output format (15 values):
    // [0-7]   Enemy type probabilities (softmax)
    // [8]     Total count factor (0-1 -> 5-50 enemies)
    // [9]     Spawn delay factor (0-1 -> 300-2000ms)
    // [10]    Spawn delay variation (0-0.5)
    // [11-14] Reserved for future use

    const enemyTypes = ['zombie', 'bat', 'tank', 'wallsmasher', 'herbert'];
    const probs = this.softmax(Array.from(output.slice(0, 5)));

    // Calculate enemy counts based on probabilities
    const baseTotalCount = 5 + Math.round(output[8] * 45); // 5-50
    const enemies = enemyTypes
      .map((type, i) => ({
        type,
        count: Math.round(probs[i] * baseTotalCount),
      }))
      .filter((e) => e.count > 0);

    // Ensure at least one enemy
    if (enemies.length === 0) {
      enemies.push({ type: 'zombie', count: Math.max(5, baseTotalCount) });
    }

    const spawnDelay = 300 + Math.round(output[9] * 1700); // 300-2000ms
    const spawnDelayVariation = output[10] * 0.5; // 0-0.5

    // Determine archetype from dominant enemy type
    const dominantType = enemies.reduce((a, b) => (a.count > b.count ? a : b)).type;
    const archetype = this.inferArchetype(dominantType, enemies);

    return {
      enemies,
      totalCount: enemies.reduce((sum, e) => sum + e.count, 0),
      spawnDelay,
      spawnDelayVariation,
      useGathering: false, // Deprecated
      archetype,
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
   * Infer wave archetype from enemy composition
   */
  private inferArchetype(
    dominantType: string,
    enemies: { type: string; count: number }[]
  ): WaveConfig['archetype'] {
    if (dominantType === 'herbert') return 'boss';
    if (dominantType === 'bat') return 'air';
    if (dominantType === 'tank' || dominantType === 'wallsmasher') return 'siege';

    const totalCount = enemies.reduce((sum, e) => sum + e.count, 0);
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
      if (this.model) {
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
