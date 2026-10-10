/**
 * Shaders of the menu globe (docs/GLOBE_PLAN.md, Rendering).
 *
 * Everything is drawn without a depth buffer, in a fixed order: stars, sun,
 * earth, atmosphere rim. The earth is convex and drawn with its front faces
 * only, so it covers what lies behind it; the rim discards where its ray
 * meets the planet. That spares the precision trouble of a depth buffer
 * over earth radii.
 *
 * The earth shader does the whole surface in one pass: day (with up to four
 * sharp region tiles over the global texture), relief, water glint, clouds
 * as a layer (no parallax is seen from the globe's heights), cloud shadows,
 * city lights on the night side, and the atmosphere in front of the ground
 * (single scattering, Rayleigh and Mie). The rim shell adds the sky around
 * the planet. Scattering runs in kilometres in "sphere space", the
 * ellipsoid stretched along z into a sphere of the equatorial radius.
 */

/** Rayleigh and Mie single scattering, shared by the earth and the rim */
const SCATTER = /* glsl */ `
const float PI = 3.14159265;
const float RP = 6378.137;
const float RA = 6478.137;
const float SPHERE_Z = 1.0033640898;
const vec3 BETA_R = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const float BETA_M = 21e-3;
const float HR = 8.0;
const float HM = 1.2;
const float MIE_G = 0.76;

uniform float sunIntensity;
uniform int scatterSteps;

vec3 toSphere(vec3 ecef) {
  return vec3(ecef.xy, ecef.z * SPHERE_Z) * 0.001;
}

vec2 raySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 transmittance(vec2 od) {
  return exp(-(BETA_R * od.x + BETA_M * 1.1 * od.y));
}

/**
 * Optical depth (Rayleigh, Mie) from p towards the sun; huge in the planet's
 * shadow. Steps grow quadratically: the air is densest at p.
 */
vec2 lightDepth(vec3 p, vec3 l) {
  if (raySphere(p, l, RP).x > 0.0) return vec2(1e4);
  float len = raySphere(p, l, RA).y;
  vec2 od = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    float a = float(j) / 4.0;
    float b = float(j + 1) / 4.0;
    float m = (float(j) + 0.5) / 4.0;
    float h = max(length(p + l * len * m * m) - RP, 0.0);
    od += vec2(exp(-h / HR), exp(-h / HM)) * len * (b * b - a * a);
  }
  return od;
}

void gather(vec3 p, float ds, vec3 l, inout vec2 od, inout vec3 sumR, inout vec3 sumM) {
  float h = max(length(p) - RP, 0.0);
  vec2 dens = vec2(exp(-h / HR), exp(-h / HM)) * ds;
  od += dens;
  vec3 att = transmittance(od + lightDepth(p, l));
  sumR += dens.x * att;
  sumM += dens.y * att;
}

/** Light scattered towards the eye along o + d t up to tMax, and what gets through */
void scatter(vec3 o, vec3 d, float tMax, vec3 l, float jitter, out vec3 inscatter, out vec3 through) {
  inscatter = vec3(0.0);
  through = vec3(1.0);
  vec2 ta = raySphere(o, d, RA);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  if (t1 <= t0) return;
  // The air is densest where the ray comes closest to the centre (the ground
  // for a ray that meets it): the steps shrink quadratically towards there
  float tc = clamp(-dot(o, d), t0, t1);
  float la = tc - t0;
  float lb = t1 - tc;
  int na = int(floor(float(scatterSteps) * la / max(la + lb, 1e-6) + 0.5));
  if (la > 0.0) na = max(na, 1);
  if (lb > 0.0) na = min(na, scatterSteps - 1);
  int nb = scatterSteps - na;
  vec2 od = vec2(0.0);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= na) break;
    float v0 = 1.0 - float(i) / float(na);
    float v1 = 1.0 - float(i + 1) / float(na);
    float vm = 1.0 - (float(i) + jitter) / float(na);
    gather(o + d * (tc - la * vm * vm), la * (v0 * v0 - v1 * v1), l, od, sumR, sumM);
  }
  for (int i = 0; i < 24; i++) {
    if (i >= nb) break;
    float v0 = float(i) / float(nb);
    float v1 = float(i + 1) / float(nb);
    float vm = (float(i) + jitter) / float(nb);
    gather(o + d * (tc + lb * vm * vm), lb * (v1 * v1 - v0 * v0), l, od, sumR, sumM);
  }
  float mu = dot(d, l);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = MIE_G * MIE_G;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));
  inscatter = sunIntensity * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
  through = transmittance(od);
}

/** Interleaved gradient noise: a per-pixel offset that turns banding into fine grain */
float ign(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}
`;

