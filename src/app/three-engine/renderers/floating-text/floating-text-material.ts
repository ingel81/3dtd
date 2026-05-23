import { ShaderMaterial, DoubleSide, Vector3, Texture } from 'three';

/**
 * Create a ShaderMaterial for instanced floating text rendering.
 *
 * Vertex shader: billboard orientation via camera vectors, float-up + scale animation
 * Fragment shader: atlas texture sampling with fade-out
 * Includes logdepthbuf for correct 3D Tiles occlusion.
 *
 * Per-instance attributes:
 *   aAtlasRect (vec4) - UV rect in atlas (u, v, w, h)
 *   aStartTime (float) - spawn time in seconds
 *   aDuration (float) - lifetime in seconds
 *   aFloatSpeed (float) - rise speed in world units/sec
 *   aBaseScale (vec2) - world size (width, height)
 */
export function createFloatingTextMaterial(atlasTexture: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraRight: { value: new Vector3(1, 0, 0) },
      uCameraUp: { value: new Vector3(0, 1, 0) },
      uAtlas: { value: atlasTexture },
    },
    vertexShader: /* glsl */ `
      // Per-instance attributes
      attribute vec4 aAtlasRect;
      attribute float aStartTime;
      attribute float aDuration;
      attribute float aFloatSpeed;
      attribute vec2 aBaseScale;
      attribute float aLateralOffset;
      attribute float aLateralDrift;

      // Uniforms
      uniform float uTime;
      uniform vec3 uCameraRight;
      uniform vec3 uCameraUp;

      // Varyings
      varying vec2 vUv;
      varying float vOpacity;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float elapsed = uTime - aStartTime;
        float progress = clamp(elapsed / aDuration, 0.0, 1.0);

        // Hide expired or inactive instances
        if (progress >= 1.0 || aDuration <= 0.0) {
          gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          vOpacity = 0.0;
          vUv = vec2(0.0);
          return;
        }

        // Fade out: starts at 50% progress
        float fadeProgress = max(0.0, (progress - 0.5) * 2.0);
        vOpacity = 1.0 - fadeProgress;

        // Scale grows 30% over lifetime
        float scaleMult = 1.0 + progress * 0.3;
        vec2 scaledSize = aBaseScale * scaleMult;

        // Extract position from instanceMatrix (column 3 = translation)
        vec3 basePos = vec3(
          instanceMatrix[3][0],
          instanceMatrix[3][1],
          instanceMatrix[3][2]
        );

        // Float upward over time + drift sideways along screen-right so
        // damage (negative drift) and reward (positive drift) trails fan
        // out diagonally as they fade. aLateralOffset is the static spawn
        // separation; aLateralDrift is the per-second sideways velocity.
        vec3 worldPos = basePos
                      + vec3(0.0, elapsed * aFloatSpeed, 0.0)
                      + uCameraRight * elapsed * aLateralDrift;

        // Billboard: offset quad vertices by camera-aligned axes.
        // position.xy is the quad vertex from PlaneGeometry (-0.5 to 0.5).
        vec3 offset = uCameraRight * (position.x * scaledSize.x + aLateralOffset)
                    + uCameraUp    * position.y * scaledSize.y;
        vec3 finalPos = worldPos + offset;

        // Compute atlas UV from quad UV + atlas rect
        // Remap position.xy from (-0.5..0.5) to (0..1)
        vec2 localUv = position.xy + 0.5;
        // Flip Y: canvas Y=0 is top, but with flipY=false texture V=0 is also top
        // PlaneGeometry uv.y=0 is bottom, so flip to match canvas top-to-bottom
        localUv.y = 1.0 - localUv.y;
        vUv = aAtlasRect.xy + localUv * aAtlasRect.zw;

        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uAtlas;

      varying vec2 vUv;
      varying float vOpacity;

      #include <logdepthbuf_pars_fragment>

      void main() {
        if (vOpacity < 0.01) discard;

        #include <logdepthbuf_fragment>

        vec4 texColor = texture2D(uAtlas, vUv);
        if (texColor.a < 0.01) discard;

        gl_FragColor = vec4(texColor.rgb, texColor.a * vOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}
