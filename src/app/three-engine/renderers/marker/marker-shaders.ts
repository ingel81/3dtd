import {
  ShaderMaterial,
  DoubleSide,
  FrontSide,
  Vector2,
  Vector3,
  Texture,
  AdditiveBlending,
  CustomBlending,
  AddEquation,
  OneFactor,
  OneMinusSrcAlphaFactor,
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

/** Opening of the portal at scale 1 (m), see PORTAL_ENERGY_LAYOUT. */
export interface PortalShaderLayout {
  halfOpening: number;
  openingHeight: number;
  groundHalfWidth: number;
  groundBack: number;
  groundFront: number;
}

/**
 * Stone frame of the spawn portals. Unlit like every marker shader: a
 * fixed key light shapes the blocks, the portal's own light falls on the
 * faces around the opening, and runes down the pillars and along the
 * lintel glow in the spawn's colour. The Photorealistic Tiles around it
 * take no scene light either way.
 */
export function createPortalFrameMaterial(layout: PortalShaderLayout, energy: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: energy },
      uOpening: { value: new Vector2(layout.halfOpening, layout.openingHeight) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vPhase;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vLocalPos = position;
        vLocalNormal = normal;
        vNormal = normalize(mat3(instanceMatrix) * normal);
        vColor = aColor;
        vPhase = aPhase;

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uEnergy;
      uniform vec2 uOpening; // half width, height

      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vPhase;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_NOISE_GLSL}

      // Glyph of one rune cell: a stem, up to three bars and two diagonals,
      // picked by the cell's hash. p in cell units.
      float portalRune(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p) - 0.5;
        float h = portalHash(cell);
        float h2 = portalHash(cell + 17.0);
        const float STROKE = 0.075;
        const float AA = 0.035;
        float m = (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.x))) * step(abs(f.y), 0.36) * step(0.25, h);
        float bar = step(abs(f.x), 0.26);
        m = max(m, (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.y - 0.28))) * bar * step(0.5, fract(h * 7.0)));
        m = max(m, (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.y))) * bar * step(0.55, fract(h * 13.0)));
        m = max(m, (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.y + 0.28))) * bar * step(0.5, fract(h * 29.0)));
        float diag = bar * step(abs(f.y), 0.3);
        m = max(m, (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.x - f.y) * 0.7071)) * diag * step(0.6, h2));
        m = max(m, (1.0 - smoothstep(STROKE, STROKE + AA, abs(f.x + f.y) * 0.7071)) * diag * step(0.75, fract(h2 * 5.0)));
        return m;
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 p = vLocalPos;
        vec3 ln = vLocalNormal;
        float ax = abs(p.x);

        // Dark basalt with some grain
        float grain = portalNoise(p.xy * 1.9 + p.z * 0.7) * 0.6 + portalNoise(p.zy * 6.1 + p.x) * 0.4;
        vec3 stone = vec3(0.085, 0.075, 0.075) * (0.7 + 0.6 * grain);
        vec3 n = normalize(vNormal);
        float key = max(dot(n, normalize(vec3(0.4, 0.8, 0.45))), 0.0);
        vec3 col = stone * (0.45 + 0.75 * key + 0.25 * n.y);

        vec3 hot = mix(vColor, vec3(1.0, 0.9, 0.65), 0.35);

        // The portal's light on the pillars' inner sides, the lintel's
        // underside and the front edges next to the opening
        float inner = clamp(-sign(p.x) * ln.x, 0.0, 1.0);
        float under = clamp(-ln.y, 0.0, 1.0) * step(ax, uOpening.x + 0.6);
        float edge = abs(ln.z) * exp(-max(ax - uOpening.x, 0.0) * 1.6);
        float near = step(p.y, uOpening.y + 0.4) * smoothstep(-0.5, 1.0, p.y);
        float flicker = 0.85 + 0.15 * portalNoise(vec2(uTime * 2.3 + vPhase, p.y * 0.4));
        col += vColor * (inner * 0.9 + under * 0.7 + edge * 0.45) * near * (0.35 + 0.65 * uEnergy) * flicker;

        // Runes down the front and back of the pillars and along the
        // lintel, lit in a wave that climbs the frame
        float face = step(0.6, abs(ln.z));
        float pillarBand = step(uOpening.x + 0.35, ax) * step(ax, uOpening.x + 1.25)
          * step(1.8, p.y) * step(p.y, uOpening.y + 1.4);
        float lintelBand = step(ax, uOpening.x - 0.3) * step(uOpening.y + 0.5, p.y) * step(p.y, uOpening.y + 2.1);
        vec2 pillarCell = vec2((ax - uOpening.x - 0.35) / 0.9, (p.y - 1.8) / 0.95);
        vec2 lintelCell = vec2((p.x + uOpening.x) / 0.95, (p.y - uOpening.y - 0.5) / 1.6);
        float rune = face * (pillarBand * portalRune(pillarCell) + lintelBand * portalRune(lintelCell));
        float climb = 0.55 + 0.45 * sin(uTime * 1.4 - p.y * 0.6 + vPhase);
        col += hot * rune * climb * (0.6 + 0.8 * uEnergy);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: FrontSide,
  });
}

