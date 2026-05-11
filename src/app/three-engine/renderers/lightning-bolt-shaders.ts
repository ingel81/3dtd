/**
 * Lightning Bolt Shaders
 *
 * Static quad-strip geometry (N segments along a virtual spine 0..1) animated
 * purely in the vertex shader. Per-bolt uniforms position the spine in world
 * space; vertex shader displaces it with deterministic noise to create the
 * jagged shape; fragment shader fades intensity/alpha across width and over
 * lifetime.
 *
 * Attributes (per vertex, set once at construction time):
 *   - aSegmentT  : float (0..1) — position along the spine
 *   - aSide      : float (+1 or -1) — side of the ribbon
 *
 * Uniforms (per bolt, set on acquire / per frame):
 *   - uStart, uEnd     : vec3 — bolt endpoints in world space
 *   - uTime            : float — global shader clock seconds
 *   - uSpawnTime       : float — clock value at spawn (for age)
 *   - uLifetime        : float — bolt lifetime in seconds
 *   - uSeed            : float — random per-bolt seed (varies the noise)
 *   - uWidth           : float — half-width of the ribbon at the spine
 *   - uJaggedness      : float — perpendicular displacement amplitude
 *   - uIntensity       : float — overall brightness multiplier
 *   - uColorCore       : vec3 — bright core color (e.g. white/cyan)
 *   - uColorOuter      : vec3 — fade-out outer color (e.g. saturated blue)
 *
 * MUST include logdepthbuf chunks for correct 3D Tiles occlusion.
 */

export const LIGHTNING_BOLT_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute float aSegmentT;
  attribute float aSide;

  uniform vec3 uStart;
  uniform vec3 uEnd;
  uniform float uTime;
  uniform float uSpawnTime;
  uniform float uLifetime;
  uniform float uSeed;
  uniform float uWidth;
  uniform float uJaggedness;

  varying float vSide;
  varying float vAge;

  // 1D hash + smooth interpolation — cheap deterministic noise
  float hash1(float p) {
    return fract(sin(p * 12.9898) * 43758.5453);
  }
  float smoothNoise1(float p) {
    float i = floor(p);
    float f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash1(i), hash1(i + 1.0), f);
  }

  void main() {
    float age = clamp((uTime - uSpawnTime) / max(uLifetime, 0.0001), 0.0, 1.0);
    vAge = age;
    vSide = aSide;

    // Base spine position along the line
    vec3 spine = mix(uStart, uEnd, aSegmentT);

    // Line direction and perpendicular axes
    vec3 lineDir = uEnd - uStart;
    float lineLen = max(length(lineDir), 0.0001);
    lineDir /= lineLen;

    // View-perpendicular (billboard) side axis
    vec4 worldPos = modelMatrix * vec4(spine, 1.0);
    vec3 toCamera = normalize(cameraPosition - worldPos.xyz);
    vec3 sideAxis = normalize(cross(lineDir, toCamera));
    // Fallback if line is parallel to view direction (degenerate cross)
    if (length(sideAxis) < 0.001) {
      sideAxis = normalize(cross(lineDir, vec3(0.0, 1.0, 0.0)));
    }
    // Perpendicular to both line and side — used for in-plane jaggedness
    vec3 normalAxis = normalize(cross(lineDir, sideAxis));

    // Taper at endpoints so the bolt anchors cleanly to source/target
    float taper = 1.0 - 2.0 * abs(aSegmentT - 0.5);

    // Two-axis noise displacement of the spine (deterministic per-bolt via uSeed).
    // Higher base frequency + a second high-frequency octave gives the
    // crackly multi-kink shape of real lightning instead of a soft S-curve.
    float t1 = aSegmentT * 17.0 + uSeed * 17.0 + uTime * 32.0;
    float t2 = aSegmentT * 21.0 + uSeed * 31.0 + uTime * 40.0;
    float n1 = (smoothNoise1(t1) - 0.5) + 0.45 * (smoothNoise1(t1 * 2.7 + 3.1) - 0.5);
    float n2 = (smoothNoise1(t2) - 0.5) + 0.45 * (smoothNoise1(t2 * 2.7 + 7.3) - 0.5);
    spine += sideAxis * n1 * uJaggedness * taper;
    spine += normalAxis * n2 * uJaggedness * taper;

    // Width: full at mid, tapered toward both endpoints
    float widthTaper = 1.0 - 0.6 * abs(aSegmentT - 0.5) * 2.0;
    vec3 pos = spine + sideAxis * aSide * uWidth * widthTaper;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);

    #include <logdepthbuf_vertex>
  }
`;

export const LIGHTNING_BOLT_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  uniform float uIntensity;
  uniform vec3 uColorCore;
  uniform vec3 uColorOuter;

  varying float vSide;
  varying float vAge;

  void main() {
    // Distance from spine across the width
    float d = abs(vSide); // 0 at spine, 1 at edge

    // Core glow: bright/white at spine, fades to outer color
    vec3 col = mix(uColorCore, uColorOuter, smoothstep(0.0, 1.0, d));

    // Alpha falls off across width with a sharp core
    float widthAlpha = pow(1.0 - d, 1.6);

    // Lifetime fade: punchy first half, then smooth decay
    float lifeAlpha = 1.0 - smoothstep(0.4, 1.0, vAge);

    float alpha = widthAlpha * lifeAlpha;
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(col * uIntensity, alpha);

    #include <logdepthbuf_fragment>
  }
`;
