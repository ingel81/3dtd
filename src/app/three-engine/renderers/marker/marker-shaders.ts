import {
  ShaderMaterial,
  DoubleSide,
  FrontSide,
  Vector2,
  Vector3,
  Vector4,
  Texture,
  AdditiveBlending,
  CustomBlending,
  AddEquation,
  OneFactor,
} from 'three';
import type { EffectRgb } from '../../../configs/visual-effects.config';
import { PORTAL_SIGILS, PORTAL_SIGIL_GLSL } from './spawn-portal-sigils';
import { PORTAL_STONE_GLSL } from './spawn-portal-stone';

// ============================================================
// DIAMOND BODY SHADER
// ============================================================

export function createDiamondMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      // Per-instance attributes
      attribute vec3 aColor;
      attribute float aGlowIntensity;
      attribute float aRotationSpeed;
      attribute float aPhaseOffset;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vGlowIntensity;
      varying float vPhase;
      varying float vFresnel;
      varying float vHeightGrad;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float phase = uTime + aPhaseOffset;

        // GPU-side Y-axis rotation
        float angle = phase * aRotationSpeed * 1000.0;
        float s = sin(angle);
        float c = cos(angle);
        vec3 rotatedPos = vec3(
          position.x * c - position.z * s,
          position.y,
          position.x * s + position.z * c
        );
        vec3 rotatedNormal = vec3(
          normal.x * c - normal.z * s,
          normal.y,
          normal.x * s + normal.z * c
        );

        // Vertical gradient: map local Y from geometry range to 0..1
        // OctahedronGeometry(8) scaled Y*1.8: Y ranges from -14.4 to +14.4
        vHeightGrad = clamp((position.y + 14.4) / 28.8, 0.0, 1.0);

        // Gentle bobbing
        float bob = sin(phase * 2.0) * 1.5;

        // Apply instance transform
        vec4 worldPos4 = instanceMatrix * vec4(rotatedPos, 1.0);
        worldPos4.y += bob;

        vWorldPos = worldPos4.xyz;
        vWorldNormal = normalize((instanceMatrix * vec4(rotatedNormal, 0.0)).xyz);
        vColor = aColor;
        vGlowIntensity = aGlowIntensity;
        vPhase = phase;

        // Pre-compute Fresnel
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        vFresnel = 1.0 - abs(dot(viewDir, vWorldNormal));
        vFresnel = pow(vFresnel, 2.0);

        vec4 mvPosition = modelViewMatrix * worldPos4;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vGlowIntensity;
      varying float vPhase;
      varying float vFresnel;
      varying float vHeightGrad;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Vertical shading: top half brighter/lighter, bottom half darker
        // heightGrad: 0 = bottom tip, 0.5 = equator, 1 = top tip
        float topFactor = smoothstep(0.3, 0.9, vHeightGrad);   // bright at top
        float bottomDarken = smoothstep(0.5, 0.0, vHeightGrad); // dark at bottom

        // Holographic scan lines (horizontal bands scrolling upward)
        float scanSpeed = 1.5;
        float scan = sin(vWorldPos.y * 0.8 - vPhase * scanSpeed) * 0.5 + 0.5;
        scan = smoothstep(0.3, 0.7, scan) * 0.25;

        // Energy pulse (breathing brightness)
        float pulse = sin(vPhase * 3.0) * 0.08 + 0.92;

        // Combine: base with vertical gradient
        vec3 topColor = mix(vColor * 1.4, vec3(1.0), 0.25); // lighter/whiter at top
        vec3 botColor = vColor * 0.4;                         // darker at bottom
        vec3 baseColor = mix(botColor, topColor, vHeightGrad) * pulse;

        // Fresnel edge glow
        vec3 edgeGlow = mix(vColor * 1.5, vec3(1.0), 0.5) * vFresnel * vGlowIntensity * 0.7;

        // Scan lines (more visible in mid-section)
        float scanMask = 1.0 - abs(vHeightGrad - 0.5) * 2.0; // strongest at equator
        vec3 scanHighlight = vColor * 1.6 * scan * scanMask;

        vec3 finalColor = baseColor * 0.8 + edgeGlow + scanHighlight;

        // Alpha: much more opaque overall, slight edge glow
        float alpha = mix(0.92, 1.0, vFresnel * vGlowIntensity * 0.5) * pulse;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
}

