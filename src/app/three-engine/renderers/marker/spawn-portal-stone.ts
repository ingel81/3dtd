import { PORTAL_OPENING_HEIGHT } from '../../../configs/marker-geometry.config';
import { PORTAL_CORNICE_TOP, PORTAL_LINTEL_TOP, PORTAL_PLINTH_TOP } from './spawn-portal-geometry';
import { SIGIL_LAYOUT } from './spawn-portal-sigils';

/**
 * Stone of the spawn portal's frame, drawn procedurally by the gate shader
 * (marker-shaders.ts), no textures: hewn ashlar blocks with joints,
 * chamfered and worn block edges with chips broken off, cracks, soot and
 * burn marks round the opening, grain and a fine relief. The relief tilts
 * the flat face normal (chamfers at the joints and the block edges, a
 * noise bump). The light is faked, as the Photorealistic Tiles around take
 * none: a fixed key light that turns with the portal, the sky from above,
 * the core's dark red light from the opening, occlusion in the joints and
 * cracks and where blocks meet.
 */

/** Masonry of one height band of the frame, see PORTAL_MASONRY. */
export interface MasonryBand {
  name: string;
  /** Upper end of the band above the ground (m); the last band runs to the top */
  below: number;
  /** Course height (m), 0 for one course without horizontal joints; courseOrigin is a joint's height */
  course: number;
  courseOrigin: number;
  /** Block length (m) along x on the front, back, tops and bottoms; 0 for no vertical joints */
  front: number;
  /** Block length (m) along z on the ±x sides; 0 for no vertical joints */
  side: number;
  /** Where a vertical joint runs in the unshifted courses (x, or z on the sides) */
  blockOrigin: number;
  /** Every second course shifted by half a block */
  bond: boolean;
}

const LINTEL_HALF = (SIGIL_LAYOUT.lintelColumns * SIGIL_LAYOUT.lintelPitch) / 2;

/**
 * Masonry of the frame from the ground up. The pillar courses are as tall
 * as a sigil cell and the lintel's joints fall between its sigil columns,
 * so no joint runs through a sigil (spawn-portal-stone.spec.ts).
 */
export const PORTAL_MASONRY: readonly MasonryBand[] = [
  // Plinths: their two steps are the courses
  { name: 'plinths', below: PORTAL_PLINTH_TOP, course: 1.1, courseOrigin: PORTAL_PLINTH_TOP, front: 1.3, side: 1.3, blockOrigin: 0, bond: true },
  // Pillars: one block across the front, two in the depth of the sides
  {
    name: 'pillars', below: PORTAL_OPENING_HEIGHT,
    course: SIGIL_LAYOUT.pillarPitch, courseOrigin: SIGIL_LAYOUT.pillarBottom,
    front: 0, side: 2, blockOrigin: 0, bond: true,
  },
  // Lintel: one course of stones, a sigil on each
  { name: 'lintel', below: PORTAL_LINTEL_TOP, course: 0, courseOrigin: 0, front: SIGIL_LAYOUT.lintelPitch, side: 0, blockOrigin: -LINTEL_HALF, bond: false },
  // Cornice: long slabs, their joints clear of the lintel's
  { name: 'cornice', below: PORTAL_CORNICE_TOP, course: 0, courseOrigin: 0, front: 3.85, side: 0, blockOrigin: 1.925, bond: false },
  // Crown, spikes and horns
  { name: 'crown', below: Infinity, course: 1.3, courseOrigin: PORTAL_CORNICE_TOP, front: 1.6, side: 1.4, blockOrigin: 0, bond: true },
];

function glslFloat(value: number): string {
  const text = value.toFixed(4);
  return text === '-0.0000' ? '0.0000' : text;
}

function masonryBranches(): string {
  const last = PORTAL_MASONRY.length - 1;
  return PORTAL_MASONRY.map((band, i) => {
    const head = i === last ? 'else' : `${i === 0 ? '' : 'else '}if (y < ${glslFloat(band.below)})`;
    return `${head} { // ${band.name}
      courseH = ${glslFloat(band.course)};
      courseO = ${glslFloat(band.courseOrigin)};
      blockL = side ? ${glslFloat(band.side)} : ${glslFloat(band.front)};
      blockO = ${glslFloat(band.blockOrigin)};
      bond = ${band.bond ? '1.0' : '0.0'};
    }`;
  }).join(' ');
}

/**
 * GLSL of the stone, after PORTAL_NOISE_GLSL (portalHash, portalNoise,
 * portalFbm). portalStone() shades a point of the frame: portal-space
 * position and flat normal, its place on the face (aFace, aWidth), the key
 * light in portal space, the pixel's footprint (m) that fades the fine
 * structure out in the distance, and the portal's opening, energy,
 * flicker and colours.
 *
 * Cost per frame pixel: about 17 value-noise lookups, one 3 by 3 Worley
 * lookup and the masonry arithmetic, no texture reads; nothing per vertex.
 */
