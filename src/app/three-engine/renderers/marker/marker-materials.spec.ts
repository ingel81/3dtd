import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Texture, type ShaderMaterial } from 'three';
import {
  CIRCLE_STREET,
  createDiamondMaterial,
  createGroundGlowMaterial,
  createLabelMaterial,
  createPortalGateMaterial,
  createPortalGlowMaterial,
  createRingMaterial,
  setPortalGateTextures,
} from './marker-shaders';
import { PORTAL_SHADER_LAYOUT } from './spawn-portal-geometry';
import { SPAWN_PORTAL_LOOK as L } from '../../../configs/visual-effects.config';

const atlas = new Texture();
atlas.name = 'atlas';

/** Every material the marker and portal managers build, with the arguments they pass. */
function materials(): Record<string, ShaderMaterial> {
  return {
    diamond: createDiamondMaterial(),
    ring: createRingMaterial(),
    groundGlow: createGroundGlowMaterial(),
    label: createLabelMaterial(atlas),
    portalGate: createPortalGateMaterial(
      PORTAL_SHADER_LAYOUT, L.palette, L.frameExposure, L.frameGlints, L.glyphs, L.idleEnergy, L.rippleLife,
    ),
    portalGlow: createPortalGlowMaterial(PORTAL_SHADER_LAYOUT, L.palette, L.idleEnergy, L.rippleLife, L.circle, L),
  };
}

function uniformValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Texture) return `Texture:${value.name}`;
  const vector = value as { toArray?: () => number[] };
  if (typeof vector.toArray === 'function') return vector.toArray();
  return String(value);
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Shader sources, uniforms with their start values and render state of a material, hashed. */
function fingerprint(material: ShaderMaterial): Record<string, string> {
  const uniforms = Object.keys(material.uniforms)
    .sort()
    .map((name) => [name, uniformValue(material.uniforms[name].value)]);
  const { transparent, depthTest, depthWrite, side, blending, blendEquation, blendSrc, blendDst } = material;
  const state = { transparent, depthTest, depthWrite, side, blending, blendEquation, blendSrc, blendDst };
  return {
    vertex: hash(material.vertexShader),
    fragment: hash(material.fragmentShader),
    setup: hash(JSON.stringify({ uniforms, state })),
  };
}

describe('Marker- und Portal-Materialien', () => {
  it('bauen jedes Material Zeichen für Zeichen wie vor der Aufteilung', () => {
    const all = materials();
    const prints = Object.fromEntries(Object.entries(all).map(([name, material]) => [name, fingerprint(material)]));
    expect(prints).toEqual({
      diamond: { vertex: 'e32e12dfc6f4423b', fragment: 'f77cd6314a08c92b', setup: '06c66ef89b13e3dd' },
      ring: { vertex: '64afe44c86843bec', fragment: '14dad21fbab6f6d2', setup: '96c24d4943bd6eaa' },
      groundGlow: { vertex: 'b7378f44b8ba274e', fragment: 'dafb3ac3faaa1145', setup: 'b80b9f78c5e33edb' },
      label: { vertex: '294d5b7848eb6e1a', fragment: '134e80085d7b8ce9', setup: '72650b738556f62d' },
      portalGate: { vertex: 'b665e71b91f27b04', fragment: 'dd12de118918b01a', setup: '25194c7d4efdb9c3' },
      portalGlow: { vertex: '4539790b9021ffdf', fragment: '6f2004f6527bb333', setup: 'a2e66a02b0e2f14f' },
    });
  });

  it('rechnen alle mit logarithmischer Tiefe', () => {
    for (const material of Object.values(materials())) {
      expect(material.vertexShader).toContain('#include <logdepthbuf_pars_vertex>');
      expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_pars_fragment>');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    }
  });

  it('gibt dem Tor die gebackenen Texturen des Rahmens', () => {
    const gate = materials()['portalGate'];
    const [baseColor, normal, orm, emissive] = [new Texture(), new Texture(), new Texture(), new Texture()];
    setPortalGateTextures(gate, { baseColor, normal, orm, emissive });
    expect(gate.uniforms['uBaseMap'].value).toBe(baseColor);
    expect(gate.uniforms['uNormalMap'].value).toBe(normal);
    expect(gate.uniforms['uOrmMap'].value).toBe(orm);
    expect(gate.uniforms['uEmissiveMap'].value).toBe(emissive);
  });

  it('stimmt den Beschwörungskreis auf eine Straße von 0.3 ab', () => {
    expect(CIRCLE_STREET).toBe(0.3);
  });
});
