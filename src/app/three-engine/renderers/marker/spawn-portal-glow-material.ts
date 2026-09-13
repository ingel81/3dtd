import { ShaderMaterial, DoubleSide, Vector2, Vector3, Vector4, CustomBlending, AddEquation, OneFactor } from 'three';
import { PORTAL_SIGILS, PORTAL_SIGIL_GLSL } from './spawn-portal-sigils';
import {
  PORTAL_NOISE_GLSL,
  PORTAL_PALETTE_GLSL,
  portalPaletteUniforms,
  type PortalPalette,
  type PortalShaderLayout,
  type PortalSurge,
} from './spawn-portal-shader-chunks';

/** The summoning circle on the street, see SPAWN_PORTAL_LOOK.circle. */
export interface PortalCircleLook {
  /** Centre ahead of the front surface and outer radius (m, scale 1) */
  centre: number;
  radius: number;
  /** Turn (rad/s, wall time) */
  spin: number;
  /** Glow between and during waves, and on top of it at the surge's peak */
  glow: number;
  flare: number;
}

/** Sigil at the circle's centre (index into PORTAL_SIGILS). */
const CIRCLE_CENTRE_SIGIL = PORTAL_SIGILS.findIndex((s) => s.name === 'haloed moon');

/**
 * Display value of the street the summoning circle is matched on. Additive
 * light adds in display values on the canvas and in linear light through
 * the post-processing target, so no one amount looks alike on both over
 * every street. Through the target the circle adds the light that raises a
 * street this bright by what it adds on the canvas: alike there, somewhat
 * brighter over a darker street, dimmer over a lighter one.
 */
export const CIRCLE_STREET = 0.3;

/**
 * Light of the spawn portals on the street in front of them, a dim dark
 * red tinted with the spawn's colour, additive, in one draw call. aRipple
 * is the wall time (s) of the portal's last spawn burst: a ring runs out
 * from the portal's foot over the street. A summoning circle lies on the
 * street ahead of the front surface, drawn in the frame's sigils
 * (portalCircle): dim, turning very slowly, flaring with the surge of a
 * wave start. The circle is written for its target (CIRCLE_STREET), so
 * over a street of that brightness it shows alike with and without
 * post-processing; the street light is still written as it is.
 */
