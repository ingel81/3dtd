/**
 * The GLSL of a ruin's damage (ruin-damage.ts): the varyings, the collapse
 * that tips and sinks a fallen building, the holes and cracks punched into
 * its walls, the soot, plaster and core of its broken faces, their depth
 * and glow.
 */
import { CRACK_TILE_M } from './crack-texture';

/** How much nearer a ruin's back faces are drawn, in units of logDepthBufFC (log2 of the relative distance over two) */
const BACK_PULL = '1.5e-5';

/** Holes punched (their highest order) past the first two after which a ruin is worn down to the ground */
const WORN_OUT = 12;

/** Seconds the column over a large hole takes to come down */
const SAG_SECONDS = 2;

/** A cave-in: the seconds its foot gives (with a shudder), how heavily it falls then (m/s², drop = g t²), its seconds at most */
export const CAVE_HOLD = 0.35;
const CAVE_FALL = 2.6;
export const CAVE_SECONDS = 4.5;

/** The stump in aDamageB.w over the bite's radius (under 8 m): steps of 1/64 m, times 8 */
export const STUMP_STEPS = 64;
export const BITE_SPAN = 8;

export const VARYINGS = /* glsl */ `
varying vec3 vDmgP;
varying float vDmgSide;
varying vec4 vDmg;
varying vec4 vDmgB;
varying vec4 vDmgC;
varying float vDmgFall;
#ifdef DMG_SLAB
varying vec2 vDmgAxis;
#endif
`;

