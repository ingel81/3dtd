/**
 * Wave Director Service — template-based wave generation.
 *
 * Loads the ONNX model and decodes its output into a WaveConfig. During
 * training the Python backend picks waves over the WebSocket instead; this
 * local ONNX path is only used in standalone play.
 *
 * If the model fails to load and no backend is available the service throws.
 * There is no rule-based fallback — the AI-off path is the static wave
 * profiles in `wave-curriculum.config.ts`, selected upstream.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { explainWaveDecision, DecisionExplanation, formatExplanationForUI } from './decision-explainer';
import { encodeGameState, ENCODED_STATE_SIZE } from './game-state-encoder';
import {
  MAX_TEMPLATE_SLOTS,
  MAX_WAVE_DURATION_MS,
  MIN_SPAWN_DELAY_MS,
  DPS_RAMP_FLOOR,
  DPS_RAMP_COUNT,
  DPS_RAMP_HP_MULT,
  getTemplate,
  lerpRange,
  fairMaxCount,
} from './templates';
import { buildWaveContext, type WaveContext } from './wave-context';
import { RuleDirector, type DirectorDecision } from './rule-director';
import { GateController } from './gate-controller';
import { ENEMY_TYPES, type EnemyTypeId } from '../../configs/enemy-types.config';
import { endgameHpMultiplier, enemyBaseDamageForWave } from '../../configs/wave-curriculum.config';

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'rules';

/** AI Mode */
type AIMode = 'inference' | 'rules' | 'training' | 'disabled';

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
  // Rules are the DEFAULT, not a degraded mode.
  //
  // Measured across a day of A/B runs sharing bots, curriculum and fairness
  // gate: the ONNX policy was three times statistically indistinguishable from
  // uniform random (mean run 45.6 [42,49] vs 44.7 [41,48]), while two trivial
  // heuristics produced measurably more tension (near-miss 0.067 vs 0.045).
  // A dependency that costs 404 kB of ONNX runtime and a load-failure path has
  // to earn its place, and this one does not yet.
  readonly modelState = signal<ModelState>('rules');
  readonly aiMode = signal<AIMode>('rules');
  readonly lastDecision = signal<WaveConfig | null>(null);
  readonly lastExplanation = signal<DecisionExplanation | null>(null);
  readonly inferenceTimeMs = signal(0);

  readonly isReady = computed(() => {
    const state = this.modelState();
    return state === 'ready' || state === 'rules';
  });

  readonly statusText = computed(() => {
    switch (this.modelState()) {
      case 'not-loaded':
        return 'AI nicht geladen';
      case 'loading':
        return 'AI wird geladen...';
      case 'ready':
        return 'AI bereit (ONNX)';
      case 'rules':
        return 'Regel-Director aktiv';
      case 'error':
        return 'AI Fehler';
    }
  });

  // === DEBUG MODE ===
  private debugMode = signal(false);

  private readonly ruleDirector = new RuleDirector();
  readonly gate = new GateController();

  constructor() {
    // Subscribe the fairness gate to completed waves.
    //
    // This wiring is the whole point of the controller and it was missing on
    // first write: `onWaveCompleted` had no caller anywhere in the project, so
    // the multiplier stayed at 1.0 forever and the cap sat back on "exactly
    // what the towers can kill" — the 70%-killed-everything state the loop
    // exists to break. Every unit test passed regardless, because they all
    // exercised the controller in isolation.
    //
    // The collector's hook is used rather than the `wave:completed` event: that
    // event is not emitted when the base falls, so the death back-off would
    // have been unreachable.
    this.dataCollector.onWaveResult((result) => this.onWaveCompleted(result));

    // No ONNX load on startup.
    //
    // The model used to be fetched eagerly and switched on the moment it
    // arrived. That made a 404 kB runtime and a network round-trip part of
    // every cold start for a director that measured no better than uniform
    // random. Call loadModel() explicitly to opt in.
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
        // No model file. Not an error: rules are the product, the model is the
        // opt-in that has not yet shown it beats them.
        console.log('[AI] No model file found, staying on the rule director');
        this.modelState.set('rules');
        this.aiMode.set('rules');
        return false;
      }
    } catch (error) {
      console.error('[AI] Failed to load ONNX Runtime', error);
      this.modelState.set('error');
      this.aiMode.set('rules');
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

    const state = this.dataCollector.getStateSnapshot();

    // Rules unless the ONNX policy was explicitly loaded AND is live. This is
    // no longer an error path: the model is the opt-in, the rules are the
    // product.
    const useModel = this.aiMode() === 'inference' && !!this.session && !!this.ort;
    const config = useModel
      ? await this.runInference(state)
      : this.runRules(state);

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
   * Rule-based decision, through the same decoder the model output uses.
   *
   * The fairness cap is corrected by the gate controller, which is the piece
   * that was previously server-only. Without it the cap sits on "exactly what
   * the towers can kill" and therefore guarantees they kill it: measured over
   * 1834 waves, 70% of waves killed everything and 80% dealt no damage at all.
   */
  private runRules(state: GameStateSnapshot): WaveConfig {
    const waveContext = buildWaveContext(state, this.recentTemplateIndices);
    const decision = this.ruleDirector.decide(
      waveContext.mask,
      state.waveNumber + 1,
      this.recentTemplateIndices,
    );
    // A rule director simply decided; there is no distribution to read a
    // confidence out of.
    return this.buildWaveConfig(decision, state, 1);
  }

  /**
   * Run ONNX neural network inference
   */
  private async runInference(state: GameStateSnapshot): Promise<WaveConfig> {
    if (!this.ort || !this.session) {
      throw new Error('Model not loaded');
    }

    // One context for the whole decision: it feeds the model's wave-context
    // features AND filters the model's template output, so the two cannot
    // describe different sets of legal templates.
    const waveContext = buildWaveContext(state, this.recentTemplateIndices);
    const encoded = encodeGameState(state, waveContext);


    // Create ONNX tensor (shape: [1, ENCODED_STATE_SIZE])
    const inputTensor = new this.ort.Tensor('float32', encoded, [1, ENCODED_STATE_SIZE]);

    // Run inference
    const feeds = { state: inputTensor };
    const results = await this.session.run(feeds);

    // Get output tensor (name: 'action')
    const outputTensor = results.action;
    const output = outputTensor.data as Float32Array;

    // Debug: Log raw model output

    // Decode output to WaveConfig
    return this.decodeModelOutput(output, state, waveContext);
  }

  /**
   * Sigmoid activation function
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Decode NN output to WaveConfig (Phase 5.11 Range-Based Templates).
   *
   * Expected output layout (36 values) — must match backend model.py:
   *   [0..MAX_TEMPLATE_SLOTS-1]                template logits (32 slots)
   *   [MAX_TEMPLATE_SLOTS..+NUM_CONTINUOUS-1]  4 raw continuous params
   *                                            (count, spawn_delay, hp_mult, variation)
   */
  private decodeModelOutput(
    output: Float32Array,
    state: GameStateSnapshot,
    waveContext: WaveContext,
  ): WaveConfig {
    const templateLogits = Array.from(output.slice(0, MAX_TEMPLATE_SLOTS));
    const rawParams = output.slice(MAX_TEMPLATE_SLOTS, MAX_TEMPLATE_SLOTS + 4);

    // Availability mask, built by the shared wave-context helper so the mask
    // the model was *fed* (see game-state-encoder) and the mask its output is
    // *filtered by* here can never disagree. Inside the curriculum it collapses
    // to a single slot, so the argmax below has one candidate and the wave that
    // ships is the one the designer pinned. Past the curriculum it is a real
    // choice.
    const mask = waveContext.mask;

    const maskedLogits = templateLogits.map((l, i) => mask[i] ? l : -Infinity);
    const probs = this.softmax(maskedLogits);

    let bestIdx = -1;
    let bestProb = -1;
    for (let i = 0; i < probs.length; i++) {
      if (mask[i] && probs[i] > bestProb) {
        bestProb = probs[i];
        bestIdx = i;
      }
    }

    return this.buildWaveConfig(
      {
        templateIdx: bestIdx,
        countFactor: this.sigmoid(rawParams[0]),
        spawnFactor: this.sigmoid(rawParams[1]),
        hpFactor: this.sigmoid(rawParams[2]),
        variationFactor: this.sigmoid(rawParams[3]),
      },
      state,
      bestProb,
    );
  }

  /**
   * Turn a director's five numbers into a shippable wave.
   *
   * Everything here is shared between the model and the rule director: the
   * template lookup, range interpolation, the DPS ramp, the endgame
   * multiplier, the fairness cap and the duration cap. Only the choice of
   * template and factors differs between them, which is what makes an A/B
   * between the two honest — and what made it possible to measure that the
   * trained model was indistinguishable from uniform random sampling.
   */
  private buildWaveConfig(
    decision: DirectorDecision,
    state: GameStateSnapshot,
    confidence: number,
  ): WaveConfig {
    const upcomingWave = state.waveNumber + 1;
    let bestIdx = decision.templateIdx;
    const bestProb = confidence;

    // An invalid index means the mask and the template table disagree, which is
    // a real bug worth shouting about — but not one worth ending the wave over.
    // Throwing here propagates to the facade, which disables the director and
    // drops to manual waves; the Python decoder logs and ships slot 0 instead,
    // and a degraded AI wave beats no AI wave.
    let template = bestIdx >= 0 ? getTemplate(bestIdx) : null;
    if (!template) {
      console.error(`[AI] Director selected invalid template index ${bestIdx} — using slot 0`);
      template = getTemplate(0);
      bestIdx = 0;
      if (!template) {
        throw new Error('[AI] Template table is empty');
      }
    }

    const { countFactor, spawnFactor, hpFactor, variationFactor } = decision;

    // DPS-scaled range caps for difficulty axes (count, hp_mult). Weak defense
    // → narrow effective range; strong defense → full range.
    const totalDPS = Math.max(0, state.defense?.totalDPS ?? 0);
    const dpsFracCount = Math.max(DPS_RAMP_FLOOR, Math.min(1.0, totalDPS / DPS_RAMP_COUNT));
    const dpsFracHp = Math.max(DPS_RAMP_FLOOR, Math.min(1.0, totalDPS / DPS_RAMP_HP_MULT));
    const lerpCapped = (rng: readonly [number, number], factor: number, dpsFrac: number): number => {
      const effMax = rng[0] + (rng[1] - rng[0]) * dpsFrac;
      return rng[0] + (effMax - rng[0]) * factor;
    };

    let spawnDelay = Math.max(MIN_SPAWN_DELAY_MS, Math.round(lerpRange(template.spawnDelayRange, spawnFactor)));
    // Phase 5.16: post-NN endgame multiplier compounds onto the NN's hp_mult so
    // late waves get steeper without retraining (W30 ≈ ×1.5, W50 ≈ ×2.5, cap 4×).
    const baseHpMult = lerpCapped(template.hpMultRange, hpFactor, dpsFracHp);
    const hpMult = Math.round(baseHpMult * endgameHpMultiplier(upcomingWave) * 1000) / 1000;
    const variation = Math.round(lerpRange(template.variationRange, variationFactor) * 1000) / 1000;

    // Fairness gate: never ship a wave the defense cannot plausibly fight.
    // Applied after the HP multipliers so it judges the enemies as they will
    // actually spawn.
    //
    // The gate INTERPOLATES rather than clamps, mirroring `_decode_action` in
    // the training backend. Clamping after the fact discarded the model's
    // choice on most waves and mapped every count factor above the cap onto an
    // identical wave — a flat region the policy cannot express a preference in,
    // and during training a chosen action paired with a different executed one.
    // Folding the cap into the range keeps chosen == executed; the factor means
    // "how far into what is currently allowed", and the cap is already part of
    // the model's observation.
    //
    // Recomputed against the template that was actually chosen and the factors
    // that were actually emitted — the context's value is a coarse ceiling
    // signal for the model, this is the binding decision.
    const countLo = template.countRange[0];
    const dpsScaledMax = lerpRange(template.countRange, dpsFracCount);
    const countFor = (delay: number): { count: number; cap: number | null } => {
      const cap = fairMaxCount(
        template,
        hpMult,
        delay,
        state.defense?.effectiveDPSPerArmor,
        state.defense?.killThroughput,
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseHp ?? 80,
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
        state.player?.lives ?? 100,
        enemyBaseDamageForWave(upcomingWave),
        // Closed-loop correction. FAIRNESS_KILL_REALISM was measured on waves
        // 1-10 and understates the defense from wave 11 on; this is the only
        // thing that notices.
        this.gate.budgetMultiplier,
      );
      // The gate outranks the template minimum. A cap BELOW countRange[0] means
      // the defense cannot handle even the smallest wave the designer wrote,
      // and shipping the minimum anyway makes early runs far more lethal than
      // intended. Collapse the range onto the cap instead.
      let lo = countLo;
      let hi = dpsScaledMax;
      if (cap !== null) {
        lo = Math.min(lo, cap);
        hi = Math.max(lo, Math.min(hi, cap));
      }
      return { count: Math.max(1, Math.round(lo + (hi - lo) * countFactor)), cap };
    };

    let totalCount = countFor(spawnDelay).count;

    // Wave-duration cap: compress spawn_delay if total would exceed 3 min.
    const totalDuration = totalCount * spawnDelay;
    if (totalDuration > MAX_WAVE_DURATION_MS) {
      spawnDelay = Math.max(MIN_SPAWN_DELAY_MS, Math.floor(MAX_WAVE_DURATION_MS / totalCount));
      // Re-derive against the compressed delay. A slow mega-wave can clear the
      // gate precisely BECAUSE its long spawn window gives the defense time,
      // and the compression then multiplies the spawn rate — so without this
      // the gate is bypassed by exactly the waves it exists to stop. The
      // backend has always done this second pass; the frontend did not.
      totalCount = countFor(spawnDelay).count;
    }

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

    this.recentTemplateIndices.push(bestIdx);
    if (this.recentTemplateIndices.length > 5) {
      this.recentTemplateIndices.shift();
    }

    return {
      enemies,
      totalCount: enemies.reduce((s, e) => s + e.count, 0),
      spawnDelay,
      spawnDelayVariation: variation,
      pattern: template.spawnPattern ?? undefined,
      confidence: bestProb,
      templateIdx: bestIdx,
      templateName: template.name,
      templateStrength: hpMult,
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
    // Feed the fairness gate. This is the loop that sizes the next wave, so it
    // has to see every completed wave — not just the ones a debug flag prints.
    const progress = result.outcome.enemyProgressValues ?? [];
    // null, not 0: a wave with no per-enemy data is no evidence either way.
    const leakRatio = progress.length > 0
      ? progress.filter(p => p >= 1).length / progress.length
      : null;
    const survived = result.outcome.playerSurvived !== false;
    this.gate.recordWave(leakRatio, survived);

    if (this.debugMode()) {
      console.log('[AI] Wave result:', result);
      console.log('[AI] Leak ratio:', leakRatio, 'gate x', this.gate.budgetMultiplier);
    }
  }

  /**
   * Clear per-run state. Must be called when a new game starts: the gate
   * multiplier is a per-RUN correction, and letting it survive into the next
   * game made it a ratchet that opened fresh runs against waves sized for a
   * defense that had already been dismantled. Median run length under that bug
   * was 6 waves against a target of 80.
   */
  resetForNewGame(): void {
    this.gate.reset();
    this.recentTemplateIndices = [];
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
        this.aiMode.set('rules');
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
    // Phase 5.11: derive from templateStrength (hp_mult) + count size.
    // hp_mult ranges vary per template (up to 10× for mech/mammoth); normalize against 10.
    const hpMult = config.templateStrength ?? 1.0;
    const hpNorm = Math.min(1, hpMult / 10);
    const countNorm = Math.min(1, config.totalCount / 1000);
    return Math.min(1, hpNorm * 0.5 + countNorm * 0.5);
  }

  /**
   * Switch back to the rule director, dropping the ONNX policy if one is live.
   */
  forceRuleMode(): void {
    this.aiMode.set('rules');
    this.modelState.set('rules');
  }
}
