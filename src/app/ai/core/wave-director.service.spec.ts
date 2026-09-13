import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirectorService } from './wave-director.service';
import { AIDataCollectorService } from './ai-data-collector.service';
import { ENCODED_STATE_SIZE } from './game-state-encoder';
import { buildWaveContext } from './wave-context';
import { MAX_TEMPLATE_SLOTS, MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS, TEMPLATES } from './templates';
import { GATE_ADAPT_WINDOW } from './gate-controller';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveConfig } from './models/wave-config';
import type { WaveResult } from './models/wave-result';

/**
 * Characterization of the director's public surface that gate-wiring.spec and
 * decision-explainer.spec leave alone: the state machine around the ONNX
 * opt-in, how the model output is decoded, the rule path's bookkeeping, and
 * the knobs the debug window turns.
 *
 * onnxruntime-web is replaced by a controllable fake. The director imports it
 * lazily, so the fake is only ever reached through loadModel().
 */

const onnx = vi.hoisted(() => ({
  env: { wasm: {} as { wasmPaths?: string }, logLevel: '' },
  envThrows: false,
  create: vi.fn(),
  tensors: [] as { type: string; data: Float32Array; dims: number[] }[],
}));

vi.mock('onnxruntime-web', () => ({
  get env() {
    if (onnx.envThrows) throw new Error('wasm backend unavailable');
    return onnx.env;
  },
  InferenceSession: { create: (...args: unknown[]) => onnx.create(...args) },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {
      onnx.tensors.push(this);
    }
  },
}));

const MODEL_PATH = 'assets/ai/wave-director/wave-director.onnx';
const METADATA_PATH = 'assets/ai/wave-director/metadata.json';
const BOSS_IDX = TEMPLATES.findIndex((t) => t.bossOnly);

class StubCollector {
  snapshot: GameStateSnapshot = createEmptySnapshot();
  setCurrentWaveConfig = vi.fn<(config: WaveConfig) => void>();
  onWaveResult(): () => void {
    return () => undefined;
  }
  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }
}

/** A defense strong enough that the fairness gate has no finite cap. */
function overwhelmingDefense(snapshot: GameStateSnapshot, waveNumber: number): void {
  const dps = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
  snapshot.waveNumber = waveNumber;
  snapshot.defense.totalDPS = 1e6;
  snapshot.defense.effectiveDPSPerArmor = { ground: dps, air: dps };
  snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
  snapshot.defense.killThroughput = { ground: 1e6, air: 1e6 };
  snapshot.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  };
}

/** Model output: template logits (default 0) followed by four raw factors. */
function modelOutput(logits: Record<number, number>, rawFactors = [0, 0, 0, 0]): Float32Array {
  const out = new Float32Array(MAX_TEMPLATE_SLOTS + 4);
  for (const [slot, logit] of Object.entries(logits)) out[Number(slot)] = logit;
  out.set(rawFactors, MAX_TEMPLATE_SLOTS);
  return out;
}

