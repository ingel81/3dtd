import { Vector4, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  MAX_SPAWN_PORTALS,
  PORTAL_CLIP,
  PORTAL_DEPTH,
  PORTAL_OPENING_WIDTH,
  portalDepthScale,
} from '../../configs/marker-geometry.config';
import { SPAWN_PORTAL_LOOK } from '../../configs/visual-effects.config';
import { portalFrontDistance, type SpawnPortalPose } from './marker/spawn-portal-pose';

/**
 * Where the spawn portals hide the enemies still behind their plane
 * (PORTAL_CLIP): one box per portal, in scene space like the poses and the
 * enemies (geoToLocalSimple). One object for all enemy materials (the VAT
 * types, the health bars, the oozes) and the overlays along the routes (the
 * route lines and their animation, the Route Grid Overlay);
 * SpawnPortalManager writes it when a portal is added, moved, turned or
 * removed (setPortalClips), not per frame.
 */
export interface PortalClipUniforms {
  /** Portals in the lists, the first ones */
  uPortalClipCount: IUniform<number>;
  /** Per portal: the centre of its plane on the ground (x, z), the way out (unit x, z) */
  uPortalClipPlane: IUniform<Vector4[]>;
  /** Per portal: half width, depth behind the plane, bottom and top (scene y) */
  uPortalClipBox: IUniform<Vector4[]>;
}

export function createPortalClipUniforms(): PortalClipUniforms {
  const list = () => Array.from({ length: MAX_SPAWN_PORTALS }, () => new Vector4());
  return {
    uPortalClipCount: { value: 0 },
    uPortalClipPlane: { value: list() },
    uPortalClipBox: { value: list() },
  };
}

/**
 * Put the clip boxes of the portals standing on `poses` into `uniforms`, the
 * first MAX_SPAWN_PORTALS of them. A box lies behind the portal's plane
 * (portalFrontDistance ahead of the pose, facing its heading), PORTAL_DEPTH
 * deep and PORTAL_CLIP.top high, both times portalDepthScale, PORTAL_CLIP.side
 * wider than the opening on either side, from PORTAL_CLIP.below under the
 * pose's ground.
 */
export function setPortalClips(uniforms: PortalClipUniforms, poses: Iterable<Readonly<SpawnPortalPose>>): void {
  let count = 0;
  for (const pose of poses) {
    if (count === MAX_SPAWN_PORTALS) break;
    const forwardX = Math.sin(pose.heading);
    const forwardZ = Math.cos(pose.heading);
    const front = portalFrontDistance(pose.scale);
    const depthScale = portalDepthScale(pose.scale);
    uniforms.uPortalClipPlane.value[count].set(pose.x + forwardX * front, pose.z + forwardZ * front, forwardX, forwardZ);
    uniforms.uPortalClipBox.value[count].set(
      (PORTAL_OPENING_WIDTH / 2) * pose.scale + PORTAL_CLIP.side,
      PORTAL_DEPTH * depthScale,
      pose.y - PORTAL_CLIP.below,
      pose.y + PORTAL_CLIP.top * depthScale,
    );
    count++;
  }
  uniforms.uPortalClipCount.value = count;
}

function glslFloat(value: number): string {
  return value.toFixed(4);
}

const SEAM = SPAWN_PORTAL_LOOK.seam;
const { ember, hot } = SPAWN_PORTAL_LOOK.palette;
const seamChannel = (a: number, b: number) => glslFloat((a + (b - a) * SEAM.heat) * SEAM.gain);

/**
 * GLSL of the clip, for the vertex or the fragment shader of an enemy
 * material that has the PortalClipUniforms:
 *
 * - portalClipAhead(p): how far the scene point p stands in front of the
 *   plane of a portal whose box lies right behind it (m), the least such;
 *   below 0 where p is inside a box, which the material drops;
 *   PORTAL_CLIP_CLEAR where no box lies behind p. One loop over the
 *   portals, ended after the last and as soon as p is in a box.
 * - portalSeam(ahead, footprint): how strongly the seam glows at `ahead`,
 *   1 on the plane, 0 from SPAWN_PORTAL_LOOK.seam.width in front of it, but
 *   over at least 1.5 `footprint` (metres per pixel), so it does not
 *   flicker away far off.
 * - PORTAL_SEAM_COLOR: the seam's colour in display values.
 */
export const PORTAL_CLIP_GLSL = /* glsl */ `
  uniform int uPortalClipCount;
  uniform vec4 uPortalClipPlane[${MAX_SPAWN_PORTALS}];
  uniform vec4 uPortalClipBox[${MAX_SPAWN_PORTALS}];

  const float PORTAL_CLIP_CLEAR = 1e4;
  const float PORTAL_SEAM_WIDTH = ${glslFloat(SEAM.width)};
  const vec3 PORTAL_SEAM_COLOR = vec3(${seamChannel(ember.r, hot.r)}, ${seamChannel(ember.g, hot.g)}, ${seamChannel(ember.b, hot.b)});

  float portalClipAhead(vec3 p) {
    float ahead = PORTAL_CLIP_CLEAR;
    for (int i = 0; i < ${MAX_SPAWN_PORTALS}; i++) {
      if (i >= uPortalClipCount) break;
      vec4 plane = uPortalClipPlane[i];
      vec4 box = uPortalClipBox[i];
      vec2 d = p.xz - plane.xy;
      float along = dot(d, plane.zw);
      if (along < -box.y || along >= ahead) continue;
      // Across the way out, and up
      if (abs(d.x * plane.w - d.y * plane.z) > box.x || p.y < box.z || p.y > box.w) continue;
      if (along < 0.0) return along;
      ahead = along;
    }
    return ahead;
  }

  float portalSeam(float ahead, float footprint) {
    return 1.0 - smoothstep(0.0, max(PORTAL_SEAM_WIDTH, 1.5 * footprint), ahead);
  }
`;

/**
 * GLSL for an overlay drawn along the routes that ends at the portals'
 * planes like the enemies, without the seam: the routes and their cells run
 * on to path[0] behind the plane, where the enemies start, but show only in
 * front of it. The vertex shader sets PORTAL_CLIP_VARYING
 * (vPortalClipPos) to the scene point of the vertex, the fragment shader
 * takes PORTAL_CLIP_GLSL and the varying and starts main with
 * PORTAL_CLIP_DISCARD.
 */
export const PORTAL_CLIP_VARYING = /* glsl */ `
  varying vec3 vPortalClipPos;
`;

export const PORTAL_CLIP_DISCARD = /* glsl */ `
  if (portalClipAhead(vPortalClipPos) < 0.0) discard;
`;

/**
 * Clip a line of three's LineMaterial (Line2) at the portals' planes, as
 * PORTAL_CLIP_DISCARD does: the route lines (RouteLineLayer) and the route
 * animation (RouteAnimationService). The line's ends in its own coordinates
 * are the scene points: its points come from geoToLocalSimple like the
 * poses, and it hangs in the overlay group like the portals. LineMaterial
 * brings its log depth chunks.
 */
export function clipLineMaterial(material: LineMaterial, uniforms: PortalClipUniforms): void {
  Object.assign(material.uniforms, uniforms);
  material.onBeforeCompile = clipLineShader;
}

function clipLineShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    `${PORTAL_CLIP_VARYING}
    void main() {
      vPortalClipPos = position.y < 0.5 ? instanceStart : instanceEnd;`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    'void main() {',
    `${PORTAL_CLIP_GLSL}
    ${PORTAL_CLIP_VARYING}
    void main() {
      ${PORTAL_CLIP_DISCARD}`,
  );
}
