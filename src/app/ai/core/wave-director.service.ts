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
 *
 * The decision is turned into a wave by `buildWaveConfig`
 * (wave-config-builder.ts), the same for both directors; the model's runtime
 * and output decoding live in onnx-policy.ts.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { formatExplanation } from './decision-explainer';
import { encodeGameState } from './game-state-encoder';
import type { TemplateMaskReason } from './templates';
import { buildWaveContext } from './wave-context';
import { RuleDirector, type DirectorDecision } from './rule-director';
import { GateController, gateLeakRatio } from './gate-controller';
import { buildWaveConfig } from './wave-config-builder';
import { OnnxPolicy, checkModelFit, decodeModelOutput, type ModelFit } from './onnx-policy';

/** Model loading states */
type ModelState = 'not-loaded' | 'loading' | 'ready' | 'error' | 'rules';

/** AI Mode */
type AIMode = 'inference' | 'rules' | 'training' | 'disabled';

/** Templates the cooldown remembers. */
const TEMPLATE_HISTORY = 5;

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class WaveDirectorService {
  private dataCollector = inject(AIDataCollectorService);

  // === STATE ===
  /** The opt-in ONNX policy; holds no runtime and no session until loadModel(). */
  private readonly policy = new OnnxPolicy();
  /** Phase 5.10: template cooldown tracking (last TEMPLATE_HISTORY template indices) */
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
  /**
   * Whether the checked-in model fits the encoder; null until checkModel()
   * or loadModel() has answered. The debug window offers the opt-in only on
   * 'fits'.
   */
  readonly modelFit = signal<ModelFit | null>(null);

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
   * Ask the model's metadata whether it fits the encoder, without loading the
   * runtime. The debug window calls this each time it opens: the 156-input
   * model from schema v2 keeps the opt-in hidden, and a model exported with
   * the encoder's input size brings it back without a code change.
   */
  async checkModel(): Promise<ModelFit> {
    const fit = await checkModelFit();
    this.modelFit.set(fit);
    return fit;
  }

  /**
   * Load ONNX Runtime and model
   */
  async loadModel(): Promise<boolean> {
    if (this.modelState() === 'ready') return true;

    this.modelState.set('loading');
    const result = await this.policy.load();
    if (result === 'ready') {
      this.modelFit.set('fits');
      this.modelState.set('ready');
      this.aiMode.set('inference');
      return true;
    }

    // A missing or mismatched model keeps the rules running as normal
    // operation and takes the opt-in away; only a runtime that failed to
    // load is an error.
    if (result !== 'runtime-error') this.modelFit.set(result);
    this.modelState.set(result === 'runtime-error' ? 'error' : 'rules');
    this.aiMode.set('rules');
    return false;
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
    const useModel = this.aiMode() === 'inference' && this.policy.isLoaded;
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
    return this.ship(decision, state, waveContext.maskReason);
  }

  /**
   * Run ONNX neural network inference
   */
  private async runInference(state: GameStateSnapshot): Promise<WaveConfig> {
    // One context for the whole decision: it feeds the model's wave-context
    // features AND filters the model's template output, so the two cannot
    // describe different sets of legal templates.
    const waveContext = buildWaveContext(state, this.recentTemplateIndices);
    const output = await this.policy.run(encodeGameState(state, waveContext));
    return this.ship(decodeModelOutput(output, waveContext.mask), state, waveContext.maskReason);
  }

  /** The wave a decision describes; its template goes into the cooldown history. */
  private ship(decision: DirectorDecision, state: GameStateSnapshot, maskReason: TemplateMaskReason): WaveConfig {
    const config = buildWaveConfig(decision, state, maskReason, this.gate);
    this.recentTemplateIndices.push(config.templateIdx);
    if (this.recentTemplateIndices.length > TEMPLATE_HISTORY) {
      this.recentTemplateIndices.shift();
    }
    return config;
  }

  /**
   * Called after wave completes - for potential online learning
   */
  onWaveCompleted(result: WaveResult): void {
    // Feed the fairness gate. This is the loop that sizes the next wave, so it
    // has to see every completed wave — not just the ones a debug flag prints.
    // null, not 0: a wave with no per-enemy data is no evidence either way.
    // Ability kills count as leaks, see gateLeakRatio.
    const leakRatio = gateLeakRatio(
      result.outcome.enemyProgressValues ?? [],
      result.outcome.abilityKills ?? 0,
    );
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
      if (this.policy.isLoaded) {
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
   *
   * The session goes too: setEnabled() brings inference back whenever a
   * session exists, so keeping it here let a later setEnabled(true) run the
   * model while the status still read "Rule director active". Opting in
   * again goes through loadModel().
   */
  forceRuleMode(): void {
    this.policy.release();
    this.aiMode.set('rules');
    this.modelState.set('rules');
  }
}
