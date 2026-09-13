import {
  ShaderMaterial,
  DoubleSide,
  FrontSide,
  Color,
  SRGBColorSpace,
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
import { PORTAL_GLYPH_CELL_GLSL, PORTAL_SIGILS, PORTAL_SIGIL_GLSL } from './spawn-portal-sigils';
import type { SpawnPortalFrame } from './spawn-portal-frame';

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

/** The palette's glow colours as linear light, for the gate's stone and sigils. */
function portalLightUniforms(palette: PortalPalette) {
  const linear = (c: EffectRgb) => {
    const color = new Color().setRGB(c.r, c.g, c.b, SRGBColorSpace);
    return { value: new Vector3(color.r, color.g, color.b) };
  };
  return { uEmberLinear: linear(palette.ember), uHotLinear: linear(palette.hot) };
}

/** The carved sigils' glow and life, see SPAWN_PORTAL_LOOK.glyphs. */
export interface PortalGlyphLook {
  dormant: number;
  active: number;
  flare: number;
  gain: number;
  breath: readonly [number, number];
  breathDepth: number;
  wakePeriod: number;
  wakeChance: readonly [number, number];
  rise: number;
  hold: number;
  fade: number;
  wakeGain: number;
  crawl: number;
  shimmer: number;
}

/** Where the portal's energy runs, see SPAWN_PORTAL_LOOK. */
export interface PortalEnergyLevels extends PortalSurge {
  idleEnergy: number;
}

/** What drives the sigils at one portal energy, see portalGlyphDrive. */
export interface PortalGlyphDrive {
  /** Glow level: `dormant` between waves, `active` in one, up to `flare` more at a surge's peak */
  level: number;
  /** Chance a sigil wakes in its slot */
  wakeChance: number;
  /** How far the surge of a wave start lifts the energy above the wave's (0 to 1) */
  surge: number;
}

/**
 * What drives the carved sigils at the portal energy `energy`: from idle
 * to wave energy the glow runs from `dormant` to `active` and the chance to
 * wake from the first to the second wakeChance; the surge of a wave start
 * above the wave energy adds up to `flare` and stirs every sigil.
 */
export function portalGlyphDrive(energy: number, levels: PortalEnergyLevels, glyphs: PortalGlyphLook): PortalGlyphDrive {
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const wave = clamp01((energy - levels.idleEnergy) / (levels.waveEnergy - levels.idleEnergy));
  const surge = clamp01((energy - levels.waveEnergy) / levels.surge);
  return {
    level: glyphs.dormant + (glyphs.active - glyphs.dormant) * wave + glyphs.flare * surge,
    wakeChance: glyphs.wakeChance[0] + (glyphs.wakeChance[1] - glyphs.wakeChance[0]) * wave,
    surge,
  };
}

/** Hand the frame's baked textures to a gate material (createPortalGateMaterial). */
export function setPortalGateTextures(
  material: ShaderMaterial,
  textures: Pick<SpawnPortalFrame, 'baseColor' | 'normal' | 'orm' | 'emissive'>,
): void {
  material.uniforms['uBaseMap'].value = textures.baseColor;
  material.uniforms['uNormalMap'].value = textures.normal;
  material.uniforms['uOrmMap'].value = textures.orm;
  material.uniforms['uEmissiveMap'].value = textures.emissive;
}

/**
 * Gate of the spawn portals: the stone frame (aPart 0) and the void (aPart
 * 1), opaque, in one draw call. Unlike the other marker shaders it works
 * in linear light and encodes its output for the canvas
 * (colorspace_fragment): it reads an sRGB base colour texture, which the
 * GPU decodes, and without the encoding the stone came out several times
 * too dark whenever the frame went straight to the canvas (bloom and colour
 * grading off). The stone comes from the frame's baked textures
 * (spawn-portal-frame.ts, setPortalGateTextures) under faked light: a
 * wrapped key light fixed in the world with glints on the glossy parts,
 * the sky and the core's dim red light from the opening; the scene's
 * lights do not reach it. The carved sigils glow from inside their
 * grooves, drawn from their distance fields (portalGlyphInk) so they stay
 * sharp near and read far, where a stroke is thinner than a pixel. Each
 * breathes at its own slow, uneven pace on the sigils' clock (uGlyphTime:
 * wall time that stands while the game is paused, never hurried by the
 * timescale), a low ember between waves, stronger in one
 * (uGlyphDrive, portalGlyphDrive); now and then one wakes in an uneven
 * glimmer crawling along its strokes, tinted with the spawn's colour.
 * `exposure` is the gain on the stone's base colour, `glints` the strength
 * of the glints. The void, a surface in front of the portal's volume and
 * one behind it, is a slow, smouldering swirl around a black eye, drawn in
 * display values; it writes depth, so whatever stands between the two (the
 * enemies at their start) stays hidden. aRipple is the wall time (s) of the
 * portal's last spawn burst: a ring runs out from the eye. The
 * Photorealistic Tiles around it take no scene light either way.
 */
export function createPortalGateMaterial(
  layout: PortalShaderLayout,
  palette: PortalPalette,
  exposure: number,
  glints: number,
  glyphs: PortalGlyphLook,
  idleEnergy: number,
  rippleLife: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlyphTime: { value: 0 },
      uEnergy: { value: idleEnergy },
      uRippleLife: { value: rippleLife },
      uOpening: { value: new Vector2(layout.halfOpening, layout.openingHeight) },
      uHalfDepth: { value: layout.halfDepth },
      uExposure: { value: exposure },
      uGlints: { value: glints },
      // Between waves until the first update
      uGlyphDrive: { value: new Vector3(glyphs.dormant, glyphs.wakeChance[0], 0) },
      uGlyphWake: { value: new Vector4(glyphs.wakePeriod, glyphs.rise, glyphs.hold, glyphs.fade) },
      uGlyphBreath: { value: new Vector4(glyphs.breath[0], glyphs.breath[1], glyphs.breathDepth, glyphs.gain) },
      uGlyphFlow: { value: new Vector3(glyphs.crawl, glyphs.shimmer, glyphs.wakeGain) },
      uBaseMap: { value: null as Texture | null },
      uNormalMap: { value: null as Texture | null },
      uOrmMap: { value: null as Texture | null },
      uEmissiveMap: { value: null as Texture | null },
      ...portalPaletteUniforms(palette),
      ...portalLightUniforms(palette),
    },
    vertexShader: /* glsl */ `
      attribute vec4 tangent;
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aRipple;
      attribute float aPart;

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec4 vLocalTangent;
      varying vec2 vUv;
      varying vec3 vLight;
      varying vec3 vView;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vLocalPos = position;
        vLocalNormal = normal;
        vLocalTangent = tangent;
        vUv = uv;
        // The fixed key light in portal space, so the shading turns with the portal
        vec3 key = normalize(vec3(0.4, 0.8, 0.45));
        vLight = vec3(dot(key, normalize(instanceMatrix[0].xyz)), key.y, dot(key, normalize(instanceMatrix[2].xyz)));
        // The way to the camera in portal space, for the glints
        mat4 toWorld = modelMatrix * instanceMatrix;
        vec4 world = toWorld * vec4(position, 1.0);
        vView = inverse(mat3(toWorld)) * (cameraPosition - world.xyz);
        vColor = aColor;
        vPhase = aPhase;
        vRipple = aRipple;
        vPart = aPart;

        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;      // wall time (s): the void, the core's flicker
      uniform float uGlyphTime; // the sigils' clock (s): wall time, standing while the game is paused
      uniform float uEnergy;
      uniform float uRippleLife;
      uniform vec2 uOpening; // half width, height
      uniform float uHalfDepth; // half the volume's depth
      uniform float uExposure;  // gain on the stone's base colour
      uniform float uGlints;    // strength of the key light's glints
      uniform vec3 uGlyphDrive;  // glow level, chance to wake, surge (portalGlyphDrive)
      uniform vec4 uGlyphWake;   // wake period, rise, hold, fade (s)
      uniform vec4 uGlyphBreath; // shortest and longest breath (s), how far it dims, gain of the glow
      uniform vec3 uGlyphFlow;   // crawl, shimmer, gain of a waking
      uniform sampler2D uBaseMap;
      uniform sampler2D uNormalMap;
      uniform sampler2D uOrmMap;      // occlusion, roughness, metal
      uniform sampler2D uEmissiveMap; // sigils left to glow, stroke order, cracks
      uniform vec3 uEmberLinear; // the palette's ember and hot as linear light
      uniform vec3 uHotLinear;
      ${PORTAL_PALETTE_GLSL}

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec4 vLocalTangent;
      varying vec2 vUv;
      varying vec3 vLight;
      varying vec3 vView;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_NOISE_GLSL}

      // The frame's stone from its baked textures under the faked light, in
      // linear light: a wrapped key light and the sky on the normal map, so
      // a face turned from the key keeps its relief, the baked occlusion,
      // glints on the glossy obsidian and the iron, the core's dark red
      // light from the volume. p in portal space, footprint in metres per
      // pixel.
      vec3 portalStone(vec3 p, float footprint, float flicker) {
        vec3 N = normalize(vLocalNormal);
        vec3 t = vLocalTangent.xyz - N * dot(N, vLocalTangent.xyz);
        vec3 mapped = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
        // A degenerate tangent would turn the normal into NaN: keep the face's normal there
        vec3 n = N;
        if (dot(t, t) > 1e-8) {
          vec3 T = normalize(t);
          n = normalize(mat3(T, cross(N, T) * vLocalTangent.w, N) * mapped);
        }
        vec3 base = texture2D(uBaseMap, vUv).rgb;
        vec3 orm = texture2D(uOrmMap, vUv).rgb;
        vec3 L = normalize(vLight);
        float lit = dot(n, L);
        float key = max(lit, 0.0);
        float wrapped = clamp(lit * 0.6 + 0.4, 0.0, 1.0);
        float sky = 0.6 + 0.4 * n.y;
        vec3 col = base * uExposure * orm.r * (0.5 * sky + 0.7 * wrapped * wrapped);
        // Glints, faded where a pixel covers the normal map's detail, which
        // would sparkle
        float gloss = 1.0 - orm.g;
        float spec = pow(max(dot(n, normalize(L + normalize(vView))), 0.0), 4.0 + 120.0 * gloss * gloss) * gloss * gloss;
        vec3 tint = mix(vec3(0.05), base * 8.0 + 0.02, orm.b);
        col += tint * spec * key * orm.r * uGlints * (1.0 - smoothstep(0.03, 0.12, footprint));
        // The core's light from the nearest point of the volume's axis,
        // strongest on the faces round the opening; the lighter worn edges
        // catch more of it than the soot
        vec3 toCore = vec3(0.0, uOpening.y * 0.45, clamp(p.z, -uHalfDepth, uHalfDepth)) - p;
        float dCore = length(toCore) + 1e-3;
        float wrap = clamp(dot(n, toCore / dCore) * 0.6 + 0.4, 0.0, 1.0);
        float catchLight = 0.35 + 8.0 * dot(base, vec3(0.3333));
        col += uEmberLinear * wrap * wrap * exp(-dCore * 0.2) * orm.r * catchLight * (0.45 + 0.9 * uEnergy) * flicker;
        return col;
      }

      ${PORTAL_SIGIL_GLSL}

      ${PORTAL_GLYPH_CELL_GLSL}

      const float TAU = 6.2831853;

      // The life of the sigil in frame cell 'cell' at uGlyphTime: 'breath'
      // its slow, uneven breathing (0 to 1), two waves at the cell's own
      // rates and phases (GLYPH_BREATH) shifted by the portal's phase;
      // 'wake' the envelope of a waking (0 dormant, 1 awake). The same game
      // time gives the same state, nothing is kept on the CPU.
      void portalGlyphState(float cell, out float breath, out float wake) {
        vec4 b = GLYPH_BREATH[int(cell)];
        float first = TAU / mix(uGlyphBreath.y, uGlyphBreath.x, b.x);
        // The second wave is slower and deepens or flattens the first
        float second = 0.37 * TAU / mix(uGlyphBreath.y, uGlyphBreath.x, b.y);
        breath = (0.5 + 0.5 * sin(uGlyphTime * first + b.z + vPhase))
          * (0.6 + 0.4 * sin(uGlyphTime * second + b.w + 2.3 * vPhase));
        // Slots of about the wake period, a waking at most in each, with the
        // chance the portal's energy gives
        float h1 = portalHash(vec2(cell * 1.37 + 0.5, vPhase * 3.1 + 2.0));
        float h2 = portalHash(vec2(cell * 2.11 + 7.0, vPhase * 1.7 + 5.0));
        float period = uGlyphWake.x * (0.8 + 0.4 * h1);
        float slotTime = uGlyphTime / period + h2;
        float roll = portalHash(vec2(floor(slotTime) * 0.731 + cell * 3.3, h1 * 17.0 + vPhase));
        // Seconds since the waking began, some way into the slot
        float since = fract(slotTime) * period - (0.6 + 2.4 * fract(roll * 9.7));
        float sinking = uGlyphWake.y + uGlyphWake.z;
        wake = step(roll, uGlyphDrive.y) * smoothstep(0.0, uGlyphWake.y, since)
          * (1.0 - smoothstep(sinking, sinking + uGlyphWake.w, since));
      }

      // Embers rising off a waking sigil over the stone above it: a speck
      // in some cells of a grid drifting up, fading with height. q in metres
      // from the sigil's centre.
      float portalGlyphEmbers(vec2 q, float cell) {
        vec2 g = vec2(q.x / 0.35, q.y / 0.45 - uGlyphTime * 1.1);
        vec2 id = floor(g);
        float h = portalHash(id + cell * 5.3 + vPhase);
        vec2 at = vec2(0.3 + 0.4 * h, 0.3 + 0.4 * fract(h * 13.0));
        float speck = 1.0 - smoothstep(0.05, 0.14, length((fract(g) - at) * vec2(1.0, 1.3)));
        float column = 1.0 - smoothstep(0.35, 0.6, abs(q.x));
        float rise = smoothstep(0.2, 0.6, q.y) * (1.0 - smoothstep(0.9, 1.8, q.y));
        return speck * step(0.72, fract(h * 29.0)) * column * rise;
      }

      // The glow of the sigil in frame cell 'cell' (centre the square's
      // centre) at p, from inside its carved grooves: a hot core along each
      // stroke, a darker blood red at its edges, a faint halo on the cut
      // stone round it. Drawn from the sigil's distance field, so it stays
      // sharp up close; far away, where a stroke is thinner than a pixel,
      // the line keeps about a pixel and a half, so the sigil still reads.
      // e the emissive data, footprint metres per pixel.
      vec3 portalGlyph(vec3 p, float cell, vec2 centre, vec3 e, float footprint) {
        float breath;
        float wake;
        portalGlyphState(cell, breath, wake);
        // Heat shimmer over a waking sigil: its lines waver
        vec2 wobble = wake * uGlyphFlow.y
          * vec2(sin(uGlyphTime * 7.0 + p.y * 9.0 + cell), cos(uGlyphTime * 5.3 + p.x * 11.0 + cell));
        float stroke;
        float ink = portalGlyphInk(p.xy, cell, centre, wobble, stroke);
        float grow = max(0.75 * footprint - stroke, 0.0);
        float d = ink - grow;
        float line = 1.0 - smoothstep(-0.5 * footprint, 0.5 * footprint, d);
        float halo = exp(-max(d, 0.0) / (0.6 * stroke + 0.5 * footprint));
        float heat = clamp(-d / (stroke + grow), 0.0, 1.0);
        heat = heat * heat * (3.0 - 2.0 * heat);
        // Uneven along the strokes: stretches glowing hotter or dimmer,
        // drifting slowly along the order the strokes run in
        float uneven = 0.3 + 0.7 * smoothstep(0.15, 0.85, portalNoise(vec2(e.g * 7.0 + cell * 3.1, uGlyphTime * 0.12 + cell * 1.7)));
        // Waking, or the surge of a wave start: an uneven glimmer crawling
        // along the strokes, bits of the lines catching and dying again,
        // never a front running round. The order is stored in 8 bits: read
        // at a low rate and through a soft curve, its steps draw no bands
        float crawl = portalNoise(vec2(e.g * 6.0 - uGlyphTime * uGlyphFlow.x, cell * 7.3 + vPhase * 5.0));
        float sparks = smoothstep(0.35, 0.95, crawl) * (0.6 + 0.4 * portalNoise(vec2(uGlyphTime * 11.0 + cell, e.g * 4.0)));
        float stir = max(wake, uGlyphDrive.z);
        float level = uGlyphDrive.x * (1.0 - uGlyphBreath.z * (1.0 - breath)) * uneven * e.r
          * (1.0 + uGlyphFlow.z * stir * (0.3 + sparks));
        // Blood red while it smoulders, the core running to the palette's
        // hot as it burns up; the sparks of a waking take the spawn's colour
        vec3 core = mix(uEmberLinear * 3.0, uHotLinear, smoothstep(0.25, 0.9, level));
        core = mix(core, vColor * core.r, 0.35 * stir * sparks);
        vec3 glow = (mix(uEmberLinear, core, heat) * line + uEmberLinear * halo * 0.35) * level * uGlyphBreath.w;
        // Embers off a waking sigil, on the front and the back
        if (wake > 0.0) {
          glow += uHotLinear * portalGlyphEmbers(p.xy - centre, cell) * wake * step(0.6, abs(vLocalNormal.z)) * 1.5;
        }
        return glow;
      }

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

      // The frame: its stone, the glowing cracks round the opening and the
      // carved sigils, in linear light.
      vec3 portalFrame(float footprint) {
        vec3 p = vLocalPos;
        float flicker = 0.8 + 0.2 * portalNoise(vec2(uTime * 1.7 + vPhase, p.y * 0.4));
        vec3 col = portalStone(p, footprint, flicker);
        // Emissive data: R how much of a carved sigil is left to glow (less
        // where it is worn or sooted), G the order its strokes run in, B the
        // cracks round the opening and the slot along the ridge
        vec3 e = texture2D(uEmissiveMap, vUv).rgb;
        col += mix(uEmberLinear, uHotLinear, 0.35) * e.b * (0.4 + 0.9 * uEnergy) * flicker;
        // The carved sigils (spawn-portal-sigils.ts), keyed to the frame cell
        // they sit in; the rest of the stone skips their cost
        vec2 centre;
        float cell = portalGlyphCell(p, uOpening, centre);
        if (cell >= 0.0 && e.r > 0.004) col += portalGlyph(p, cell, centre, e, footprint);
        return col;
      }

      void main() {
        #include <logdepthbuf_fragment>

        // Metres of the frame per pixel; derivatives before any branch, as
        // they need uniform control flow. vPart is the same over a
        // triangle, so the texture reads below still see whole quads.
        float footprint = length(fwidth(vLocalPos));

        vec3 col;
        if (vPart > 0.5) {
          // The void is drawn in display values: decoded here and encoded
          // again below, it shows the same with and without post-processing
          col = sRGBTransferEOTF(vec4(portalVoid(), 1.0)).rgb;
        } else {
          col = portalFrame(footprint);
        }
        gl_FragColor = vec4(col, 1.0);
        // Linear light out: encoded for the canvas, left linear for the
        // post-processing target, whose output pass encodes it
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
 * wave start. The circle is encoded for its target like the gate, so over
 * a dark street it shows alike with and without post-processing; the
 * street light is still written as it is.
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
        // The circle is drawn in display values, like the gate's void:
        // decoded, then encoded for the target, it shows as it is on the
        // canvas and as linear light through the post-processing target
        light += linearToOutputTexel(sRGBTransferEOTF(vec4(circle, 1.0))).rgb;
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
