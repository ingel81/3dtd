import { vi } from 'vitest';

/** A renderer that records what is done to it; its canvas a real element */
export function fakeRenderer() {
  const r = {
    domElement: document.createElement('canvas'),
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: true, type: 0 },
    info: { autoReset: false, reset: vi.fn() },
    toneMapping: 4,
    toneMappingExposure: 2,
    outputColorSpace: 'srgb-linear',
    localClippingEnabled: true,
    clippingPlanes: [{}],
    autoClear: false,
    setRenderTarget: vi.fn(),
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    resetState: vi.fn(),
    getContext: () => ({ getExtension: () => null, deleteProgram: () => undefined }),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    renderBufferDirect: vi.fn(),
    compile: vi.fn(() => new Set()),
    properties: { get: () => ({}) },
  };
  return r;
}
