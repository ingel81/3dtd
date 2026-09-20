/**
 * Wave Director Service — template-based wave generation.
 *
 * Decides the next wave and decodes that decision into a WaveConfig. The
 * decision comes from the rule director: it needs no model, no network and no
 * runtime, so there is no startup window in which the service cannot produce
 * a wave.
 *
 * Why rules and nothing else: measured across a day of A/B runs sharing the
 * same bots, campaign and fairness gate, a trained policy was three times
 * statistically indistinguishable from uniform random sampling, so the ONNX
 * path was removed with the rest of the training stack (BALANCING_PLAN.md,
 * Phase 1a). See `rule-director.ts` for the numbers.
 *
 * The decision is turned into a wave by `buildWaveConfig`
 * (wave-config-builder.ts).
 */

import { Injectable, inject, signal } from '@angular/core';
import { StateSnapshotService } from './state-snapshot.service';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { formatExplanation } from './decision-explainer';
import type { CandidateReason } from './templates';
import { buildWaveContext } from './wave-context';
import { decideWave, type DirectorDecision } from './director-rules';
import { LeakController, leakRatio } from './leak-controller';
import { buildWaveConfig } from './wave-config-builder';

/** Templates the cooldown remembers. */
const TEMPLATE_HISTORY = 5;

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class WaveDirector {
  private stateSnapshots = inject(StateSnapshotService);

  // === STATE ===
  /** Phase 5.10: template cooldown tracking (last TEMPLATE_HISTORY template indices) */
  private recentTemplateIndices: number[] = [];

  // === SIGNALS ===
  readonly lastDecision = signal<WaveConfig | null>(null);
  readonly decisionTimeMs = signal(0);

  // === DEBUG MODE ===
  private debugMode = signal(false);


  readonly leak = new LeakController();

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
    this.stateSnapshots.onWaveResult((result) => this.onWaveCompleted(result));
  }

  /**
   * Get next wave configuration
   *
   * This is the main entry point for wave generation. `random` is the run's
   * director stream (GameRng): the factor jitter and the tie-break between
   * equally stale templates draw from it, so the same seed plans the same
   * waves as long as the run takes the same course.
   */
  async getNextWave(random: () => number = Math.random): Promise<WaveConfig> {
    const startTime = performance.now();

    const state = this.stateSnapshots.getStateSnapshot();
    const config = this.plan(state, random);

    this.lastDecision.set(config);
    this.stateSnapshots.setCurrentWaveConfig(config);
    this.decisionTimeMs.set(performance.now() - startTime);

    if (this.debugMode()) {
      console.log('[AI] Wave decision:', config);
      if (config.explanation) {
        console.log(`[AI] Why this wave:\n${formatExplanation(config.explanation)}`);
      }
    }

    return config;
  }

  /**
   * Rule-based decision.
   *
   * The fairness cap is corrected by the gate controller, which is the piece
   * that was previously server-only. Without it the cap sits on "exactly what
   * the towers can kill" and therefore guarantees they kill it: measured over
   * 1834 waves, 70% of waves killed everything and 80% dealt no damage at all.
   */
  private plan(state: GameStateSnapshot, random: () => number): WaveConfig {
    const context = buildWaveContext(state, this.recentTemplateIndices);
    const decision = decideWave(
      context.candidates,
      state.waveNumber + 1,
      this.recentTemplateIndices,
      random,
    );
    return this.ship(decision, state, context.candidateReason);
  }

  /** The wave a decision describes; its template goes into the cooldown history. */
  private ship(decision: DirectorDecision, state: GameStateSnapshot, candidateReason: CandidateReason): WaveConfig {
    const config = buildWaveConfig(decision, state, candidateReason, this.leak);
    this.recentTemplateIndices.push(config.templateIdx);
    if (this.recentTemplateIndices.length > TEMPLATE_HISTORY) {
      this.recentTemplateIndices.shift();
    }
    return config;
  }

  /**
   * Called after wave completes
   */
  onWaveCompleted(result: WaveResult): void {
    // Feed the fairness gate. This is the loop that sizes the next wave, so it
    // has to see every completed wave — not just the ones a debug flag prints.
    // null, not 0: a wave with no per-enemy data is no evidence either way.
    // Ability kills count as leaks, see leakRatio.
    const ratio = leakRatio(
      result.outcome.enemyProgressValues ?? [],
      result.outcome.abilityKills ?? 0,
    );
    const survived = result.outcome.playerSurvived !== false;
    this.leak.recordWave(ratio, survived);

    if (this.debugMode()) {
      console.log('[AI] Wave result:', result);
      console.log('[AI] Leak ratio:', ratio, 'leak x', this.leak.leakMultiplier);
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
    this.leak.reset();
    this.recentTemplateIndices = [];
  }

  // === PUBLIC API ===

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
}
