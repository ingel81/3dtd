import { describe, it, expect } from 'vitest';
import { CIRCLE_STREET, createPortalGateMaterial, createPortalGlowMaterial } from './marker-shaders';
import { PORTAL_SHADER_LAYOUT } from './spawn-portal-geometry';
import { SPAWN_PORTAL_LOOK as L } from '../../../configs/visual-effects.config';

/**
 * Built-in GLSL functions and constructors the portal shaders call, and
 * what three puts in front of every ShaderMaterial (colorspace_pars_fragment).
 */
const PROVIDED = new Set([
  'abs', 'atan', 'clamp', 'cos', 'cross', 'dot', 'exp', 'floor', 'fract', 'fwidth', 'inverse', 'length', 'max', 'min',
  'mix', 'mod', 'normalize', 'pow', 'sign', 'sin', 'smoothstep', 'step', 'texture2D', 'float', 'int', 'vec2', 'vec3',
  'vec4', 'mat2', 'mat3', 'mat4', 'sRGBTransferEOTF', 'sRGBTransferOETF', 'linearToOutputTexel',
]);
const KEYWORDS = new Set(['if', 'for', 'while', 'return']);

/** Functions a shader calls that it neither defines nor gets from GLSL or three. */
function undefinedCalls(source: string): string[] {
  const code = source.replace(/\/\/.*$/gm, '');
  const defined = new Set([...code.matchAll(/\b(?:void|float|int|bool|vec[234]|mat[234])\s+(\w+)\s*\(/g)].map((m) => m[1]));
  const called = new Set([...code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]));
  return [...called].filter((name) => !defined.has(name) && !PROVIDED.has(name) && !KEYWORDS.has(name)).sort();
}

describe('Portal-Shader', () => {
  const gate = createPortalGateMaterial(
    PORTAL_SHADER_LAYOUT, L.palette, L.frameExposure, L.frameGlints, L.glyphs, L.idleEnergy, L.rippleLife,
  );
  const glow = createPortalGlowMaterial(PORTAL_SHADER_LAYOUT, L.palette, L.idleEnergy, L.rippleLife, L.circle, L);

  it('ruft nur Funktionen auf, die es gibt', () => {
    for (const material of [gate, glow]) {
      expect(undefinedCalls(material.vertexShader)).toEqual([]);
      expect(undefinedCalls(material.fragmentShader)).toEqual([]);
    }
  });

  it('gibt das Tor in linearem Licht aus und kodiert es selbst, mit logarithmischer Tiefe', () => {
    const fragment = gate.fragmentShader;
    expect(fragment).toContain('#include <logdepthbuf_fragment>');
    expect(fragment).toContain('#include <colorspace_fragment>');
    // Die Leere in Anzeigewerten, vor der Kodierung zurückgewandelt
    expect(fragment).toContain('sRGBTransferEOTF(vec4(portalVoid(), 1.0))');
    // Das Leuchten von Stein und Sigillen aus der Palette als lineares Licht
    const ember = gate.uniforms['uEmberLinear'].value;
    expect(ember.x).toBeCloseTo(((L.palette.ember.r + 0.055) / 1.055) ** 2.4, 5);
    expect(gate.vertexShader).toContain('#include <logdepthbuf_vertex>');
  });

  it('kodiert den Beschwörungskreis für sein Ziel, das Straßenlicht bleibt, wie es ist', () => {
    const fragment = glow.fragmentShader;
    // Als Schritt von einer Straße der Helligkeit CIRCLE_STREET zu dieser Straße plus Kreis,
    // beides für Canvas oder Nachbearbeitung kodiert
    expect(fragment).toContain(`const vec3 street = vec3(${CIRCLE_STREET.toFixed(2)});`);
    expect(fragment).toContain('light += linearToOutputTexel(sRGBTransferEOTF(vec4(street + circle, 1.0))).rgb');
    expect(fragment).toContain('- linearToOutputTexel(sRGBTransferEOTF(vec4(street, 1.0))).rgb;');
    // Nicht mehr der Kreis allein dekodiert: mit Bloom war er so kaum zu sehen (Playtest 248)
    expect(fragment).not.toContain('sRGBTransferEOTF(vec4(circle, 1.0))');
    // Nicht die ganze Ausgabe: das Straßenlicht wird nicht angefasst
    expect(fragment).not.toContain('#include <colorspace_fragment>');
    expect(fragment).toContain('#include <logdepthbuf_fragment>');
  });

  it('hebt eine Straße von CIRCLE_STREET mit und ohne Nachbearbeitung gleich an', () => {
    // sRGB wie sRGBTransferEOTF / sRGBTransferOETF in three
    const eotf = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const oetf = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    const street = CIRCLE_STREET;
    for (const circle of [0.02, 0.08, 0.4]) {
      // Canvas: linearToOutputTexel kodiert sRGB, übrig bleibt der Kreis selbst
      expect(oetf(eotf(street + circle)) - oetf(eotf(street))).toBeCloseTo(circle, 6);
      // Composer-Ziel: linear addiert, am Ende kodiert, die Straße wird um den Kreis heller
      const added = eotf(street + circle) - eotf(street);
      expect(oetf(eotf(street) + added) - street).toBeCloseTo(circle, 6);
      // Der Kreis allein dekodiert brachte dort weniger als die Hälfte
      expect(oetf(eotf(street) + eotf(circle)) - street).toBeLessThan(0.5 * circle);
    }
  });
});