// ============================================================
// RING SHADER
// ============================================================

export function createRingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aTiltAngle;
      attribute float aRotationSpeed;
      attribute float aPhaseOffset;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vPhase;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float phase = uTime + aPhaseOffset;

        // Apply tilt around Z-axis
        float tiltS = sin(aTiltAngle);
        float tiltC = cos(aTiltAngle);
        vec3 tiltedPos = vec3(
          position.x,
          position.y * tiltC - position.z * tiltS,
          position.y * tiltS + position.z * tiltC
        );
        vec3 tiltedNormal = vec3(
          normal.x,
          normal.y * tiltC - normal.z * tiltS,
          normal.y * tiltS + normal.z * tiltC
        );

        // Y-axis rotation
        float angle = phase * aRotationSpeed * 1000.0;
        float s = sin(angle);
        float c = cos(angle);
        vec3 rotatedPos = vec3(
          tiltedPos.x * c - tiltedPos.z * s,
          tiltedPos.y,
          tiltedPos.x * s + tiltedPos.z * c
        );
        vec3 rotatedNormal = vec3(
          tiltedNormal.x * c - tiltedNormal.z * s,
          tiltedNormal.y,
          tiltedNormal.x * s + tiltedNormal.z * c
        );

        // Bobbing synced with diamond
        float bob = sin(phase * 2.0) * 1.5;

        vec4 worldPos4 = instanceMatrix * vec4(rotatedPos, 1.0);
        worldPos4.y += bob;

        vWorldPos = worldPos4.xyz;
        vWorldNormal = normalize((instanceMatrix * vec4(rotatedNormal, 0.0)).xyz);
        vColor = aColor;
        vPhase = phase;

        vec4 mvPosition = modelViewMatrix * worldPos4;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vPhase;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Fresnel for ring glow
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        float fresnel = 1.0 - abs(dot(viewDir, vWorldNormal));
        fresnel = pow(fresnel, 1.5);

        // Pulse
        float pulse = sin(vPhase * 2.5) * 0.15 + 0.85;

        vec3 finalColor = mix(vColor, vec3(1.0), fresnel * 0.4) * pulse * 1.2;
        float alpha = mix(0.5, 0.9, fresnel) * pulse;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

// ============================================================
// GROUND GLOW SHADER
// ============================================================

export function createGroundGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhaseOffset;

      uniform float uTime;

      varying vec3 vColor;
      varying vec2 vUv;
      varying float vPhase;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = aColor;
        vUv = uv;
        vPhase = uTime + aPhaseOffset;

        vec4 worldPos4 = instanceMatrix * vec4(position, 1.0);
        vec4 mvPosition = modelViewMatrix * worldPos4;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vColor;
      varying vec2 vUv;
      varying float vPhase;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Radial distance from center
        vec2 centered = vUv * 2.0 - 1.0;
        float dist = length(centered);
        if (dist > 1.0) discard;

        // Concentric pulse rings expanding outward
        float ring1 = sin(dist * 12.0 - vPhase * 2.0) * 0.5 + 0.5;
        ring1 = smoothstep(0.3, 0.7, ring1);

        float ring2 = sin(dist * 8.0 - vPhase * 1.5 + 1.5) * 0.5 + 0.5;
        ring2 = smoothstep(0.4, 0.6, ring2);

        float rings = max(ring1 * 0.6, ring2 * 0.4);

        // Radial falloff
        float falloff = 1.0 - smoothstep(0.0, 1.0, dist);
        falloff = pow(falloff, 1.5);

        // Breathing pulse
        float pulse = sin(vPhase * 3.0) * 0.1 + 0.9;

        float alpha = falloff * (0.25 + rings * 0.2) * pulse;
        vec3 finalColor = vColor * (1.0 + rings * 0.5);

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

