/**
 * Wave Director Service — the one door to whichever wave source a run plays.
 *
 * It decides nothing about waves itself. It picks the source for the run
 * (`configs/director.config.ts`, or the debug window's choice), holds the wave
 * that source has committed, hands it finished waves, and clears it between
 * runs. Everything about which wave comes next and how big it is lives in
 * `sources/` (docs/WAVE_SOURCE_PLAN.md).
 *
 * The measuring side is deliberately outside: `StateSnapshotService`, the
 * defense analysis and the run log are the same whatever plans the waves,
 * which is the only reason two sources are comparable at all.
 */

import { Injectable, inject, signal } from '@angular/core';
import { StateSnapshotService } from './state-snapshot.service';
import { WaveConfig } from './models/wave-config';
import { WaveResult } from './models/wave-result';
import { formatExplanation } from './wave-explanation';
import { createWaveSource } from './wave-source.registry';
import { DEFAULT_WAVE_SOURCE } from '../configs/director.config';
import type {
  PlannedWave,
  WavePeekFacts,
  WavePeekRequest,
  WaveSource,
  WaveSourceId,
} from './wave-source';

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class WaveDirector {
  private stateSnapshots = inject(StateSnapshotService);

  /** The source of the current run. Swapped only by `resetForNewGame`. */
  private activeSource: WaveSource = createWaveSource(DEFAULT_WAVE_SOURCE);

  /**
   * Which source the NEXT run plays. The debug window writes it; a running
   * game keeps the one it started with.
   */
  private nextSourceId: WaveSourceId = DEFAULT_WAVE_SOURCE;

  /** The wave the source has committed, or null before the first one. */
  private plannedWave: PlannedWave | null = null;

  /**
   * Where the director stream comes from, asked for per plan rather than held.
   *
   * `GameRng.reset()` throws its streams away, so a cached function would keep
   * drawing from the previous run's sequence.
   */
  private randomSource: () => () => number = () => Math.random;

  // === SIGNALS ===
  readonly lastDecision = signal<WaveConfig | null>(null);
  readonly decisionTimeMs = signal(0);

  // === DEBUG MODE ===
  private debugMode = signal(false);

  constructor() {
    // Subscribe the source to completed waves.
    //
    // This wiring is the whole point of an adaptive source and it was missing
    // on first write: `onWaveCompleted` had no caller anywhere in the project,
    // so the pressure multiplier stayed at 1.0 forever and the cap sat back on
    // "exactly what the towers can kill" — the 70%-killed-everything state the
    // loop exists to break. Every unit test passed regardless, because they
    // all exercised the controller in isolation. `pressure-wiring.spec.ts`
    // exists against exactly that.
    //
    // The collector's hook is used rather than the `wave:completed` event:
    // that event is not emitted when the base falls, so a source would never
    // hear about the wave that ended the run.
    this.stateSnapshots.onWaveResult((result) => this.onWaveCompleted(result));
  }

  /** The source of the current run. Read-only from outside. */
  get source(): WaveSource {
    return this.activeSource;
  }

  /** The committed wave, for the preview and the debug window. */
  get committed(): PlannedWave | null {
    return this.plannedWave;
  }

  /**
   * Where to get the run's `director` stream. Called once by the facade; the
   * getter is called again for every plan so a reset is picked up.
   */
  useRandomSource(random: () => () => number): void {
    this.randomSource = random;
  }

  /** What the next run will play. `resetForNewGame` puts it into service. */
  useSourceNextRun(id: WaveSourceId): void {
    this.nextSourceId = id;
  }

  /** What the next run will play, for the debug window's own display. */
  get sourceNextRun(): WaveSourceId {
    return this.nextSourceId;
  }

  /**
   * The plan for `wave`, planning it if it is not the committed one.
   *
   * Idempotent, which is what makes the planning moment a property of the
   * source rather than a second code path: a source that commits at the end of
   * the previous wave finds its plan here and returns it, one that decides on
   * the button plans here. It also covers the dev jump — a committed wave for
   * another number is thrown away and replanned.
   *
   * `plannedWave` is written only after a successful plan, so a source that
   * throws leaves the previous commitment standing instead of a half state.
   */
  ensurePlanned(wave: number): PlannedWave {
    const committed = this.plannedWave;
    if (committed && committed.wave === wave) return committed;

    const planned = this.activeSource.plan({
      wave,
      state: this.stateSnapshots.getStateSnapshot(),
      random: this.randomSource(),
    });
    this.plannedWave = planned;
    return planned;
  }

  /**
   * The wave to start now.
   *
   * Stays `async` although nothing in here is: the facade's retry path
   * (`MAX_AI_RETRY`, `directorError`) hangs off the rejected promise, and
   * unwinding that belongs to its own change (WAVE_SOURCE_PLAN.md, R5).
   */
  async getNextWave(wave: number): Promise<PlannedWave> {
    const startTime = performance.now();
    const planned = this.ensurePlanned(wave);

    this.lastDecision.set(planned.config);
    this.stateSnapshots.setCurrentWaveConfig(planned.config);
    this.decisionTimeMs.set(performance.now() - startTime);

    if (this.debugMode()) {
      console.log('[AI] Wave decision:', planned.config);
      if (planned.explanation) {
        console.log(`[AI] Why this wave:\n${formatExplanation(planned.explanation)}`);
      }
    }

    return planned;
  }

  /** NEXT in the wave panel: what the source says about the coming waves. */
  peek(request: WavePeekRequest): WavePeekFacts[] {
    return this.activeSource.peek(request);
  }

  /**
   * A wave finished: the source hears about it, and one that commits early
   * plans the next wave right away, so the preview can name it.
   */
  onWaveCompleted(result: WaveResult): void {
    this.activeSource.onWaveResult(result);

    if (this.debugMode()) {
      console.log('[AI] Wave result:', result);
    }

    if (this.activeSource.plansAt === 'wave-end') {
      this.planAhead(result.waveNumber + 1);
    }
  }

  /**
   * Clear per-run state and put the chosen source into service.
   *
   * Must be called when a new game starts: an adaptive source's correction is
   * a per-RUN figure, and letting it survive into the next game made it a
   * ratchet that opened fresh runs against waves sized for a defense that had
   * already been dismantled. Median run length under that bug was 6 waves
   * against a target of 80.
   */
  resetForNewGame(): void {
    if (this.nextSourceId !== this.activeSource.id) {
      this.activeSource = createWaveSource(this.nextSourceId);
    } else {
      this.activeSource.reset();
    }
    this.plannedWave = null;
    this.lastDecision.set(null);

    if (this.activeSource.plansAt === 'wave-end') {
      this.planAhead(1);
    }
  }

  /**
   * Commit a wave ahead of its start, for a source that wants it.
   *
   * Swallowing the failure is deliberate: nothing is waiting for this wave
   * yet, and the same plan runs again through `ensurePlanned` when the wave
   * actually starts, where the facade's error path is listening.
   */
  private planAhead(wave: number): void {
    try {
      this.ensurePlanned(wave);
    } catch (error) {
      console.error('[AI] Could not plan ahead for wave', wave, error);
    }
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
