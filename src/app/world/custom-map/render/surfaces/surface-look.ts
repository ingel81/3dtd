import type { DataTexture } from 'three';
import type { DrapeLook } from '../drape/draped-layer';
import { EDGE_REACH, MAX_CELL_EDGES, MAX_SURFACE_RANK } from './surface-geometry';

/** Texels a row of the edge texture (surface-layer.ts SurfaceEdgeStore) */
export const SURFACE_EDGE_WIDTH = 1024;

/**
 * The look of the map's surfaces (surface-layer.ts), drawn by the shader
 * from where a pixel lies in its marking's frame (surface-geometry.ts):
 *
 *   - the material's texture running along the marking (a pitch's grain
 *     along its length), broad blots of older and newer patches;
 *   - the lines of each marking in real measures (map-surfaces.ts courtOf):
 *     a football pitch's boxes, arcs and spots, scaled with a small pitch;
 *     the 6 m and dashed 9 m lines of handball; basketball's three-point
 *     line, key and circles; tennis doubles and singles; volleyball; a
 *     multi-sport court with handball lines in white and a basketball court
 *     in yellow; a running track's lanes round a stadium oval; a car park's
 *     stalls (map-surfaces.ts parkingRows, the same rows); a platform's edge
 *     stone, white line and tactile strip;
 *   - what use leaves: mowing stripes and worn goal mouths on a grass
 *     pitch, a painted key and goal area, oil under the parked cars and the
 *     tyres' tracks along the aisle, paint worn thin;
 *   - the edge: a timber board round loose ground (wood chips, sand,
 *     rubber), a kerb round a hard court or car park, a soft contact shade
 *     everywhere; measured per pixel against the edges listed for its grid
 *     cell (surface-geometry.ts), so a corner stays a corner.
 *
 * Lines thinner than a pixel keep their share of it instead of flickering
 * (surfLine), and the fine detail fades out with distance as on the roads.
 */

const SURFACE_VERTEX_PARS = /* glsl */ `
attribute vec4 aSurfMark;
attribute vec3 aSurfLook;
varying vec4 vSurfMark;
flat varying float vSurfLook;
flat varying float vSurfAngle;
flat varying float vSurfEdges;
`;

const SURFACE_VERTEX = /* glsl */ `
vSurfMark = aSurfMark;
vSurfLook = aSurfLook.x;
vSurfEdges = aSurfLook.y;
vSurfAngle = aSurfLook.z;
`;

