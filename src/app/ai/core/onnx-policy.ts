/**
 * The ONNX wave-director policy: its runtime, its session, and how to read
 * its output as a director decision.
 *
 * Opt-in only, loaded on demand from the debug window; the rule director is
 * the default (see wave-director.service.ts for why). Nothing here is loaded
 * or fetched until load() is called: the runtime is imported lazily.
 */

import type { InferenceSession } from 'onnxruntime-web';
import { ENCODED_STATE_SIZE } from './game-state-encoder';
import { MAX_TEMPLATE_SLOTS } from './templates';
import type { DirectorDecision } from './rule-director';

/** ONNX Runtime module type. Type-only: the runtime is imported lazily in load(). */
type OrtModule = typeof import('onnxruntime-web');

const MODEL_URL = 'assets/ai/wave-director/wave-director.onnx';
const METADATA_URL = 'assets/ai/wave-director/metadata.json';

/**
 * Outcome of OnnxPolicy.load(). Only 'ready' leaves a session behind; a
 * missing or mismatched model is normal operation on the rules, a runtime
 * that fails to load is an error.
 */
export type PolicyLoadResult = 'ready' | 'no-model' | 'wrong-input-size' | 'runtime-error';

export class OnnxPolicy {
  private ort: OrtModule | null = null; // ONNX Runtime (lazy loaded)
  private session: InferenceSession | null = null;

  /** A session is live and run() can be called. */
  get isLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Load ONNX Runtime and model
   */
  async load(): Promise<PolicyLoadResult> {
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
    } catch (error) {
      console.error('[AI] Failed to load ONNX Runtime', error);
      return 'runtime-error';
    }

    // Try to load model from assets
    try {
      // Create inference session with WASM backend only (simpler, more compatible)
      const options: InferenceSession.SessionOptions = {
        executionProviders: ['wasm'],
        logSeverityLevel: 3, // ERROR only (suppress "Unknown CPU vendor" warning)
      };

      this.session = await this.ort.InferenceSession.create(MODEL_URL, options);

      // Refuse a model that was trained against a different state encoding.
      //
      // The checked-in model was exported at schema v2 and expects 156
      // inputs; the encoder produces ENCODED_STATE_SIZE (208 at schema v5).
      // Without this check the session loads happily and then throws a shape
      // error on the first `run()` — mid-wave, in a path with no fallback,
      // long after the button that started it. Failing here keeps the rules
      // running and says why.
      const declared = await declaredInputSize();
      if (declared !== null && declared !== ENCODED_STATE_SIZE) {
        console.warn(
          `[AI] Model expects ${declared} inputs, the encoder produces `
          + `${ENCODED_STATE_SIZE}. It was exported against an older schema; `
          + 're-export it with `npm run export-ai`. Staying on the rule director.'
        );
        this.release();
        return 'wrong-input-size';
      }

      console.log('[AI] ONNX model loaded successfully');
      return 'ready';
    } catch {
      // No model file. Not an error: rules are the product, the model is the
      // opt-in that has not yet shown it beats them.
      console.log('[AI] No model file found, staying on the rule director');
      return 'no-model';
    }
  }

  /**
   * Raw model output for one encoded game state: MAX_TEMPLATE_SLOTS template
   * logits followed by four raw continuous parameters.
   */
  async run(encoded: Float32Array): Promise<Float32Array> {
    if (!this.ort || !this.session) {
      throw new Error('Model not loaded');
    }

    // Create ONNX tensor (shape: [1, ENCODED_STATE_SIZE])
    const inputTensor = new this.ort.Tensor('float32', encoded, [1, ENCODED_STATE_SIZE]);

    // Run inference
    const results = await this.session.run({ state: inputTensor });

    // Get output tensor (name: 'action')
    return results['action'].data as Float32Array;
  }

  /** Forget the session and free its WASM memory. The runtime stays loaded. */
  release(): void {
    const session = this.session;
    this.session = null;
    session?.release().catch(() => { /* already gone, nothing to free */ });
  }
}

/**
 * Input width the exported model was built for, or null if unknown.
 *
 * Read from the sidecar metadata rather than the session: onnxruntime-web
 * exposes input names but not reliably a concrete dimension for a dynamic
 * batch axis, and the export writes the figure it used.
 */
async function declaredInputSize(): Promise<number | null> {
  try {
    const res = await fetch(METADATA_URL);
    if (!res.ok) return null;
    const meta = await res.json();
    return typeof meta?.inputSize === 'number' ? meta.inputSize : null;
  } catch {
    return null;
  }
}

/**
 * Decode NN output to a director decision (Phase 5.11 Range-Based Templates).
 *
 * Expected output layout (36 values) — must match backend model.py:
 *   [0..MAX_TEMPLATE_SLOTS-1]                template logits (32 slots)
 *   [MAX_TEMPLATE_SLOTS..+NUM_CONTINUOUS-1]  4 raw continuous params
 *                                            (count, spawn_delay, hp_mult, variation)
 *
 * `mask` is the availability mask from the shared wave-context helper, so
 * the mask the model was *fed* (see game-state-encoder) and the mask its
 * output is *filtered by* here can never disagree. Inside the curriculum it
 * collapses to a single slot, so the argmax below has one candidate and the
 * wave that ships is the one the designer pinned. Past the curriculum it is
 * a real choice.
 */
export function decodeModelOutput(output: Float32Array, mask: readonly boolean[]): DirectorDecision {
  const templateLogits = Array.from(output.slice(0, MAX_TEMPLATE_SLOTS));
  const rawParams = output.slice(MAX_TEMPLATE_SLOTS, MAX_TEMPLATE_SLOTS + 4);

  const maskedLogits = templateLogits.map((l, i) => mask[i] ? l : -Infinity);
  const probs = softmax(maskedLogits);

  let bestIdx = -1;
  let bestProb = -1;
  for (let i = 0; i < probs.length; i++) {
    if (mask[i] && probs[i] > bestProb) {
      bestProb = probs[i];
      bestIdx = i;
    }
  }

  return {
    templateIdx: bestIdx,
    countFactor: sigmoid(rawParams[0]),
    spawnFactor: sigmoid(rawParams[1]),
    hpFactor: sigmoid(rawParams[2]),
    variationFactor: sigmoid(rawParams[3]),
    why: { by: 'model', candidates: mask.filter(Boolean).length, probability: bestProb },
  };
}

/**
 * Sigmoid activation function
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Softmax function for probability distribution
 */
function softmax(values: number[]): number[] {
  const finiteMax = Math.max(...values.filter(v => Number.isFinite(v)));
  const exps = values.map(v => (Number.isFinite(v) ? Math.exp(v - finiteMax) : 0));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / sum);
}
