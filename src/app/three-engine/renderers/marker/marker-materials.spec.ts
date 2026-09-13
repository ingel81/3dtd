import { describe, it, expect } from 'vitest';
import { Texture, type ShaderMaterial } from 'three';
import { createDiamondMaterial, createGroundGlowMaterial, createLabelMaterial, createRingMaterial } from './marker-shaders';
import { createPortalGateMaterial, setPortalGateTextures } from './spawn-portal-gate-material';
import { CIRCLE_STREET, createPortalGlowMaterial } from './spawn-portal-glow-material';
import { PORTAL_SHADER_LAYOUT } from './spawn-portal-geometry';
import { SPAWN_PORTAL_LOOK as L } from '../../../configs/visual-effects.config';

/** Every material the marker and portal managers build, with the arguments they pass. */
function materials(): Record<string, ShaderMaterial> {
  return {
    diamond: createDiamondMaterial(),
    ring: createRingMaterial(),
    groundGlow: createGroundGlowMaterial(),
    label: createLabelMaterial(new Texture()),
    portalGate: createPortalGateMaterial(
      PORTAL_SHADER_LAYOUT, L.palette, L.frameExposure, L.frameGlints, L.glyphs, L.idleEnergy, L.rippleLife,
    ),
    portalGlow: createPortalGlowMaterial(PORTAL_SHADER_LAYOUT, L.palette, L.idleEnergy, L.rippleLife, L.circle, L),
  };
}

describe('Marker- und Portal-Materialien', () => {
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
