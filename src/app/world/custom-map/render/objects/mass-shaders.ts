/**
 * The GLSL of the mass layer's materials (mass-layer.ts): gables drawn in
 * from quads, the walls' storeys, windows, doors, plinth and cornice by
 * their surface, their shine and night windows, the roofs' UVs and a flat
 * roof's cover.
 */
import { CELLAR_STOREY } from '../../object-cellar';
import { DOOR_FROM, DOOR_TO } from './cellar-shell';

/**
 * A gable's quad drawn in to a triangle: its top corners meet where along it
 * its top is (aWallD.x: the middle of a wing's end, an end of a skillion's
 * side wall); a wedge's (mass-openings.ts WALL_WEDGE) meet at its start, the
 * quad's corner and its two edges a triangle of any shape
 */
export const GABLE_GLSL = /* glsl */ `
if (abs(aWallB.y - 2.0) < 0.5 && transformed.y > 0.5) transformed.x = aWallD.x;
if (abs(aWallB.y - 5.0) < 0.5 && transformed.y > 0.5) transformed.x = 0.0;
`;

/** What GABLE_GLSL reads, for the depth materials of the sun's shadow */
export const GABLE_PARS = 'attribute vec4 aWallB;\nattribute vec4 aWallD;';

export const WALL_VERTEX_PARS = /* glsl */ `
attribute vec4 aWall;
attribute vec4 aWallB;
attribute vec4 aWallC;
attribute vec4 aWallD;
uniform float uTile;
varying vec2 vWallM;
varying vec4 vWall;
varying vec4 vWallB;
varying vec4 vWallC;
varying vec4 vWallD;
`;

/**
 * Metres along the wall and over the seat; the surfaces read them in their
 * own repeat. A piece of a wall in pieces (an opening's, mass-openings.ts)
 * counts from the whole wall's start and lays its windows out over the
 * whole wall's length
 */
export const WALL_UV_VERTEX = /* glsl */ `
#include <uv_vertex>
{
  // uv_vertex runs before begin_vertex: the gable's corners drawn in again here
  vec3 wallP = position;
  if (abs(aWallB.y - 2.0) < 0.5 && wallP.y > 0.5) wallP.x = aWallD.x;
  if (abs(aWallB.y - 5.0) < 0.5 && wallP.y > 0.5) wallP.x = 0.0;
  vWallM = vec2(aWallC.x + wallP.x * aWall.x, wallP.y * aWall.y - aWall.z);
  vWall = aWall;
  if (aWallC.y > 0.0) vWall.x = aWallC.y;
  vWallB = aWallB;
  vWallC = aWallC;
  vWallD = aWallD;
  // The texture in metres over the seat: the pieces of a wall, a fallen wall's stump and what falls, meet without a seam
  vec2 wallUv = vWallM / uTile;
  #ifdef USE_MAP
  vMapUv = wallUv;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = wallUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = wallUv;
  #endif
  #ifdef USE_METALNESSMAP
  vMetalnessMapUv = wallUv;
  #endif
}
`;

export const WALL_FRAGMENT_PARS = /* glsl */ `
uniform float uFacade;
varying vec2 vWallM;
varying vec4 vWall;
varying vec4 vWallB;
varying vec4 vWallC;
varying vec4 vWallD;
uniform sampler2D uPlinthMap;
uniform float uPlinthTile;
uniform vec3 uPlinthColor;
uniform float uNightWindows;
float massGlass = 0.0;
float massWindow = 0.0;
float massLit = 0.0;
vec3 massLight = vec3(0.0);

float massHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Smooth step over a pixel's width: inside 1, outside 0
float massBox(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
}

// The share of a pixel's width (2 aa round x) inside [lo, hi], for a row of them every \`period\` apart: over the
// one at x up close, the row's mean once a pixel spans the gaps between them. Holds still at any distance
float massCover(float x, float lo, float hi, float aa, float period) {
  float one = clamp((min(hi, x + aa) - max(lo, x - aa)) / (2.0 * aa), 0.0, 1.0);
  return mix(one, (hi - lo) / period, smoothstep(0.5, 1.0, 2.0 * aa / max(period - (hi - lo), 1e-3)));
}
`;

/**
 * The facade: the plinth, the cornice, then per storey and bay a window
 * with its frame, sill, reveal and blind; halls one high row. Laid out in
 * metres per wall (vWallM: along, over the seat), centred with a margin at
 * the corners. Far away the detail turns into its mean colour.
 */
