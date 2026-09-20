import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3 } from 'three';
import { TD_THEME } from '../../../styles/td-theme';

/**
 * Size of a badge: BADGE_PX CSS pixels on screen, held in the world between
 * BADGE_MIN_M and BADGE_MAX_M. Up close it stays in scale with the tower
 * instead of shrinking to a speck beside it; far out it shrinks with the
 * world instead of carpeting the overview. In between it reads the same at
 * every zoom.
 */
export const BADGE_PX = 24;
export const BADGE_MIN_M = 1.4;
export const BADGE_MAX_M = 9;

/** Camera distances (m) over which the badges fade out */
export const BADGE_FADE_START_M = 700;
export const BADGE_FADE_END_M = 1100;

const BADGE_VERTEX = /* glsl */ `
  attribute vec3 aAnchor; // top of the tower model, scene-local
  attribute vec4 aStyle;  // chevrons (0..3), star (0/1), gold (0/1), hold fire (0/1); all zero = free slot

  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform float uWorldPerPixel; // world size of one CSS pixel 1 m from the camera
  uniform vec3 uSize;           // CSS px on screen, min m, max m
  uniform vec2 uFade;           // fade start, fade end (m)

  varying vec2 vP;
  varying vec4 vStyle;
  varying float vFade;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    float dist = distance(cameraPosition, aAnchor);
    vFade = 1.0 - smoothstep(uFade.x, uFade.y, dist);

    // Free slots and badges faded out collapse to a clipped vertex
    if (aStyle.x + aStyle.y + aStyle.w <= 0.0 || vFade <= 0.0) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vP = vec2(0.0);
      vStyle = vec4(0.0);
      vFade = 0.0;
      return;
    }

    float size = clamp(uSize.x * uWorldPerPixel * dist, uSize.y, uSize.z);
    // Billboard, its lower edge a quarter of its size above the model's top
    vec3 center = aAnchor + vec3(0.0, size * 0.75, 0.0);
    vec3 worldPos = center
                  + uCameraRight * (position.x * size)
                  + uCameraUp * (position.y * size);
    vP = position.xy * 2.0;
    vStyle = aStyle;

    // The mesh sits at the identity origin, aAnchor is already in world space
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`;

const BADGE_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uSilver;
  uniform vec3 uGold;
  uniform vec3 uHold;
  uniform vec3 uOutline;

  varying vec2 vP;
  varying vec4 vStyle;
  varying float vFade;

  #include <logdepthbuf_pars_fragment>

  // The insignia in the quad's [-1, 1] square, y up
  const float CHEVRON_HALF_WIDTH = 0.7;
  const float CHEVRON_RISE = 0.4;
  const float CHEVRON_HALF_THICKNESS = 0.12;
  const float CHEVRON_GAP = 0.46;
  const float OUTLINE = 0.11;
  const float RIM = 0.07;
  // Pause sign of a tower holding fire: two upright bars
  const float PAUSE_HALF_GAP = 0.3;
  const float PAUSE_HALF_HEIGHT = 0.5;
  const float PAUSE_HALF_WIDTH = 0.17;

  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // Chevron pointing up, its arms ending at height y
  float sdChevron(vec2 p, float y) {
    p.x = abs(p.x);
    return sdSegment(p, vec2(0.0, y + CHEVRON_RISE), vec2(CHEVRON_HALF_WIDTH, y)) - CHEVRON_HALF_THICKNESS;
  }

  // Five-pointed star, a point up (sdStar5 after Inigo Quilez)
  float sdStar5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }

  void main() {
    #include <logdepthbuf_fragment>

    // One pixel in insignia units, taken before any branch
    float aa = length(fwidth(vP)) * 0.7;

    float d;
    if (vStyle.w > 0.5) {
      vec2 p = vP;
      p.x = abs(p.x) - PAUSE_HALF_GAP;
      d = sdSegment(p, vec2(0.0, -PAUSE_HALF_HEIGHT), vec2(0.0, PAUSE_HALF_HEIGHT)) - PAUSE_HALF_WIDTH;
    } else if (vStyle.y > 0.5) {
      d = sdStar5(vP - vec2(0.0, -0.08), 0.86, 0.45);
    } else {
      float n = floor(vStyle.x + 0.5);
      float y0 = -(CHEVRON_RISE + (n - 1.0) * CHEVRON_GAP) * 0.5;
      d = sdChevron(vP, y0);
      if (n > 1.5) d = min(d, sdChevron(vP, y0 + CHEVRON_GAP));
      if (n > 2.5) d = min(d, sdChevron(vP, y0 + 2.0 * CHEVRON_GAP));
    }

    float fill = 1.0 - smoothstep(-aa, aa, d);
    float edge = 1.0 - smoothstep(-aa, aa, d - OUTLINE);
    float alpha = max(fill, edge * 0.85) * vFade;
    if (alpha < 0.01) discard;

    // Metal with a darker rim inside the dark outline: a step, not a gradient
    vec3 metal = mix(mix(uSilver, uGold, vStyle.z), uHold, vStyle.w);
    float rim = smoothstep(-aa, aa, d + RIM);
    vec3 color = mix(uOutline, mix(metal, metal * 0.62, rim), fill);

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Material of the veteran badges. The colours are td-theme tokens, turned
 * into linear values by three's colour management; colorspace_fragment
 * encodes the result for the canvas (sRGB) or leaves it linear when the
 * post-processing composer renders into its linear target. The billboard
 * axes are shared by reference, one write per frame moves every badge.
 */
export function createBadgeMaterial(cameraRight: Vector3, cameraUp: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uCameraRight: { value: cameraRight },
      uCameraUp: { value: cameraUp },
      uWorldPerPixel: { value: 0.001 },
      uSize: { value: new Vector3(BADGE_PX, BADGE_MIN_M, BADGE_MAX_M) },
      uFade: { value: new Vector2(BADGE_FADE_START_M, BADGE_FADE_END_M) },
      uSilver: { value: new Color(TD_THEME.edgeHighlight) },
      uGold: { value: new Color(TD_THEME.goldLight) },
      uHold: { value: new Color(TD_THEME.healthRed) },
      uOutline: { value: new Color(TD_THEME.panelShadow) },
    },
    vertexShader: BADGE_VERTEX,
    fragmentShader: BADGE_FRAGMENT,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
