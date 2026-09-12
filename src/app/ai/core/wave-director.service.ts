/**
 * Wave Director Service — template-based wave generation.
 *
 * Decides the next wave and decodes that decision into a WaveConfig. The
 * decision comes from the rule director by default; the ONNX policy is an
 * opt-in loaded on demand from the debug window. During training the Python
 * backend picks waves over the WebSocket instead, upstream of this service.
 *
 * Nothing here throws for a missing model any more. Rules need no model, no
 * network and no ONNX runtime, so there is no startup window in which the
 * service cannot produce a wave — the earlier `'fallback'` state meant "error:
 * no model" and is now `'rules'`, meaning normal operation. The AI-off path
 * remains the static wave profiles in `wave-curriculum.config.ts`, selected
 * upstream.
 *
 * Why rules and not the model: measured across a day of A/B runs sharing the
 * same bots, curriculum and fairness gate, the trained policy was three times
 * statistically indistinguishable from uniform random sampling. See
 * `rule-director.ts` for the numbers and `docs/AI_WAVE_DIRECTOR_PLAN.md` for
 * the reasoning.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { explainWaveDecision, formatExplanation } from './decision-explainer';
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
  type TemplateMaskReason,
} from './templates';
import { buildWaveContext, type WaveContext } from './wave-context';
import { RuleDirector, type DirectorDecision } from './rule-director';
import { GateController } from './gate-controller';
import { ENEMY_TYPES, lineageHp, splitBodyCount, type EnemyTypeId } from '../../configs/enemy-types.config';
import { endgameHpMultiplier, enemyBaseDamageForWave } from '../../configs/wave-curriculum.config';
import type { InferenceSession } from 'onnxruntime-web';

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'rules';

/** AI Mode */
type AIMode = 'inference' | 'rules' | 'training' | 'disabled';