/**
 * Energy of the spawn portals: the swirling surface in the opening and the
 * light it throws on the street, in one draw call. Premultiplied alpha
 * (ONE, ONE_MINUS_SRC_ALPHA): the surface's dark void covers the street
 * behind the portal and its swirl adds light on top, the ground patch
 * writes alpha 0 and is purely additive. aRipple is the wall time (s) of
 * the portal's last spawn burst: a ring runs out from the eye over the
 * surface and from the portal's foot over the street.
 */
export function createPortalEnergyMaterial(
  layout: PortalShaderLayout,
  energy: number,
  rippleLife: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: energy },
      uRippleLife: { value: rippleLife },
      uOpening: { value: new Vector2(layout.halfOpening, layout.openingHeight) },
      uGround: { value: new Vector3(layout.groundHalfWidth, layout.groundBack, layout.groundFront) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aRipple;
      attribute float aPart;

      varying vec3 vLocal;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vLocal = position;
        vColor = aColor;
        vPhase = aPhase;
        vRipple = aRipple;
        vPart = aPart;

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

      varying vec3 vLocal;
      varying vec3 vColor;
      varying float vPhase;
      varying float vRipple;
      varying float vPart;

      #include <logdepthbuf_pars_fragment>

      ${PORTAL_NOISE_GLSL}

      void main() {
        #include <logdepthbuf_fragment>

        vec3 hot = mix(vColor, vec3(1.0, 0.93, 0.75), 0.6);

        // Spawn burst: strength fading from 1 to 0 over the ripple's life
        float age = uTime - vRipple;
        float ripple = age >= 0.0 && age < uRippleLife ? 1.0 - age / uRippleLife : 0.0;
        float progress = 1.0 - ripple;

        if (vPart < 0.5) {
          // Surface: a swirl around an eye a little below the middle,
          // tighter toward the eye, faster with more energy
          vec2 m = vec2(vLocal.x, vLocal.y - uOpening.y * 0.45) / uOpening.x;
          float r = length(m);
          float a = atan(m.y, m.x);
          float t = uTime * (0.3 + 0.25 * uEnergy) + vPhase;
          float swirl = a + 2.4 / (r + 0.45) - t * 2.0;
          vec2 q = vec2(cos(swirl), sin(swirl)) * r;
          float n = portalFbm(q * 1.7 + vec2(0.0, t * 0.6));
          float bands = 0.5 + 0.5 * sin(swirl * 3.0 + n * 5.0 - r * 4.0);
          float glow = n * (0.3 + 0.7 * bands);

          // Metres to the nearest edge of the opening: the rim burns brightest
          float edge = min(uOpening.x - abs(vLocal.x), min(vLocal.y, uOpening.y - vLocal.y));
          float rim = exp(-max(edge, 0.0) * 1.2);
          // Ring running out from the eye past the frame
          float wave = ripple * exp(-pow((r - progress * 2.2) * 5.0, 2.0));

          vec3 light = mix(vColor * 0.7, hot, bands * n) * glow * (0.5 + uEnergy)
            + hot * rim * (0.3 + 0.6 * uEnergy)
            + hot * wave * 1.6;
          const float VOID = 0.82;
          gl_FragColor = vec4(vColor * 0.03 * VOID + light, VOID);
        } else {
          // Street patch: strongest at the portal's foot, fading to the
          // patch's edges, weaker behind the portal
          float dx = max(abs(vLocal.x) - uOpening.x, 0.0);
          float d = length(vec2(dx, vLocal.z));
          float side = 1.0 - smoothstep(0.55, 1.0, abs(vLocal.x) / uGround.x);
          float along = vLocal.z >= 0.0
            ? 1.0 - smoothstep(0.35, 1.0, vLocal.z / uGround.z)
            : (1.0 - smoothstep(0.2, 1.0, -vLocal.z / uGround.y)) * 0.45;
          float flicker = 0.85 + 0.15 * portalNoise(vec2(uTime * 2.3 + vPhase, d * 0.3));
          // Ring running out from the portal's foot over the street
          float ring = ripple * exp(-pow(d - progress * uGround.z, 2.0) * 0.6);
          vec3 light = vColor * exp(-d * 0.25) * side * along * (0.25 + 0.45 * uEnergy) * flicker
            + hot * ring * side * along * 0.9;
          gl_FragColor = vec4(light, 0.0);
        }
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
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