export const WALL_COLOR_FRAGMENT = /* glsl */ `
{
  float u = vWallM.x;
  float v = vWallM.y;
  float L = vWall.x;
  float floors = max(vWall.w, 1.0);
  // Whole numbers: an interpolated varying drifts in its last bits, and the hash would turn that into noise
  float seed = floor(vWallB.x + 0.5);
  float kind = vWallB.y;
  float band = vWallB.z;
  float top = vWallB.w;
  // The opening the wall is cut round (mass-openings.ts): its middle and half width along the wall, its top, an
  // arch's rise, its look (0 lintel, 1 round arch, 2 a car park's), its floor
  float cutMid = vWallC.z;
  float cutHalf = vWallC.w;
  float cutTop = vWallD.x;
  float cutRise = vWallD.y;
  float cutStyle = vWallD.z;
  float cutFloor = vWallD.w;
  float cutSpring = cutTop - cutRise;
  // An arch's head: the arch itself is open
  if (abs(kind - 4.0) < 0.5 && cutHalf > 0.0) {
    vec2 archQ = vec2((u - cutMid) / cutHalf, (v - cutSpring) / max(cutRise, 0.01));
    if (dot(archQ, archQ) < 1.0) discard;
  }
  float aa = max(max(fwidth(u), fwidth(v)), 1e-4);
  // Per facade (uFacade, MAP_MASS_FACADES' order): plinth height, bay, window width and height, the sill over the
  // storey's floor, frame colour
  int facade = int(uFacade + 0.5);
  float plinthH = 0.5; float bay = 1.6; float winW = 0.85; float winH = 1.1; float sill = 0.85; vec3 frame = vec3(0.9, 0.88, 0.82);
  if (facade == 0) {
    plinthH = 0.45; bay = 2.9; winW = 1.25; winH = 1.45; sill = 0.9; frame = vec3(0.92, 0.92, 0.9);
  } else if (facade == 1) {
    plinthH = 0.6; bay = 1.6; winW = 1.36; winH = 1.55; sill = 0.85; frame = vec3(0.16, 0.17, 0.18);
  } else if (facade == 2) {
    plinthH = 1.0; bay = 5.0; winW = 4.2; winH = 1.1; sill = 0.0; frame = vec3(0.2, 0.21, 0.22);
  } else if (facade == 3) {
    plinthH = 0.5; bay = 2.7; winW = 1.1; winH = 1.6; sill = 0.85; frame = vec3(0.9, 0.9, 0.88);
  } else if (facade == 4) {
    plinthH = 0.6; bay = 3.6; winW = 1.05; winH = 2.0; sill = 1.1; frame = vec3(0.3, 0.27, 0.24);
  }
  // Its cellar under the floor (MapObject.cellar, object-cellar.ts; the walls' foot at its foot): one house in five
  // in the plinth's surface from the plinth's top over the floor all the way down; the others in the wall's, the
  // plinth at the lowest ground (the walls reach CELLAR_EXPOSED_MARGIN under it, vWall.z; none under FOUNDATION)
  float wallDown = step(0.2, massHash(vec3(seed, 3.7, 1.3))) * step(1.55, vWall.z) * max(vWall.z - 0.6, 0.0);
  float plinthTop = plinthH - wallDown;
  vec3 base = diffuseColor.rgb;
  #ifdef USE_COLOR
  if (facade == 2) {
    // Sheet metal takes its tint as paint: the sheet's own colour out, its light and shade kept
    base = vColor.rgb * dot(base / max(vColor.rgb, vec3(0.02)), vec3(0.299, 0.587, 0.114)) * 6.5;
  }
  #endif
  // A broad, slow patchiness and grime above the plinth: no two walls alike
  float patchy = massHash(floor(vec3(u * 0.25, v * 0.35, seed)));
  base *= 0.95 + 0.07 * patchy;
  base *= 1.0 - 0.14 * exp(-max(v - plinthTop, 0.0) / 0.7);
  float windows = 0.0;
  vec3 detail = base;
  // Far off: the windows as dark panes by the share of a pixel they cover (massCover), their colour and light
  float coarse = 0.0;
  vec3 coarsePane = vec3(0.08, 0.09, 0.1);
  float coarseLit = 0.0;
  // A shop's wall is a facade too, with display windows on its ground floor; an arch's head is facade, an
  // opening's reveal plain with the plinth at its foot
  float shop = 1.0 - step(0.5, abs(kind - 3.0));
  float facadeWall = max(max(step(kind, 0.5), shop), 1.0 - step(0.5, abs(kind - 4.0)));
  float revealWall = 1.0 - step(0.5, abs(kind - 6.0));
  if (facadeWall > 0.5 && v > plinthH) {
    float usable = max(top - plinthH - band, 0.5);
    float storey = usable / floors;
    // A hall is one high storey; the high storeys of a palace keep their rows, with taller windows
    float hall = step(4.6, storey) * step(floors, 1.5);
    float k = floor((v - plinthH) / storey);
    float inStorey = v - plinthH - k * storey;
    float wb;
    float wh;
    if (hall > 0.5) {
      // A hall: one high row under the roof; stone walls tall windows from low down
      if (facade == 4) {
        wb = 2.2; wh = max(usable - 3.6, 1.5);
      } else {
        wh = min(winH * 1.4, usable * 0.3); wb = usable - wh - 0.5;
      }
      inStorey = v - plinthH;
      k = 0.0;
    } else {
      wb = sill;
      wh = min(max(winH, (storey - sill) * 0.55), storey - sill - 0.35);
    }
    float display = shop * step(k, 0.5) * step(hall, 0.5);
    if (display > 0.5) {
      // Display windows: wide, from just over the plinth to under the first floor
      bay = 3.2;
      winW = 2.7;
      wb = 0.3;
      wh = storey - 0.75;
    }
    float margin = 0.8;
    float n = floor((L - 2.0 * margin) / bay);
    float ww = winW * (hall > 0.5 ? 1.0 : 1.0);
    if (n < 1.0) { n = L > 2.0 ? 1.0 : 0.0; ww = min(ww, L - 1.0); }
    float u0 = (L - n * bay) * 0.5;
    float i = floor((u - u0) / bay);
    float lu = u - u0 - (i + 0.5) * bay;
    float inBay = step(0.0, i) * step(i, n - 1.0) * step(k, floors - 0.5);
    // The building's entrance (MapMass.door) on the ground floor of its wall: the bay it is in a door instead of a
    // window (vWallD.z the metres along the wall to it plus one; 0 on every other wall, a cut wall's its opening)
    float doorU = cutHalf > 0.0 ? -1.0 : vWallD.z - 1.0;
    float doorBay = clamp(floor((doorU - u0) / bay), 0.0, max(n - 1.0, 0.0));
    float door = step(hall, 0.5) * step(k, 0.5) * step(0.0, doorU) * step(abs(i - doorBay), 0.5);
    if (cutHalf > 0.0) {
      // No window or door the opening or its frame would cut: their bay's middle off its middle, their sill under its top
      float off = abs(u - lu - cutMid);
      float under = step(plinthH + k * storey + wb, cutTop + 0.35);
      inBay *= 1.0 - step(off, cutHalf + ww * 0.5 + 0.45) * under;
      door *= 1.0 - step(off, cutHalf + 1.15) * step(plinthH, cutTop + 0.5);
    }
    if (door > 0.5) {
      float dw = 1.4;
      float dh = min(2.5, storey - 0.3);
      float leaf = massBox(lu, -dw * 0.5, dw * 0.5, aa) * massBox(inStorey, 0.0, dh, aa);
      float glassDoor = massBox(lu, -dw * 0.5 + 0.1, dw * 0.5 - 0.1, aa) * massBox(inStorey, 0.15, dh - 0.12, aa);
      vec3 doorColor = mix(vec3(0.2, 0.13, 0.08), vec3(0.16, 0.17, 0.18), step(0.5, massHash(vec3(seed, 5.0, 1.0))));
      detail = mix(detail, frame, leaf);
      detail = mix(detail, mix(doorColor, vec3(0.06, 0.07, 0.08), 0.5 * step(uFacade, 0.5)), glassDoor);
      // A canopy's shadow over it
      detail *= 1.0 - 0.35 * massBox(lu, -dw * 0.5 - 0.3, dw * 0.5 + 0.3, aa) * massBox(inStorey, dh + 0.05, dh + 0.35, aa);
      massWindow = leaf;
      massGlass = glassDoor * 0.5;
      inBay = 0.0;
    }
    // Half-timbered storeys over the ground floor: sill and head plates, a post at every bay line, rails over
    // and under the windows, braces crossing the bays that have none
    if (facade == 5 && k > 0.5 && hall < 0.5 && wh > 0.3) {
      vec3 oak = vec3(0.16, 0.1, 0.065) * (0.8 + 0.4 * massHash(vec3(seed, 7.0, 2.0))) * (0.75 + 0.5 * dot(base, vec3(0.33)));
      float bw = 0.17;
      float lp = lu + bay * 0.5;
      float braced = step(0.66, massHash(vec3(i, k, seed + 3.0))) * inBay;
      float timber = max(massBox(inStorey, 0.0, bw, aa), massBox(inStorey, storey - bw, storey + 0.02, aa));
      timber = max(timber, step(0.0, i) * step(i, n) * max(massBox(lp, -bw * 0.5, bw * 0.5, aa), massBox(lp, bay - bw * 0.5, bay + bw * 0.5, aa)));
      float rails = max(massBox(inStorey, wb - bw, wb, aa), massBox(inStorey, wb + wh, wb + wh + bw * 0.8, aa));
      timber = max(timber, rails * inBay * (1.0 - braced));
      float d1 = abs(lp * storey - inStorey * bay) / length(vec2(bay, storey));
      float d2 = abs((bay - lp) * storey - inStorey * bay) / length(vec2(bay, storey));
      timber = max(timber, braced * (1.0 - smoothstep(bw * 0.4 - aa, bw * 0.4 + aa, min(d1, d2))));
      detail = mix(detail, oak, timber);
      inBay *= 1.0 - braced;
    }
    if (inBay > 0.5 && wh > 0.3) {
      float h = massHash(vec3(i, k, seed));
      coarse = massCover(lu, -ww * 0.5, ww * 0.5, aa, bay) * massCover(inStorey, wb, wb + wh, aa, hall > 0.5 ? usable : storey);
      // The opening, its frame and the glass inside
      float open = massBox(lu, -ww * 0.5, ww * 0.5, aa) * massBox(inStorey, wb, wb + wh, aa);
      float fw = 0.07;
      float glass = massBox(lu, -ww * 0.5 + fw, ww * 0.5 - fw, aa) * massBox(inStorey, wb + fw, wb + wh - fw, aa);
      if (facade == 4) {
        // A round head on the tall windows of a stone wall
        float arch = length(vec2(lu, max(inStorey - (wb + wh - ww * 0.5), 0.0)));
        open *= 1.0 - smoothstep(ww * 0.5 - aa, ww * 0.5 + aa, arch);
        glass *= 1.0 - smoothstep(ww * 0.5 - fw - aa, ww * 0.5 - fw + aa, arch);
      }
      // Blinds part way down in some homes and offices (never in a hall's tall windows), the sky's sheen in the rest
      float blind = step(0.62, h) * step(hall, 0.5) * massBox(inStorey, wb + wh - wh * (0.15 + 0.55 * fract(h * 13.7)), wb + wh + 1.0, aa);
      vec3 glassColor = mix(vec3(0.05, 0.065, 0.08), vec3(0.11, 0.12, 0.13), fract(h * 3.1));
      vec3 blindColor = mix(vec3(0.82, 0.8, 0.74), vec3(0.62, 0.6, 0.56), fract(h * 5.3));
      vec3 pane = mix(glassColor, blindColor, blind);
      // The reveal: the top of the opening in shade
      float reveal = massBox(inStorey, wb + wh - fw - 0.16, wb + wh - fw, aa) * glass;
      pane *= 1.0 - 0.45 * reveal;
      detail = mix(detail, frame, open);
      detail = mix(detail, pane, glass);
      // Window crosses on homes: a mullion and a transom at two thirds
      if (facade == 0 || facade == 3 || facade == 5) {
        float bar = max(massBox(lu, -0.035, 0.035, aa), massBox(inStorey, wb + wh * 0.66 - 0.035, wb + wh * 0.66 + 0.035, aa)) * step(hall, 0.5) * (1.0 - display);
        detail = mix(detail, frame, glass * bar);
        glass *= 1.0 - bar;
      }
      massGlass = glass * (1.0 - blind);
      massWindow = open;
      // The sill under the window, a streak of grime under the sill
      float sillBand = massBox(lu, -ww * 0.5 - 0.06, ww * 0.5 + 0.06, aa) * massBox(inStorey, wb - 0.07, wb, aa);
      detail = mix(detail, vec3(0.78, 0.78, 0.76), sillBand * step(0.1, sill));
      float streak = (1.0 - smoothstep(0.0, ww * 0.45, abs(lu))) * massBox(inStorey, wb - 1.3, wb - 0.07, aa) * (1.0 - (wb - inStorey) / 1.3);
      detail *= 1.0 - 0.1 * streak * step(0.1, sill) * fract(h * 7.7);
      windows = open;
      massLit = glass * step(0.45, fract(h * 19.3)) * (1.0 - blind * 0.6);
      massLight = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), fract(h * 7.0));
      // The pane seen from afar: glass with a little of its frame, or the blind
      coarsePane = mix(mix(glassColor, frame, 0.2), blindColor, blind * 0.6);
      coarseLit = step(0.45, fract(h * 19.3)) * (1.0 - blind * 0.6);
    }
    // The cornice under the roof, a shadow line beneath it
    float cornice = massBox(v, top - band, top - band + 0.22, aa);
    detail = mix(detail, detail * 1.12, cornice * step(0.2, band));
    detail *= 1.0 - 0.18 * massBox(v, top - band - 0.12, top - band, aa) * step(0.2, band);
    // Corner pilasters on plaster
    if (facade == 0) detail *= 1.0 + 0.05 * (massBox(u, -1.0, 0.32, aa) + massBox(u, L - 0.32, L + 1.0, aa));
  }
  // The plinth below, in the plinth's concrete
  vec3 plinthColor = texture2D(uPlinthMap, vWallM / uPlinthTile).rgb * uPlinthColor;
  // The cellar's openings (vWallD.w its storeys open to the slope, -1 buried): per storey a cellar window under each
  // bay, high in the wall and only where the ground outside the wall's middle (vWallD.y, m under the floor) lies under
  // its sill with room to spare, the larger the more of the storey stands free; the middle bay a door or a garage on
  // the storey whose floor the ground there meets. In the plinth's surface, which the cellar's walls are of
  float cellarStoreys = cutHalf > 0.0 ? 0.0 : vWallD.w;
  if (facadeWall > 0.5 && cellarStoreys > 0.5 && v < 0.0) {
    float storeyH = ${CELLAR_STOREY.toFixed(2)};
    float ck = floor(-v / storeyH);
    float ctop = -ck * storeyH;
    float cn = floor((L - 1.6) / bay);
    if (cn < 1.0) cn = L > 2.0 ? 1.0 : 0.0;
    float cu0 = (L - cn * bay) * 0.5;
    float ci = floor((u - cu0) / bay);
    float clu = u - cu0 - (ci + 0.5) * bay;
    float inCellar = step(0.0, ci) * step(ci, cn - 1.0) * step(ck, cellarStoreys - 0.5) * (1.0 - smoothstep(0.06, 0.3, aa));
    // Metres of this storey the ground leaves free under its ceiling
    float free = vWallD.y - ck * storeyH;
    float middle = step(ci, floor(cn * 0.5)) * step(floor(cn * 0.5), ci) * step(${DOOR_FROM.toFixed(2)}, free) * step(free, ${DOOR_TO.toFixed(2)}) * inCellar;
    float garage = step(8.0, L) * step(0.5, massHash(vec3(floor(L * 10.0), seed, 9.0)));
    float dw = mix(1.05, 2.5, garage);
    float dh = min(mix(2.05, 2.2, garage), free - 0.3);
    // On the ground, on the storey's floor where the ground lies lower (a few steps)
    float doorFoot = ctop - min(free, storeyH);
    float leaf = middle * massBox(clu, -dw * 0.5, dw * 0.5, aa) * massBox(v, doorFoot - 0.3, doorFoot + dh, aa);
    float inner = middle * massBox(clu, -dw * 0.5 + 0.08, dw * 0.5 - 0.08, aa) * massBox(v, doorFoot - 0.3, doorFoot + dh - 0.08, aa);
    // A garage's door in ribbed grey sheet, a house door in dark wood
    float rib = 0.85 + 0.15 * step(0.5, fract((v - doorFoot) / 0.5));
    vec3 doorColor = mix(vec3(0.2, 0.13, 0.08), vec3(0.5, 0.51, 0.5) * rib, garage);
    // Its window from 0.35 m under the ceiling, as tall as the free wall allows (none under 0.45 m: no window half
    // in the ground), none where the door is
    float ch = min(free - 0.35 - 0.15, 1.1);
    float cw = mix(0.8, winW, smoothstep(0.6, 1.1, ch));
    float win = inCellar * step(0.45, ch) * (1.0 - step(0.5, middle));
    float open = win * massBox(clu, -cw * 0.5, cw * 0.5, aa) * massBox(v, ctop - 0.35 - ch, ctop - 0.35, aa);
    float glass = win * massBox(clu, -cw * 0.5 + 0.06, cw * 0.5 - 0.06, aa) * massBox(v, ctop - 0.35 - ch + 0.06, ctop - 0.41, aa);
    // In the house's style: a stone wall's window in a surround of dressed stone with iron bars, a plastered one's
    // with a sill
    vec3 cellarFrame = frame * 0.85;
    float dressed = 0.0;
    float bars = 0.0;
    if (facade == 4) {
      dressed = win * massBox(clu, -cw * 0.5 - 0.16, cw * 0.5 + 0.16, aa) * massBox(v, ctop - 0.35 - ch - 0.16, ctop - 0.35 + 0.16, aa);
      cellarFrame = vec3(0.13, 0.11, 0.09);
      bars = glass * (1.0 - smoothstep(0.012, 0.012 + aa, abs(fract(clu / 0.16 + 0.5) - 0.5) * 0.16));
    }
    float sillBand = (facade == 4 ? 0.0 : 1.0) * win * massBox(clu, -cw * 0.5 - 0.05, cw * 0.5 + 0.05, aa) * massBox(v, ctop - 0.35 - ch - 0.06, ctop - 0.35 - ch, aa);
    vec3 ashlar = min(base * 1.28 + 0.04, vec3(1.0));
    for (int layer = 0; layer < 2; layer++) {
      vec3 c = layer == 0 ? detail : plinthColor;
      c = mix(c, ashlar, dressed);
      c = mix(c, vec3(0.78, 0.78, 0.76), sillBand);
      c = mix(c, cellarFrame * 0.95, leaf);
      c = mix(c, doorColor, inner);
      c = mix(c, cellarFrame, open);
      c = mix(c, vec3(0.05, 0.06, 0.07), glass);
      c = mix(c, vec3(0.1, 0.1, 0.11), bars);
      if (layer == 0) detail = c; else plinthColor = c;
    }
    massWindow = max(massWindow, max(open, leaf));
    massGlass = max(massGlass, glass * (1.0 - bars));
  }
  float plinth = 1.0 - smoothstep(plinthTop - aa, plinthTop + aa, v);
  // The opening's frame on the facade (its dressing replaces the plinth where it reaches down)
  float dressed = 0.0;
  if (cutHalf > 0.0 && facadeWall > 0.5) {
    float du = abs(u - cutMid);
    vec3 dress = min(base * 1.16 + 0.025, vec3(1.0));
    vec3 joint = base * 0.62;
    if (cutStyle > 1.5) {
      // A car park's entrance: a concrete lintel over it, its edges in shade
      float beam = massBox(du, -1.0, cutHalf + 0.3, aa) * massBox(v, cutTop, cutTop + 0.42, aa);
      detail = mix(detail, plinthColor * 0.92, beam);
      detail *= 1.0 - 0.3 * massBox(du, -1.0, cutHalf + 0.3, aa) * massBox(v, cutTop + 0.42, cutTop + 0.5, aa);
      dressed = beam;
    } else if (cutStyle > 0.5) {
      // A round arch in stone: voussoirs round it with a keystone, quoins up the jambs, an impost at the springing
      vec2 q = vec2((u - cutMid) / cutHalf, (v - cutSpring) / max(cutRise, 0.01));
      float ring = (length(q) - 1.0) * cutRise;
      float stones = 2.0 * floor(cutHalf * 1.6) + 7.0;
      float a = atan(max(q.y, 0.0), q.x) / PI * stones;
      float stone = floor(a);
      float key = 1.0 - step(0.5, abs(stone - (stones - 1.0) * 0.5));
      float voussoir = step(cutSpring, v) * massBox(ring, -0.02, 0.44 + 0.2 * key, aa);
      // The joints between the voussoirs: metres along the arch to the nearest
      float seam = 1.0 - smoothstep(0.0, 0.03, (0.5 - abs(fract(a) - 0.5)) * PI * (cutHalf + 0.2) / stones);
      // Quoins: courses of 0.5 m, long and short in turn, up to the springing, a bed joint under each
      float course = floor(v / 0.5);
      float reach = mix(0.36, 0.58, mod(course, 2.0));
      float quoin = massBox(du, cutHalf - 0.02, cutHalf + reach, aa) * massBox(v, -0.2, cutSpring, aa);
      float bed = 1.0 - smoothstep(0.0, 0.03, fract(v / 0.5) * 0.5);
      float impost = massBox(du, cutHalf - 0.02, cutHalf + 0.7, aa) * massBox(v, cutSpring - 0.22, cutSpring, aa);
      dressed = max(max(voussoir, quoin), impost);
      // Dressed stone a shade lighter than the walling, each block its own
      vec3 ashlar = min(base * 1.32 + 0.05, vec3(1.0));
      detail = mix(detail, ashlar * (0.94 + 0.1 * massHash(vec3(stone, course, seed))), dressed);
      detail = mix(detail, ashlar * 1.06, impost);
      detail *= 1.0 - 0.3 * massBox(du, cutHalf - 0.02, cutHalf + 0.7, aa) * massBox(v, cutSpring - 0.3, cutSpring - 0.22, aa);
      detail = mix(detail, joint, 0.55 * (voussoir * seam + quoin * bed));
    } else {
      // A town house's carriageway: a plain band round it (a plaster facade's dressing), the lintel's shade inside
      float fw = 0.3;
      float jamb = massBox(du, cutHalf - 0.02, cutHalf + fw, aa) * massBox(v, plinthH, cutTop + fw, aa);
      float head = massBox(du, -1.0, cutHalf + fw, aa) * massBox(v, cutTop - 0.02, cutTop + fw, aa);
      dressed = max(jamb, head);
      detail = mix(detail, dress, dressed);
      detail *= 1.0 - 0.18 * massBox(du, cutHalf + fw, cutHalf + fw + 0.06, aa) * massBox(v, plinthH, cutTop + fw, aa);
    }
  }
  plinth *= max(facadeWall * (1.0 - dressed), revealWall);
  // Far off, where a window gets under two pixels: the wall with its panes by their cover instead of the shimmer of
  // its frame and bars, down to the wall's mean where a pixel spans several windows. From 0.06 m a pixel on the
  // windows of a wall seen from the game's height were grey smudges from 150 m
  float far = smoothstep(0.3, 0.7, aa);
  vec3 mean = mix(base, coarsePane, coarse);
  diffuseColor.rgb = mix(mix(detail, mean, far), plinthColor, plinth);
  massGlass *= 1.0 - far;
  massWindow *= 1.0 - far;
  massLit = mix(massLit, coarse * coarseLit, far);
  massLit *= 1.0 - plinth;
}
`;

