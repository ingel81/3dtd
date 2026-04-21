/**
 * Wave Director Service — Phase 5.10 Template-Based
 *
 * Loads the ONNX model (optional) and decodes its output into a Template-Based
 * WaveConfig. During training, the backend picks waves via WebSocket; the
 * local ONNX path is only used in standalone play.
 *
 * If the model fails to load AND no backend is available, the service throws
 * an explicit error — there is no rule-based fallback in Phase 5.10.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { explainWaveDecision, DecisionExplanation, formatExplanationForUI } from './decision-explainer';
import { encodeGameState, ENCODED_STATE_SIZE } from './game-state-encoder';
import {
  TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  STRENGTH_MIN,
  STRENGTH_MAX,
  COUNT_MIN,
  COUNT_MAX,
  getTemplate,
  getAvailableTemplateMask,
} from './templates';
import { EnemyTypeId } from '../../models/enemy-types';

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'fallback';

/** AI Mode */
type AIMode = 'inference' | 'fallback' | 'training' | 'disabled';

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
  /** Phase 5.10: template cooldown tracking (last 2 template indices) */
  private recentTemplateIndices: number[] = [];

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
        return 'Fehler: kein Model geladen';
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

    // Phase 5.10: no rule-based fallback — ONNX model is required for inference.
    if (this.aiMode() !== 'inference' || !this.session || !this.ort) {
      throw new Error(
        '[AI] Wave Director model is not available. Fallback-rules were removed '
        + 'in Phase 5.10; the ONNX model must load successfully for inference. '
        + 'Check network/onnx-wasm assets and reload the page.'
      );
    }

    const state = this.dataCollector.getStateSnapshot();
    const config = await this.runInference(state);

    // Generate explanation
    const explanation = explainWaveDecision(state, config);
    config.explanation = explanation.summary;
    config.confidence = explanation.confidence;

    this.lastDecision.set(config);
    this.lastExplanation.set(explanation);
    this.dataCollector.setCurrentWaveConfig(config);
    this.inferenceTimeMs.set(performance.now() - startTime);

    if (this.debugMode()) {
      console.log('[AI] Wave decision:', config);
      console.log('[AI] Explanation:', formatExplanationForUI(explanation));
    }

    return config;
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
   * Decode NN output to WaveConfig (Phase 5.10 Template-Based).
   *
   * Expected output layout (34 values) — must match backend model.py:
   *   [0..MAX_TEMPLATE_SLOTS-1]             template logits (32 slots)
   *   [MAX_TEMPLATE_SLOTS..+NUM_CONTINUOUS] raw continuous params (strength, count)
   */
  private decodeModelOutput(output: Float32Array, state: GameStateSnapshot): WaveConfig {
    const templateLogits = Array.from(output.slice(0, MAX_TEMPLATE_SLOTS));
    const rawParams = output.slice(MAX_TEMPLATE_SLOTS, MAX_TEMPLATE_SLOTS + 2);

    // Apply template availability mask
    const research = state.research;
    const hasAntiAir = !!(
      research?.towerUnlocked?.['ice']
      || research?.towerUnlocked?.['rocket']
      || research?.airTargetingUnlocked
    );
    const hasAntiEthereal = !!(
      research?.towerUnlocked?.['magic']
      || research?.towerUnlocked?.['ice']
    );
    const mask = getAvailableTemplateMask(
      state.waveNumber + 1,
      hasAntiAir,
      hasAntiEthereal,
      this.recentTemplateIndices,
    );

    // Mask and softmax
    const maskedLogits = templateLogits.map((l, i) => mask[i] ? l : -Infinity);
    const probs = this.softmax(maskedLogits);

    // Argmax for deterministic inference (client side; training uses sampling)
    let bestIdx = 0;
    let bestProb = -1;
    for (let i = 0; i < probs.length; i++) {
      if (mask[i] && probs[i] > bestProb) {
        bestProb = probs[i];
        bestIdx = i;
      }
    }

    const template = getTemplate(bestIdx);
    if (!template) {
      throw new Error(`[AI] Decoder selected invalid template index ${bestIdx}`);
    }

    // Scale continuous params
    const strength = STRENGTH_MIN + this.sigmoid(rawParams[0]) * (STRENGTH_MAX - STRENGTH_MIN);
    const countFactor = COUNT_MIN + this.sigmoid(rawParams[1]) * (COUNT_MAX - COUNT_MIN);

    const totalCount = Math.max(1, Math.round(template.baseCount * countFactor));
    const hpMult = Math.round(template.baseHpMult * strength * 1000) / 1000;

    // Expand template → enemy groups
    const enemies: { type: string; count: number; healthMultiplier: number }[] = [];
    let allocated = 0;
    for (let i = 0; i < template.enemies.length; i++) {
      const [type, share] = template.enemies[i];
      const count = i === template.enemies.length - 1
        ? Math.max(1, totalCount - allocated)
        : Math.max(1, Math.round(totalCount * share));
      allocated += count;
      enemies.push({ type, count, healthMultiplier: hpMult });
    }

    // Track for cooldown
    this.recentTemplateIndices.push(bestIdx);
    if (this.recentTemplateIndices.length > 5) {
      this.recentTemplateIndices.shift();
    }

    return {
      enemies,
      totalCount: enemies.reduce((s, e) => s + e.count, 0),
      spawnDelay: template.baseSpawnDelayMs,
      spawnDelayVariation: 0.2,
      pattern: template.spawnPattern ?? undefined,
      confidence: bestProb,
      templateIdx: bestIdx,
      templateName: template.name,
      templateStrength: Math.round(strength * 1000) / 1000,
    };
  }

  /**
   * Softmax function for probability distribution
   */
  private softmax(values: number[]): number[] {
    const finiteMax = Math.max(...values.filter(v => Number.isFinite(v)));
    const exps = values.map(v => (Number.isFinite(v) ? Math.exp(v - finiteMax) : 0));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    return exps.map(e => e / sum);
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
   * Get a coarse difficulty rating for the current wave decision (0-1).
   * Phase 5.10: derived from template strength + count factor + wave-number.
   */
  getCurrentDifficulty(): number {
    const config = this.lastDecision();
    if (!config) return 0;
    const strength = config.templateStrength ?? 1.0;
    const strengthNorm = Math.min(1, (strength - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN));
    const countNorm = Math.min(1, config.totalCount / 500);
    return Math.min(1, strengthNorm * 0.5 + countNorm * 0.5);
  }

  /**
   * Force fallback mode (for testing)
   */
  forceFallbackMode(): void {
    this.aiMode.set('fallback');
  }
}