/** What the vertex and fragment shaders both know of a collapse: its variant (uCollapse) and how long it takes */
const COLLAPSE_PARS = /* glsl */ `
uniform float uCollapse;
// What writeDamage packs: the roll past the stage, the stump over the bite's radius, the top in place of the seconds
float dmgRollOf(vec4 a) {
  return fract(a.x) * 4.0;
}
float dmgBiteR(vec4 b) {
  return mod(b.w, ${BITE_SPAN.toFixed(1)});
}
float dmgSeat(vec4 a, vec4 b) {
  return a.w - floor(b.w / ${BITE_SPAN.toFixed(1)}) / ${STUMP_STEPS.toFixed(1)};
}
// fallSeconds
float dmgFallS(vec4 a, vec4 b, vec4 c) {
  return clamp(1.2 + (c.w - dmgSeat(a, b)) * 0.06, 1.2, 2.5);
}
// Whether this ruin tips (fallsAsTower), and its reach (the sign is the tower's flag)
bool dmgTower(vec4 c) {
  return uCollapse > 1.5 ? false : uCollapse > 0.5 ? true : c.z < 0.0;
}
float dmgReach(vec4 c) {
  return abs(c.z);
}
// collapseSeconds
float damageDuration(vec4 a, vec4 b, vec4 c) {
  return dmgTower(c) ? dmgFallS(a, b, c) : ${CAVE_SECONDS.toFixed(2)};
}
float dmgHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float dmgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dmgHash(i), dmgHash(i + vec2(1.0, 0.0)), f.x), mix(dmgHash(i + vec2(0.0, 1.0)), dmgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Noise round a middle by the direction to it (a unit vector), k cells a radian: smooth all round. An angle round the
// vertical had a seam behind the middle, and on a wall through it swept half a turn within a few centimetres, its
// teeth a fan of slivers thinner than a pixel that flickered as the camera moved
float dmgRound(vec3 u, float k, vec2 shift) {
  return dmgNoise(vec2(u.x + 0.6 * u.y, u.z - 0.8 * u.y) * k + shift);
}
uniform sampler2D uRuinHoles;
// What writeDamage packs into the heading: the ruin's row in RUIN_HOLES (-1 none), and the heading itself
float dmgHoleRow(vec4 a) {
  return floor((a.z + 4.0) / 8.0) - 1.0;
}
float dmgHeading(vec4 a) {
  return a.z - 8.0 * floor((a.z + 4.0) / 8.0);
}
// A row's holes, HOLE_SLOTS at most (a uniform, so the loop over them stays a loop: unrolled, its body six times
// over made each ruin program slow to translate, E274)
uniform int uHoleSlots;
// What one pass over a ruin's holes at a point found (dmgScanHoles)
struct DmgHoleScan {
  // Metres outside the holes (negative inside), a little wider than high, the rims ragged; 1e3 without (edges only)
  float edge;
  // The column over a large hole p lies in: when it starts to come down (-1 for none) and the floor it comes onto
  float sagStart;
  float sagFloor;
  // How low the break line dips to the holes at p, and the holes punched (their highest order)
  float dip;
  float punched;
};
// One pass over the ruin's holes at p, in order up to the first empty slot (RuinHoles fills a row from the left).
// Each opens as it is hit, its rim ragged by angle and height (edges). Over a large hole (2.2 m and more) a ragged
// column (0.85 its radius at the hole, narrowing up, ragged round and up it), from 0.4 to 2 or 2.9 radii over its
// middle, comes down onto the floor under it (sag)
DmgHoleScan dmgScanHoles(vec3 p, vec4 a, bool edges, bool sag) {
  DmgHoleScan s = DmgHoleScan(1e3, -1.0, 0.0, 1e3, 0.0);
  float row = dmgHoleRow(a);
  if (row < 0.0) return s;
  int y = int(row);
  for (int k = 0; k < uHoleSlots; k++) {
    vec4 h = texelFetch(uRuinHoles, ivec2(k * 2, y), 0);
    if (h.w <= 0.0) break;
    vec4 t = texelFetch(uRuinHoles, ivec2(k * 2 + 1, y), 0);
    s.dip = min(s.dip, h.y - 0.6 * h.w + 0.7 * length(p.xz - h.xz));
    s.punched = max(s.punched, t.z);
    if (edges) {
      vec3 q = p - h.xyz;
      vec3 u = q / max(length(q), 1e-4);
      float jag = dmgRound(u, 2.6, vec2(t.y, q.y * 0.9)) * 0.55 + dmgRound(u, 9.0, vec2(t.y, q.y * 3.1)) * 0.25;
      float open = smoothstep(0.0, 0.3, uDamageTime - t.x);
      s.edge = min(s.edge, length(q * vec3(1.0, 1.25, 1.0)) - h.w * open * (0.7 + jag));
    }
    if (sag && s.sagStart < 0.0 && h.w >= 2.2) {
      vec2 q = p.xz - h.xz;
      // Ragged round it and up it, narrowing to the top: no cylinder
      vec3 u = vec3(q.x, 0.0, q.y) / max(length(q), 1e-4);
      float up = (p.y - h.y) / h.w;
      float reach = h.w * (0.85 - 0.15 * up) * (0.65 + 0.45 * dmgRound(u, 1.7, vec2(0.0, p.y * 0.35 + t.y)) + 0.2 * dmgRound(u, 5.3, vec2(0.0, p.y * 1.3)));
      float top = 2.0 + 0.9 * dmgNoise(p.xz * 0.45 + t.y);
      if (length(q) < reach && up > 0.4 && up < top) {
        s.sagFloor = h.y - h.w * 0.5;
        s.sagStart = t.x + 0.25;
      }
    }
  }
  return s;
}
// A break line worn by the holes (a scan's dip and punched): it dips to each (where it was hit it gives way first),
// and the more holes were punched, the lower all of it, down to the ground after WORN_OUT of them: a ruin under fire
// wears away to its rubble
float dmgWorn(float cut, DmgHoleScan s, vec4 a, vec4 b) {
  float seat = dmgSeat(a, b);
  cut = min(cut, max(seat + 0.05, s.dip));
  return seat + (cut - seat) * clamp(1.0 - (s.punched - 2.0) / ${WORN_OUT.toFixed(1)}, 0.0, 1.0);
}
// cave-in: the break line, low ragged stumps inside rising steeply to the walls (6 m and a quarter of the height
// over the seat at most), those on the side of the hit (against the heading) lower, dipping to the holes; its rim
// ragged by angle only, so nothing stays standing as an island
float dmgCaveCut(vec3 p, vec4 a, vec4 b, vec4 c, DmgHoleScan holes) {
  float seat = dmgSeat(a, b);
  float roll = dmgRollOf(a) * 17.0;
  vec2 off = p.xz - c.xy;
  float dist = length(off);
  vec2 dir = off / max(dist, 1e-3);
  float r = dist / max(dmgReach(c), 1.0);
  float rn = r + (dmgNoise(dir * 0.9 + 10.0 + roll) - 0.5) * 0.45 + (dmgNoise(dir * 3.5 + 20.0 + roll) - 0.5) * 0.06;
  float stump = max(1.2, a.w - seat);
  float cut = seat + max(1.2, stump * (0.25 + 1.0 * dmgNoise(p.xz / 4.0 + roll) + 0.35 * dmgNoise(p.xz / 1.1 + roll * 2.0)));
  float outer = max(0.0, (rn - 0.55) / 0.4);
  float away = 0.55 + 0.45 * dot(dir, vec2(cos(dmgHeading(a)), sin(dmgHeading(a))));
  float walls = min(c.w - seat, 6.0 + 0.25 * (c.w - seat));
  cut += outer * outer * walls * away;
  return dmgWorn(cut, holes, a, b);
}
// cave-in: where a falling part comes to rest, the highest floor (a storey of 3 m) under the break line, through up
// to two of them in patches of 4 m; else the ground
float dmgCaveLanding(vec3 p, float cut, vec4 a, vec4 b, vec4 c) {
  float seat = dmgSeat(a, b);
  float k = floor((min(cut, p.y) - seat - 0.2) / 3.0);
  k = min(k, floor((c.w - seat - 1.2) / 3.0));
  k -= floor(dmgHash(floor(p.xz / 4.0) + dmgRollOf(a) * 31.0) * 2.5);
  return k >= 1.0 ? seat + k * 3.0 : seat;
}
`;