export const WALL_SHINE_FRAGMENT = /* glsl */ `
// Frames and blinds painted, the panes glass
roughnessFactor = mix(mix(roughnessFactor, 0.5, massWindow), 0.12, massGlass);
metalnessFactor = mix(mix(metalnessFactor, 0.0, massWindow), 0.55, massGlass);
`;

export const WALL_NIGHT_FRAGMENT = /* glsl */ `
totalEmissiveRadiance += massLight * massLit * uNightWindows * 0.9;
`;

/** A roof triangle's corners carry their places in metres: between them by the unit triangle's corner */
export const ROOF_UV_VERTEX = /* glsl */ `
#include <uv_vertex>
{
  vec2 a = aRoofUvA.xy;
  vec2 b = vec2(aRoofUvA.z, aRoofUv.x);
  vec2 c = aRoofUv.yz;
  vRoofM = a * (1.0 - position.x - position.z) + b * position.x + c * position.z;
  vec2 roofUv = vRoofM / uTile;
  #ifdef USE_MAP
  vMapUv = roofUv;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = roofUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = roofUv;
  #endif
  #ifdef USE_METALNESSMAP
  vMetalnessMapUv = roofUv;
  #endif
}
`;

/** A flat roof: its sheets in strips a metre wide, a few patched lighter */
export const FLAT_ROOF_FRAGMENT = /* glsl */ `
if (uFlatRoof > 0.5) {
  float strip = floor(vRoofM.x);
  float h = fract(sin(strip * 12.9898 + floor(vRoofM.y / 6.0) * 4.1414) * 43758.5453);
  diffuseColor.rgb *= 0.94 + 0.1 * h;
  float seam = 1.0 - smoothstep(0.0, 0.04, abs(fract(vRoofM.x) - 0.5) - 0.46);
  diffuseColor.rgb *= 1.0 - 0.12 * seam;
}
`;
