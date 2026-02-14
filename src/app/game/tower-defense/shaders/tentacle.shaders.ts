/**
 * Tentacle Shaders
 *
 * Procedural tentacle rendering for Tentacle Tower melee attack:
 * - GPU Bezier: vertex shader evaluates cubic Bezier curve + Frenet frame
 * - Only 4 vec3 control-point uniforms set per frame from CPU
 * - Flesh-colored gradient from base to tip (dark reddish → pale pink)
 * - Procedural veins (FBM-warped sin lines) + glossy specular (wet/slimy)
 * - Log depth buffer support for 3D Tiles compatibility
 *
 * Template geometry: unit-circle cross-section in position.xz, uv.y = Bezier t.
 */

export const TENTACLE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform vec3 uCP0;
  uniform vec3 uCP1;
  uniform vec3 uCP2;
  uniform vec3 uCP3;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  // Cubic Bezier
  vec3 cubicBezier(float t, vec3 p0, vec3 p1, vec3 p2, vec3 p3) {
    float u = 1.0 - t;
    float u2 = u * u;
    float t2 = t * t;
    return u2 * u * p0 + 3.0 * u2 * t * p1 + 3.0 * u * t2 * p2 + t2 * t * p3;
  }

  // Cubic Bezier derivative
  vec3 cubicBezierTangent(float t, vec3 p0, vec3 p1, vec3 p2, vec3 p3) {
    float u = 1.0 - t;
    return 3.0 * (u * u * (p1 - p0) + 2.0 * u * t * (p2 - p1) + t * t * (p3 - p2));
  }

  // --- Noise for vertex displacement ---
  float vhash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = vhash(i);
    float b = vhash(i + vec2(1.0, 0.0));
    float c = vhash(i + vec2(0.0, 1.0));
    float d = vhash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Seamless noise on cylinder: wraps around circumference without seam
  // Uses cos/sin of angle to create naturally periodic 2D coordinates
  float cylNoise(float angle, float r, float y, vec2 seed) {
    return (vnoise(vec2(cos(angle) * r, y) + seed)
          + vnoise(vec2(sin(angle) * r, y) + seed + vec2(31.7, 17.3))) * 0.5;
  }

  void main() {
    vUv = uv;

    float t = uv.y;            // 0 = base, 1 = tip
    vec2 radial = position.xz; // Unit-circle cross-section
    float radLenSq = dot(radial, radial); // 0 for cap center, ~1 for ring verts

    // Evaluate Bezier curve + tangent
    vec3 center = cubicBezier(t, uCP0, uCP1, uCP2, uCP3);
    vec3 tang = cubicBezierTangent(t, uCP0, uCP1, uCP2, uCP3);
    vec3 T = normalize(tang);

    // Build Frenet frame
    vec3 bino = cross(T, vec3(0.0, 0.0, 1.0));
    vec3 binoAlt = cross(T, vec3(1.0, 0.0, 0.0));
    bino = normalize(mix(binoAlt, bino, step(0.0001, dot(bino, bino))));
    vec3 N = cross(bino, T);

    // Taper: thick base (1.2) → blunt tip (0.35)
    float baseRadius = mix(1.2, 0.35, pow(t, 1.2));

    // --- Seamless procedural displacement ---
    float angle = uv.x * 6.28318;
    float cr = baseRadius;
    float ly = uv.y * 12.0;

    // Broad undulation (muscle-like bulges)
    float bulge = cylNoise(angle, cr * 0.5, ly * 0.3, vec2(1.7, 3.2)) * 0.2
                + cylNoise(angle, cr * 0.8, ly * 0.5, vec2(5.1, 8.4)) * 0.1;

    // Wart-like bumps
    float wart = smoothstep(0.62, 0.82, cylNoise(angle, cr * 0.4, ly * 0.25, vec2(7.1, 3.4)));
    wart += smoothstep(0.68, 0.88, cylNoise(angle, cr * 0.5, ly * 0.35, vec2(2.9, 11.7))) * 0.7;

    // Sucker indentations
    float sucker = smoothstep(0.7, 0.85, cylNoise(angle, cr * 0.9, ly * 0.6, vec2(4.2, 6.8))) * -0.15;

    // Combine, fade near tip
    float disp = (bulge + wart * 0.3 + sucker) * smoothstep(0.92, 0.4, t);
    // Skip displacement for cap center vertex
    disp *= step(0.01, radLenSq);

    float radius = baseRadius * (1.0 + disp);

    // Final position
    vec3 radDir = radial.x * N + radial.y * bino;
    vec3 offset = radDir * radius;
    vec3 worldP = center + offset;

    // Normal: cap center uses tangent, ring verts use perturbed radial
    vec3 surfNormal;
    if (radLenSq < 0.01) {
      surfNormal = T; // Cap center: normal points along curve direction
    } else {
      // Displacement gradient for normal perturbation
      float epsA = 0.15; // angular step
      float epsY = 0.05;
      float dispA = (cylNoise(angle + epsA, cr * 0.5, ly * 0.3, vec2(1.7, 3.2)) * 0.2
                    + cylNoise(angle + epsA, cr * 0.8, ly * 0.5, vec2(5.1, 8.4)) * 0.1) * smoothstep(0.92, 0.4, t);
      float dispY = (cylNoise(angle, cr * 0.5, (ly + epsY) * 0.3, vec2(1.7, 3.2)) * 0.2
                    + cylNoise(angle, cr * 0.8, (ly + epsY) * 0.5, vec2(5.1, 8.4)) * 0.1) * smoothstep(0.92, 0.4, t);
      float dda = (dispA - disp) / epsA;
      float ddy = (dispY - disp) / epsY;
      surfNormal = normalize(radDir - T * ddy * 0.3 - cross(T, radDir) * dda * 0.3);
    }

    vNormal = normalize(normalMatrix * surfNormal);
    vWorldPos = worldP;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldP, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export const TENTACLE_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <logdepthbuf_pars_fragment>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  uniform vec3 uCameraPos;

  // --- Procedural noise ---
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453123);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // FBM — 4 octaves for richer detail
  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.50 * vnoise(p); p *= 2.01;
    v += 0.25 * vnoise(p); p *= 2.02;
    v += 0.125 * vnoise(p); p *= 2.03;
    v += 0.0625 * vnoise(p);
    return v;
  }

  // World-space UVs compensated for taper so patterns don't stretch
  // radius(t) = mix(1.2, 0.08, pow(t,1.5)) — circumference shrinks toward tip
  // We scale X by radius/baseRadius to keep patterns square in world space
  vec2 worldUv(vec2 uv) {
    float t = uv.y;
    float radius = mix(1.2, 0.35, pow(t, 1.2));
    // X: scale by circumference ratio, Y: scale by length (12m)
    return vec2(uv.x * radius * 6.28, uv.y * 12.0);
  }

  // Heavy vein pattern: thick + thin veins, organically warped
  float veins(vec2 wuv, float t) {
    vec2 veinUv = wuv * vec2(0.8, 0.35);

    // Strong FBM warp for organic irregularity
    float warp = fbm(veinUv * 0.5 + vec2(3.7, 1.2));
    float warp2 = fbm(veinUv * 0.4 + vec2(8.1, 4.6));
    veinUv.x += warp * 1.5;
    veinUv.y += warp2 * 0.8;

    // Thick primary veins — diagonal, not purely longitudinal
    float vein1 = 1.0 - smoothstep(0.0, 0.10, abs(sin(veinUv.x * 2.5 + veinUv.y * 0.7)));
    // Medium secondary veins — opposite diagonal
    float vein2 = 1.0 - smoothstep(0.0, 0.14, abs(sin(veinUv.x * 1.8 - veinUv.y * 0.5 + 1.5)));
    // Fine capillary network
    float vein3 = 1.0 - smoothstep(0.0, 0.06, abs(sin(veinUv.x * 4.0 + veinUv.y * 1.2 + 3.0)));

    float veinMask = max(max(vein1 * 0.8, vein2 * 0.5), vein3 * 0.3);
    veinMask *= smoothstep(0.9, 0.2, t); // fade out toward tip
    return veinMask;
  }

  // Scar pattern: raised ridges across the surface
  float scars(vec2 wuv) {
    vec2 scarUv = wuv * 0.6 + vec2(2.3, 7.1);
    float warp = fbm(scarUv * 0.8 + vec2(13.7, 5.2));
    scarUv += warp * 1.0;

    // Diagonal scar lines (roughly equal X/Y contribution)
    float scar1 = 1.0 - smoothstep(0.0, 0.04, abs(sin(scarUv.x * 1.5 + scarUv.y * 1.2)));
    float scar2 = 1.0 - smoothstep(0.0, 0.05, abs(sin(scarUv.x * 1.1 - scarUv.y * 1.5 + 2.0)));

    // Sparse — only show where hash is high
    float mask1 = step(0.7, hash(floor(scarUv * 0.5)));
    float mask2 = step(0.75, hash2(floor(scarUv * 0.4)));

    return scar1 * mask1 * 0.6 + scar2 * mask2 * 0.4;
  }

  // Dirt/grime patches
  float grime(vec2 wuv, float t) {
    float n1 = fbm(wuv * 0.4 + vec2(11.3, 8.7));
    float n2 = vnoise(wuv * 0.7 + vec2(3.2, 1.4));

    // Dark splotches in recesses
    float dirt = smoothstep(0.35, 0.65, n1) * smoothstep(0.3, 0.6, n2);

    // More grime at base, less at tip
    dirt *= smoothstep(0.8, 0.0, t) * 0.7 + 0.3;
    return dirt;
  }

  void main() {
    float t = vUv.y; // 0 = base, 1 = tip

    // World-space UVs: compensated for taper so patterns stay square
    vec2 wuv = worldUv(vUv);

    // Dark sinister flesh
    vec3 baseColor = vec3(0.22, 0.10, 0.08);  // Very dark reddish-brown
    vec3 midColor  = vec3(0.35, 0.16, 0.13);  // Dark blood-red flesh
    vec3 tipColor  = vec3(0.45, 0.22, 0.18);  // Dark reddish tip

    vec3 color = t < 0.5
      ? mix(baseColor, midColor, t * 2.0)
      : mix(midColor, tipColor, (t - 0.5) * 2.0);

    // --- Veins: thick, prominent, dark ---
    float veinIntensity = veins(wuv, t);
    vec3 veinColor = vec3(0.12, 0.04, 0.06); // Near-black veins
    color = mix(color, veinColor, veinIntensity * 0.7);

    // --- Scars: pale raised tissue ---
    float scarIntensity = scars(wuv);
    vec3 scarColor = vec3(0.40, 0.25, 0.22); // Dark scar tissue
    color = mix(color, scarColor, scarIntensity * 0.5);

    // --- Grime / dirt patches ---
    float grimeIntensity = grime(wuv, t);
    vec3 grimeColor = vec3(0.08, 0.05, 0.04); // Near-black grime
    color = mix(color, grimeColor, grimeIntensity * 0.4);

    // --- Skin texture: bumpy, uneven surface ---
    float skinNoise = fbm(wuv * 0.8 + vec2(5.3, 2.1));
    float skinFine = vnoise(wuv * 1.5 + vec2(1.7, 9.3));
    color *= 0.82 + skinNoise * 0.28 + skinFine * 0.1;

    // --- Lighting: matte, low-gloss ---
    vec3 lightDir = normalize(vec3(-0.5, 1.0, -0.3));

    // Perturb normal with procedural bump
    float bumpStr = 0.12;
    float eps = 0.003;
    vec2 wuvL = worldUv(vUv + vec2(-eps, 0.0));
    vec2 wuvR = worldUv(vUv + vec2( eps, 0.0));
    vec2 wuvD = worldUv(vUv + vec2(0.0, -eps));
    vec2 wuvU = worldUv(vUv + vec2(0.0,  eps));
    float hL = fbm(wuvL * 0.8);
    float hR = fbm(wuvR * 0.8);
    float hD = fbm(wuvD * 0.8);
    float hU = fbm(wuvU * 0.8);
    vec3 bumpN = normalize(vNormal + vec3((hL - hR), (hD - hU), 0.0) * bumpStr / eps);

    // Vein bump
    float vBumpL = veins(wuvL, t);
    float vBumpR = veins(wuvR, t);
    float vBumpD = veins(wuvD, t);
    float vBumpU = veins(wuvU, t);
    bumpN = normalize(bumpN + vec3((vBumpL - vBumpR), (vBumpD - vBumpU), 0.0) * 0.06 / eps);

    float diffuse = max(dot(bumpN, lightDir), 0.0) * 0.5 + 0.4;

    // Very subtle specular — matte/leathery, not wet
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(bumpN, halfDir), 0.0), 16.0) * 0.12;

    // Tiny bit of specular on veins (slightly moist in crevices)
    spec += veinIntensity * 0.05 * pow(max(dot(bumpN, halfDir), 0.0), 12.0);
    spec = max(spec, 0.0);

    // Very subtle greenish rim light (matching tower crystals)
    float rim = pow(1.0 - max(dot(bumpN, viewDir), 0.0), 4.0) * 0.08;
    vec3 rimColor = vec3(0.1, 0.18, 0.08); // Dark green rim

    vec3 finalColor = color * diffuse + vec3(0.9, 0.85, 0.8) * spec + rimColor * rim;

    gl_FragColor = vec4(finalColor, 1.0);

    #include <logdepthbuf_fragment>
  }
`;
