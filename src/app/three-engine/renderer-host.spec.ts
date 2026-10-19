import { BufferGeometry, MeshBasicMaterial, type WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEEP_LEASES, onGpuReset, RendererHost } from './renderer-host';
import type { ProgramPins } from './program-pins';
import { settleContexts } from './context-release';
import { fakeRenderer } from '../../test/fake-renderer';

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

  it('tells when the GPU lost what the page uploaded: a renderer made anew, a context back after a loss', () => {
    const host = new RendererHost(() => fakeRenderer() as unknown as WebGLRenderer);
    const heard = vi.fn();
    const stop = onGpuReset(heard);
    host.acquire(document.createElement('div'), true).release();
    // The first renderer and one lent again lose nothing
    host.acquire(document.createElement('div'), true).release();
    expect(heard).not.toHaveBeenCalled();
    const old = host.renderer!;
    host.acquire(document.createElement('div'), false).release();
    expect(heard).toHaveBeenCalledTimes(1);
    // The old renderer's canvas no longer counts
    old.domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(heard).toHaveBeenCalledTimes(1);
    host.renderer!.domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    host.dispose();
  });
});