/** Attributes, the fall in each collapse variant and what the fragment needs */
export const DAMAGE_VERTEX_PARS = /* glsl */ `
attribute vec4 aDamage;
attribute vec4 aDamageB;
attribute vec4 aDamageC;
uniform float uDamageTime;
${COLLAPSE_PARS}
${VARYINGS}
vec3 dmgAt(vec2 xz, float y) {
  return vec3(xz.x, y, xz.y);
}
mat4 dmgShift(vec3 v) {
  return mat4(vec4(1.0, 0.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(v, 1.0));
}
// Turning by th about the level line across d through the pivot: the top towards d (k = up x d)
mat4 dmgTip(vec3 pivot, vec2 d, float th) {
  vec3 k = vec3(d.y, 0.0, -d.x);
  float c = cos(th);
  float s = sin(th);
  float ic = 1.0 - c;
  mat3 r = mat3(
    c + k.x * k.x * ic, k.y * k.x * ic + k.z * s, k.z * k.x * ic - k.y * s,
    k.x * k.y * ic - k.z * s, c + k.y * k.y * ic, k.z * k.y * ic + k.x * s,
    k.x * k.z * ic + k.y * s, k.y * k.z * ic - k.x * s, c + k.z * k.z * ic);
  return mat4(vec4(r[0], 0.0), vec4(r[1], 0.0), vec4(r[2], 0.0), vec4(pivot - r * pivot, 1.0));
}
// tip: whole about the foot of the side it gives way to, sinking as it goes
mat4 dmgFallTip(float t) {
  vec2 d = vec2(cos(dmgHeading(aDamage)), sin(dmgHeading(aDamage)));
  vec3 pivot = dmgAt(aDamageC.xy + d * dmgReach(aDamageC), aDamage.w);
  return dmgShift(vec3(0.0, -2.5 * t * t, 0.0)) * dmgTip(pivot, d, 1.4 * t * t);
}
// cave-in: what stands above the break line falls as one (one motion: no triangle stretches): the foot gives a
// quarter metre with a shudder, then it comes down heavily, straight and a little inwards, until it reaches where it
// lands (dmgCaveLanding) and is gone (vDmgFall 0: the fragment draws it only while every corner falls)
vec3 dmgCaveFall(vec3 p, float s, DmgHoleScan holes) {
  float cut = dmgCaveCut(p, aDamage, aDamageB, aDamageC, holes);
  if (p.y <= cut) return p;
  float give = smoothstep(0.0, ${CAVE_HOLD.toFixed(2)}, s);
  float f = max(0.0, s - ${CAVE_HOLD.toFixed(2)});
  float drop = 0.25 * give + 0.03 * sin(s * 47.0) * (1.0 - give) + ${CAVE_FALL.toFixed(2)} * f * f;
  if (p.y - drop < dmgCaveLanding(p, cut, aDamage, aDamageB, aDamageC) + 0.3) return p;
  vDmgFall = 1.0;
  vec2 inward = (aDamageC.xy - p.xz) * min(0.25, 0.08 * f);
  return p + vec3(inward.x, -drop, inward.y);
}
// Holed (stage 1 and 2): the column over a large hole comes down until it reaches the floor under the hole
vec3 dmgSag(vec3 p, DmgHoleScan holes) {
  if (holes.sagStart < 0.0) return p;
  float f = uDamageTime - holes.sagStart;
  if (f <= 0.0 || f >= ${SAG_SECONDS.toFixed(1)}) return p;
  float drop = ${CAVE_FALL.toFixed(2)} * f * f;
  if (p.y - drop < holes.sagFloor + 0.3) return p;
  vDmgFall = 1.0;
  return p - vec3(0.0, drop, 0.0);
}
// Where a point of the ruin is drawn (group frame): at rest, or as it falls
vec3 damageMove(vec3 p) {
  if (aDamage.x < 0.5) return p;
  float s = uDamageTime - aDamage.y;
  bool holed = aDamage.x < 2.5;
  if (holed || !dmgTower(aDamageC)) {
    // A cave-in moves only while it falls; one scan of the holes for both
    if (!holed && (s <= 0.0 || s >= ${CAVE_SECONDS.toFixed(2)})) return p;
    DmgHoleScan holes = dmgScanHoles(p, aDamage, false, holed);
    return holed ? dmgSag(p, holes) : dmgCaveFall(p, s, holes);
  }
  if (p.y < aDamage.w) return p;
  float dur = damageDuration(aDamage, aDamageB, aDamageC);
  if (s <= 0.0 || s >= dur) return p;
  return (dmgFallTip(s / dur) * vec4(p, 1.0)).xyz;
}
void damageVaryings(vec3 rest) {
  vDmgP = rest;
  vDmgSide = step(aDamage.w, rest.y);
  vDmgFall = 0.0;
  vDmg = aDamage;
  vDmgB = aDamageB;
  vDmgC = aDamageC;
#ifdef DMG_SLAB
  vDmgAxis = normalize(instanceMatrix[0].xz + vec2(1e-6, 0.0));
#endif
}
`;

