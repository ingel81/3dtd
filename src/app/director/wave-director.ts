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
import { capIsBinding, formatExplanation } from './decision-explainer';
import type { CandidateReason } from './templates';
import { buildWaveContext } from './wave-context';
import { decideWave, type DirectorDecision, type TieBreak } from './director-rules';
import { PressureController, wavePressure } from './pressure-controller';
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


  readonly pressure = new PressureController();

  /**
   * Hat der Deckel die zuletzt geplante Welle begrenzt?
   *
   * Der Regler bekommt es beim Abschluss dieser Welle als Anti-Windup. Es
   * gehört hierher und nicht in den Regler, weil nur der Planungspfad weiß,
   * was die Größe der Welle am Ende entschieden hat.
   */
  private lastCapBinding = true;

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
      this.tieBreak(context.headroomByTemplate),
    );
    return this.ship(decision, state, context.candidateReason);
  }

  /**
   * Der dritte Griff des Druck-Reglers: die Wahl unter gleich alten
   * Templates.
   *
   * Deckel und Anzahl-Faktor stellen ein, *wie groß* eine Welle wird. Was sie
   * nicht können, ist die Streuung: Ein Template, das zur Abwehr passt,
   * kostet auch groß nichts, und eines, das nicht passt, kostet auch klein
   * viel. Genau daraus entsteht die tote Strecke — der Regler trifft den
   * Erwartungswert und der Verlauf bleibt zackig
   * (docs/DRAMA_CONTROLLER_PLAN.md, Runde 12).
   *
   * Steht der Regler auf "zu leicht", bekommt der Spieler unter den gleich
   * alten Kandidaten den, gegen den seine Abwehr am schlechtesten steht, und
   * umgekehrt. Hält er, bleibt es beim Zufall: Im Zielzustand soll nichts
   * nachgeholfen werden.
   */
  private tieBreak(headroom: ReadonlyMap<number, number>): TieBreak | null {
    const step = this.pressure.status.lastStep;
    if (step === 'opened') return { prefer: 'harder', headroom };
    if (step === 'closed') return { prefer: 'easier', headroom };
    return null;
  }

  /** The wave a decision describes; its template goes into the cooldown history. */
  private ship(decision: DirectorDecision, state: GameStateSnapshot, candidateReason: CandidateReason): WaveConfig {
    const config = buildWaveConfig(decision, state, candidateReason, this.pressure);
    const sizing = config.explanation?.sizing;
    this.lastCapBinding = sizing ? capIsBinding(sizing) : true;
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
    // null, not 0: a wave that carries no HP reading is no evidence either way.
    const pressure = wavePressure(
      result.outcome.damageToPlayer ?? 0,
      result.outcome.healthAtWaveStart ?? 0,
      result.outcome.enemiesSpawned ?? 0,
    );
    this.pressure.recordWave(pressure, result.waveNumber, this.lastCapBinding);

    if (this.debugMode()) {
      console.log('[AI] Wave result:', result);
      console.log('[AI] Pressure:', pressure, 'mult x', this.pressure.pressureMultiplier);
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
    this.pressure.reset();
    this.lastCapBinding = true;
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