export const EARTH_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const EARTH_FRAGMENT = /* glsl */ `
${SCATTER}
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D reliefMap;
uniform vec2 reliefTexel;
uniform sampler2D region0;
uniform sampler2D region1;
uniform sampler2D region2;
uniform sampler2D region3;
uniform vec4 regionRect[4];
uniform vec4 regionOn;
uniform vec3 sunDir;
uniform vec3 camPos;
uniform float cloudShift;
uniform float cloudCover;
uniform vec3 holeDir;
uniform float holeRadius;
uniform float nightGain;
uniform float nightAmbient;
uniform float bumpScale;
varying vec2 vUv;
varying vec3 vPos;

const float A = 6378137.0;
const float B = 6356752.314245;

void blendRegion(sampler2D tex, vec4 rect, float on, vec2 gx, vec2 gy, inout vec3 color, inout float water) {
  if (on < 0.5) return;
  vec2 size = rect.zw - rect.xy;
  vec2 local = (vUv - rect.xy) / size;
  if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0) return;
  float edge = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  float w = smoothstep(0.0, 0.04, edge) * on;
  vec4 r = textureGrad(tex, local, gx / size, gy / size);
  color = mix(color, r.rgb, w);
  water = mix(water, r.a, w);
}

void main() {
  vec3 n = normalize(vec3(vPos.xy / (A * A), vPos.z / (B * B)));
  vec3 l = normalize(sunDir);
  vec3 toEye = camPos - vPos;
  vec3 v = normalize(toEye);
  vec2 gx = dFdx(vUv);
  vec2 gy = dFdy(vUv);

  vec3 day = texture2D(dayMap, vUv).rgb;
  vec4 relief = texture2D(reliefMap, vUv);
  float water = relief.a;
  blendRegion(region0, regionRect[0], regionOn.x, gx, gy, day, water);
  blendRegion(region1, regionRect[1], regionOn.y, gx, gy, day, water);
  blendRegion(region2, regionRect[2], regionOn.z, gx, gy, day, water);
  blendRegion(region3, regionRect[3], regionOn.w, gx, gy, day, water);

  // Relief: the normal tilted by the height's slope east and north
  vec3 east = normalize(vec3(-vPos.y, vPos.x, 0.0) + vec3(1e-3, 0.0, 0.0));
  vec3 north = cross(n, east);
  float cosLat = max(length(vPos.xy) / A, 0.05);
  float hE = texture2D(reliefMap, vUv + vec2(reliefTexel.x, 0.0)).r - relief.r;
  float hS = texture2D(reliefMap, vUv + vec2(0.0, reliefTexel.y)).r - relief.r;
  float metresE = 6.2831853 * A * cosLat * reliefTexel.x;
  float metresN = 3.1415927 * A * reliefTexel.y;
  vec3 nb = normalize(n - bumpScale * (hE / metresE * east - hS / metresN * north) * (1.0 - water));

  // Clouds: drifting, thinned out over the place the dive goes to
  vec2 cloudUv = vUv + vec2(cloudShift, 0.0);
  float hole = smoothstep(holeRadius * 0.5, holeRadius, acos(clamp(dot(n, holeDir), -1.0, 1.0)));
  float cloud = smoothstep(0.08, 0.85, texture2D(nightMap, cloudUv).a) * cloudCover * hole;
  vec2 shadowShift = vec2(dot(l, east) / (6.2831853 * cosLat), -dot(l, north) / 3.1415927) * 0.0015;
  float shadow = smoothstep(0.08, 0.85, texture2D(nightMap, cloudUv + shadowShift).a) * cloudCover * hole;

  // Sunlight on the ground, reddened by the air it came through
  vec3 ps = toSphere(vPos);
  vec3 ls = normalize(vec3(l.xy, l.z * SPHERE_Z));
  // Lambert: radiance albedo E / pi, the same sun that lights the air
  vec3 sunAtGround = sunIntensity / PI * transmittance(lightDepth(ps * 1.00002, ls));
  float ndl = dot(n, l);
  float lit = smoothstep(-0.06, 0.2, ndl);
  float diffuse = max(dot(nb, l), 0.0);

  vec3 ground = day * sunAtGround * diffuse * lit * (1.0 - 0.5 * shadow);
  vec3 h = normalize(l + v);
  float ndh = max(dot(n, h), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  float glint = (pow(ndh, 400.0) * 2.0 + pow(ndh, 60.0) * 0.08) * (0.3 + fresnel);
  ground += sunAtGround * water * glint * lit * (1.0 - shadow);

  vec3 cloudLit = sunAtGround * (0.25 + 0.75 * max(ndl, 0.0)) * smoothstep(-0.12, 0.12, ndl);
  vec3 color = mix(ground, cloudLit, cloud);

  // City lights past the dusk, dimmed under clouds; a trace of moonlight on the night side
  float dark = 1.0 - smoothstep(-0.16, 0.05, ndl);
  color += mix(day, vec3(0.5), cloud) * vec3(0.5, 0.6, 0.85) * nightAmbient * dark;
  vec3 lights = texture2D(nightMap, vUv).rgb;
  color += lights * lights * nightGain * dark * (1.0 - 0.75 * cloud);

  // The air between the eye and the ground
  vec3 os = toSphere(camPos);
  vec3 ds = normalize(ps - os);
  vec3 inscatter;
  vec3 through;
  scatter(os, ds, length(ps - os), ls, ign(gl_FragCoord.xy), inscatter, through);
  color = color * through + inscatter;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const RIM_VERTEX = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIM_FRAGMENT = /* glsl */ `
