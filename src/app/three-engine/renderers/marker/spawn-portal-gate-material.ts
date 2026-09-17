import { ShaderMaterial, FrontSide, Color, SRGBColorSpace, Vector2, Vector3, Vector4, Texture } from 'three';
import type { EffectRgb } from '../../../configs/visual-effects.config';
import { PORTAL_GLYPH_CELL_GLSL, PORTAL_SIGIL_GLSL } from './spawn-portal-sigils';
import type { SpawnPortalFrame } from './spawn-portal-frame';
import {
  PORTAL_NOISE_GLSL,
  PORTAL_PALETTE_GLSL,
  portalPaletteUniforms,
  type PortalPalette,
  type PortalShaderLayout,
  type PortalSurge,
} from './spawn-portal-shader-chunks';

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
 * Gate of the spawn portals: the stone arch (aPart 0) and the void (aPart
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
 * of the glints. The void, the surface in the portal's plane, seen from
 * both sides, is a slow, smouldering swirl around a black eye, drawn in
 * display values; it writes depth, so it hides what stands beyond it in the
 * opening. The enemies still behind the plane drop out in their own
 * shaders (portal-clip.ts). aRipple is the wall time (s) of the
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
      uCoreBack: { value: layout.coreBack },
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
      uniform float uHalfDepth; // the plane's distance from the route start
      uniform float uCoreBack;  // how far behind the plane the core's light runs
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
      // light from the opening. p in portal space, footprint in metres per
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
        // The core's light from the nearest point of the opening's axis
        // through the arch, strongest on the faces round the opening, on the
        // front and the back alike; the lighter worn edges catch more of it
        // than the soot
        vec3 toCore = vec3(0.0, uOpening.y * 0.45, clamp(p.z, uHalfDepth - uCoreBack, uHalfDepth)) - p;
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
