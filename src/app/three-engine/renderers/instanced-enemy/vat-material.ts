import {
  ShaderMaterial,
  Color,
  Vector3,
  type IUniform,
} from 'three';
import { VATData } from './vat-baker';
import type { VATAlphaMode } from './vat-surface';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';

/** Shader switch per VAT alpha mode. */
const ALPHA_DEFINES: Record<VATAlphaMode, Record<string, string>> = {
  opaque: {},
  mask: { VAT_ALPHA_MASK: '' },
  blend: { VAT_ALPHA_BLEND: '' },
};

/**
 * Blood moon uniforms. EnemyInstanceManager hands the same objects to every
 * VAT material, so one write reaches all enemy types; no material clones.
 */
export interface VATBloodMoonUniforms {
  /** 0 outside a blood moon, 1 at full glow */
  bloodMoonGlow: IUniform<number>;
  /** The mood's multiplier, for the blending types that draw after its quad */
  bloodMoonTint: IUniform<Vector3>;
}

export function createVATBloodMoonUniforms(): VATBloodMoonUniforms {
  return {
    bloodMoonGlow: { value: 0 },
    bloodMoonTint: { value: new Vector3(1, 1, 1) },
  };
}

export interface VATMaterialOptions {
  emissiveIntensity?: number;
  emissiveColor?: string;
  colorMultiplier?: number;
  /** Shared blood moon uniforms; without them the material gets its own, at rest */
  bloodMoon?: VATBloodMoonUniforms;
}

/**
 * Create a ShaderMaterial for Vertex Animation Texture (VAT) rendering.
 *
 * Vertex shader: samples baked vertex positions from the VAT DataTexture
 * Fragment shader: applies diffuse texture × tint color. Alpha only counts
 * where the model's materials use it (vatData.alpha): opaque types draw in
 * the opaque pass, masked ones discard below the cutoff, only blending types
 * are transparent.
 * Includes logarithmic depth buffer support for correct 3D tiles occlusion.
 * Draws the faces the baked materials draw (vatData.side).
 *
 * Per-instance attributes:
 *   aAnimFrame (float) - current animation frame in the VAT
 *   aTintColor (vec3) - tint color overlay (0,0,0 = no tint)
 *
 * Blood moon (VATBloodMoonUniforms, shared by every type): a rim glow while
 * bloodMoonGlow is above 0, and for blending types the mood's multiplier.
 */