// ============================================================
// SPAWN PORTAL SHADERS
// ============================================================

/** Value noise and a three-octave fbm for the portal shaders. */
const PORTAL_NOISE_GLSL = /* glsl */ `
  float portalHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float portalNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = portalHash(i);
    float b = portalHash(i + vec2(1.0, 0.0));
    float c = portalHash(i + vec2(0.0, 1.0));
    float d = portalHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float portalFbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      v += amp * portalNoise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v / 0.875;
  }
`;

/** Opening of the portal at scale 1 (m), see PORTAL_SHADER_LAYOUT. */
export interface PortalShaderLayout {
  halfOpening: number;
  openingHeight: number;
  halfDepth: number;
  groundHalfWidth: number;
  groundBack: number;
  groundFront: number;
}

/** Colours of the portal look, see SPAWN_PORTAL_LOOK.palette. */
export interface PortalPalette {
  void: EffectRgb;
  ember: EffectRgb;
  hot: EffectRgb;
  violet: EffectRgb;
}

/** The palette as shader uniforms, written as they are (no colour space conversion). */
function portalPaletteUniforms(palette: PortalPalette) {
  const rgb = (c: EffectRgb) => ({ value: new Vector3(c.r, c.g, c.b) });
  return {
    uVoid: rgb(palette.void),
    uEmber: rgb(palette.ember),
    uHot: rgb(palette.hot),
    uViolet: rgb(palette.violet),
  };
}

const PORTAL_PALETTE_GLSL = /* glsl */ `
  uniform vec3 uVoid;   // near-black ground of the void
  uniform vec3 uEmber;  // dark red: swirl, seams, light on stone and street
  uniform vec3 uHot;    // dull orange: hottest points, embers
  uniform vec3 uViolet; // the swirl's troughs
`;

/**
 * Gate of the spawn portals: the stone frame (aPart 0) and the void in the
 * opening (aPart 1), opaque, in one draw call. Unlit like every marker
 * shader: the stone is procedural (spawn-portal-stone.ts: ashlars and
 * joints, worn and chipped edges, cracks, soot, relief) under faked light,
 * a fixed key light and the core's dim red light from the opening, and a
 * fixed set of sigils up the pillars and along the
 * lintel (spawn-portal-sigils.ts) glows in a dark red tinted with the
 * spawn's colour. The void, a surface in front of the portal's volume and
 * one behind it, is a slow, smouldering swirl around a black eye; it
 * writes depth, so whatever stands between the two (the enemies at their
 * start) stays hidden. aRipple is the wall time
 * (s) of the portal's last spawn burst: a ring runs out from the eye. The
 * Photorealistic Tiles around it take no scene light either way.
 */
