import { describe, it, expect } from 'vitest';
import { ShaderChunk } from 'three';
import { ADDITIVE_GROUND, DISPLAY_OUTPUT_GLSL } from './display-output';

/**
 * sRGBTransferEOTF and sRGBTransferOETF as three writes them
 * (colorspace_pars_fragment), with its constants; the first test holds the
 * chunk to them.
 */
const eotf = (v: number) => (v <= 0.04045 ? v * 0.0773993808 : (v * 0.9478672986 + 0.0521327014) ** 2.4);
const oetf = (v: number) => (v <= 0.0031308 ? v * 12.92 : v ** 0.41666 * 1.055 - 0.055);

/** linearToOutputTexel: sRGB on the canvas, nothing into the composer's linear target. */
type Target = 'canvas' | 'composer';
const toOutput = (linear: number, target: Target) => (target === 'canvas' ? oetf(linear) : linear);

/** displayOutput and displayLight of DISPLAY_OUTPUT_GLSL, one channel. */
function displayOutput(display: number, target: Target): number {
  const c = Math.max(display, 0);
  const low = Math.min(c, 1);
  return toOutput(eotf(low), target) + c - low;
}
function displayLight(light: number, target: Target): number {
  return displayOutput(ADDITIVE_GROUND + Math.max(light, 0), target) - displayOutput(ADDITIVE_GROUND, target);
}
function displayLightAlpha(light: number, alpha: number, target: Target): number {
  return alpha <= 0 ? 0 : displayLight(light * alpha, target) / alpha;
}

/** What the screen shows after the output pass encoded the composer's target (the canvas clamps). */
const shown = (linear: number) => Math.min(Math.max(oetf(linear), 0), 1);

/** 0..4 in steps of 1/256, beyond 1 as the shaders' overdriven glows go. */
const SAMPLES = Array.from({ length: 4 * 256 + 1 }, (_, i) => i / 256);
/** Below half an 8-bit step no pixel of the canvas can change (it may round the other way where it lay on the edge). */
const HALF_STEP = 0.5 / 255;

const maxError = (f: (x: number) => number, want: (x: number) => number, xs = SAMPLES) =>
  Math.max(...xs.map((x) => Math.abs(f(x) - want(x))));