export function createVATMaterial(vatData: VATData, options?: VATMaterialOptions): ShaderMaterial {
  const emissiveIntensity = options?.emissiveIntensity ?? 0;
  const emissiveColor = new Color(options?.emissiveColor ?? '#ffffff');
  const colorMultiplier = options?.colorMultiplier ?? 1.0;
  const bloodMoon = options?.bloodMoon ?? createVATBloodMoonUniforms();
  const glow = BLOOD_MOON_LOOK.glow;

  const uniforms: Record<string, { value: unknown }> = {
    // The same uniform objects in every material (see VATBloodMoonUniforms)
    ...bloodMoon,
    bloodMoonGlowColor: { value: new Vector3(glow.color.r, glow.color.g, glow.color.b) },
    bloodMoonRim: { value: glow.rim },
    bloodMoonBase: { value: glow.base },
    vatTexture: { value: vatData.positionTexture },
    vatWidth: { value: vatData.texWidth },
    vatHeight: { value: vatData.totalFrames * vatData.rowsPerFrame },
    rowsPerFrame: { value: vatData.rowsPerFrame },
    vatOrigin: { value: new Vector3(...vatData.encoding.origin) },
    vatExtent: { value: new Vector3(...vatData.encoding.extent) },
    isUnlit: { value: vatData.isUnlit ? 1.0 : 0.0 },
    emissiveIntensity: { value: emissiveIntensity },
    emissiveColor: { value: emissiveColor },
    colorMultiplier: { value: colorMultiplier },
    alphaCutoff: { value: vatData.alpha.cutoff },
  };

  if (vatData.diffuseMap) {
    uniforms['diffuseMap'] = { value: vatData.diffuseMap };
    uniforms['hasDiffuse'] = { value: 1.0 };
  } else {
    uniforms['diffuseMap'] = { value: null };
    uniforms['hasDiffuse'] = { value: 0.0 };
  }

  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      // Per-vertex attributes
      attribute float aVertexIndex;
      attribute vec3 aVertexColor;
      attribute float aVertexAlpha;
      attribute float aUseMap;

      // Per-instance attributes
      attribute float aAnimFrame;
      attribute vec3 aTintColor;

      // VAT uniforms
      uniform sampler2D vatTexture;
      uniform float vatWidth;
      uniform float vatHeight;
      uniform float rowsPerFrame;
      uniform vec3 vatOrigin;
      uniform vec3 vatExtent;

      // Varyings
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vHasTint;
      varying vec3 vVertexColor;
      varying float vVertexAlpha;
      varying float vUseMap;
      varying vec3 vWorldPosition;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vUv = uv;
        vTintColor = aTintColor;
        vHasTint = step(0.01, dot(aTintColor, aTintColor));
        vVertexColor = aVertexColor;
        vVertexAlpha = aVertexAlpha;
        vUseMap = aUseMap;

        // Sample VAT for animated position (tiled layout for large vertex counts)
        float col = mod(aVertexIndex, vatWidth);
        float localRow = floor(aVertexIndex / vatWidth);
        float globalRow = aAnimFrame * rowsPerFrame + localRow;
        vec2 vatUV = vec2(
          (col + 0.5) / vatWidth,
          (globalRow + 0.5) / vatHeight
        );
        vec4 vatPos = texture2D(vatTexture, vatUV);

        // Use VAT position instead of geometry position. Half-float VATs store
        // it relative to their bounding box (vatEncoding in vat-encoding.ts),
        // float VATs as it is (extent 1, origin 0).
        vec3 animatedPosition = vatPos.xyz * vatExtent + vatOrigin;

        // Transform normal to world space (light directions are world-space)
        vNormal = normalize(mat3(instanceMatrix) * normal);

        // Apply instance transform
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(animatedPosition, 1.0);
        vWorldPosition = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D diffuseMap;
      uniform float hasDiffuse;
      uniform float isUnlit;
      uniform float emissiveIntensity;
      uniform vec3 emissiveColor;
      uniform float colorMultiplier;
      uniform float alphaCutoff;
      uniform float bloodMoonGlow;
      uniform vec3 bloodMoonGlowColor;
      uniform float bloodMoonRim;
      uniform float bloodMoonBase;
      uniform vec3 bloodMoonTint;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vHasTint;
      varying vec3 vVertexColor;
      varying float vVertexAlpha;
      varying float vUseMap;
      varying vec3 vWorldPosition;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Base color + alpha: per-vertex texture flag decides texture vs vertex color
        vec3 baseColor;
        float baseAlpha;
        if (vUseMap > 0.5 && hasDiffuse > 0.5) {
          vec4 texSample = texture2D(diffuseMap, vUv);
          baseColor = texSample.rgb;
          baseAlpha = texSample.a;
        } else {
          baseColor = vVertexColor;
          baseAlpha = vVertexAlpha;
        }

        // Alpha as the model's materials use it (vatAlpha in vat-surface.ts)
        #if defined( VAT_ALPHA_BLEND )
          if (baseAlpha < 0.05) discard; // nearly transparent, before lighting
        #elif defined( VAT_ALPHA_MASK )
          if (baseAlpha < alphaCutoff) discard;
        #endif

        vec3 litColor;

        if (isUnlit > 0.5) {
          // Unlit: show original colors without lighting (for cartoon models)
          litColor = baseColor;
        } else {
          // Scene lighting: sun + fill + hemi + ambient (cooler, brighter)
          // A back face of a double-sided type faces away from its normal.
          vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);

          // Sun (key light): slightly warm, from SW high.
          // Pre-normalized literal of vec3(-0.44, 0.89, -0.27) — avoids a
          // per-fragment normalize() of a compile-time constant.
          const vec3 sunDir = vec3(-0.42765, 0.86505, -0.26242);
          float sunNdotL = max(dot(N, sunDir), 0.0);
          vec3 sunColor = vec3(1.0, 0.95, 0.88);
          vec3 sun = sunColor * sunNdotL * 1.5;

          // Fill light: neutral-warm, from NE.
          // Pre-normalized literal of vec3(0.63, 0.63, 0.38).
          const vec3 fillDir = vec3(0.65041, 0.65041, 0.39231);
          float fillNdotL = max(dot(N, fillDir), 0.0);
          vec3 fillColor = vec3(1.0, 0.96, 0.92);
          vec3 fill = fillColor * fillNdotL * 0.8;

          // Hemisphere: sky/ground blend (cooler sky)
          float hemiBlend = 0.5 + 0.5 * N.y;
          vec3 hemiSky = vec3(0.95, 0.95, 0.97);
          vec3 hemiGround = vec3(0.45, 0.4, 0.35);
          vec3 hemi = mix(hemiGround, hemiSky, hemiBlend) * 0.75;

          // Ambient (neutral)
          vec3 ambientColor = vec3(0.95, 0.95, 0.93) * 0.5;

          vec3 totalLight = sun + fill + hemi + ambientColor;
          litColor = baseColor * totalLight;
        }

        // Color multiplier: darken overly bright models
        litColor *= colorMultiplier;

        // Emissive: additive glow (brightens the model)
        litColor += emissiveColor * emissiveIntensity;

        // Blood moon glow, 0 outside it: a hot rim where the surface turns
        // away from the camera, a faint glow all over
        if (bloodMoonGlow > 0.0) {
          vec3 glowNormal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 toCamera = normalize(cameraPosition - vWorldPosition);
          float rim = 1.0 - max(dot(glowNormal, toCamera), 0.0);
          litColor += bloodMoonGlowColor * (bloodMoonRim * rim * rim + bloodMoonBase) * bloodMoonGlow;
        }

        // Apply tint (for freeze/damage effects)
        if (vHasTint > 0.5) {
          litColor = mix(litColor, vTintColor, 0.5);
        }

        // ACES Filmic tone mapping (matches Three.js default)
        // Prevents overexposure and preserves color saturation
        litColor = (litColor * (2.51 * litColor + 0.03)) /
                   (litColor * (2.43 * litColor + 0.59) + 0.14);

        #ifdef VAT_ALPHA_BLEND
          // Drawn after the blood moon's mood quad (transparent), so the
          // mood's multiplier comes in here; 1 outside a blood moon
          litColor *= bloodMoonTint;
          gl_FragColor = vec4(litColor, baseAlpha);
        #else
          gl_FragColor = vec4(litColor, 1.0);
        #endif
      }
    `,
    defines: { ...ALPHA_DEFINES[vatData.alpha.mode] },
    transparent: vatData.alpha.mode === 'blend',
    side: vatData.side,
    // One pass also for double-sided blending. ShaderMaterial's own default
    // in r186, kept explicit: a transparent double-sided material without it
    // draws back and front faces in two passes, which doubles the VAT reads.
    forceSinglePass: true,
    depthWrite: true,
  });
}

/** Point a VAT material at another bake of the same model: same layout, new texture and mapping. */
export function setVATTexture(material: ShaderMaterial, vatData: VATData): void {
  material.uniforms['vatTexture'].value = vatData.positionTexture;
  (material.uniforms['vatOrigin'].value as Vector3).set(...vatData.encoding.origin);
  (material.uniforms['vatExtent'].value as Vector3).set(...vatData.encoding.extent);
}