const SURFACE_FRAGMENT_PARS = /* glsl */ `
varying vec4 vSurfMark;
flat varying float vSurfLook;
flat varying float vSurfAngle;
flat varying float vSurfEdges;
uniform highp sampler2D uSurfEdges;

// Metres from map point m to the nearest of the edges listed for its cell (ref: start * 8 + count), at most the reach
float surfEdge(vec2 m, float ref) {
  float start = floor(ref / 8.0 + 0.01);
  int count = int(ref - start * 8.0 + 0.5);
  float best = ${EDGE_REACH.toFixed(1)};
  int at = int(start);
  for (int k = 0; k < ${MAX_CELL_EDGES}; k++) {
    if (k >= count) break;
    vec4 e = texelFetch(uSurfEdges, ivec2((at + k) % ${SURFACE_EDGE_WIDTH}, (at + k) / ${SURFACE_EDGE_WIDTH}), 0);
    vec2 d = e.zw - e.xy;
    float t = clamp(dot(m - e.xy, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
    best = min(best, length(e.xy + d * t - m));
  }
  return best;
}

// A line of width w at distance d: 1 on it, soft over a pixel; thinner than a pixel it keeps its share of one
float surfLine(float d, float w, float aa) {
  float ww = max(w, aa * 1.5);
  return (1.0 - smoothstep(ww * 0.5 - aa * 0.5, ww * 0.5 + aa * 0.5, d)) * (w / ww);
}

// Signed distance to a box of half sides h round the origin
float surfBox(vec2 q, vec2 h) {
  vec2 d = abs(q) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float surfFill(float sd, float aa) {
  return 1.0 - smoothstep(-aa, aa, sd);
}

// A football pitch of half sides h (q: the pixel folded into one quarter); its measures shrink with a small pitch
float surfSoccer(vec2 q, vec2 h, float aa, out float wear) {
  float s = clamp(min(h.x / 52.5, h.y / 34.0), 0.3, 1.0);
  float d = abs(surfBox(q, h));
  if (q.y <= h.y) d = min(d, q.x);
  d = min(d, abs(length(q) - 9.15 * s));
  vec2 box = vec2(16.5 * s, min(20.16 * s, h.y - 1.0));
  d = min(d, abs(surfBox(q - vec2(h.x - box.x * 0.5, 0.0), vec2(box.x * 0.5, box.y))));
  vec2 goal = vec2(5.5 * s, min(9.16 * s, box.y - 1.0));
  d = min(d, abs(surfBox(q - vec2(h.x - goal.x * 0.5, 0.0), vec2(goal.x * 0.5, goal.y))));
  vec2 spot = vec2(h.x - 11.0 * s, 0.0);
  if (q.x < h.x - box.x) d = min(d, abs(length(q - spot) - 9.15 * s));
  if (q.x <= h.x && q.y <= h.y) d = min(d, abs(length(q - h) - 1.0));
  float lines = surfLine(d, 0.12, aa);
  lines = max(lines, surfFill(length(q - spot) - 0.11, aa));
  lines = max(lines, surfFill(length(q) - 0.15, aa));
  // Worn in front of the goals, a little round the centre spot
  vec2 mouth = (q - vec2(h.x - 4.0 * s, 0.0)) / vec2(6.0 * s, 4.5 * s);
  vec2 centre = q / vec2(7.0 * s, 5.0 * s);
  wear = exp(-dot(mouth, mouth) * 1.5) + exp(-dot(centre, centre) * 2.0) * 0.45;
  return lines;
}

// Handball: court, centre line, the 6 m line with its goal area, the dashed 9 m line, the 7 m mark
float surfHandball(vec2 q, vec2 h, float aa, out float area) {
  float s = h.x / 20.0;
  float d = abs(surfBox(q, h));
  if (q.y <= h.y) d = min(d, q.x);
  vec2 g = vec2(h.x - q.x, q.y);
  float post = 1.5 * s;
  float off = max(0.0, g.y - post);
  float r = length(vec2(g.x, off));
  float inside = step(0.0, g.x) * step(q.y, h.y);
  d = min(d, mix(1e3, abs(r - 6.0 * s), inside));
  if (g.y <= 0.5 * s) d = min(d, abs(g.x - 7.0 * s));
  float along = g.y <= post ? g.y : post + 9.0 * s * atan(off, max(g.x, 1e-3));
  float dash = step(0.5, fract(along / (0.3 * s)));
  area = surfFill(r - 6.0 * s, aa) * inside;
  return max(surfLine(d, 0.05, aa), surfLine(abs(r - 9.0 * s), 0.05, aa) * dash * inside);
}

// Basketball: court, centre line and circle, three-point line, key and free-throw circle
float surfBasketball(vec2 q, vec2 h, float aa, out float area) {
  float s = h.x / 14.0;
  float d = abs(surfBox(q, h));
  if (q.y <= h.y) d = min(d, q.x);
  d = min(d, abs(length(q) - 1.8 * s));
  float bx = h.x - 1.575 * s;
  float side = h.y - 0.9 * s;
  float r3 = 6.75 * s;
  float meet = bx - sqrt(max(r3 * r3 - side * side, 0.0));
  d = min(d, q.x >= meet ? (q.x <= h.x ? abs(q.y - side) : 1e3) : abs(length(q - vec2(bx, 0.0)) - r3));
  vec2 key = vec2(2.9 * s, 2.45 * s);
  float keyBox = surfBox(q - vec2(h.x - key.x, 0.0), key);
  d = min(d, abs(keyBox));
  vec2 ft = vec2(h.x - 5.8 * s, 0.0);
  if (q.x < ft.x) d = min(d, abs(length(q - ft) - 1.8 * s));
  area = max(surfFill(keyBox, aa), surfFill(length(q) - 1.8 * s, aa));
  return surfLine(d, 0.05, aa);
}

// Tennis: doubles court, singles side lines, service lines and the centre line between them, the centre marks
float surfTennis(vec2 q, vec2 h, float aa) {
  float s = h.x / 11.885;
  float d = abs(surfBox(q, h));
  float singles = 4.115 * s;
  float service = 6.4 * s;
  if (q.x <= h.x) d = min(d, abs(q.y - singles));
  if (q.y <= singles) d = min(d, abs(q.x - service));
  if (q.x <= service || q.x >= h.x - 0.1 * s) d = min(d, q.y);
  return surfLine(d, 0.05, aa);
}

// Volleyball: court, centre line, attack lines 3 m from it
float surfVolleyball(vec2 q, vec2 h, float aa) {
  float s = h.x / 9.0;
  float d = abs(surfBox(q, h));
  if (q.y <= h.y) d = min(d, min(q.x, abs(q.x - 3.0 * s)));
  return surfLine(d, 0.05, aa);
}

// A running track: lanes of 1.22 m round a stadium oval in the rectangle, the finish across the lanes; inside 1 on the infield
float surfTrack(vec2 p, vec2 h, float aa, out float infield) {
  vec2 q = abs(p);
  float big = h.y;
  float a = max(0.0, h.x - big);
  float r = q.x <= a ? q.y : length(vec2(q.x - a, q.y));
  float lanes = clamp(floor(big * 0.4 / 1.22), 1.0, 8.0);
  float outer = big - 0.3;
  float k = (outer - r) / 1.22;
  float onLanes = step(-0.05, k) * step(k, lanes + 0.05);
  float lines = surfLine(abs(k - floor(k + 0.5)) * 1.22, 0.05, aa) * onLanes;
  if (p.y > 0.0) lines = max(lines, surfLine(abs(p.x - a), 0.05, aa) * onLanes);
  infield = 1.0 - smoothstep(outer - lanes * 1.22 - aa, outer - lanes * 1.22 + aa, r);
  return lines;
}

// A car park's stalls (map-surfaces.ts parkingRows): separators in each row, a line where two rows meet back to back.
// stall: 1 inside a stall, id which one and local where in it (-0.5 to 0.5 along, 0 to 1 from the back); aisle: across
// the aisle from its middle, -1 to 1
float surfParking(vec2 p, vec2 h, float aa, out float stall, out vec2 id, out vec2 local, out float aisle) {
  stall = 0.0;
  aisle = 2.0;
  id = vec2(0.0);
  local = vec2(0.0);
  float w = 2.0 * h.y;
  float count = floor(max(0.0, 2.0 * h.x - 2.0) / 2.5);
  if (w < 5.0 || count < 1.0) return 0.0;
  float vv = p.y + h.y;
  float band = w;
  float vb = vv;
  float bandIndex = 0.0;
  bool twoRows = w >= 16.0;
  if (twoRows) {
    band = w / max(1.0, floor(w / 16.0 + 0.5));
    vb = mod(vv, band);
    bandIndex = floor(vv / band);
  }
  bool low = vb <= 5.0;
  bool high = twoRows && vb >= band - 5.0;
  float uu = p.x + count * 1.25;
  float inRun = step(-0.06, uu) * step(uu, count * 2.5 + 0.06);
  float lines = 0.0;
  if (low || high) {
    lines = surfLine(abs(uu - floor(uu / 2.5 + 0.5) * 2.5), 0.12, aa) * inRun;
    stall = step(0.0, uu) * step(uu, count * 2.5);
    id = vec2(floor(uu / 2.5), bandIndex * 2.0 + (high ? 1.0 : 0.0));
    local = vec2(fract(uu / 2.5) - 0.5, high ? (band - vb) / 5.0 : vb / 5.0);
  } else {
    float lo = 5.0;
    float hi = twoRows ? band - 5.0 : w;
    aisle = (vb - (lo + hi) * 0.5) / max((hi - lo) * 0.5, 0.5);
  }
  if (twoRows) lines = max(lines, surfLine(min(vb, band - vb), 0.12, aa) * inRun * step(0.5, vv) * step(vv, w - 0.5));
  return lines;
}
`;