describe('Ausgabe in Anzeigewerten (display-output)', () => {
  it('rechnet mit den Konstanten, die three in seinen sRGB-Funktionen hat', () => {
    const chunk = ShaderChunk.colorspace_pars_fragment;
    for (const constant of ['0.9478672986', '0.0521327014', 'vec3( 2.4 )', '0.0773993808', 'vec3( 0.04045 )',
      'vec3( 0.41666 )', '* 1.055 - vec3( 0.055 )', '* 12.92', 'vec3( 0.0031308 )']) {
      expect(chunk).toContain(constant);
    }
    expect(ShaderChunk.colorspace_fragment).toContain('gl_FragColor = linearToOutputTexel( gl_FragColor );');
  });

  it('gibt auf dem Canvas zurück, was es bekommt: das Bild ohne Bloom bleibt, wie es war', () => {
    const opaque = maxError((x) => displayOutput(x, 'canvas'), (x) => x);
    const light = maxError((x) => displayLight(x, 'canvas'), (x) => x);
    expect(opaque).toBeLessThan(1e-4);
    expect(light).toBeLessThan(1e-4);
    expect(opaque).toBeLessThan(HALF_STEP / 10);
    // Mit Alpha (AdditiveBlending: SrcAlpha, One) kommt rgb * alpha an, wie vorher
    for (const alpha of [1, 0.5, 0.05, 0.004]) {
      expect(maxError((x) => displayLightAlpha(x, alpha, 'canvas') * alpha, (x) => x * alpha)).toBeLessThan(1e-4);
    }
    // Negativ zeigt der Canvas ohnehin schwarz
    expect(displayOutput(-0.2, 'canvas')).toBe(0);
    expect(displayLight(-0.2, 'canvas')).toBeCloseTo(0, 6);
  });

  it('bringt eine deckende Farbe durch die Nachbearbeitung als denselben Anzeigewert an', () => {
    const upToOne = SAMPLES.filter((x) => x <= 1);
    expect(maxError((x) => shown(displayOutput(x, 'composer')), (x) => x, upToOne)).toBeLessThan(1e-4);
    // Über 1 zeigt der Schirm 1, der Bloom bekommt den Überschuss wie vorher
    expect(shown(displayOutput(3, 'composer'))).toBe(1);
    expect(displayOutput(3, 'composer')).toBeCloseTo(3, 6);
    // Unkodiert kam derselbe Wert aufgehellt an: 0.2 als 0.48
    expect(shown(0.2)).toBeCloseTo(0.485, 3);
  });

  it('mischt eine halb deckende Farbe durch die Nachbearbeitung näher am Canvas als unkodiert', () => {
    for (const alpha of [0.2, 0.4, 0.7]) {
      for (const colour of [0, 0.05, 0.3, 0.8]) {
        for (const ground of [0.1, 0.3, 0.6]) {
          const canvas = alpha * colour + (1 - alpha) * ground;
          const encoded = shown(alpha * displayOutput(colour, 'composer') + (1 - alpha) * eotf(ground));
          const raw = shown(alpha * colour + (1 - alpha) * eotf(ground));
          // Lineares Mischen liegt nie unter dem Canvas, kodiert nie über dem unkodierten Wert
          expect(encoded).toBeGreaterThanOrEqual(canvas - 1e-6);
          expect(encoded).toBeLessThanOrEqual(raw + 1e-6);
        }
      }
    }
  });

  it('hebt einen Boden von ADDITIVE_GROUND mit und ohne Nachbearbeitung gleich an', () => {
    const ground = ADDITIVE_GROUND;
    const upToTop = SAMPLES.filter((x) => ground + x <= 1);
    expect(maxError((x) => shown(eotf(ground) + displayLight(x, 'composer')), (x) => ground + x, upToTop)).toBeLessThan(1e-4);
    for (const alpha of [1, 0.5, 0.1]) {
      const added = (x: number) => displayLightAlpha(x, alpha, 'composer') * alpha;
      expect(maxError((x) => shown(eotf(ground) + added(x)), (x) => ground + x * alpha, upToTop)).toBeLessThan(1e-4);
    }
  });

  it('weicht additiv über anderem Boden ab: dunkler Boden heller, heller Boden dunkler', () => {
    const light = 0.1;
    const composer = (ground: number) => shown(eotf(ground) + displayLight(light, 'composer')) - ground;
    // Über Schwarz etwa 2,6-mal so hell, über 0,6 knapp die Hälfte (0,049 von 0,1)
    expect(composer(0)).toBeGreaterThan(light);
    expect(composer(0.6)).toBeLessThan(light);
    expect(composer(0.6)).toBeGreaterThan(0.45 * light);
    // Allein dekodiert brachte das Licht über der Straße weniger als die Hälfte (Playtest 248)
    expect(shown(eotf(ADDITIVE_GROUND) + eotf(light)) - ADDITIVE_GROUND).toBeLessThan(0.5 * light);
  });

  it('steht als GLSL mit dem Boden und three-Funktionen, die jedes ShaderMaterial hat', () => {
    expect(ADDITIVE_GROUND).toBe(0.3);
    expect(DISPLAY_OUTPUT_GLSL).toContain('const vec3 ground = vec3(0.30);');
    expect(DISPLAY_OUTPUT_GLSL).toContain('linearToOutputTexel(sRGBTransferEOTF(vec4(low, 1.0))).rgb + c - low');
    for (const signature of ['vec3 displayOutput(vec3 display)', 'vec4 displayOutput(vec4 display)',
      'vec3 displayLight(vec3 light)', 'vec4 displayLight(vec4 light)']) {
      expect(DISPLAY_OUTPUT_GLSL).toContain(signature);
    }
  });
});