/** project_vertex with the fall between the instance and the model matrix (and the rest position for the fragment) */
export const DAMAGE_PROJECT_VERTEX = /* glsl */ `
vec4 dmgRest = instanceMatrix * vec4(transformed, 1.0);
damageVaryings(dmgRest.xyz);
vec4 dmgMoved = vec4(damageMove(dmgRest.xyz), 1.0);
vec4 mvPosition = modelViewMatrix * dmgMoved;
gl_Position = projectionMatrix * mvPosition;
`;

export const DAMAGE_WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = modelMatrix * dmgMoved;
#endif
`;

/** What every damaged surface's fragment knows: the ragged edges, the cut and what is left of a wall's edge */
export const DAMAGE_FRAGMENT_PARS = /* glsl */ `
uniform float uDamageTime;
${COLLAPSE_PARS}
${VARYINGS}
// Height of the ragged break line at a point: broken masonry, not a saw cut (a cave-in's dmgCaveCut), worn by the
// holes found there
float damageCut(vec3 p, DmgHoleScan holes) {
  float cut = 0.0;
  if (dmgTower(vDmgC)) {
    cut = vDmg.w + (dmgNoise(p.xz * 0.8 + dmgHeading(vDmg)) - 0.5) * 1.3 + (dmgNoise(p.xz * 3.3) - 0.5) * 0.45;
    cut = dmgWorn(cut, holes, vDmg, vDmgB);
  } else {
    cut = dmgCaveCut(p, vDmg, vDmgB, vDmgC, holes);
  }
  return cut;
}
// How far a point lies outside the bite, m (negative inside): its edge jagged by direction and height
float damageBite(vec3 p) {
  vec3 q = p - vDmgB.xyz;
  vec3 u = q / max(length(q), 1e-4);
  float jag = dmgRound(u, 2.6, vec2(0.0, q.y * 0.9) + dmgHeading(vDmg) * 3.0) * 0.55 + dmgRound(u, 9.0, vec2(0.0, q.y * 3.1)) * 0.25;
  return length(q) - dmgBiteR(vDmgB) * (0.7 + jag);
}
// The slab's reinforcement where its concrete broke away (DMG_SLAB): bars every 20 cm both ways in two layers (its top
// and its bottom face), each sticking out of the broken edge by a length of its own, the cross bars shorter. Only up
// close: where a bar is thinner than a pixel and a half it would sparkle as the camera moves, so there are none
float dmgRebar = 0.0;
#ifdef DMG_SLAB
// n: the face's normal, ab: the point along the slab's axes, w: their change over a pixel (taken before any branch)
bool dmgRebarAt(float edge, vec3 n, vec2 ab, vec2 w) {
  const float W = 0.011;
  if (abs(n.y) < 0.9 || edge < -1.0 || max(w.x, w.y) > W * 1.5) return false;
  // Which face: the top layer and the bottom one have bars of their own
  float layer = gl_FrontFacing == (n.y > 0.0) ? 1.0 : 2.0;
  vec2 k = floor(ab / 0.2 + 0.5);
  float outA = 0.12 + 0.85 * dmgHash(vec2(k.y, layer * 3.1));
  float outB = 0.08 + 0.4 * dmgHash(vec2(k.x, layer * 7.7));
  return (abs(ab.y - k.y * 0.2) < W && -edge < outA) || (abs(ab.x - k.x * 0.2) < W && -edge < outB);
}
#endif
// What lies under the plaster where it came off, and in a broken edge: brickwork (courses of 7.5 cm, bricks of
// 25 cm, every other course half off, mortar lighter), or concrete with its gravel (DMG_CORE_CONCRETE, the slabs).
// Far off the joints thin into the mean colour, no moire
vec3 dmgCore(vec3 p, vec3 fn) {
#if defined( DMG_CORE_CONCRETE ) || defined( DMG_SLAB )
  float grit = dmgNoise(p.xz * 11.0 + p.y * 7.0) * 0.6 + dmgNoise(p.zy * 23.0 + p.x * 5.0) * 0.4;
  float aa = smoothstep(0.02, 0.06, fwidth(p.x) + fwidth(p.y) + fwidth(p.z));
  return vec3(0.25, 0.24, 0.22) * mix(0.7 + 0.55 * grit, 0.97, aa);
#else
  float u = fn.x > fn.z ? p.z : p.x;
  float row = floor(p.y / 0.075);
  float c = u / 0.25 + 0.5 * mod(row, 2.0);
  float mortar = max(step(fract(p.y / 0.075), 0.16), step(fract(c), 0.06));
  vec3 brick = vec3(0.3, 0.13, 0.08) * (0.7 + 0.6 * dmgHash(vec2(floor(c), row)));
  vec3 bricks = mix(brick, vec3(0.36, 0.33, 0.29), mortar);
  float aa = smoothstep(0.012, 0.03, fwidth(p.y));
  return mix(bricks, vec3(0.31, 0.17, 0.12), aa);
#endif
}
// Rubble on a floor: a broken piece round each point of a jittered grid, angular, of its own size and turn. Per
// fragment the piece it lies on or nearest: its shade (x), how far inside it (y, negative on the floor round it) and whether
// one lies there (z); its tilt for the light
vec3 dmgRubble(vec2 p, out vec2 tilt) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float inside = -1.0;
  vec2 id = i;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = i + g;
      vec2 r = g + 0.15 + vec2(dmgHash(c), dmgHash(c + 17.3)) * 0.7 - f;
      // Four broken sides, each at its own turn and distance: no two pieces alike, none round
      float size = 0.14 + 0.26 * dmgHash(c + 8.8);
      float k = -1e3;
      for (int j = 0; j < 4; j++) {
        float a = dmgHash(c + 4.4) * 6.28 + float(j) * 1.571 + (dmgHash(c + float(j) * 2.7) - 0.5) * 0.9;
        k = max(k, dot(r, vec2(cos(a), sin(a))) / (size * (0.55 + 0.7 * dmgHash(c + float(j) * 5.3))));
      }
      k = 1.0 - k;
      if (k > inside) {
        inside = k;
        id = c;
      }
    }
  }
  tilt = vec2(dmgHash(id + 9.7), dmgHash(id + 3.3)) - 0.5;
  return vec3(dmgHash(id + 5.1), clamp(inside * 3.0, -1.0, 1.0), dmgHash(id + 1.9));
}
// Whether a fragment is inside a ruin (DAMAGE_COLOR_FRAGMENT): the sky reaches it only in part
float dmgInside = 0.0;
// The tilt of the rubble under a fragment, for the light (DAMAGE_NORMAL_FRAGMENT)
vec2 dmgTilt = vec2(0.0);
// Metres to the nearest broken edge (holes, else the bite; once fallen the cut), large where there is none: what
// damageClip found, which runs first
float dmgEdgeAt = 1e3;
float damageEdge() {
  return dmgEdgeAt;
}
// Soot on the surface, which is matte (DAMAGE_COLOR_FRAGMENT sets it, the roughness reads it)
float dmgSoot = 0.0;
// Metres of edge distance one pixel spans (DAMAGE_COLOR_FRAGMENT sets it): a band along a broken edge keeps a pixel or
// two, a thinner one would sparkle as the camera moves
float dmgEdgePx = 0.0;
// Throws away what the damage took: the holes (a ruin without any its bite), the column over a large hole while it
// does not fall whole and once it came down, a fall's parts as below
void damageClip() {
  dmgEdgeAt = 1e3;
#ifdef DMG_SLAB
  vec3 slabN = normalize(cross(dFdx(vDmgP), dFdy(vDmgP)));
  vec2 slabAB = vec2(dot(vDmgP.xz, vDmgAxis), dot(vDmgP.xz, vec2(-vDmgAxis.y, vDmgAxis.x)));
  vec2 slabW = fwidth(slabAB);
#endif
  if (vDmg.x < 0.5) return;
  bool holed = vDmg.x < 2.5;
  DmgHoleScan holes = dmgScanHoles(vDmgP, vDmg, true, holed);
  dmgRebar = 0.0;
#ifdef DMG_SLAB
  if (holes.edge < 0.0) {
    if (!dmgRebarAt(holes.edge, slabN, slabAB, slabW)) discard;
    dmgRebar = 1.0;
  }
#else
  if (holes.edge < 0.0) discard;
#endif
  dmgEdgeAt = holes.edge;
  if (holes.edge > 999.0 && vDmg.x > 1.5) {
    dmgEdgeAt = damageBite(vDmgP);
    if (dmgEdgeAt < 0.0) discard;
  }
  if (holed) {
    if (holes.sagStart >= 0.0) {
      float f = uDamageTime - holes.sagStart;
      if (f >= 0.0 && !(f < ${SAG_SECONDS.toFixed(1)} && vDmgFall > 0.999)) discard;
    } else if (vDmgFall > 0.001) discard;
    return;
  }
  bool tower = dmgTower(vDmgC);
  bool fallen = (uDamageTime - vDmg.y) >= damageDuration(vDmg, vDmgB, vDmgC);
  if (tower && !fallen) {
    // A tower: the triangles across the line go while it falls
    if (vDmgSide > 0.002 && vDmgSide < 0.998) discard;
    return;
  }
  float cut = damageCut(vDmgP, holes);
  bool above = vDmgP.y > cut;
  if (fallen) {
    // Afterwards what was above the line is gone
    if (above) discard;
    dmgEdgeAt = min(dmgEdgeAt, cut - vDmgP.y);
  } else if (above ? vDmgFall < 0.999 : vDmgFall > 0.001) discard;
  // cave-in: above the line only while all of it falls, below it nothing that falls along
}
`;

/**
 * Cracks and soot from stage 1, edges charred; the inside lived in and burnt out, never clean: the walls stained,
 * smoke under every ceiling and grime over every floor, plaster off in patches over the brick (or concrete), soot
 * rising from the broken edges, the ceilings sooted, the floors under dust and rubble. The plaster round a broken
 * edge is gone on both sides, so the wall shows its thickness. Inside is a back face of a wall or roof, and all of
 * the floors and inner walls (DMG_SLAB)
 */
export const DAMAGE_COLOR_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5) {
  vec3 toMid = vDmgP - vec3(vDmgC.x, vDmgP.y, vDmgC.y);
  vec2 dir = vec2(cos(dmgHeading(vDmg)), sin(dmgHeading(vDmg)));
  // The side it gives way to cracks first
  float lean = smoothstep(-0.3, 0.9, dot(normalize(toMid.xz + vec2(1e-4)), dir));
  float strength = (vDmg.x > 1.5 ? 1.0 : 0.7) * (0.45 + 0.55 * lean);
  // The face towards the eye, and the crack tile from three sides by its facing
  vec3 dmgN = normalize(cross(dFdx(vDmgP), dFdy(vDmgP)));
  vec3 fn = abs(dmgN);
  fn /= fn.x + fn.y + fn.z + 1e-4;
  vec3 cp = vDmgP / ${CRACK_TILE_M.toFixed(1)};
  vec2 cr = texture2D(uCrackMap, cp.zy).rg * fn.x + texture2D(uCrackMap, cp.xz).rg * fn.y + texture2D(uCrackMap, cp.xy).rg * fn.z;
  float lines = max(cr.g, cr.r * smoothstep(0.3, 0.8, strength));
  // Soot in patches on that side, and round the broken edges
  float edge = damageEdge();
  dmgEdgePx = min(fwidth(edge), 1.0);
  // Floor metres a pixel spans: rubble smaller than that fades into its mean (taken before any branch)
  float floorPx = fwidth(vDmgP.x) + fwidth(vDmgP.z);
  float soot = smoothstep(0.6, 0.9, dmgNoise(vDmgP.xz * 0.35 + vDmgP.y * 0.25 + dmgHeading(vDmg))) * strength * 0.5;
  soot = max(soot, (1.0 - smoothstep(0.0, 0.9, edge)) * 0.55);
  diffuseColor.rgb *= (1.0 - 0.75 * lines * strength) * (1.0 - 0.7 * soot);
  vec3 core = dmgCore(vDmgP, fn);
  // The plaster round a broken edge broke off with it: the brick (or concrete) shows in a ragged band
  float rimW = 0.08 + 0.3 * dmgNoise(vDmgP.xz * 2.3 + vDmgP.y * 1.7);
  float rim = 1.0 - smoothstep(rimW, rimW + max(0.05, dmgEdgePx), edge);
#ifdef DMG_SLAB
  bool inside = true;
  // A broken slab's inside (its box seen through the break): the concrete itself
  if (!gl_FrontFacing) rim = 1.0;
#else
  bool inside = !gl_FrontFacing;
#endif
  if (inside) {
    dmgInside = 1.0;
    vec3 p = vDmgP;
#ifdef DMG_SLAB
    vec3 c = diffuseColor.rgb;
#else
    // Plastered inside, whatever the wall or roof is outside
    vec3 c = mix(diffuseColor.rgb, vec3(0.4, 0.37, 0.32), 0.7);
#endif
    float sf = fract((p.y - dmgSeat(vDmg, vDmgB)) / 3.0);
    // Along a wall (or across a floor), for streaks that run down it
    float along = fn.x > fn.z ? p.z : p.x;
    float streak = dmgNoise(vec2(along * 3.1, p.y * 0.35));
    // Rooms that burnt: darker and browner all over, damp in patches
    float damp = dmgNoise(vec2(dot(p.xz, vec2(0.7)) * 0.8, p.y * 0.25));
    c = mix(c * 0.8, vec3(0.17, 0.15, 0.12), 0.15 + 0.25 * damp);
    // Soot thick round the broken edges, rising from them in streaks
    float sootIn = (1.0 - smoothstep(0.0, 1.2 + 1.4 * streak, edge)) * 0.65;
    if (fn.y < 0.6) {
      // Walls: the smoke under the ceiling, run-off streaks, grime along the floor, plaster off over the core
      sootIn = max(sootIn, smoothstep(0.45, 0.98, sf) * (0.3 + 0.4 * streak));
      // Damp and smoke in blotches
      c *= 0.6 + 0.4 * dmgNoise(vec2(along * 0.6, p.y * 0.8) + 11.0);
      float drip = smoothstep(0.55, 0.85, dmgNoise(vec2(along * 5.3, p.y * 0.6))) * smoothstep(0.7, 0.1, sf);
      c *= 1.0 - 0.2 * drip;
      c = mix(c, vec3(0.12, 0.1, 0.08), (1.0 - smoothstep(0.0, 0.12, sf)) * 0.65);
      float off = smoothstep(0.7, 0.75, dmgNoise(p.xz * 0.9 + p.y * 0.8 + 3.0) + 0.3 * (1.0 - smoothstep(0.0, 2.0, edge)));
      c = mix(c, core * 0.9, off);
    } else if (dmgN.y < 0.0) {
      // Ceilings, seen from below: sooted
      sootIn = max(sootIn, 0.2 + 0.35 * dmgNoise(p.xz * 0.6 + 2.0));
    } else {
      // Floors: dust, grit and, in heaps (more of it near the breaks), the pieces that came down
      vec2 tiltBig;
      vec2 tiltGrit;
      vec3 big = dmgRubble(p.xz * 2.3, tiltBig);
      vec3 grit = dmgRubble(p.xz * 8.0, tiltGrit);
      float near = 1.0 - smoothstep(0.0, 2.5, edge);
      float heap = smoothstep(0.35, 0.8, dmgNoise(p.xz * 0.45 + 7.0) * 0.8 + dmgNoise(p.xz * 1.3 + 3.0) * 0.3 + 0.4 * near);
      // Grit everywhere, thicker in the heaps; pieces strewn thin, piled in the heaps
      float gritOn = step(0.8 - 0.45 * heap, grit.z) * (1.0 - smoothstep(0.02, 0.06, floorPx));
      c = mix(c, vec3(0.3, 0.27, 0.23) * (0.8 + 0.4 * dmgNoise(p.xz * 2.1)), 0.55 + 0.3 * heap);
      c *= mix(1.0, grit.y > 0.0 ? (0.65 + 0.6 * grit.x) * (0.75 + 0.25 * grit.y) : 0.8 + 0.2 * (1.0 + grit.y), gritOn);
      float chunk = step(0.9 - 0.8 * heap, big.z) * (1.0 - smoothstep(0.07, 0.2, floorPx));
      vec3 piece = mix(vec3(0.33, 0.31, 0.28), vec3(0.3, 0.15, 0.09), step(0.85, big.x));
      // Each piece with the shadow it lies in
      c *= 1.0 - 0.45 * chunk * smoothstep(-0.5, 0.0, big.y) * step(big.y, 0.0);
      chunk *= step(0.0, big.y);
      c = mix(c, piece * (0.7 + 0.5 * big.x) * (0.6 + 0.4 * big.y), chunk);
      dmgTilt = tiltBig * chunk * 1.1 + tiltGrit * gritOn * 0.5;
      sootIn *= 0.6;
    }
    c *= 1.0 - 0.8 * sootIn;
    soot = max(soot, sootIn);
    diffuseColor.rgb = c;
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, core * (1.0 - 0.5 * soot), rim);
  // The reinforcement out of a broken slab: rusted steel
  if (dmgRebar > 0.5) {
    diffuseColor.rgb = vec3(0.09, 0.05, 0.03);
    soot = 0.6;
  }
  dmgSoot = soot;
}
`;

