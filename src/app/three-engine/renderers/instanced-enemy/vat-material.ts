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
    vatWidth: { value: vatData.vertexCount },
    vatHeight: { value: vatData.totalFrames },
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
      // Per-vertex attribute: vertex index for VAT sampling
      attribute float aVertexIndex;

      // Per-instance attributes
      attribute float aAnimFrame;
      attribute vec3 aTintColor;
      attribute float aOpacity;

      // VAT uniforms
      uniform sampler2D vatTexture;
      uniform float vatWidth;
      uniform float vatHeight;

      // Varyings
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vOpacity;
      varying float vHasTint;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vUv = uv;
        vTintColor = aTintColor;
        vOpacity = aOpacity;
        vHasTint = step(0.01, dot(aTintColor, aTintColor));

        // Sample VAT for animated position
        vec2 vatUV = vec2(
          (aVertexIndex + 0.5) / vatWidth,
          (aAnimFrame + 0.5) / vatHeight
        );
        vec4 vatPos = texture2D(vatTexture, vatUV);

        // Use VAT position instead of geometry position
        vec3 animatedPosition = vatPos.xyz;

        // Transform normal (using rest-pose normal - approximate but acceptable)
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);

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

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTintColor;
      varying float vOpacity;
      varying float vHasTint;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Base color from diffuse texture or white
        vec3 baseColor;
        if (hasDiffuse > 0.5) {
          baseColor = texture2D(diffuseMap, vUv).rgb;
        } else {
          baseColor = vec3(1.0);
        }

        // Simple hemisphere lighting (matches MeshBasicMaterial / unlit look)
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float NdotL = dot(normalize(vNormal), lightDir);
        float light = 0.5 + 0.5 * NdotL; // Hemisphere: range [0.5, 1.0]

        vec3 litColor = baseColor * light;

        // Apply tint (for freeze/damage effects)
        if (vHasTint > 0.5) {
          litColor = mix(litColor, vTintColor, 0.5);
        }

        gl_FragColor = vec4(litColor, vOpacity);

        // Discard fully transparent fragments
        if (vOpacity < 0.01) discard;
      }
    `,
    transparent: true,
    side: FrontSide,
    depthWrite: true,
  });
}
