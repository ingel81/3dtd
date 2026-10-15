import { Color, Vector3, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { CustomMapEnvironment } from './map-environment';
import { HEIGHT_FOG_UNIFORMS } from './height-fog';
import { SHADOW_PARTS } from './shadow-parts';
import { SkyDome } from './sky-dome';
import { chooseSkyImage, SKY_IMAGES } from './sky-images';
import { SKY_PRESETS } from './biomes';

const env = { sky: 'day' as const, sunAzimuth: 200, sunElevation: 40, fogDensity: 0.001, tint: '#ffffff' };

/** The parts of a renderer the shadow cache touches; `parts` counts the shadow passes drawn */
function fakeRenderer(): { shadowMap: { autoUpdate: boolean; needsUpdate: boolean; enabled: boolean }; renders: number; parts: number } {
  const r = {
    shadowMap: {
      autoUpdate: true,
      needsUpdate: false,
      enabled: true,
      // three's shadow pass for the staging light: a part
      render: () => {
        r.parts++;
      },
    },
    renders: 0,
    parts: 0,
    // The sky texture's bake; the shadow parts draw after an empty scene's render
    getRenderTarget: () => null,
    setRenderTarget: () => undefined,
    render: (scene?: { onAfterRender?: () => void }) => {
      r.renders++;
      scene?.onAfterRender?.();
    },
    clear: () => undefined,
  };
  return r;
}

/** Sets the renderer the way apply() does, without a scene to install the sky into; with `scene` the shadows draw */
function attach(e: CustomMapEnvironment, renderer: ReturnType<typeof fakeRenderer>, scene = false): void {
  const inside = e as unknown as { renderer: unknown; previousShadowAuto: boolean; scene: unknown };
  inside.renderer = renderer as unknown as WebGLRenderer;
  inside.previousShadowAuto = renderer.shadowMap.autoUpdate;
  if (scene) inside.scene = { children: [] };
  renderer.shadowMap.autoUpdate = false;
}

describe('sun shadow cache', () => {
  /** One frame at `focus` with the box asked for `radius`: the shadow parts drawn in it */
  const frame = (e: CustomMapEnvironment, r: ReturnType<typeof fakeRenderer>, focus: Vector3, radius: number): number => {
    const before = r.parts;
    e.focus(focus, radius);
    e.update(0.016, e.sun.shadow.camera);
    return r.parts - before;
  };
  const parts = SHADOW_PARTS;

  it('renders the shadow map only when the box moved, resized or something was invalidated', () => {
    const e = new CustomMapEnvironment(env);
    const r = fakeRenderer();
    attach(e, r, true);
    // The first map in one frame
    expect(frame(e, r, new Vector3(0, 0, 0), 200)).toBe(parts);
    expect(frame(e, r, new Vector3(0, 0, 0), 200)).toBe(0);
    // A pan within the middle of the box and a small zoom keep the map
    expect(frame(e, r, new Vector3(10, 0, 5), 205)).toBe(0);
    const build = (focus: Vector3, radius: number): number[] => {
      const drawn: number[] = [];
      for (let k = 0; k < 20; k++) {
        const n = frame(e, r, focus, radius);
        if (!n) break;
        drawn.push(n);
      }
      return drawn;
    };
    // Leaving the middle moves the box: a build spread over frames
    expect(build(new Vector3(40, 0, 0), 205)).toEqual(Array(parts).fill(1));
    // A zoom past the next step resizes it
    expect(build(new Vector3(40, 0, 0), 300).length).toBeGreaterThan(0);
    e.invalidateShadows();
    expect(build(new Vector3(40, 0, 0), 300).length).toBeGreaterThan(0);
    // A new sun: spread over frames as well, the shown map stays until the new one is whole
    const shown = e.sun.shadow.map;
    e.set({ ...env, sunAzimuth: 120 });
    expect(build(new Vector3(40, 0, 0), 300)).toEqual(Array(parts).fill(1));
    expect(e.sun.shadow.map).not.toBe(shown);
    e.detach();
    expect(r.shadowMap.autoUpdate).toBe(true);
    e.dispose();
  });

  it('keeps showing the old map and its matrix until the last tile, then swaps both in one frame', () => {
    const e = new CustomMapEnvironment(env);
    const r = fakeRenderer();
    attach(e, r, true);
    frame(e, r, new Vector3(0, 0, 0), 200);
    const shown = e.sun.shadow.map;
    const matrix = e.sun.shadow.matrix.clone();
    const area = new Vector3();
    const radius = e.shadowArea(area);
    expect(shown).not.toBeNull();
    const moved = new Vector3(60, 0, 0);
    for (let k = 1; k < parts; k++) {
      frame(e, r, moved, 200);
      expect(e.sun.shadow.map).toBe(shown);
      expect(e.sun.shadow.matrix.equals(matrix)).toBe(true);
      expect(e.shadowArea(new Vector3())).toBe(radius);
    }
    frame(e, r, moved, 200);
    expect(e.sun.shadow.map).not.toBe(shown);
    expect(e.sun.shadow.matrix.equals(matrix)).toBe(false);
    e.shadowArea(area);
    expect(area.x).toBeCloseTo(e.sun.target.position.x, 3);
    // The next build draws into the map that was shown before
    e.invalidateShadows();
    for (let k = 0; k < parts; k++) frame(e, r, moved, 200);
    expect(e.sun.shadow.map).toBe(shown);
    e.dispose();
  });

  it('lets a change during a build wait for it, then builds once more', () => {
    const e = new CustomMapEnvironment(env);
    const r = fakeRenderer();
    attach(e, r, true);
    frame(e, r, new Vector3(0, 0, 0), 200);
    e.invalidateShadows();
    const drawn: number[] = [];
    for (let k = 0; k < 12; k++) {
      // A caster changes every other frame, as during a pan
      if (k % 2 === 0 && k < 6) e.invalidateShadows();
      drawn.push(frame(e, r, new Vector3(0, 0, 0), 200));
    }
    // Two builds back to back, one part a frame, then rest
    expect(Math.max(...drawn)).toBe(1);
    expect(drawn.reduce((a, b) => a + b, 0)).toBe(2 * parts);
    expect(drawn.at(-1)).toBe(0);
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

  it('grows at once to cover the view, shrinks only once the view needs well under it', () => {
    const e = new CustomMapEnvironment(env);
    const at = new Vector3();
    const box = e.focus(at, 200);
    expect(box).toBeGreaterThanOrEqual(200);
    // A wheel notch closer (1.15) and two: the box and its casters stay
    expect(e.focus(at, 200 / 1.15)).toBe(box);
    expect(e.focus(at, 200 / 1.15 / 1.15)).toBe(box);
    // Far closer: it shrinks, still covering what was asked
    const small = e.focus(at, 100);
    expect(small).toBeLessThan(box);
    expect(small).toBeGreaterThanOrEqual(100);
    expect(e.focus(at, 201 * 1.1)).toBeGreaterThanOrEqual(221);
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

describe('moonlight', () => {
  const night = { sky: 'night' as const, sunAzimuth: 200, sunElevation: 30, fogDensity: 0.001, tint: '#ffffff' };

  it('lights a night map cool and brighter, leaves the sky dark and day maps alone', () => {
    const plain = new CustomMapEnvironment(night);
    const lit = new CustomMapEnvironment({ ...night, moonlight: 0.8 });
    expect(lit.sun.intensity).toBeCloseTo(plain.sun.intensity + 1.2);
    expect(lit.hemi.intensity).toBeCloseTo(plain.hemi.intensity + 0.64);
    // A cool light
    expect(lit.sun.color.b).toBeGreaterThan(lit.sun.color.r);
    // The sky keeps its colours
    expect(lit.zenith.getHex()).toBe(plain.zenith.getHex());
    expect(lit.horizon.getHex()).toBe(plain.horizon.getHex());
    // Only at night
    const day = new CustomMapEnvironment({ ...night, sky: 'day' });
    const dayMoon = new CustomMapEnvironment({ ...night, sky: 'day', moonlight: 1 });
    expect(dayMoon.sun.intensity).toBe(day.sun.intensity);
    for (const e of [plain, lit, day, dayMoon]) e.dispose();
  });
});

describe('sky texture for reflections', () => {
  it('bakes the sky every few frames and right after a new sky', () => {
    const e = new CustomMapEnvironment(env);
    const r = fakeRenderer();
    attach(e, r);
    for (let k = 0; k < 6; k++) e.update(0.016, e.sun.shadow.camera);
    expect(r.renders).toBe(2);
    e.set({ ...env, sky: 'dusk' });
    e.update(0.016, e.sun.shadow.camera);
    expect(r.renders).toBe(3);
    e.dispose();
  });
});

describe('tone mapping (custom maps only)', () => {
  it('tone maps the map with Neutral at the look exposure and gives the renderer its own back on detach', async () => {
    const { Scene, NeutralToneMapping, ACESFilmicToneMapping } = await import('three');
    const renderer = {
      shadowMap: { autoUpdate: true, needsUpdate: false },
      toneMapping: ACESFilmicToneMapping,
      toneMappingExposure: 0.21,
      getRenderTarget: () => null,
      setRenderTarget: () => undefined,
      compileAsync: () => Promise.resolve(),
    };
    const e = new CustomMapEnvironment(env);
    e.apply(new Scene(), renderer as unknown as WebGLRenderer);
    expect(renderer.toneMapping).toBe(NeutralToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.4);
    e.set({ ...env, sky: 'night' });
    expect(renderer.toneMappingExposure).toBeCloseTo(1.7);
    e.detach();
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(0.21);
    e.dispose();
  });
});

describe('Mars (TODO E170)', () => {
  it('rings a setting sun with a blue glow while its light stays near white; by day the glow is the sun', () => {
    const e = new CustomMapEnvironment({ ...env, biome: 'mars', sky: 'dusk' });
    const glow = e.skyDome.uniforms['uGlowColor'].value as Color;
    expect(glow.b).toBeGreaterThan(glow.r * 2);
    expect(e.sun.color.b).toBeLessThan(e.sun.color.r * 1.2);
    e.set({ ...env, biome: 'mars', sky: 'day' });
    expect(glow.equals(e.sun.color)).toBe(true);
    e.dispose();
  });

  it('lights the day with a pale butterscotch sky, not a red one', () => {
    const e = new CustomMapEnvironment({ ...env, biome: 'mars' });
    const hsl = { h: 0, s: 0, l: 0 };
    e.horizon.getHSL(hsl);
    // Orange-yellow, not red, and far from fully saturated
    expect(hsl.h * 360).toBeGreaterThan(30);
    expect(hsl.s).toBeLessThan(0.5);
    e.dispose();
  });
});

describe('image skies (TODO E172)', () => {
  it('takes haze, light hue and sun colour from the picture, its preset for the rest, and hides the procedural sky', () => {
    const image = SKY_IMAGES.find((s) => s.id === 'sunset')!;
    const e = new CustomMapEnvironment({ ...env, ...chooseSkyImage(image.id) });
    // Haze and fog: the picture's horizon, so the dome's foot fades into it
    expect(e.fog.color.toArray()).toEqual(new Color().setRGB(...image.horizon).toArray());
    expect(e.horizon.toArray()).toEqual(new Color().setRGB(...image.horizon).toArray());
    expect(e.sun.color.toArray()).toEqual(new Color().setRGB(...image.sunColor!).toArray());
    // The hemisphere light: the hue of the picture's sky at the dusk preset's brightness
    const lum = (c: Color): number => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    expect(lum(e.hemi.color)).toBeCloseTo(lum(new Color(SKY_PRESETS.dusk.hemiSky)), 5);
    expect(e.hemi.color.r / e.hemi.color.b).toBeCloseTo(image.sky[0] / image.sky[2], 5);
    expect(e.darkness).toBeGreaterThan(0.5);
    const u = e.skyDome.uniforms;
    expect(u['uCover'].value).toBe(2);
    expect(u['uStars'].value).toBe(0);
    // No decoder in the test: the picture never loads, the dome shows the gradient in its colours
    expect(u['uSkyImageOn'].value).toBe(0);
    e.dispose();
  });

  it('a night picture keeps the moonlight; an unknown id is the procedural sky', () => {
    const night = new CustomMapEnvironment({ ...env, ...chooseSkyImage('starry-night') });
    const dark = night.sun.intensity;
    night.set({ ...env, ...chooseSkyImage('starry-night'), moonlight: 1 });
    expect(night.sun.intensity).toBeGreaterThan(dark);
    night.dispose();
    const plain = new CustomMapEnvironment(env);
    const unknown = new CustomMapEnvironment({ ...env, skyImage: 'from-a-newer-game' });
    expect(unknown.fog.color.toArray()).toEqual(plain.fog.color.toArray());
    expect(unknown.skyDome.uniforms['uCover'].value).toBe(plain.skyDome.uniforms['uCover'].value);
    plain.dispose();
    unknown.dispose();
  });
});

describe('the moon', () => {
  it('shows the Earth where the map sets it, the look default without, none at size 0 or on other looks', () => {
    const e = new CustomMapEnvironment({ ...env, biome: 'moon' });
    const u = e.skyDome.uniforms;
    // The look's Earth: north-east, a third up, 4 degrees across
    expect(u['uPlanet'].value).toBeCloseTo((4 * Math.PI) / 360, 6);
    const dir = u['uPlanetDir'].value as Vector3;
    expect(dir.y).toBeCloseTo(Math.sin((33 * Math.PI) / 180), 5);
    // Due north and low, 10 degrees across: scene z is north
    e.set({ ...env, biome: 'moon', planet: { azimuth: 0, elevation: 15, size: 10 } });
    expect(u['uPlanet'].value).toBeCloseTo((10 * Math.PI) / 360, 6);
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.z).toBeGreaterThan(0.9);
    e.set({ ...env, biome: 'moon', planet: { azimuth: 0, elevation: 15, size: 0 } });
    expect(u['uPlanet'].value).toBe(0);
    // Another look shows a planet only when the map asks for one
    e.set({ ...env, biome: 'mars' });
    expect(u['uPlanet'].value).toBe(0);
    e.set({ ...env, biome: 'mars', planet: { azimuth: 90, elevation: 20, size: 3 } });
    expect(u['uPlanet'].value).toBeGreaterThan(0);
    e.dispose();
  });

  it('lets the map lights matter by day under the black sky, and the land beyond the border show', () => {
    const e = new CustomMapEnvironment({ ...env, biome: 'moon' });
    expect(e.darkness).toBe(0.5);
    // No air: the backdrop range would sink into the black haze
    expect(HEIGHT_FOG_UNIFORMS.uFogBeyond.value).toBeLessThan(0.97);
    e.set({ ...env, biome: 'temperate' });
    expect(e.darkness).toBe(0);
    expect(HEIGHT_FOG_UNIFORMS.uFogBeyond.value).toBe(0.97);
    e.dispose();
  });
});
