import {
  ShaderMaterial,
  DoubleSide,
  FrontSide,
  Vector3,
  Texture,
  AdditiveBlending,
} from 'three';
import { DISPLAY_OUTPUT_GLSL } from '../display-output';
import { HQ_CRYSTAL_HALF_HEIGHT } from './hq-marker-geometry';

// The HQ marker's colours are display values, written for the target
// (display-output.ts): crystal, rings and label as colours (displayOutput),
// the ground emblem and light pillar as additive light (displayLight). On
// the canvas as they were, through the post-processing target alike where
// opaque.

/** Bobbing of crystal, rings, pillar top and label, in step (GLSL, phase in s). */
const BOB_GLSL = /* glsl */ `sin(phase * 2.0) * 1.5`;

// ============================================================
// CRYSTAL SHADER (shell and energy core, hq-marker-geometry)
// ============================================================

export function createDiamondMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      // Per-vertex: barycentric corner for the edge lines, 0 shell / 1 core
      attribute vec3 aBary;
      attribute float aLayer;

      // Per-instance attributes
      attribute vec3 aColor;
      attribute float aGlowIntensity;
      attribute float aRotationSpeed;
      attribute float aPhaseOffset;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vBary;
      varying vec3 vWorldNormal;
      varying float vLayer;
      varying float vGlowIntensity;
      varying float vPhase;
      varying float vFresnel;
      varying float vHeightGrad;
      varying float vFacet;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float phase = uTime + aPhaseOffset;

        // The core turns the other way and faster, and breathes
        float isCore = step(0.5, aLayer);
        float spin = mix(1.0, -2.5, isCore);
        float breathe = 1.0 + isCore * sin(phase * 3.0) * 0.08;
        vec3 local = position * breathe;

        float angle = phase * aRotationSpeed * 1000.0 * spin;
        float s = sin(angle);
        float c = cos(angle);
        vec3 rotatedPos = vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);
        vec3 rotatedNormal = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);

        // 0 at the lower tip, 1 at the upper
        vHeightGrad = clamp((position.y + ${HQ_CRYSTAL_HALF_HEIGHT.toFixed(2)}) / ${(HQ_CRYSTAL_HALF_HEIGHT * 2).toFixed(2)}, 0.0, 1.0);

        vec4 worldPos4 = instanceMatrix * vec4(rotatedPos, 1.0);
        worldPos4.y += ${BOB_GLSL};

        vWorldNormal = normalize((instanceMatrix * vec4(rotatedNormal, 0.0)).xyz);
        vColor = aColor;
        vBary = aBary;
        vLayer = aLayer;
        vGlowIntensity = aGlowIntensity;
        vPhase = phase;

        // Facet light from a fixed key light, so the cut reads as it turns
        vFacet = clamp(dot(vWorldNormal, normalize(vec3(0.45, 0.75, 0.35))), 0.0, 1.0);

        // Pre-compute Fresnel; |dot| of two unit vectors can round past 1,
        // and pow() of a negative base is NaN (see the ring shader)
        vec3 viewDir = normalize(uCameraPos - worldPos4.xyz);
        vFresnel = clamp(1.0 - abs(dot(viewDir, vWorldNormal)), 0.0, 1.0);
        vFresnel = pow(vFresnel, 2.0);

        vec4 mvPosition = modelViewMatrix * worldPos4;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vColor;
      varying vec3 vBary;
      varying vec3 vWorldNormal;
      varying float vLayer;
      varying float vGlowIntensity;
      varying float vPhase;
      varying float vFresnel;
      varying float vHeightGrad;
      varying float vFacet;

      #include <logdepthbuf_pars_fragment>

      ${DISPLAY_OUTPUT_GLSL}

      void main() {
        #include <logdepthbuf_fragment>

        float pulse = sin(vPhase * 3.0) * 0.08 + 0.92;

        // Energy core: hot and opaque, whiter in its middle
        if (vLayer > 0.5) {
          float heat = 1.0 - abs(vHeightGrad - 0.5) * 2.0;
          vec3 core = mix(vColor * 2.4, vec3(1.0), 0.1 + heat * 0.4) * (0.9 + pulse * 0.3);
          gl_FragColor = displayOutput(vec4(core, 1.0));
          return;
        }

        // With MSAA an edge pixel is shaded outside its triangle, where the
        // varying is extrapolated below 0: clamped, or the glow turns into a
        // negative colour
        float fresnel = clamp(vFresnel, 0.0, 1.0);

        // Facets: dark glass, lit by the key light, lighter towards the top
        vec3 deep = vColor * 0.3;
        vec3 lit = mix(vColor * 1.25, vec3(1.0), 0.12);
        vec3 baseColor = mix(deep, lit, vFacet * 0.75 + vHeightGrad * 0.25);

        // Edges of the cut: a thin bright line and a softer glow beside it,
        // the same width on screen at every distance
        vec3 b = clamp(vBary, 0.0, 1.0);
        float d = min(min(b.x, b.y), b.z);
        float w = max(fwidth(d), 1e-4);
        float line = 1.0 - smoothstep(w * 0.6, w * 1.8, d);
        float halo = 1.0 - smoothstep(0.0, 0.12, d);
        vec3 edgeColor = mix(vColor * 1.8, vec3(1.0), 0.35);

        // A glint sweeps up the crystal every few seconds
        float sweepPos = fract(vPhase * 0.18) * 1.6 - 0.3;
        float sweep = exp(-pow((vHeightGrad - sweepPos) * 9.0, 2.0));

        vec3 rim = mix(vColor * 1.5, vec3(1.0), 0.5) * fresnel * vGlowIntensity * 0.6;
        vec3 finalColor = baseColor * pulse
          + edgeColor * (line * 0.9 + halo * 0.2)
          + rim
          + vec3(0.85, 1.0, 0.9) * sweep * 0.35;

        // Clear glass in the face, denser at the rim and the edges: the core
        // shows through
        float alpha = clamp(0.55 + fresnel * 0.35 + line * 0.5 + halo * 0.1 + sweep * 0.2, 0.0, 1.0);

        gl_FragColor = displayOutput(vec4(finalColor, alpha));
      }
    `,
    transparent: true,
    depthWrite: true,
    side: FrontSide,
  });
}

// ============================================================
// RING SHADER (thin segmented bands)
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
      attribute float aRadiusScale;
      attribute float aStyle;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vRingPos;
      varying float vPhase;
      varying float vStyle;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float phase = uTime + aPhaseOffset;

        // Radius scaled in the ring's plane, the tube keeps its thickness
        vec3 local = vec3(position.x * aRadiusScale, position.y, position.z * aRadiusScale);
        vRingPos = local.xz;

        // Apply tilt around Z-axis
        float tiltS = sin(aTiltAngle);
        float tiltC = cos(aTiltAngle);
        vec3 tiltedPos = vec3(
          local.x,
          local.y * tiltC - local.z * tiltS,
          local.y * tiltS + local.z * tiltC
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

        vec4 worldPos4 = instanceMatrix * vec4(rotatedPos, 1.0);
        worldPos4.y += ${BOB_GLSL};

        vWorldPos = worldPos4.xyz;
        vWorldNormal = normalize((instanceMatrix * vec4(rotatedNormal, 0.0)).xyz);
        vColor = aColor;
        vPhase = phase;
        vStyle = aStyle;

        vec4 mvPosition = modelViewMatrix * worldPos4;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vRingPos;
      varying float vPhase;
      varying float vStyle;

      #include <logdepthbuf_pars_fragment>

      ${DISPLAY_OUTPUT_GLSL}

      void main() {
        #include <logdepthbuf_fragment>

        // Around the ring 0..1, from the ring's own plane: atan per pixel,
        // an interpolated angle would jump at the seam
        float around = atan(vRingPos.y, vRingPos.x) / 6.28318530718 + 0.5;

        // Style 0: three long arcs; style 1: fine dashes
        float segments = vStyle < 0.5 ? 3.0 : 40.0;
        float duty = vStyle < 0.5 ? 0.86 : 0.5;
        float cell = fract(around * segments);
        if (cell > duty) discard;
        // Arcs fade out at their ends
        float ends = vStyle < 0.5 ? smoothstep(0.0, 0.05, cell) * smoothstep(duty, duty - 0.05, cell) : 1.0;

        // A spark runs round the ring
        float spark = fract(around - vPhase * (vStyle < 0.5 ? 0.12 : -0.07));
        spark = pow(1.0 - spark, 10.0);

        // Fresnel for ring glow. vWorldNormal is interpolated, not unit
        // length: inside a triangle it is 1 or shorter, but with MSAA a
        // pixel on the thin tube's edge is shaded at its centre outside the
        // triangle, where the normal is extrapolated past 1. Facing the
        // camera, 1 - |dot| then turns negative, and pow() of a negative
        // base is NaN, which the bloom spread into a black block whenever
        // the HQ was in view (playtest 2026-09-14). Inside a triangle the
        // clamp changes nothing.
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        float fresnel = clamp(1.0 - abs(dot(viewDir, vWorldNormal)), 0.0, 1.0);
        fresnel = pow(fresnel, 1.5);

        float pulse = sin(vPhase * 2.5) * 0.15 + 0.85;

        vec3 finalColor = mix(vColor * 1.3, vec3(1.0), fresnel * 0.3 + spark * 0.7) * pulse * 1.2;
        float alpha = clamp(mix(0.65, 0.95, fresnel) * pulse * ends + spark * 0.4, 0.0, 1.0);

        gl_FragColor = displayOutput(vec4(finalColor, alpha));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

// ============================================================
// GROUND EMBLEM AND LIGHT PILLAR SHADER (additive)
// ============================================================

export function createGroundGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      // 0 ground emblem, 1 light pillar
      attribute float aLayer;
      attribute vec3 aColor;
      attribute float aPhaseOffset;

      uniform float uTime;
      uniform vec3 uCameraPos;

      varying vec3 vColor;
      varying vec2 vUv;
      varying float vPhase;
      varying float vLayer;
      varying float vFacing;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = aColor;
        vUv = uv;
        vPhase = uTime + aPhaseOffset;
        vLayer = aLayer;

        vec4 worldPos4 = instanceMatrix * vec4(position, 1.0);
        // The pillar's top follows the crystal's bobbing
        float phase = vPhase;
        worldPos4.y += aLayer * uv.y * ${BOB_GLSL};

        // Pillar: bright where its side faces the camera, soft at its edges
        vec3 n = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);
        vFacing = abs(dot(normalize(uCameraPos - worldPos4.xyz), n));

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
      varying float vLayer;
      varying float vFacing;

      #include <logdepthbuf_pars_fragment>

      ${DISPLAY_OUTPUT_GLSL}

      // Soft line of width w at distance d from it
      float band(float d, float w) {
        return 1.0 - smoothstep(0.0, w, abs(d));
      }

      void main() {
        #include <logdepthbuf_fragment>

        float pulse = sin(vPhase * 3.0) * 0.1 + 0.9;

        if (vLayer > 0.5) {
          // Light pillar: energy streaks rising, faded at both ends
          float streak = sin(vUv.y * 18.0 - vPhase * 5.0) * 0.5 + 0.5;
          float ends = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
          float body = pow(clamp(vFacing, 0.0, 1.0), 2.0);
          float alpha = body * ends * (0.55 + streak * 0.4) * pulse;
          vec3 pillarColor = mix(vColor, vec3(1.0), 0.35 + streak * 0.2);
          gl_FragColor = displayLight(vec4(pillarColor, alpha));
          return;
        }

        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);

        // Outer rim and a dashed ring turning inside it
        float rim = band(r - 0.93, 0.025);
        float ticks = step(0.5, fract((a + vPhase * 0.15) / 6.28318530718 * 48.0));
        float tickRing = band(r - 0.82, 0.035) * ticks;

        // Hexagon, turning the other way
        float sector = 1.04719755;
        float ha = mod(a - vPhase * 0.1, sector) - sector * 0.5;
        float hexR = r * cos(ha) / 0.866;
        float hex = band(hexR - 0.55, 0.03);

        // Pulse wave running outward
        float wave = fract(vPhase * 0.3);
        float waveRing = band(r - wave, 0.06) * (1.0 - wave);

        // Soft glow under the pillar
        float centre = pow(1.0 - smoothstep(0.0, 0.5, r), 2.0);

        float shape = rim * 0.55 + tickRing * 0.45 + hex * 0.6 + waveRing * 0.5 + centre * 0.6;
        float falloff = 1.0 - smoothstep(0.85, 1.0, r) * 0.5;
        float alpha = clamp(shape * falloff * pulse, 0.0, 1.0);
        vec3 finalColor = mix(vColor, vec3(1.0), centre * 0.3) * 1.2;

        gl_FragColor = displayLight(vec4(finalColor, alpha));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
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

      ${DISPLAY_OUTPUT_GLSL}

      void main() {
        if (vAlpha < 0.01) discard;

        #include <logdepthbuf_fragment>

        vec4 texColor = texture2D(uAtlas, vUv);
        if (texColor.a < 0.01) discard;

        gl_FragColor = displayOutput(vec4(texColor.rgb, texColor.a * vAlpha));
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}