/** ONNX Runtime module type. Type-only: the runtime is imported lazily in loadModel(). */
type OrtModule = typeof import('onnxruntime-web');

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
  readonly inferenceTimeMs = signal(0);

  readonly isReady = computed(() => {
    const state = this.modelState();
    return state === 'ready' || state === 'rules';
  });

  readonly statusText = computed(() => {
    switch (this.modelState()) {
      case 'not-loaded':
        return 'Model not loaded';
      case 'loading':
        return 'Loading model...';
      case 'ready':
        return 'ONNX model active';
      case 'rules':
        return 'Rule director active';
      case 'error':
        return 'Model error';
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
        this.ort.env.wasm.wasmPaths = 'assets/onnx-wasm/';
        // Suppress WASM internal logs ("Unknown CPU vendor" etc.)
        this.ort.env.logLevel = 'error';

        console.log('[AI] ONNX Runtime Web loaded');
      }

      // Try to load model from assets
      try {
        // Create inference session with WASM backend only (simpler, more compatible)
        const options: InferenceSession.SessionOptions = {
          executionProviders: ['wasm'],
          logSeverityLevel: 3, // ERROR only (suppress "Unknown CPU vendor" warning)
        };

        this.session = await this.ort.InferenceSession.create(
          'assets/ai/wave-director/wave-director.onnx',
          options
        );

        // Refuse a model that was trained against a different state encoding.
        //
        // The checked-in model was exported at schema v2 and expects 156
        // inputs; the encoder produces ENCODED_STATE_SIZE (208 at schema v5).
        // Without this check the session loads happily and then throws a shape
        // error on the first `run()` — mid-wave, in a path with no fallback,
        // long after the button that started it. Failing here keeps the rules
        // running and says why.
        const declared = await this.declaredInputSize();
        if (declared !== null && declared !== ENCODED_STATE_SIZE) {
          console.warn(
            `[AI] Model expects ${declared} inputs, the encoder produces `
            + `${ENCODED_STATE_SIZE}. It was exported against an older schema; `
            + 're-export it with `npm run export-ai`. Staying on the rule director.'
          );
          this.session = null;
          this.modelState.set('rules');
          this.aiMode.set('rules');
          return false;
        }

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

    this.lastDecision.set(config);
    this.dataCollector.setCurrentWaveConfig(config);
    this.inferenceTimeMs.set(performance.now() - startTime);

    if (this.debugMode()) {
      console.log('[AI] Wave decision:', config);
      if (config.explanation) {
        console.log(`[AI] Why this wave:\n${formatExplanation(config.explanation)}`);
      }
    }

    return config;
  }

  /**
   * Input width the exported model was built for, or null if unknown.
   *
   * Read from the sidecar metadata rather than the session: onnxruntime-web
   * exposes input names but not reliably a concrete dimension for a dynamic
   * batch axis, and the export writes the figure it used.
   */
  private async declaredInputSize(): Promise<number | null> {
    try {
      const res = await fetch('assets/ai/wave-director/metadata.json');
      if (!res.ok) return null;
      const meta = await res.json();
      return typeof meta?.inputSize === 'number' ? meta.inputSize : null;
    } catch {
      return null;
    }
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
    return this.buildWaveConfig(decision, state, waveContext.maskReason);
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
    const outputTensor = results['action'];
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
        why: { by: 'model', candidates: mask.filter(Boolean).length, probability: bestProb },
      },
      state,
      waveContext.maskReason,
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
    maskReason: TemplateMaskReason,
  ): WaveConfig {
    const upcomingWave = state.waveNumber + 1;
    let bestIdx = decision.templateIdx;
    // A rule director simply decided; there is no distribution to read a
    // confidence out of.
    const bestProb = decision.why.by === 'model' ? decision.why.probability : 1;

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
    const endgameHpMult = endgameHpMultiplier(upcomingWave);
    const hpMult = Math.round(baseHpMult * endgameHpMult * 1000) / 1000;
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
        state.defense?.gateDpsPerArmor,
        state.defense?.killThroughput,
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
        (id) => lineageHp(id as EnemyTypeId),
        (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
        (id) => splitBodyCount(id as EnemyTypeId),
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

    let sized = countFor(spawnDelay);

    // Wave-duration cap: compress spawn_delay if total would exceed 3 min.
    const durationCapped = sized.count * spawnDelay > MAX_WAVE_DURATION_MS;
    if (durationCapped) {
      spawnDelay = Math.max(MIN_SPAWN_DELAY_MS, Math.floor(MAX_WAVE_DURATION_MS / sized.count));
      // Re-derive against the compressed delay. A slow mega-wave can clear the
      // gate precisely BECAUSE its long spawn window gives the defense time,
      // and the compression then multiplies the spawn rate — so without this
      // the gate is bypassed by exactly the waves it exists to stop. The
      // backend has always done this second pass; the frontend did not.
      sized = countFor(spawnDelay);
    }
    const totalCount = sized.count;

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

    const shippedCount = enemies.reduce((s, e) => s + e.count, 0);
    return {
      enemies,
      totalCount: shippedCount,
      spawnDelay,
      spawnDelayVariation: variation,
      pattern: template.spawnPattern ?? undefined,
      confidence: bestProb,
      templateIdx: bestIdx,
      templateName: template.name,
      templateStrength: hpMult,
      // Built from the values this function just used, so the debug window
      // explains the wave that ships rather than a re-derivation of it.
      explanation: explainWaveDecision({
        wave: upcomingWave,
        templateName: template.name,
        mask: maskReason,
        director: decision.why,
        gate: this.gate.status,
        sizing: {
          countRange: template.countRange,
          dpsScaledMax,
          totalDps: totalDPS,
          cap: sized.cap,
          countFactor,
          count: shippedCount,
          hpMult,
          endgameHpMult,
          spawnDelay,
          durationCapped,
        },
      }),
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
   * Switch back to the rule director, dropping the ONNX policy if one is live.
   */
  forceRuleMode(): void {
    this.aiMode.set('rules');
    this.modelState.set('rules');
  }
}