const surfaceSample = (maxLayers: number) => /* glsl */ `
// The look (surface-geometry.ts surfaceLook): layer, marking, rank
float code = floor(vSurfLook + 0.5);
float layer = mod(code, 16.0);
float kind = mod(floor(code / 16.0), 16.0);
int li = min(int(layer), ${maxLayers - 1});
vec2 p = vSurfMark.xy;
vec2 hc = vSurfMark.zw;
float edge = surfEdge(vDrapeMap, vSurfEdges);
// Pixel size in metres for the soft edges of lines; the fine detail fades out once a pixel covers more than a few centimetres
float aa = max(length(vec2(dFdx(p.x), dFdy(p.x))), length(vec2(dFdx(p.y), dFdy(p.y)))) * 0.75 + 1e-4;
float near = 1.0 - smoothstep(0.04, 0.12, aa);

// The material, along the marking (x across, y along)
vec4 rc;
vec4 rd;
if (layer < uDrapeLayers) {
  drapeLookup(vec2(p.y, p.x), layer, uDrapeInvScale[li], near, rc, rd);
} else {
  rc = vec4(uDrapeAverage[li], 0.5);
  rd = vec4(0.5, 0.5, 0.8, 1.0);
}
vec3 albedo = rc.rgb;
float rough = rd.b;
float ao = mix(1.0, rd.a, 0.8);
vec2 nxy = (rd.xy * 2.0 - 1.0) * vec2(1.2, -1.2);
bool grassy = uDrapeGrass[li] > 0.5;
bool paved = uDrapePaved[li] > 0.5;

// Broad tone: slow blots of older and newer patches of it
float blot = valueNoise(vDrapeMap * 0.045 + layer) * 0.6 + valueNoise(vDrapeMap * 0.17) * 0.4;
albedo *= mix(0.92, 1.08, blot);

float paint = 0.0;
float paint2 = 0.0;
float area = 0.0;
vec2 q = abs(p);
if (kind > 0.5 && kind < 1.5) {
  float wear;
  paint = surfSoccer(q, hc, aa, wear);
  if (grassy) {
    // Mowing stripes across the pitch, every few metres, and the turf worn to earth in front of the goals
    float stripe = max(hc.x / 9.0, 2.5);
    float mow = smoothstep(-aa * 3.0, aa * 3.0, sin(p.x * 3.14159 / stripe)) * step(q.x, hc.x + 2.0) * step(q.y, hc.y + 2.0);
    albedo *= mix(0.93, 1.07, mow);
    float breakup = valueNoise(vDrapeMap * 0.7) * 0.5 + valueNoise(vDrapeMap * 2.3) * 0.3 + valueNoise(vDrapeMap * 7.9) * 0.2;
    float bare = smoothstep(0.5, 1.0, wear * (0.3 + breakup * 1.1));
    float thin = smoothstep(0.25, 0.8, wear * (0.3 + breakup * 1.1));
    albedo = mix(albedo, albedo * vec3(1.12, 1.05, 0.78), thin * 0.6);
    albedo = mix(albedo, vec3(0.3, 0.24, 0.16) * mix(0.8, 1.1, breakup), bare * 0.7);
    rough = mix(rough, 0.95, bare);
  }
} else if (kind < 2.5 && kind > 1.5) {
  paint = surfHandball(q, hc, aa, area);
  albedo *= mix(vec3(1.0), vec3(0.8, 0.86, 0.98), area * 0.8);
} else if (kind < 3.5 && kind > 2.5) {
  paint = surfBasketball(q, hc, aa, area);
  albedo *= mix(vec3(1.0), vec3(0.8, 0.68, 0.62), area * 0.8);
} else if (kind < 4.5 && kind > 3.5) {
  paint = surfTennis(q, hc, aa);
} else if (kind < 5.5 && kind > 4.5) {
  paint = surfVolleyball(q, hc, aa);
} else if (kind < 6.5 && kind > 5.5) {
  // Handball lines on the whole court in white, a basketball court in it in yellow
  paint = surfHandball(q, hc, aa, area);
  float fit = min(1.0, min((hc.x * 2.0 - 2.0) / 28.0, (hc.y * 2.0 - 2.0) / 15.0));
  float none;
  paint2 = surfBasketball(q, vec2(14.0, 7.5) * max(fit, 0.1), aa, none);
} else if (kind < 7.5 && kind > 6.5) {
  float infield;
  paint = surfTrack(p, hc, aa, infield);
  if (!grassy) {
    // The infield a lawn, where no pitch of its own lies over it: grass in clumps at three sizes, mown in stripes
    float tuft = valueNoise(vDrapeMap * 7.3) * 0.3 + valueNoise(vDrapeMap * 1.9) * 0.4 + valueNoise(vDrapeMap * 0.37) * 0.3;
    float mown = smoothstep(-aa * 3.0, aa * 3.0, sin(p.x * 3.14159 / max(hc.x / 9.0, 2.5)));
    vec3 lawn = mix(vec3(0.08, 0.15, 0.04), vec3(0.19, 0.29, 0.09), tuft) * mix(0.93, 1.07, mown);
    albedo = mix(albedo, lawn, infield);
    rough = mix(rough, 0.92, infield);
    nxy *= 1.0 - infield * 0.8;
  }
} else if (kind < 8.5 && kind > 7.5) {
  float stall;
  vec2 id;
  vec2 local;
  float aisle;
  paint = surfParking(p, hc, aa, stall, id, local, aisle);
  // Oil where the engines stood, under the front half of the car, on some stalls more than on others
  float oil = hash12(id + 17.0);
  vec2 blotAt = vec2(local.x / 0.22, (local.y - 0.35 - (hash12(id + 3.0) - 0.5) * 0.2) / 0.16);
  float stain = stall * step(0.35, oil) * exp(-dot(blotAt, blotAt)) * (0.55 + 0.45 * valueNoise(vDrapeMap * 4.0));
  albedo *= 1.0 - stain * mix(0.2, 0.45, oil) * near;
  rough = mix(rough, 0.45, stain * near);
  // The tyres' tracks along the aisle, two darker bands either side of its middle
  float tracks = exp(-pow((abs(aisle) - 0.42) / 0.14, 2.0));
  albedo *= 1.0 - tracks * 0.12 * (0.6 + 0.4 * valueNoise(vec2(p.x * 0.2, p.y)));
} else if (kind < 9.5 && kind > 8.5) {
  // A platform: the edge stone along both long sides, the white line behind it, the ribbed tactile strip
  float fromEdge = hc.y - q.y;
  float onLength = step(q.x, hc.x);
  float stone = (1.0 - smoothstep(0.35 - aa, 0.35 + aa, fromEdge)) * onLength;
  float joint = surfLine(abs(fract(p.x) - 0.5) * 1.0, 0.012, aa) * stone * near;
  albedo = mix(albedo, vec3(0.42, 0.41, 0.38) * mix(0.9, 1.06, valueNoise(vec2(p.x * 1.3, 3.0))), stone);
  albedo = mix(albedo, vec3(0.08), max(joint, surfLine(abs(fromEdge - 0.35), 0.015, aa) * onLength * near) * 0.7);
  paint = surfLine(abs(fromEdge - 0.8), 0.12, aa) * onLength;
  float tactile = (smoothstep(0.92 - aa, 0.92 + aa, fromEdge) - smoothstep(1.22 - aa, 1.22 + aa, fromEdge)) * onLength;
  float rib = sin((fromEdge - 0.92) * 6.2832 / 0.06);
  albedo = mix(albedo, vec3(0.52, 0.51, 0.48) * (0.92 + 0.08 * rib * near), tactile);
  nxy = mix(nxy, vec2(rib * 0.6 * near, 0.0), tactile);
  rough = mix(rough, 0.7, tactile);
}

// Paint, a little worn and dusted; the second set (a multi-sport court's basketball) in yellow
float worn = valueNoise(vec2(p.x * 1.9, p.y * 2.3)) * 0.6 + 0.2;
if (near > 0.0) worn += (valueNoise(vDrapeMap * 9.0) - 0.5) * 0.3 * near;
float keep = smoothstep(0.1, 0.55, worn + 0.25);
paint *= keep;
paint2 *= keep * (1.0 - paint);
albedo = mix(albedo, vec3(0.83, 0.83, 0.79), paint * 0.92);
albedo = mix(albedo, vec3(0.86, 0.66, 0.12), paint2 * 0.9);
float painted = max(paint, paint2);
rough = mix(rough, 0.55, painted);
nxy *= 1.0 - painted * 0.7;

// The edge: a timber board round loose ground, a kerb round a hard court or car park, a soft contact shade
bool hardCourt = paved && kind > 0.5 && kind < 6.5;
if (!grassy && !paved) {
  float board = 1.0 - smoothstep(0.12 - aa, 0.12 + aa, edge);
  float grain = valueNoise(vec2((p.x + p.y) * 4.0, edge * 40.0)) * 0.5 + valueNoise(vDrapeMap * 0.6) * 0.5;
  albedo = mix(albedo, vec3(0.34, 0.25, 0.16) * mix(0.75, 1.15, grain), board);
  rough = mix(rough, 0.85, board);
  ao *= mix(1.0, 0.75, (1.0 - smoothstep(0.12, 0.35, edge)) * (1.0 - board));
} else if (hardCourt || (kind > 7.5 && kind < 8.5)) {
  float kerb = 1.0 - smoothstep(0.15 - aa, 0.15 + aa, edge);
  albedo = mix(albedo, vec3(0.44, 0.43, 0.41) * mix(0.9, 1.05, valueNoise(vec2((p.x + p.y) * 0.9, 4.0))), kerb);
  albedo *= 1.0 - (1.0 - smoothstep(0.15, 0.2 + aa, edge)) * (1.0 - kerb) * 0.4;
  rough = mix(rough, 0.8, kerb);
}
ao *= mix(0.86, 1.0, smoothstep(0.0, 0.6, edge));

diffuseColor.rgb *= albedo;
// The frame of the marking: along and across in the scene (x = -map x), the normal from the terrain's grid
vec3 surfUp = normalize(vDrapeNormal);
vec3 surfT = normalize(vec3(-cos(vSurfAngle), 0.0, sin(vSurfAngle)));
vec3 surfB = normalize(cross(surfUp, surfT));
surfT = cross(surfB, surfUp);
float drapeRough = rough;
float drapeAO = ao;
vec3 drapeNormal = normalize(surfUp + surfB * nxy.x + surfT * nxy.y);
`;

/** How far a surface is drawn towards the camera: under every road (ROAD_PULL), the smaller of two over the larger */
const SURFACE_PULL = { base: 0.01, perMetre: 0.0039, rank: 0.002, rankPerMetre: 0.000006 };

/** The surfaces' part of their draped material; `edges` the edge texture's uniform */
export function surfaceLook(maxLayers: number, edges: { value: DataTexture | null }): DrapeLook {
  return {
    uniforms: { uSurfEdges: edges },
    key: 'custom-map-surfaces-1',
    vertexPars: SURFACE_VERTEX_PARS,
    vertex: SURFACE_VERTEX,
    rank: `min(floor((aSurfLook.x + 0.5) / 256.0), ${MAX_SURFACE_RANK.toFixed(1)})`,
    pull: SURFACE_PULL,
    fragmentPars: SURFACE_FRAGMENT_PARS,
    fragment: surfaceSample(maxLayers),
  };
}