/** The rubble on a ruin's floors tilts the light on its pieces (dmgTilt, in the group frame) */
export const DAMAGE_NORMAL_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5 && dot(dmgTilt, dmgTilt) > 0.0) normal = normalize(normal + mat3(viewMatrix) * vec3(dmgTilt.x, 0.0, dmgTilt.y));
`;

/**
 * A ruin's insides are drawn in front of what lies in their plane: where two
 * buildings share a wall (a terrace, the parts of one), or two floor boxes
 * meet, a ruin's back face and the other's front face lie in one plane and
 * would flicker. A back face pulled a little nearer (relative, in the
 * logarithmic depth: millimetres at a hundred metres) wins, so through a hole
 * one sees the ruin's own sooted inside
 */
export const DAMAGE_DEPTH_FRAGMENT = /* glsl */ `
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
if (!gl_FrontFacing) gl_FragDepth -= ${BACK_PULL} * logDepthBufFC;
#endif
`;

/** Lit windows go dark from stage 1; embers glow along a stage-2 ruin's edges */
export const DAMAGE_EMISSIVE_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5) {
  totalEmissiveRadiance *= 0.0;
  // Indoors the sky is mostly walls and ceilings: less of its light, and of the dust's colour, not the sky's blue
  if (dmgInside > 0.5) {
    reflectedLight.indirectDiffuse = vec3(dot(reflectedLight.indirectDiffuse, vec3(0.3, 0.59, 0.11))) * vec3(0.66, 0.6, 0.52);
    reflectedLight.indirectSpecular *= 0.4;
  }
  // The inside sees the sky through the holes: a little light of its own where the sun's shadow keeps it dark
  if (!gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * 0.22;
  if (vDmg.x > 1.5) {
    // Glowing in a few places along the broken edges, less once it has fallen
    float e = damageEdge();
    float spots = smoothstep(0.72, 0.88, dmgNoise(vDmgP.xz * 1.6 + vDmgP.y * 1.1 + dmgHeading(vDmg)));
    float flicker = 0.7 + 0.3 * sin(uDamageTime * 3.1 + dot(vDmgP, vec3(1.7, 2.3, 1.1)));
    float heat = vDmg.x > 2.5 ? 0.55 : 1.0;
    // A band of 22 cm, at least two pixels wide far off and as much light in all
    float band = max(0.22, 2.0 * dmgEdgePx);
    totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * (1.0 - smoothstep(0.0, band, e)) * (0.22 / band) * spots * flicker * heat * 1.5 * (1.0 - dmgRebar);
  }
}
`;