export function createPortalGateMaterial(
  layout: PortalShaderLayout,
  palette: PortalPalette,
  exposure: number,
  energy: number,
  rippleLife: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: energy },
      uRippleLife: { value: rippleLife },
      uOpening: { value: new Vector2(layout.halfOpening, layout.openingHeight) },
      uHalfDepth: { value: layout.halfDepth },
      uExposure: { value: exposure },
      ...portalPaletteUniforms(palette),
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aRipple;
      attribute float aPart;
      attribute vec3 aFace;
      attribute vec2 aWidth;

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vLight;
      varying vec3 vFace;
      varying vec2 vWidth;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vLocalPos = position;
        vLocalNormal = normal;
        vFace = aFace;
        vWidth = aWidth;
        // The fixed key light in portal space, so the shading turns with the portal
        vec3 key = normalize(vec3(0.4, 0.8, 0.45));
        vLight = vec3(dot(key, normalize(instanceMatrix[0].xyz)), key.y, dot(key, normalize(instanceMatrix[2].xyz)));
        vColor = aColor;
        vPhase = aPhase;
        vRipple = aRipple;
        vPart = aPart;

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
      uniform float uHalfDepth; // half the volume's depth
      uniform float uExposure;  // gain on the lit stone
      ${PORTAL_PALETTE_GLSL}

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vLight;
      varying vec3 vFace;
      varying vec2 vWidth;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_NOISE_GLSL}

      ${PORTAL_STONE_GLSL}

      // Embers rising through the void: a speck in some cells of a grid
      // that drifts up, each flickering at its own pace. p in metres.
      float portalEmbers(vec2 p) {
        vec2 g = vec2(p.x / 1.4, p.y / 1.8 - uTime * 0.45);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float h = portalHash(cell + vPhase * 7.0);
        vec2 at = vec2(0.25 + 0.5 * h, 0.25 + 0.5 * fract(h * 17.0));
        float speck = 1.0 - smoothstep(0.06, 0.25, length((f - at) * vec2(1.4, 1.8)));
        float flicker = 0.5 + 0.5 * sin(uTime * (3.0 + 4.0 * h) + h * 40.0);
        return speck * step(0.82, fract(h * 31.0)) * flicker;
      }

      // The void in the opening: a slow swirl around an eye a little below
      // the middle, tighter toward the eye, on a near-black ground. Its arms
      // smoulder dark red, violet in the troughs and dull orange at the
      // hottest points; the eye swallows the light. A thin rim in the
      // spawn's colour, embers rising, and a ring running out from the eye
      // after a spawn burst.
      vec3 portalVoid() {
        float age = uTime - vRipple;
        float ripple = age >= 0.0 && age < uRippleLife ? 1.0 - age / uRippleLife : 0.0;
        float progress = 1.0 - ripple;

        vec2 m = vec2(vLocalPos.x, vLocalPos.y - uOpening.y * 0.45) / uOpening.x;
        float r = length(m);
        float a = atan(m.y, m.x);
        float t = uTime * (0.2 + 0.18 * uEnergy) + vPhase;
        float swirl = a + 2.4 / (r + 0.45) - t * 2.0;
        vec2 q = vec2(cos(swirl), sin(swirl)) * r;
        float n = portalFbm(q * 1.7 + vec2(0.0, t * 0.6));
        float bands = 0.5 + 0.5 * sin(swirl * 3.0 + n * 5.0 - r * 4.0);
        float smoulder = smoothstep(0.35, 0.9, n * (0.4 + 0.6 * bands));
        float eye = smoothstep(0.08, 0.6, r);

        vec3 col = uVoid;
        col += mix(uViolet, uEmber, smoothstep(0.3, 0.7, bands)) * smoulder * eye * (0.3 + 0.5 * uEnergy);
        col += uHot * smoulder * smoulder * smoulder * eye * 0.45 * uEnergy;

        // Metres to the nearest edge of the opening
        float edge = min(uOpening.x - abs(vLocalPos.x), min(vLocalPos.y, uOpening.y - vLocalPos.y));
        col += mix(uEmber, vColor, 0.5) * exp(-max(edge, 0.0) * 2.5) * (0.25 + 0.4 * uEnergy);
        col += uHot * portalEmbers(vLocalPos.xy) * (0.35 + 0.5 * uEnergy);

        // pow() of a negative base is undefined in GLSL: square by hand
        float front = (r - progress * 2.2) * 5.0;
        float wave = ripple * exp(-front * front);
        col += mix(uEmber, uHot, 0.5) * wave * 0.9;
        return col;
      }

      ${PORTAL_SIGIL_GLSL}

      void main() {
        #include <logdepthbuf_fragment>

        // Metres of the frame per pixel; derivatives before any branch, as
        // they need uniform control flow
        float footprint = length(fwidth(vLocalPos));

        if (vPart > 0.5) {
          gl_FragColor = vec4(portalVoid(), 1.0);
          return;
        }

        vec3 p = vLocalPos;
        vec3 ln = vLocalNormal;
        float flicker = 0.8 + 0.2 * portalNoise(vec2(uTime * 1.7 + vPhase, p.y * 0.4));

        // Hewn, worn, cracked and sooted stone (spawn-portal-stone.ts)
        vec3 col = portalStone(p, ln, vFace, vWidth, normalize(vLight), footprint,
          uOpening, uHalfDepth, uExposure, uEnergy, flicker, uEmber, uHot);

        // Sigils in a frieze round the opening (spawn-portal-sigils.ts), on
        // the front and the back, with a faint glow round the ink, lit in a
        // wave that climbs the frame
        float face = step(0.6, abs(ln.z));
        float fade;
        float ink = portalFrameSigils(p, uOpening, fade);
        float sigil = 1.0 - smoothstep(0.0, 0.04, ink);
        float halo = exp(-max(ink, 0.0) * 25.0) * fade;
        float climb = 0.55 + 0.45 * sin(uTime * 1.4 - p.y * 0.6 + vPhase);
        col += mix(uEmber, vColor, 0.4) * face * (sigil + 0.3 * halo) * climb * (0.5 + 0.7 * uEnergy);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: FrontSide,
  });
}

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