export const PORTAL_STONE_GLSL = /* glsl */ `
  const float STONE_PLINTH_TOP = ${glslFloat(PORTAL_PLINTH_TOP)};
  const float STONE_CORNICE_TOP = ${glslFloat(PORTAL_CORNICE_TOP)};

  // Worley noise over a unit grid: distances to the nearest and second
  // nearest feature point; F2 - F1 is small along the cells' borders
  vec2 portalWorley(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 site = o + vec2(portalHash(cell + o), portalHash(cell + o + 31.7));
        float d = length(site - f);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return vec2(f1, f2);
  }

  // Masonry of the band y lies in (PORTAL_MASONRY): course height and a
  // joint's height, block length for the face and a joint's position, bond
  void portalMasonry(float y, bool side, out float courseH, out float courseO,
                     out float blockL, out float blockO, out float bond) {
    ${masonryBranches()}
  }

  vec3 portalStone(vec3 p, vec3 ln, vec3 face, vec2 width, vec3 light, float footprint,
                   vec2 opening, float energy, float flicker, vec3 ember, vec3 hot) {
    vec3 an = abs(ln);
    bool top = an.y > max(an.x, an.z);
    bool side = !top && an.x > an.z;
    // The face's plane: u across (x, or z on the sides), v up (z on tops and bottoms)
    vec2 uv = top ? p.xz : (side ? p.zy : p.xy);
    vec3 U = side ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 V = top ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    // The fine structure fades out where a pixel covers more than a few centimetres
    float detail = 1.0 - smoothstep(0.04, 0.15, footprint);

    // Ashlar joints; a top or bottom face takes the course of its own block
    float y = top ? p.y - 0.05 * sign(ln.y) : p.y;
    float courseH;
    float courseO;
    float blockL;
    float blockO;
    float bond;
    portalMasonry(y, side, courseH, courseO, blockL, blockO, bond);
    float course = 0.0;
    float jointY = 1000.0;
    float towardY = 0.0;
    if (courseH > 0.0) {
      float c = (y - courseO) / courseH;
      course = floor(c);
      float into = fract(c) * courseH;
      if (!top) {
        jointY = min(into, courseH - into);
        towardY = into > 0.5 * courseH ? 1.0 : -1.0;
      }
    }
    float block = 0.0;
    float jointX = 1000.0;
    float towardX = 0.0;
    if (blockL > 0.0) {
      float b = (uv.x - blockO) / blockL + bond * 0.5 * mod(course, 2.0);
      block = floor(b);
      float into = fract(b) * blockL;
      jointX = min(into, blockL - into);
      towardX = into > 0.5 * blockL ? 1.0 : -1.0;
    }
    float joint = min(jointX, jointY);
    vec3 jointTilt = jointX < jointY ? U * towardX : V * towardY;

    // Edges of the frame block the face belongs to
    float halfWidth = 0.5 * mix(width.x, width.y, clamp(face.y / max(face.z, 0.001), 0.0, 1.0));
    float edgeAcross = halfWidth - abs(face.x);
    float edgeUp = min(face.y, face.z - face.y);
    float edge = max(min(edgeAcross, edgeUp), 0.0);
    vec3 edgeTilt = edgeAcross < edgeUp ? U * sign(face.x) : V * sign(face.y - 0.5 * face.z);

    // A tone per ashlar, grain, rubbed edges and chips broken off them
    float tone = 0.78 + 0.44 * portalHash(vec2(block, course) + vec2(courseO, blockO) * 7.3);
    float grain = portalNoise(uv * 1.9 + p.z * 0.7) * 0.6 + portalNoise(uv * 6.1 + 3.3) * 0.4;
    float fine = portalNoise(uv * 13.0 + 7.1);
    float nearEdge = min(edge, joint + 0.02);
    float wearWidth = 0.05 + 0.13 * portalNoise(uv * 3.3 + 17.0) + 0.04 * fine;
    float worn = (1.0 - smoothstep(0.6 * wearWidth, wearWidth, nearEdge)) * detail;
    float chipped = worn * step(0.56, portalNoise(uv * 7.3 + 41.0));

    // Cracks along the borders of large Worley cells, in patches and round
    // the opening
    float dOpen = length(vec2(max(abs(p.x) - opening.x, 0.0), max(p.y - opening.y, 0.0))) + abs(p.z) * 0.3;
    float nearOpen = exp(-dOpen * 0.6);
    vec2 cells = portalWorley(uv * 0.8 + vec2(3.7, 1.3));
    float crackLine = 1.0 - smoothstep(0.02, 0.06 + footprint, cells.y - cells.x);
    float crackArea = smoothstep(0.5, 0.72, portalNoise(uv * 0.3 + vec2(9.0, 2.0)));
    float crack = crackLine * max(crackArea, 0.8 * nearOpen) * detail;

    // Albedo: dark basalt, streaks run down by the rain, grime at the foot,
    // lighter where edges wore or chipped, soot and burn marks round the
    // opening, dark in the cracks
    float streaks = portalNoise(vec2(uv.x * 2.3 + p.z * 1.7, p.y * 0.22));
    float grime = 1.0 - smoothstep(-0.5, 3.5, p.y);
    vec3 albedo = vec3(0.055, 0.049, 0.05) * tone * (0.65 + 0.6 * grain) * (1.0 - 0.4 * streaks) * (1.0 - 0.4 * grime);
    albedo *= 1.0 + 0.2 * (fine - 0.5) * detail;
    albedo = mix(albedo, albedo * 1.7 + 0.006, 0.7 * worn);
    albedo = mix(albedo, vec3(0.1, 0.095, 0.09) * tone, 0.8 * chipped);
    float soot = nearOpen * (0.55 + 0.45 * portalFbm(uv * 0.9 + 4.0));
    // Smoke rises: soot streaks up the faces over the opening
    float over = step(opening.y, p.y) * step(abs(p.x), opening.x + 0.5);
    soot = max(soot, over * smoothstep(0.35, 0.85, portalNoise(vec2(uv.x * 1.4, p.y * 0.3))) * exp(-(p.y - opening.y) * 0.5));
    float burn = smoothstep(0.6, 0.78, portalFbm(uv * 0.45 + 7.0)) * exp(-dOpen * 0.35);
    albedo = mix(albedo, vec3(0.012, 0.009, 0.008), clamp(max(0.85 * soot, 0.9 * burn), 0.0, 1.0));
    albedo *= 1.0 - 0.8 * crack;

    // Relief: chamfered block edges and arrises at the joints, a fine bump,
    // rougher on the chips
    float bevelJoint = 1.0 - smoothstep(0.03, 0.16, joint);
    float bevelEdge = 1.0 - smoothstep(0.0, 0.12, edge);
    float h0 = portalNoise(uv * 4.0);
    vec2 slope = vec2(portalNoise(uv * 4.0 + vec2(0.2, 0.0)) - h0, portalNoise(uv * 4.0 + vec2(0.0, 0.2)) - h0)
      * (0.9 + 1.6 * chipped) * detail;
    vec3 n = normalize(ln + jointTilt * 0.7 * bevelJoint + edgeTilt * 0.8 * bevelEdge - U * slope.x - V * slope.y);

    // Occlusion: joints and cracks, the ground, where the pillars meet the
    // lintel, and on the sides of what stands on the plinths and the cornice
    float sides = top ? 0.0 : 1.0;
    float gap = 1.0 - smoothstep(0.02, 0.045 + footprint, joint);
    float ao = (1.0 - 0.85 * gap) * (1.0 - 0.3 * bevelJoint) * (1.0 - 0.5 * crack);
    ao *= 0.55 + 0.45 * smoothstep(0.0, 1.2, p.y);
    ao *= 1.0 - 0.45 * exp(-abs(p.y - opening.y) * 1.8) * step(p.y, opening.y + 0.01) * step(abs(p.x), opening.x + 3.0);
    ao *= 1.0 - 0.35 * sides * exp(-max(p.y - STONE_PLINTH_TOP, 0.0) * 2.5) * step(STONE_PLINTH_TOP - 0.01, p.y);
    ao *= 1.0 - 0.35 * sides * exp(-max(p.y - STONE_CORNICE_TOP, 0.0) * 2.5) * step(STONE_CORNICE_TOP - 0.01, p.y);

    // Light: the key light and the sky, the core's dark red light, strongest
    // on the faces round the opening, and the cracks near it glowing from within
    float key = max(dot(n, light), 0.0);
    float sky = 0.55 + 0.45 * n.y;
    vec3 col = albedo * ao * (0.45 * sky + 0.9 * key);
    vec3 toCore = vec3(0.0, opening.y * 0.45, 0.0) - p;
    float dCore = length(toCore);
    float wrap = clamp(dot(n, toCore / dCore) * 0.6 + 0.4, 0.0, 1.0);
    col += ember * wrap * wrap * exp(-dCore * 0.2) * ao * (0.45 + 0.9 * energy) * flicker;
    col += mix(ember, hot, 0.3) * crack * nearOpen * (0.2 + 0.5 * energy) * flicker;
    return col;
  }
`;
