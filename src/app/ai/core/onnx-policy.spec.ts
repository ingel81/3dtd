import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OnnxPolicy, checkModelFit, decodeModelOutput } from './onnx-policy';
import { ENCODED_STATE_SIZE } from './game-state-encoder';
import { MAX_TEMPLATE_SLOTS } from './templates';

const METADATA_PATH = 'assets/ai/wave-director/metadata.json';

/** Serve metadata.json: a body with this inputSize, a failed response, or no network. */
function stubMetadata(response: { ok: boolean; inputSize?: unknown } | 'reject'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (response === 'reject') throw new Error('offline');
    return { ok: response.ok, json: async () => ({ inputSize: response.inputSize }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The metadata answers a fetch can give that name no input size. */
const UNREADABLE_METADATA = [{ ok: false }, 'reject', { ok: true, inputSize: 'n/a' }] as const;

/** Model output: template logits (default 0) followed by four raw factors. */
function modelOutput(logits: Record<number, number>, rawFactors = [0, 0, 0, 0]): Float32Array {
  const out = new Float32Array(MAX_TEMPLATE_SLOTS + 4);
  for (const [slot, logit] of Object.entries(logits)) out[Number(slot)] = logit;
  out.set(rawFactors, MAX_TEMPLATE_SLOTS);
  return out;
}

const allowOnly = (...slots: number[]) => Array.from({ length: MAX_TEMPLATE_SLOTS }, (_, i) => slots.includes(i));

describe('decodeModelOutput', () => {
  it('picks the best allowed template with its probability under the masked softmax', () => {
    const decision = decodeModelOutput(modelOutput({ 0: 1, 1: 9, 2: 3 }), allowOnly(0, 2));

    expect(decision.templateIdx).toBe(2);
    expect(decision.why.by).toBe('model');
    expect(decision.why.candidates).toBe(2);
    expect(decision.why.by === 'model' && decision.why.probability)
      .toBeCloseTo(Math.exp(3) / (Math.exp(1) + Math.exp(3)), 10);
  });

  it('maps the four raw factors through a sigmoid', () => {
    const decision = decodeModelOutput(modelOutput({}, [0, 40, -40, Math.log(3)]), allowOnly(0));

    // The output is float32, so log(3) arrives slightly rounded.
    expect(decision.countFactor).toBe(0.5);
    expect(decision.spawnFactor).toBeCloseTo(1, 10);
    expect(decision.hpFactor).toBeCloseTo(0, 10);
    expect(decision.variationFactor).toBeCloseTo(0.75, 6);
  });

  it('has no pick when the mask allows nothing', () => {
    const decision = decodeModelOutput(modelOutput({ 3: 5 }), allowOnly());
    expect(decision.templateIdx).toBe(-1);
    expect(decision.why.candidates).toBe(0);
  });
});

describe('checkModelFit', () => {
  beforeEach(() => {
    onnx.env = { wasm: {}, logLevel: '' };
    onnx.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the input size from the metadata, revalidated, without the runtime', async () => {
    const fetchMock = stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });

    await expect(checkModelFit()).resolves.toBe('fits');

    expect(fetchMock).toHaveBeenCalledWith(METADATA_PATH, { cache: 'no-cache' });
    expect(onnx.env.wasm.wasmPaths).toBeUndefined();
    expect(onnx.create).not.toHaveBeenCalled();
  });

  it('reports the 156-input model from schema v2 as not fitting', async () => {
    stubMetadata({ ok: true, inputSize: 156 });
    await expect(checkModelFit()).resolves.toBe('wrong-input-size');
  });

  it('reports a model without a readable input size as absent', async () => {
    for (const response of UNREADABLE_METADATA) {
      stubMetadata(response);
      await expect(checkModelFit()).resolves.toBe('no-model');
    }
  });

  it('reads the checked-in metadata the way the export writes it', async () => {
    const text = readFileSync(resolve('public/assets/ai/wave-director/metadata.json'), 'utf8');
    const { inputSize } = JSON.parse(text) as { inputSize: unknown };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => JSON.parse(text) })));

    expect(typeof inputSize).toBe('number');
    await expect(checkModelFit()).resolves.toBe(inputSize === ENCODED_STATE_SIZE ? 'fits' : 'wrong-input-size');
  });
});

describe('OnnxPolicy', () => {
  let policy: OnnxPolicy;
  let session: { run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    policy = new OnnxPolicy();
    session = {
      run: vi.fn(async () => ({ action: { data: modelOutput({ 1: 2 }) } })),
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

  it('holds nothing before load() and refuses to run', async () => {
    expect(policy.isLoaded).toBe(false);
    await expect(policy.run(new Float32Array(ENCODED_STATE_SIZE))).rejects.toThrow('Model not loaded');
    expect(onnx.create).not.toHaveBeenCalled();
  });

  it('loads the runtime from the local assets and opens the model', async () => {
    stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });

    await expect(policy.load()).resolves.toBe('ready');

    expect(policy.isLoaded).toBe(true);
    expect(onnx.env.wasm.wasmPaths).toBe('assets/onnx-wasm/');
    expect(onnx.create).toHaveBeenCalledWith('assets/ai/wave-director/wave-director.onnx', {
      executionProviders: ['wasm'],
      logSeverityLevel: 3,
    });
  });

  it('runs one float32 row and returns the action output', async () => {
    stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
    await policy.load();
    const encoded = new Float32Array(ENCODED_STATE_SIZE);

    const output = await policy.run(encoded);

    const [tensor] = onnx.tensors;
    expect(tensor).toMatchObject({ type: 'float32', data: encoded, dims: [1, ENCODED_STATE_SIZE] });
    expect(session.run).toHaveBeenCalledWith({ state: tensor });
    expect(output[1]).toBe(2);
  });

  it('refuses a model exported for another input size before loading the runtime', async () => {
    stubMetadata({ ok: true, inputSize: 156 });

    await expect(policy.load()).resolves.toBe('wrong-input-size');

    expect(policy.isLoaded).toBe(false);
    expect(onnx.env.wasm.wasmPaths).toBeUndefined();
    expect(onnx.create).not.toHaveBeenCalled();
  });

  it('treats a model without a readable input size as absent, before loading the runtime', async () => {
    for (const response of UNREADABLE_METADATA) {
      stubMetadata(response);
      await expect(policy.load()).resolves.toBe('no-model');
    }
    expect(policy.isLoaded).toBe(false);
    expect(onnx.env.wasm.wasmPaths).toBeUndefined();
    expect(onnx.create).not.toHaveBeenCalled();
  });

  it('reports a missing model file', async () => {
    stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
    onnx.create.mockRejectedValue(new Error('404'));
    await expect(policy.load()).resolves.toBe('no-model');
    expect(policy.isLoaded).toBe(false);
  });

  it('reports a runtime that fails to load, before touching the model', async () => {
    stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
    onnx.envThrows = true;
    await expect(policy.load()).resolves.toBe('runtime-error');
    expect(onnx.create).not.toHaveBeenCalled();
  });

  it('frees the session on release and can open it again', async () => {
    stubMetadata({ ok: true, inputSize: ENCODED_STATE_SIZE });
    await policy.load();

    policy.release();
    policy.release();

    expect(policy.isLoaded).toBe(false);
    expect(session.release).toHaveBeenCalledTimes(1);
    await expect(policy.load()).resolves.toBe('ready');
    expect(onnx.create).toHaveBeenCalledTimes(2);
  });
});