${SCATTER}
uniform vec3 sunDir;
uniform vec3 camPos;
uniform float rimGain;
varying vec3 vPos;

void main() {
  vec3 os = toSphere(camPos);
  vec3 ds = normalize(toSphere(vPos) - os);
  // The earth shader draws the air in front of the ground
  if (raySphere(os, ds, RP).x > 0.0) discard;
  vec3 l = normalize(sunDir);
  vec3 ls = normalize(vec3(l.xy, l.z * SPHERE_Z));
  vec3 inscatter;
  vec3 through;
  scatter(os, ds, 1e9, ls, ign(gl_FragCoord.xy), inscatter, through);
  float alpha = 1.0 - (through.r + through.g + through.b) / 3.0;
  gl_FragColor = vec4(inscatter * rimGain, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const STAR_VERTEX = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float pixelRatio;
uniform float starGain;
void main() {
  vColor = color * starGain;
  vec4 view = modelViewMatrix * vec4(position, 0.0);
  vec4 clip = projectionMatrix * vec4(view.xyz, 1.0);
  // At infinity: the camera's position does not move the stars
  clip.z = clip.w * 0.9999;
  gl_Position = clip;
  gl_PointSize = size * pixelRatio;
}
`;

export const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = exp(-r * 4.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export const SUN_VERTEX = /* glsl */ `
uniform vec3 sunDir;
uniform float size;
varying vec2 vCoord;
void main() {
  vCoord = position.xy;
  vec4 view = viewMatrix * vec4(sunDir, 0.0);
  vec4 clip = projectionMatrix * vec4(view.xyz, 1.0);
  clip.xy += position.xy * size * clip.w * vec2(projectionMatrix[0][0] / projectionMatrix[1][1], 1.0);
  clip.z = clip.w * 0.9998;
  gl_Position = clip;
}
`;

export const SUN_FRAGMENT = /* glsl */ `
uniform float glow;
varying vec2 vCoord;
void main() {
  float r = length(vCoord);
  float disc = smoothstep(0.045, 0.035, r);
  float halo = exp(-r * 14.0) * 0.18 + exp(-r * 45.0) * 0.7;
  vec3 color = vec3(1.0, 0.95, 0.85) * (disc * 90.0 + halo * glow);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