/** Where the surge of a wave start lies in the energy, see SPAWN_PORTAL_LOOK. */
export interface PortalSurge {
  waveEnergy: number;
  surge: number;
}

/** Sigil at the circle's centre (index into PORTAL_SIGILS). */
const CIRCLE_CENTRE_SIGIL = PORTAL_SIGILS.findIndex((s) => s.name === 'haloed moon');

/**
 * Light of the spawn portals on the street in front of them, a dim dark
 * red tinted with the spawn's colour, additive, in one draw call. aRipple
 * is the wall time (s) of the portal's last spawn burst: a ring runs out
 * from the portal's foot over the street. A summoning circle lies on the
 * street ahead of the front surface, drawn in the frame's sigils
 * (portalCircle): dim, turning very slowly, flaring with the surge of a
 * wave start.
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
        light += tint * (ink + 0.35 * halo) * level * sharp;
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

// ============================================================
// LABEL SHADER (persistent billboard text)
// ============================================================

export function createLabelMaterial(atlasTexture: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAtlas: { value: atlasTexture },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aAtlasRect;
      attribute vec2 aBaseScale;
      attribute float aPhaseOffset;
      attribute float aAlpha;

      uniform float uTime;

      varying vec2 vUv;
      varying float vAlpha;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float phase = uTime + aPhaseOffset;

        // Hide if alpha is 0
        if (aAlpha < 0.01) {
          gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          vAlpha = 0.0;
          vUv = vec2(0.0);
          return;
        }

        vAlpha = aAlpha;

        // Instance center in local space (overlay-group space)
        vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

        // Bobbing synced with diamond
        center.y += sin(phase * 2.0) * 1.5;

        // Extract camera right/up in local space from modelViewMatrix
        // Row 0 of mvM = direction that maps to view +X (screen right)
        // Row 1 of mvM = direction that maps to view +Y (screen up)
        vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
        vec3 camUp = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);

        // Subtle scale pulse
        float scalePulse = 1.0 + sin(phase * 3.0) * 0.03;
        vec2 scaledSize = aBaseScale * scalePulse;

        // Billboard quad in local space
        vec3 vertexPos = center.xyz
          + camRight * position.x * scaledSize.x
          + camUp * position.y * scaledSize.y;

        // Standard transform pipeline
        vec4 mvPosition = modelViewMatrix * vec4(vertexPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Atlas UV
        vec2 localUv = position.xy + 0.5;
        localUv.y = 1.0 - localUv.y;
        vUv = aAtlasRect.xy + localUv * aAtlasRect.zw;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uAtlas;

      varying vec2 vUv;
      varying float vAlpha;

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vAlpha < 0.01) discard;

        #include <logdepthbuf_fragment>

        vec4 texColor = texture2D(uAtlas, vUv);
        if (texColor.a < 0.01) discard;

        gl_FragColor = vec4(texColor.rgb, texColor.a * vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}
