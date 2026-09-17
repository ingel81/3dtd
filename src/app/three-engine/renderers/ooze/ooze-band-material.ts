import { DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { OOZE_LOOK } from '../../../configs/visual-effects.config';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';
import { createPortalClipUniforms, PORTAL_CLIP_GLSL, type PortalClipUniforms } from '../portal-clip';

/**
 * Material of an ooze's body (OozeBandRenderer), on the band geometry of
 * ooze-band-geometry.ts. One per ooze, clones of one base material, so they
 * share the program and differ in their uniforms:
 *
 * - uTail, uTip: the body's stretch, metres along the route. Vertices
 *   outside collapse onto the centre line, fragments outside are dropped,
 *   so the band ends exactly at the tip.
 * - uWidth, uHeight: share of the covered width and crest height (m), both
 *   less with less HP; tip and tail round off over uCap metres, the tip in
 *   a fatter lobe.
 * - uTime: game seconds, for the wobble, the swirl and the bubbles.
 * - uTint, uTintAmount, uBurn: slow or poison tint, burn glow.
 * - uDissolve: 0 alive, 1 sunk away.
 * - uCollapse: 0 sinks evenly (a leak, a removal), 1 collapses (a kill):
 *   boils and swells first, then slumps into a spreading puddle and tears
 *   open, see OOZE_LOOK.collapse.
 * - uBloodMoonGlow, uBloodMoonTint: the blood moon look, see
 *   OozeBandRenderer.setBloodMoon; 0 and 1 outside it.
 * - PortalClipUniforms (portal-clip.ts): the body behind a spawn portal's
 *   plane is dropped, a glowing seam runs where it comes through. The
 *   renderer puts the one object all enemies share in place of `portalClip`
 *   (clone() copies uniforms).
 *
 * Toxic green and translucent, deeper where it is thick, a slow swirl of
 * lighter slime, bubbles rising and popping, bone remnants blurred inside,
 * lit by a wrapped key light with a sharp gloss and a bright rim at the
 * edges. Works in linear light and encodes its output for its target like
 * the portal gate (tonemapping and colorspace chunks): straight to the sRGB
 * canvas without post-processing, linear into the post-processing target.
 * Logarithmic depth like every material over the tiles.
 */
export function createOozeBandMaterial(portalClip: PortalClipUniforms = createPortalClipUniforms()): ShaderMaterial {
  const vec = (c: readonly [number, number, number]) => new Vector3(c[0], c[1], c[2]);
  const glow = BLOOD_MOON_LOOK.glow;
  return new ShaderMaterial({
    uniforms: {
      uTail: { value: 0 },
      uTip: { value: 0 },
      uTime: { value: 0 },
      uWidth: { value: 1 },
      uHeight: { value: OOZE_LOOK.height },
      uCap: { value: OOZE_LOOK.capLength },
      uDissolve: { value: 0 },
      uCollapse: { value: 0 },
      uTint: { value: new Vector3() },
      uTintAmount: { value: 0 },
      uBurn: { value: 0 },
      uDeep: { value: vec(OOZE_LOOK.deep) },
      uBright: { value: vec(OOZE_LOOK.bright) },
      uBone: { value: vec(OOZE_LOOK.bone) },
      uGlow: { value: vec(OOZE_LOOK.glow) },
      uBurnGlow: { value: vec(OOZE_LOOK.burnGlow) },
      // Blood moon: OozeBandRenderer puts one shared object for all bands in
      // place of glow and tint (clone() copies uniforms)
      uBloodMoonGlow: { value: 0 },
      uBloodMoonTint: { value: new Vector3(1, 1, 1) },
      uBloodMoonGlowColor: { value: new Vector3(glow.color.r, glow.color.g, glow.color.b) },
      uBloodMoonRim: { value: glow.rim },
      uBloodMoonBase: { value: glow.base },
      ...portalClip,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSide;
      attribute float aS;

      uniform float uTail;
      uniform float uTip;
      uniform float uTime;
      uniform float uWidth;
      uniform float uHeight;
      uniform float uCap;
      uniform float uDissolve;
      uniform float uCollapse;

      varying float vS;
      varying float vA;
      varying float vDome;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float a = aSide.z;
        vS = aS;
        vA = a;

        // Round ends: 0 at the tip and the tail, 1 from uCap inward
        float end = min(uTip - aS, aS - uTail);
        float cap = clamp(end / uCap, 0.0, 1.0);
        float capShape = sqrt(1.0 - (1.0 - cap) * (1.0 - cap));
        // The leading lobe is fatter than the rest
        float lobe = 1.0 + 0.25 * exp(-max(uTip - aS, 0.0) / 6.0);

        // Going away: a removed body sinks and narrows evenly; a killed one
        // (uCollapse) swells and boils first, then slumps flat and spreads
        float d = uDissolve;
        float slump = smoothstep(0.15, 0.85, d);
        float swell = uCollapse * smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.1, 0.35, d));
        float boil = uCollapse * (1.0 - smoothstep(0.2, 0.6, d));
        float sink = mix(1.0 - d, (1.0 - 0.94 * slump) * (1.0 + 0.4 * swell), uCollapse);
        float spread = mix(1.0 - 0.5 * d, 1.0 + 0.3 * slump, uCollapse);

        // Across: the covered half width, less with less HP, swelling slowly
        float wobble = 0.06 * sin(aS * 0.8 - uTime * 1.7) + 0.04 * sin(aS * 2.1 + uTime * 2.6 + a * 2.0);
        wobble += 0.08 * boil * sin(aS * 3.3 - uTime * 11.0 + a * 5.0);
        float width = uWidth * capShape * spread * (1.0 + wobble);
        vec3 p = position + vec3(aSide.x, 0.0, aSide.y) * a * width;

        // Up: a flat-topped dome across, heaving along the body, churning while it boils
        float dome = pow(max(1.0 - a * a, 0.0), 0.55);
        float heave = 1.0 + 0.18 * sin(aS * 1.3 - uTime * 2.1)
          + 0.35 * boil * sin(aS * 2.7 + uTime * 9.0) * sin(a * 3.0 + aS * 0.9);
        float crest = uHeight * capShape * lobe * sink * heave;
        p.y += crest * dome + 0.04;
        vDome = dome * capShape * min(sink, 1.0);

        // Normal of the cross section: slope of the dome over the metres across
        float ac = clamp(a, -0.97, 0.97);
        float slope = -1.1 * ac * pow(1.0 - ac * ac, -0.45);
        float halfWidth = max(length(aSide.xy) * width, 0.05);
        vec3 right = normalize(vec3(aSide.x, 0.0, aSide.y) + vec3(1e-6, 0.0, 0.0));
        vNormal = normalize(vec3(0.0, 1.0, 0.0) - right * (crest * slope / halfWidth));

        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTail;
      uniform float uTip;
      uniform float uTime;
      uniform float uDissolve;
      uniform float uCollapse;
      uniform vec3 uTint;
      uniform float uTintAmount;
      uniform float uBurn;
      uniform vec3 uDeep;
      uniform vec3 uBright;
      uniform vec3 uBone;
      uniform vec3 uGlow;
      uniform vec3 uBurnGlow;
      uniform float uBloodMoonGlow;
      uniform vec3 uBloodMoonTint;
      uniform vec3 uBloodMoonGlowColor;
      uniform float uBloodMoonRim;
      uniform float uBloodMoonBase;

      varying float vS;
      varying float vA;
      varying float vDome;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_CLIP_GLSL}

      float oozeHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float oozeNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = oozeHash(i);
        float b = oozeHash(i + vec2(1.0, 0.0));
        float c = oozeHash(i + vec2(0.0, 1.0));
        float d = oozeHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float oozeFbm(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 3; i++) {
          v += amp * oozeNoise(p);
          p = p * 2.03 + vec2(1.7, 9.2);
          amp *= 0.5;
        }
        return v;
      }

      // Bone remnants: a few capsules per cell of 5 m by 3 m, placed and
      // turned by the cell's hash. q in metres behind the tip and across.
      float oozeBones(vec2 q) {
        vec2 cellSize = vec2(5.0, 3.0);
        vec2 cell = floor(q / cellSize);
        float h = oozeHash(cell + 3.1);
        if (h < 0.55) return 0.0;
        vec2 f = q - cell * cellSize;
        vec2 centre = cellSize * vec2(0.25 + 0.5 * fract(h * 13.0), 0.3 + 0.4 * fract(h * 7.0));
        float angle = h * 40.0;
        vec2 dir = vec2(cos(angle), sin(angle));
        float halfLength = 0.4 + 0.5 * fract(h * 29.0);
        vec2 d = f - centre;
        float t = clamp(dot(d, dir), -halfLength, halfLength);
        float dist = length(d - dir * t);
        // Knobs at both ends
        float knob = min(length(d - dir * halfLength), length(d + dir * halfLength)) - 0.07;
        return 1.0 - smoothstep(0.06, 0.16, min(dist, knob));
      }

      // Bubbles rising and popping: a ring per lucky cell (hash above rare),
      // growing until it pops
      float oozeBubbles(vec2 q, float time, float rare) {
        vec2 cellSize = vec2(1.4, 1.1);
        vec2 cell = floor(q / cellSize);
        float h = oozeHash(cell);
        if (h < rare) return 0.0;
        vec2 f = q - cell * cellSize;
        vec2 centre = cellSize * vec2(0.3 + 0.4 * fract(h * 17.0), 0.3 + 0.4 * fract(h * 31.0));
        float phase = fract(time * (0.18 + 0.25 * h) + h * 7.0);
        float r = 0.08 + 0.32 * phase;
        float d = length(f - centre);
        float ring = smoothstep(r - 0.07, r, d) * (1.0 - smoothstep(r, r + 0.035, d));
        float glint = 1.0 - smoothstep(0.0, 0.06, length(f - centre - vec2(0.3, 0.3) * r));
        return (ring + glint * 0.8) * (1.0 - phase * phase);
      }

      void main() {
        #include <logdepthbuf_fragment>
        // Metres per pixel, before any branch: derivatives need uniform control flow
        float footprint = length(fwidth(vWorldPos));
        if (vS > uTip + 0.02 || vS < uTail - 0.02) discard;
        // Still behind a spawn portal's plane: not out yet
        float portalAhead = portalClipAhead(vWorldPos);
        if (portalAhead < 0.0) discard;

        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vNormal);
        float facing = abs(dot(N, V));

        // Patterns ride with the tip: the slime flows forward as it crawls
        vec2 q = vec2(uTip - vS, vA * 3.0);

        // A killed body tears open as it slumps: holes grow out of the noise
        // until nothing is left, their edges glowing. Only while collapsing.
        float tornEdge = 0.0;
        if (uCollapse > 0.5) {
          float tear = oozeFbm(q * vec2(0.45, 0.8) + vec2(7.3, 1.9));
          float torn = smoothstep(0.3, 1.0, uDissolve) * 1.1 - 0.05;
          if (tear < torn) discard;
          tornEdge = step(0.0, torn) * (1.0 - smoothstep(0.0, 0.06, tear - torn));
        }
        // It boils as it breaks up: more bubbles, faster, brighter
        float boil = uCollapse * (1.0 - smoothstep(0.2, 0.6, uDissolve));

        float swirl = oozeFbm(q * vec2(0.3, 0.5) + vec2(uTime * 0.12, -uTime * 0.07));
        vec3 col = mix(uDeep, uBright, 0.3 + 0.55 * swirl);
        col = mix(col, uDeep, vDome * 0.45);

        float bone = oozeBones(q + vec2(uTime * 0.05, 0.0)) * (0.35 + 0.5 * vDome);
        col = mix(col, uBone * (0.55 + 0.45 * swirl), bone * 0.75);

        float bubble = oozeBubbles(q, uTime * (1.0 + 2.5 * boil), 0.45 - 0.3 * boil) * (1.0 + 1.5 * boil);

        // Wrapped key light from the sun's direction (the tiles take no scene light)
        const vec3 L = vec3(-0.42765, 0.86505, -0.26242);
        float diffuse = 0.4 + 0.6 * max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float nh = max(dot(N, H), 0.0);
        float gloss = pow(nh, 90.0) * 1.6 + pow(nh, 16.0) * 0.15;
        float rim = pow(1.0 - facing, 3.0);

        col = col * diffuse + uGlow * (bubble * 0.5 + rim * 0.35 + tornEdge * 0.6) + vec3(gloss);
        col = mix(col, uTint, uTintAmount);
        col += uBurnGlow * uBurn * (0.35 + 0.25 * sin(uTime * 13.0 + vS * 1.7));
        // Blood moon: a red glow at the edges like the other enemies, then
        // the mood's tint, which the transparent band draws after (linear,
        // 1 outside a blood moon)
        col += uBloodMoonGlowColor * (uBloodMoonRim * rim + uBloodMoonBase) * uBloodMoonGlow;
        col *= uBloodMoonTint;
        // The seam where the body comes through a spawn portal's plane, its
        // display colour as linear light
        float seam = portalSeam(portalAhead, footprint);
        col = mix(col, sRGBTransferEOTF(vec4(PORTAL_SEAM_COLOR, 1.0)).rgb, seam);

        float alpha = clamp(0.6 + 0.25 * vDome + 0.3 * rim + 0.3 * bone + 0.2 * gloss, 0.0, 0.96);
        // A collapsing body keeps its colour until the last of it tears away
        float fade = mix(1.0 - uDissolve, 1.0 - smoothstep(0.7, 1.0, uDissolve), uCollapse);
        gl_FragColor = vec4(col, max(alpha, seam) * fade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    // Translucent over the street and the enemies wading through it
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
  });
}
