import {
  ShaderMaterial,
  DoubleSide,
  Vector3,
  Texture,
  AdditiveBlending,
} from 'three';

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
