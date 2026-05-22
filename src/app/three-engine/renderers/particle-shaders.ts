import {
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  AdditiveBlending,
  NormalBlending,
} from 'three';

/**
 * GPU particle shaders for ThreeEffectsRenderer's trail/atlas particle pools.
 *
 * Split out of three-effects.renderer.ts (mirrors decal-shaders.ts). The
 * vertex shader carries per-particle `size` + sprite-sheet `frameIndex`
 * attributes; the fragment shaders pick between a classic circular particle
 * (frameIndex < 0) and an NxN sprite-atlas lookup.
 *
 * Key constraint: with `logarithmicDepthBuffer: true` on the WebGLRenderer,
 * custom ShaderMaterials MUST include the log-depth shader chunks to write
 * correct depth values — otherwise particles z-fight / punch through 3D Tiles.
 */

/**
 * Vertex shader: per-particle size attenuation + sprite-sheet frame passthrough.
 *   frameIndex < 0  → default circular particle (no atlas)
 *   frameIndex >= 0 → index into the NxN atlas grid
 */
const PARTICLE_VERTEX_SHADER = /* glsl */ `
      attribute float size;
      attribute float frameIndex;
      varying vec3 vColor;
      varying float vFrameIndex;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = color;
        vFrameIndex = frameIndex;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Size attenuation: larger particles when closer
        gl_PointSize = size * (3000.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `;

/** Fragment shader for additive blending (fire/glow) with sprite-sheet support. */
const PARTICLE_FRAGMENT_SHADER_ADDITIVE = /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      varying float vFrameIndex;
      uniform sampler2D uAtlas;
      uniform vec2 uAtlasGrid; // (cols, rows)

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vFrameIndex < 0.0) {
          // === Classic circular particle (no atlas) ===
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor * alpha, alpha);
        } else {
          // === Sprite-sheet atlas lookup ===
          float frame = floor(vFrameIndex + 0.5); // round to nearest int
          float col = mod(frame, uAtlasGrid.x);
          float row = floor(frame / uAtlasGrid.x);
          // UV within this cell: gl_PointCoord is [0,1] across the point
          vec2 cellUV = gl_PointCoord;
          // Map to atlas coordinates (row 0 = top of texture)
          vec2 uv = vec2(
            (col + cellUV.x) / uAtlasGrid.x,
            (row + cellUV.y) / uAtlasGrid.y
          );
          vec4 texel = texture2D(uAtlas, uv);
          if (texel.a < 0.01) discard;
          // Tint with particle color (allows color variation)
          gl_FragColor = vec4(texel.rgb * vColor, texel.a);
        }

        #include <logdepthbuf_fragment>
      }
    `;

/** Fragment shader for normal blending (smoke/dust) with sprite-sheet support. */
const PARTICLE_FRAGMENT_SHADER_NORMAL = /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      varying float vFrameIndex;
      uniform sampler2D uAtlas;
      uniform vec2 uAtlasGrid; // (cols, rows)

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vFrameIndex < 0.0) {
          // === Classic circular particle (no atlas) ===
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = 0.7 * (1.0 - smoothstep(0.3, 0.5, dist));
          gl_FragColor = vec4(vColor, alpha);
        } else {
          // === Sprite-sheet atlas lookup ===
          float frame = floor(vFrameIndex + 0.5);
          float col = mod(frame, uAtlasGrid.x);
          float row = floor(frame / uAtlasGrid.x);
          vec2 cellUV = gl_PointCoord;
          vec2 uv = vec2(
            (col + cellUV.x) / uAtlasGrid.x,
            (row + cellUV.y) / uAtlasGrid.y
          );
          vec4 texel = texture2D(uAtlas, uv);
          if (texel.a < 0.01) discard;
          gl_FragColor = vec4(texel.rgb * vColor, texel.a * 0.85);
        }

        #include <logdepthbuf_fragment>
      }
    `;

/** Additive + normal trail-particle shader materials, sharing one vertex shader. */
export interface ParticleShaderMaterials {
  /** Additive blending — fire, tracers, glow; tinted with the explosion atlas. */
  additive: ShaderMaterial;
  /** Normal blending — smoke, dust; tinted with the smoke atlas. */
  normal: ShaderMaterial;
}

/**
 * Create the additive + normal trail-particle ShaderMaterials.
 *
 * @param explosionAtlas sprite-sheet sampled by the additive material
 * @param smokeAtlas     sprite-sheet sampled by the normal material
 * @param atlasCols      atlas grid columns
 * @param atlasRows      atlas grid rows
 */
export function createParticleShaderMaterials(
  explosionAtlas: Texture | null,
  smokeAtlas: Texture | null,
  atlasCols: number,
  atlasRows: number,
): ParticleShaderMaterials {
  const additive = new ShaderMaterial({
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER_ADDITIVE,
    uniforms: {
      uAtlas: new Uniform(explosionAtlas),
      uAtlasGrid: new Uniform(new Vector2(atlasCols, atlasRows)),
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: true,
  });

  const normal = new ShaderMaterial({
    vertexShader: PARTICLE_VERTEX_SHADER,
    fragmentShader: PARTICLE_FRAGMENT_SHADER_NORMAL,
    uniforms: {
      uAtlas: new Uniform(smokeAtlas),
      uAtlasGrid: new Uniform(new Vector2(atlasCols, atlasRows)),
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexColors: true,
  });

  return { additive, normal };
}
