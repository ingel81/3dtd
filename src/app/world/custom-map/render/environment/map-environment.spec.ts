import { Color, Vector3, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { CustomMapEnvironment } from './map-environment';
import { SkyDome } from './sky-dome';

const env = { sky: 'day' as const, sunAzimuth: 200, sunElevation: 40, fogDensity: 0.001, tint: '#ffffff' };

/** The parts of a renderer the shadow cache touches */
function fakeRenderer(): { shadowMap: { autoUpdate: boolean; needsUpdate: boolean } } {
  return { shadowMap: { autoUpdate: true, needsUpdate: false } };
}

/** Sets the renderer the way apply() does, without a scene to install the sky into */
function attach(e: CustomMapEnvironment, renderer: ReturnType<typeof fakeRenderer>): void {
  const inside = e as unknown as { renderer: unknown; previousShadowAuto: boolean };
  inside.renderer = renderer as unknown as WebGLRenderer;
  inside.previousShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
}

describe('sun shadow cache', () => {
  it('renders the shadow map only when the box moved, resized or something was invalidated', () => {
    const e = new CustomMapEnvironment(env);
    const r = fakeRenderer();
    attach(e, r);
    const frame = (focus: Vector3, radius: number): boolean => {
      r.shadowMap.needsUpdate = false;
      e.focus(focus, radius);
      e.update(0.016, e.sun.shadow.camera, focus);
      return r.shadowMap.needsUpdate;
    };
    expect(frame(new Vector3(0, 0, 0), 200)).toBe(true);
    expect(frame(new Vector3(0, 0, 0), 200)).toBe(false);
    // A pan within the middle of the box and a small zoom keep the map
    expect(frame(new Vector3(10, 0, 5), 205)).toBe(false);
    // Leaving the middle moves the box
    expect(frame(new Vector3(40, 0, 0), 205)).toBe(true);
    // A zoom past the next step resizes it
    expect(frame(new Vector3(40, 0, 0), 300)).toBe(true);
    e.invalidateShadows();
    expect(frame(new Vector3(40, 0, 0), 300)).toBe(true);
    // A new sun
    e.set({ ...env, sunAzimuth: 120 });
    expect(frame(new Vector3(40, 0, 0), 300)).toBe(true);
    e.detach();
    expect(r.shadowMap.autoUpdate).toBe(true);
    e.dispose();
  });
});

describe('sky and shadow box (review 2026-10-11)', () => {
  const skyBytes = (e: CustomMapEnvironment) => (e as unknown as { sky: { image: { data: Uint8Array } } }).sky.image.data.slice();

  it('paints the sky again when only the tint changed', () => {
    const e = new CustomMapEnvironment(env);
    const before = skyBytes(e);
    e.set({ ...env, tint: '#ff8040' });
    expect(skyBytes(e)).not.toEqual(before);
    // The same tint again changes nothing
    const tinted = skyBytes(e);
    e.set({ ...env, tint: '#ff8040' });
    expect(skyBytes(e)).toEqual(tinted);
  });

  it('gives the shadow radius back in its steps, the same for a camera that only drifts', () => {
    const e = new CustomMapEnvironment(env);
    const at = new Vector3();
    const steps = [200, 201, 203.5, 207].map((r) => e.focus(at, r));
    expect(new Set(steps).size).toBe(1);
    expect(e.focus(at, 300)).toBeGreaterThan(steps[0]);
  });
});

describe('one full-screen sky (review 2026-10-11)', () => {
  it('draws the dome last of the opaques, depth-tested and without a fragment depth', () => {
    const dome = new SkyDome();
    const m = dome.mesh.material;
    expect(dome.mesh.renderOrder).toBe(1e6);
    expect([m.depthTest, m.depthWrite, m.transparent]).toEqual([true, false, false]);
    // logdepthbuf chunks write gl_FragDepth, which turns early-z off
    expect(m.vertexShader + m.fragmentShader).not.toContain('#include <logdepthbuf');
  });

  it('clears behind the dome in the haze colour, which follows the sky', () => {
    const e = new CustomMapEnvironment(env);
    const backdrop = (e as unknown as { backdrop: Color }).backdrop;
    const fog = e.fog;
    e.set({ ...env, sky: 'dusk' });
    expect(backdrop.getHex()).toBe(fog.color.getHex());
    const dusk = backdrop.getHex();
    e.set({ ...env, sky: 'day' });
    expect(backdrop.getHex()).toBe(fog.color.getHex());
    expect(backdrop.getHex()).not.toBe(dusk);
  });
});
