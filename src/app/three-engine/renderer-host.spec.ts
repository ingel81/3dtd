import { BufferGeometry, MeshBasicMaterial, type WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEEP_LEASES, RendererHost } from './renderer-host';
import type { ProgramPins } from './program-pins';
import { settleContexts } from './context-release';

/** A renderer that records what is done to it; its canvas a real element */
function fakeRenderer() {
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
  };
  return r;
}

describe('RendererHost', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lends one renderer to world after world, its canvas in each owner\'s place, reset to a fresh state', () => {
    const made: ReturnType<typeof fakeRenderer>[] = [];
    const host = new RendererHost(() => {
      const r = fakeRenderer();
      made.push(r);
      return r as unknown as WebGLRenderer;
    });
    const first = document.createElement('div');
    const a = host.acquire(first, true);
    expect(first.firstElementChild).toBe(a.renderer.domElement);
    const r = made[0];
    // An owner changes what it needs
    r.toneMapping = 6;
    r.shadowMap.enabled = true;
    a.release();
    expect(first.childElementCount).toBe(0);
    expect(r.toneMapping).toBe(0);
    expect(r.shadowMap.enabled).toBe(false);
    expect(r.dispose).not.toHaveBeenCalled();
    // The next world: the same renderer and context
    const second = document.createElement('div');
    const b = host.acquire(second, true);
    expect(b.renderer).toBe(a.renderer);
    expect(made.length).toBe(1);
    expect(second.firstElementChild).toBe(r.domElement);
    // The first owner's late release leaves the second one's canvas where it is
    a.release();
    expect(second.firstElementChild).toBe(r.domElement);
    b.release();
  });

  it('makes a new renderer for the other MSAA setting, the old context going once the next view stands', () => {
    vi.useFakeTimers();
    const made: ReturnType<typeof fakeRenderer>[] = [];
    const host = new RendererHost(() => {
      const r = fakeRenderer();
      made.push(r);
      return r as unknown as WebGLRenderer;
    });
    host.acquire(document.createElement('div'), true).release();
    const slot = document.createElement('div');
    const lease = host.acquire(slot, false);
    expect(made.length).toBe(2);
    expect(lease.msaa).toBe(false);
    expect(made[0].dispose).toHaveBeenCalled();
    expect(made[0].forceContextLoss).not.toHaveBeenCalled();
    settleContexts();
    vi.runAllTimers();
    expect(made[0].forceContextLoss).toHaveBeenCalled();
    expect(slot.firstElementChild).toBe(made[1].domElement);
  });

  it('disposes every geometry and material drawn during a lease when it is given back', () => {
    const host = new RendererHost(() => fakeRenderer() as unknown as WebGLRenderer);
    const lease = host.acquire(document.createElement('div'), true);
    const kept = new BufferGeometry();
    const drawn = new BufferGeometry();
    let disposed = 0;
    drawn.addEventListener('dispose', () => disposed++);
    kept.addEventListener('dispose', () => disposed += 100);
    const material = new MeshBasicMaterial();
    material.addEventListener('dispose', () => disposed += 10);
    lease.renderer.renderBufferDirect(null as never, null as never, drawn, material, null as never, null as never);
    lease.release();
    expect(disposed).toBe(11);
    // The next lease starts with nothing drawn
    host.acquire(document.createElement('div'), true).release();
    expect(disposed).toBe(11);
  });

  it('keeps the pins of the last KEEP_LEASES leases and gives older ones back', () => {
    const host = new RendererHost(() => fakeRenderer() as unknown as WebGLRenderer);
    const given: number[] = [];
    const pins = (n: number) => ({ dispose: () => given.push(n) }) as unknown as ProgramPins;
    for (let n = 1; n <= 4; n++) {
      const lease = host.acquire(document.createElement('div'), true);
      lease.keep(pins(n));
      lease.release();
    }
    // Leases 3 and 4 kept; 1 and 2 given back as later leases ended
    expect(given).toEqual([1, 2]);
    expect(KEEP_LEASES).toBe(2);
    // A lease no longer current keeps nothing
    const stale = host.acquire(document.createElement('div'), true);
    host.acquire(document.createElement('div'), true);
    stale.keep(pins(9));
    expect(given).toContain(9);
  });
});
