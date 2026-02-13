import {
  ShaderMaterial,
  FrontSide,
} from 'three';
import { VATData } from './vat-baker';

/**
 * Create a ShaderMaterial for Vertex Animation Texture (VAT) rendering.
 *
 * Vertex shader: samples baked vertex positions from the VAT DataTexture
 * Fragment shader: applies diffuse texture × tint color with opacity
 * Includes logarithmic depth buffer support for correct 3D tiles occlusion.
 *
 * Per-instance attributes:
 *   aAnimFrame (float) - current animation frame in the VAT
 *   aTintColor (vec3) - tint color overlay (0,0,0 = no tint)
 *   aOpacity (float) - instance opacity (1.0 = fully visible)
 */
export function createVATMaterial(vatData: VATData): ShaderMaterial {
  const uniforms: Record<string, { value: unknown }> = {
    vatTexture: { value: vatData.positionTexture },
    vatWidth: { value: vatData.texWidth },
    vatHeight: { value: vatData.totalFrames * vatData.rowsPerFrame },
    rowsPerFrame: { value: vatData.rowsPerFrame },
    isUnlit: { value: vatData.isUnlit ? 1.0 : 0.0 },
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
      attribute float aUseMap;

      // Per-instance attributes
      attribute float aAnimFrame;
      attribute vec3 aTintColor;
      attribute float aOpacity;

      // VAT uniforms
      uniform sampler2D vatTexture;
      uniform float vatWidth;
      uniform float vatHeight;
      uniform float rowsPerFrame;

      // Varyings
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vOpacity;
      varying float vHasTint;
      varying vec3 vVertexColor;
      varying float vUseMap;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vUv = uv;
        vTintColor = aTintColor;
        vOpacity = aOpacity;
        vHasTint = step(0.01, dot(aTintColor, aTintColor));
        vVertexColor = aVertexColor;
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

        // Use VAT position instead of geometry position
        vec3 animatedPosition = vatPos.xyz;

        // Transform normal to world space (light directions are world-space)
        vNormal = normalize(mat3(instanceMatrix) * normal);

        // Apply instance transform
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(animatedPosition, 1.0);
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

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vOpacity;
      varying float vHasTint;
      varying vec3 vVertexColor;
      varying float vUseMap;

      #include <logdepthbuf_pars_fragment>

      void main() {
        // Discard fully transparent fragments early (before lighting)
        if (vOpacity < 0.01) discard;

        #include <logdepthbuf_fragment>

        // Base color: per-vertex texture flag decides texture vs vertex color
        vec3 baseColor;
        if (vUseMap > 0.5 && hasDiffuse > 0.5) {
          baseColor = texture2D(diffuseMap, vUv).rgb;
        } else {
          baseColor = vVertexColor;
        }

        vec3 litColor;

        if (isUnlit > 0.5) {
          // Unlit: show original colors without lighting (for cartoon models)
          litColor = baseColor;
        } else {
          // Scene lighting: sun + fill + hemi + ambient (cooler, brighter)
          vec3 N = normalize(vNormal);

          // Sun (key light): slightly warm, from SW high
          vec3 sunDir = normalize(vec3(-0.44, 0.89, -0.27));
          float sunNdotL = max(dot(N, sunDir), 0.0);
          vec3 sunColor = vec3(1.0, 0.95, 0.88);
          vec3 sun = sunColor * sunNdotL * 1.5;

          // Fill light: neutral-warm, from NE
          vec3 fillDir = normalize(vec3(0.63, 0.63, 0.38));
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

        // Apply tint (for freeze/damage effects)
        if (vHasTint > 0.5) {
          litColor = mix(litColor, vTintColor, 0.5);
        }

        gl_FragColor = vec4(litColor, vOpacity);
      }
    `,
    transparent: true,
    side: FrontSide,
    depthWrite: true,
  });
}