function stubMetadata(response: { ok: boolean; inputSize?: unknown } | 'reject'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (response === 'reject') throw new Error('offline');
    return { ok: response.ok, json: async () => ({ inputSize: response.inputSize }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function waveResult(outcome: Partial<WaveResult['outcome']>): WaveResult {
  return {
    waveNumber: 1,
    timestamp: 0,
    config: { enemies: [], totalCount: 0, spawnDelay: 500 },
    outcome,
  } as WaveResult;
}

describe('WaveDirectorService', () => {
  let collector: StubCollector;
  let director: WaveDirectorService;
  let session: { run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({ providers: [{ provide: AIDataCollectorService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirectorService());

    session = {
      run: vi.fn(async () => ({ action: { data: modelOutput({}) } })),
      release: vi.fn(async () => undefined),
    };
    onnx.env = { wasm: {}, logLevel: '' };
    onnx.envThrows = false;
    onnx.tensors = [];
    onnx.create.mockReset();
    onnx.create.mockImplementation(async () => session);

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts on the rule director without touching the ONNX runtime', () => {
      expect(director.modelState()).toBe('rules');
      expect(director.aiMode()).toBe('rules');
      expect(director.isReady()).toBe(true);
      expect(director.statusText()).toBe('Rule director active');
      expect(director.lastDecision()).toBeNull();
      expect(director.isDebugMode()).toBe(false);
      expect(onnx.create).not.toHaveBeenCalled();
    });

    it('maps every model state to a status text and readiness', () => {
      const expected = {
        'not-loaded': ['Model not loaded', false],
        loading: ['Loading model...', false],
        ready: ['ONNX model active', true],
        rules: ['Rule director active', true],
        error: ['Model error', false],
      } as const;
      for (const [state, [text, ready]] of Object.entries(expected)) {
        director.modelState.set(state as keyof typeof expected);
        expect(director.statusText()).toBe(text);
        expect(director.isReady()).toBe(ready);
      }
    });
  });

  describe('rule path', () => {
    it('ships the pinned curriculum template for wave 1 and records the decision', async () => {
      const config = await director.getNextWave();

      expect(config.templateIdx).toBe(0);
      expect(config.templateName).toBe(TEMPLATES[0].name);
      expect(config.confidence).toBe(1);
      expect(config.enemies.map((e) => e.type)).toEqual(TEMPLATES[0].enemies.map(([type]) => type));
      expect(config.enemies.reduce((s, e) => s + e.count, 0)).toBe(config.totalCount);
      for (const group of config.enemies) expect(group.healthMultiplier).toBe(config.templateStrength);
      expect(config.spawnDelay).toBeGreaterThanOrEqual(MIN_SPAWN_DELAY_MS);

      expect(director.lastDecision()).toBe(config);
      expect(collector.setCurrentWaveConfig).toHaveBeenCalledWith(config);
      expect(director.inferenceTimeMs()).toBeGreaterThanOrEqual(0);
    });

    it('does not repeat a template on consecutive free waves', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      const picks: number[] = [];
      for (let i = 0; i < 6; i++) picks.push((await director.getNextWave()).templateIdx!);
      for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    });

    it('remembers the last five templates and forgets them on a new game', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      for (let i = 0; i < 7; i++) await director.getNextWave();
      const capped = (await director.getNextWave()).explanation!.reasons[0];
      expect(capped).toMatch(/in the last 5 waves/);

      director.resetForNewGame();
      const fresh = (await director.getNextWave()).explanation!.reasons[0];
      expect(fresh).toMatch(/no history yet/);
    });

    it('keeps every wave inside the duration cap', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      for (let i = 0; i < 10; i++) {
        const config = await director.getNextWave();
        const withinCap = config.totalCount * config.spawnDelay <= MAX_WAVE_DURATION_MS;
        expect(withinCap || config.spawnDelay === MIN_SPAWN_DELAY_MS).toBe(true);
      }
    });

    it('still plans a rule wave when disabled: the on/off switch lives upstream', async () => {
      director.setEnabled(false);
      expect(director.aiMode()).toBe('disabled');
      const config = await director.getNextWave();
      expect(config.totalCount).toBeGreaterThan(0);
      expect(director.lastDecision()).toBe(config);
    });

    it('re-enabling without a loaded model returns to rules', () => {
      director.setEnabled(false);
      director.setEnabled(true);
      expect(director.aiMode()).toBe('rules');
    });

    it('plans from the counter alone: after a dev jump to W35 a boss wave, gate and history kept', async () => {
      // The jump only moves the counter (snapshot waveNumber 34, next wave 35).
      // The gate's leak window and the template history stay as they were.
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], playerSurvived: true }));
      overwhelmingDefense(collector.snapshot, 12);
      const before = (await director.getNextWave()).templateIdx!;
      const gateBefore = director.gate.status;

      overwhelmingDefense(collector.snapshot, 34);
      const config = await director.getNextWave();
      expect(TEMPLATES[config.templateIdx!].bossOnly).toBe(true);
      expect(config.templateIdx).not.toBe(before);
      expect(director.gate.status).toEqual(gateBefore);
    });

    it('does not log wave decisions outside debug mode', async () => {
      await director.getNextWave();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('completed waves', () => {
    /** Fill the gate's window with waves that leak 10%, inside the target band. */
    function fillInBand(): void {
      const tenPercent = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < GATE_ADAPT_WINDOW; i++) {
        director.onWaveCompleted(waveResult({ enemyProgressValues: tenPercent, playerSurvived: true }));
      }
    }

    it('treats a wave without per-enemy progress as no sample', () => {
      director.onWaveCompleted(waveResult({}));
      expect(director.gate.status.samples).toBe(0);
    });

    it('counts a wave with no survival flag as survived', () => {
      fillInBand();
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
      expect(director.gate.status.lastStep).toBe('held');
      expect(director.gate.budgetMultiplier).toBe(1);
    });

    it('logs the result and the gate in debug mode', () => {
      director.setDebugMode(true);
      expect(director.isDebugMode()).toBe(true);
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0] }));
      expect(console.log).toHaveBeenCalledWith('[AI] Leak ratio:', 0.5, 'gate x', 1);
    });
  });

  describe('loadModel', () => {
    it('opts into the ONNX policy when the model matches the encoder', async () => {
      const fetchMock = stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });

      await expect(director.loadModel()).resolves.toBe(true);

      expect(director.modelState()).toBe('ready');
      expect(director.aiMode()).toBe('inference');
      expect(director.statusText()).toBe('ONNX model active');
      expect(onnx.env.wasm.wasmPaths).toBe('assets/onnx-wasm/');
      expect(onnx.env.logLevel).toBe('error');
      expect(onnx.create).toHaveBeenCalledWith(MODEL_PATH, { executionProviders: ['wasm'], logSeverityLevel: 3 });
      expect(fetchMock).toHaveBeenCalledWith(METADATA_PATH);
    });

    it('does not load twice once ready', async () => {
      stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
      await director.loadModel();
      await expect(director.loadModel()).resolves.toBe(true);
      expect(onnx.create).toHaveBeenCalledTimes(1);
    });

    it('accepts the model when the metadata cannot be read', async () => {
      for (const response of [{ ok: false }, 'reject', { ok: true, inputSize: 'n/a' }] as const) {
        director.forceRuleMode();
        director.modelState.set('not-loaded');
        stubMetadata(response);
        await expect(director.loadModel()).resolves.toBe(true);
        expect(director.modelState()).toBe('ready');
      }
    });

    it('refuses a model exported against another state size and keeps the rules', async () => {
      stubMetadata({ ok: true, inputSize: 156 });

      await expect(director.loadModel()).resolves.toBe(false);

      expect(director.modelState()).toBe('rules');
      expect(director.aiMode()).toBe('rules');
      // The session is dropped, so enabling the director cannot bring it back.
      expect(session.release).toHaveBeenCalledTimes(1);
      director.setEnabled(true);
      expect(director.aiMode()).toBe('rules');
      await director.getNextWave();
      expect(session.run).not.toHaveBeenCalled();
    });

    it('stays on the rules when there is no model file', async () => {
      onnx.create.mockRejectedValue(new Error('404'));
      stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });

      await expect(director.loadModel()).resolves.toBe(false);

      expect(director.modelState()).toBe('rules');
      expect(director.aiMode()).toBe('rules');
      expect(director.isReady()).toBe(true);
    });

    it('reports an error when the runtime itself fails, and still plans waves', async () => {
      onnx.envThrows = true;

      await expect(director.loadModel()).resolves.toBe(false);

      expect(director.modelState()).toBe('error');
      expect(director.aiMode()).toBe('rules');
      expect(director.isReady()).toBe(false);
      expect(director.statusText()).toBe('Model error');
      const config = await director.getNextWave();
      expect(config.totalCount).toBeGreaterThan(0);
    });
  });

  describe('inference path', () => {
    beforeEach(async () => {
      stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
      await director.loadModel();
    });

    it('feeds the encoded state as one float32 row', async () => {
      await director.getNextWave();

      expect(session.run).toHaveBeenCalledTimes(1);
      const [tensor] = onnx.tensors;
      expect(session.run).toHaveBeenCalledWith({ state: tensor });
      expect(tensor.type).toBe('float32');
      expect(tensor.dims).toEqual([1, ENCODED_STATE_SIZE]);
      expect(tensor.data).toHaveLength(ENCODED_STATE_SIZE);
    });

    it('picks the best template the mask allows, with its masked probability', async () => {
      overwhelmingDefense(collector.snapshot, 40);             // planning 41, not a boss wave
      const allowed = buildWaveContext(collector.snapshot).mask.filter(Boolean).length;
      session.run.mockResolvedValue({
        action: { data: modelOutput({ [BOSS_IDX]: 50, [MAX_TEMPLATE_SLOTS - 1]: 40, 0: 5 }) },
      });

      const config = await director.getNextWave();

      expect(config.templateIdx).toBe(0);
      expect(config.confidence).toBeCloseTo(Math.exp(5) / (Math.exp(5) + allowed - 1), 5);
      expect(config.explanation!.reasons[0]).toMatch(new RegExp(`^ONNX model pick among ${allowed} allowed templates`));
    });

    it('cannot override a curriculum pin', async () => {
      session.run.mockResolvedValue({ action: { data: modelOutput({ 5: 50 }) } });

      const config = await director.getNextWave();                // wave 1

      expect(config.templateIdx).toBe(0);
      expect(config.confidence).toBe(1);
    });

    it('decodes saturated factors to the top of the template ranges, then compresses the delay', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      session.run.mockResolvedValue({ action: { data: modelOutput({ 0: 10 }, [20, 20, 20, 20]) } });

      const config = await director.getNextWave();
      const horde = TEMPLATES[0];
      const hpMult = Math.round(horde.hpMultRange[1] * (1 + 0.05 * (41 - 20)) * 1000) / 1000;

      expect(config.totalCount).toBe(horde.countRange[1]);
      expect(config.enemies).toEqual([
        { type: 'zombie', count: 1800, healthMultiplier: hpMult },
        { type: 'zombie-v2', count: 200, healthMultiplier: hpMult },
      ]);
      expect(config.templateStrength).toBe(hpMult);
      expect(config.spawnDelayVariation).toBe(horde.variationRange[1]);
      expect(config.pattern).toBe('interleaved');
      // The template's slowest delay would run 2000 enemies for 13 minutes.
      expect(config.spawnDelay).toBe(Math.floor(MAX_WAVE_DURATION_MS / horde.countRange[1]));
      expect(config.explanation!.reasons).toContain(
        `Spawn delay compressed to ${config.spawnDelay} ms to keep the wave under 3 min.`,
      );
    });

    it('propagates a failing inference run without recording a decision', async () => {
      session.run.mockRejectedValue(new Error('shape mismatch'));

      await expect(director.getNextWave()).rejects.toThrow('shape mismatch');

      expect(director.lastDecision()).toBeNull();
      expect(collector.setCurrentWaveConfig).not.toHaveBeenCalled();
    });

    it('forceRuleMode stops using the model', async () => {
      director.forceRuleMode();

      expect(director.modelState()).toBe('rules');
      expect(director.aiMode()).toBe('rules');
      await director.getNextWave();
      expect(session.run).not.toHaveBeenCalled();
    });

    it('drops the session on forceRuleMode, so setEnabled(true) stays on the rules', async () => {
      director.forceRuleMode();
      director.setEnabled(true);

      expect(session.release).toHaveBeenCalledTimes(1);
      expect(director.aiMode()).toBe('rules');
      expect(director.statusText()).toBe('Rule director active');
      await director.getNextWave();
      expect(session.run).not.toHaveBeenCalled();
    });

    it('opts in again through loadModel after forceRuleMode', async () => {
      director.forceRuleMode();

      await expect(director.loadModel()).resolves.toBe(true);

      expect(onnx.create).toHaveBeenCalledTimes(2);
      expect(director.aiMode()).toBe('inference');
      await director.getNextWave();
      expect(session.run).toHaveBeenCalledTimes(1);
    });
  });
});