export function createPortalGlowMaterial(
  layout: PortalShaderLayout,
  palette: PortalPalette,
  energy: number,
  rippleLife: number,
  circle: PortalCircleLook,
  surge: PortalSurge,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: energy },
      uRippleLife: { value: rippleLife },
      uOpening: { value: new Vector2(layout.halfOpening, layout.openingHeight) },
      uGround: { value: new Vector3(layout.groundHalfWidth, layout.groundBack, layout.groundFront) },
      uHalfDepth: { value: layout.halfDepth },
      uCircle: { value: new Vector4(circle.centre, circle.radius, circle.spin, circle.glow) },
      uFlare: { value: new Vector3(surge.waveEnergy, surge.surge, circle.flare) },
      ...portalPaletteUniforms(palette),
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aRipple;

      varying vec3 vLocal;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vDepthRatio;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vLocal = position;
        vColor = aColor;
        vPhase = aPhase;
        vRipple = aRipple;
        // The depth is not scaled below 1 (portalDepthScale): the circle
        // keeps round in the portal's width units
        vDepthRatio = length(instanceMatrix[2].xyz) / length(instanceMatrix[0].xyz);

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uEnergy;
      uniform float uRippleLife;
      uniform vec2 uOpening; // half width, height
      uniform vec3 uGround;  // half width, depth behind, depth in front
      uniform float uHalfDepth; // half the volume's depth
      uniform vec4 uCircle;  // centre ahead of the front surface, radius (m), spin (rad/s), glow
      uniform vec3 uFlare;   // wave energy, surge, flare at the surge's peak
      ${PORTAL_PALETTE_GLSL}

      varying vec3 vLocal;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vDepthRatio;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_NOISE_GLSL}

      ${PORTAL_SIGIL_GLSL}

      const float TAU = 6.2831853;
      const float CIRCLE_SIGILS = ${PORTAL_SIGILS.length.toFixed(1)};
      const float CIRCLE_CENTRE_SIGIL = ${CIRCLE_CENTRE_SIGIL.toFixed(1)};

      // Distance (m) from p (on the street, from the circle's centre) to the
      // lines of the summoning circle: an outer double ring and an inner
      // ring, between them every sigil of the set in turn, upright to the
      // outside, and a seal at the centre turning the other way
      float portalCircle(vec2 p, float turn) {
        float R = uCircle.y;
        float r = length(p);
        float d = min(abs(r - R) - 0.06, abs(r - 0.93 * R) - 0.03);
        d = min(d, abs(r - 0.56 * R) - 0.04);
        float sector = floor((atan(p.y, p.x) + turn) / TAU * CIRCLE_SIGILS + 0.5);
        float at = sector * TAU / CIRCLE_SIGILS - turn;
        vec2 radial = vec2(cos(at), sin(at));
        float size = 0.32 * R;
        vec2 q = vec2(dot(p, vec2(-radial.y, radial.x)), dot(p, radial) - 0.745 * R) / size;
        d = min(d, portalSigil(q, mod(sector, CIRCLE_SIGILS)) * size);
        float c = cos(-1.7 * turn);
        float s = sin(-1.7 * turn);
        float seal = 0.9 * R;
        return min(d, portalSigil(mat2(c, s, -s, c) * p / seal, CIRCLE_CENTRE_SIGIL) * seal);
      }

      void main() {
        #include <logdepthbuf_fragment>

        // Spawn burst: strength fading from 1 to 0 over the ripple's life
        float age = uTime - vRipple;
        float ripple = age >= 0.0 && age < uRippleLife ? 1.0 - age / uRippleLife : 0.0;
        float progress = 1.0 - ripple;

        // Strongest at the portal's foot, fading to the patch's edges,
        // weaker behind the portal; along the route measured from the front
        // and the back surface, 0 inside the volume
        float zOut = sign(vLocal.z) * max(abs(vLocal.z) - uHalfDepth, 0.0);
        float dx = max(abs(vLocal.x) - uOpening.x, 0.0);
        float d = length(vec2(dx, zOut));
        float side = 1.0 - smoothstep(0.55, 1.0, abs(vLocal.x) / uGround.x);
        float along = zOut >= 0.0
          ? 1.0 - smoothstep(0.35, 1.0, zOut / uGround.z)
          : (1.0 - smoothstep(0.2, 1.0, -zOut / uGround.y)) * 0.45;
        float flicker = 0.8 + 0.2 * portalNoise(vec2(uTime * 1.7 + vPhase, d * 0.3));
        // Ring running out from the portal's foot over the street
        float front = d - progress * uGround.z;
        float ring = ripple * exp(-front * front * 0.6);
        vec3 light = mix(uEmber, vColor, 0.25) * exp(-d * 0.3) * side * along * (0.2 + 0.35 * uEnergy) * flicker
          + mix(uEmber, uHot, 0.5) * ring * side * along * 0.6;

        // Summoning circle ahead of the front surface: fine lines with a
        // soft halo, faded where a pixel covers so much street that they
        // would break up into noise
        vec2 onStreet = vec2(vLocal.x, (vLocal.z - uHalfDepth) * vDepthRatio - uCircle.x);
        float lines = portalCircle(onStreet, uTime * uCircle.z);
        float w = max(fwidth(lines), 0.004);
        float ink = 1.0 - smoothstep(0.0, 1.5 * w, lines);
        float halo = exp(-max(lines, 0.0) * 5.0);
        float sharp = 1.0 - smoothstep(0.12, 0.4, w);
        float surge = clamp((uEnergy - uFlare.x) / uFlare.y, 0.0, 1.0);
        float breathe = 0.75 + 0.25 * sin(uTime * 0.7 + vPhase);
        float level = uCircle.w * breathe * (0.6 + 0.8 * uEnergy) + uFlare.z * surge;
        vec3 tint = mix(mix(uViolet, uEmber, 0.55 + 0.45 * surge), vColor, 0.15);
        vec3 circle = tint * (ink + 0.35 * halo) * level * sharp;
        // The circle is designed in display values added over the street.
        // Encoded for the target as the step from a street of CIRCLE_STREET
        // to that street plus the circle: on the canvas exactly the circle,
        // through the linear post-processing target the light that raises
        // such a street by as much. The circle decoded alone added a
        // fraction of that over a sunlit street (playtest 248).
        const vec3 street = vec3(${CIRCLE_STREET.toFixed(2)});
        light += linearToOutputTexel(sRGBTransferEOTF(vec4(street + circle, 1.0))).rgb
          - linearToOutputTexel(sRGBTransferEOTF(vec4(street, 1.0))).rgb;
        gl_FragColor = vec4(light, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  });
}
