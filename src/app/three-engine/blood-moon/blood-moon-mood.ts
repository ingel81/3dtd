import {
  AddEquation,
  Color,
  CustomBlending,
  Fog,
  Mesh,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcColorFactor,
  Uniform,
  Vector3,
  ZeroFactor,
  type Scene,
} from 'three';
import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';
import { DrawGate } from '../renderers/draw-gate';

/**
 * After every opaque object of the world (tiles, towers, plinths, enemies),
 * before anything transparent: fire, muzzle flashes, projectiles, the
 * searchlights and the 3D UI (health bars, range, LOS cells) keep their own
 * colours and read as light in the red night. What is transparent but part
 * of the world multiplies by the tint in its own shader: blending enemies,
 * the ooze band and the ground decals (bloodMoonMultiplier).
 */
const MOOD_ORDER = 900;

/** Display values into the linear post-processing target, about sRGB */
export const LINEAR_EXPONENT = 2.2;

/** The mood's tint in display values at `amount`: 1 at 0, BLOOD_MOON_LOOK.mood.tint at 1. */
export function bloodMoonTintAt(amount: number, target: Vector3): Vector3 {
  const k = Math.min(1, Math.max(0, amount));
  const { tint } = BLOOD_MOON_LOOK.mood;
  return target.set(1 + (tint.r - 1) * k, 1 + (tint.g - 1) * k, 1 + (tint.b - 1) * k);
}

/**
 * What the mood multiplies the frame by at `amount`, without the darker
 * corners, in the values of the target: display values on the canvas,
 * linear ones in the post-processing target.
 */
export function bloodMoonMultiplier(amount: number, linearOutput: boolean, target: Vector3): Vector3 {
  bloodMoonTintAt(amount, target);
  if (linearOutput) {
    target.set(target.x ** LINEAR_EXPONENT, target.y ** LINEAR_EXPONENT, target.z ** LINEAR_EXPONENT);
  }
  return target;
}

const MOOD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const MOOD_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTint;
  uniform float uVignette;
  uniform float uExponent;

  varying vec2 vUv;

  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    // 0 in the middle of the screen, 1 in the corners
    vec2 d = vUv - 0.5;
    float edge = smoothstep(0.2, 1.0, dot(d, d) * 2.0);
    vec3 shade = uTint * (1.0 - uVignette * edge);
    // The blending multiplies the frame by this colour
    gl_FragColor = vec4(pow(shade, vec3(uExponent)), 1.0);
  }
`;

function noRaycast(): void {
  // a screen tint, nothing to pick
}

/**
 * The red, dark mood of the blood moon (BLOOD_MOON_LOOK.mood).
 *
 * A screen quad multiplies the frame (blend factors zero and source colour)
 * at the end of the opaque pass, see MOOD_ORDER. A multiply cannot mix
 * channels, so there is no desaturation, only the red cast and the darker
 * corners. It is not a post-processing pass on purpose: the composer runs
 * only with bloom or colour grading on, and switching it on for the blood
 * moon would change how the custom shaders that write display values (the
 * enemies among them) come out, a jump right at the wave start. The quad
 * works the same on the canvas and in the composer target; into the linear
 * target its colour is raised to 2.2, so the multiply matches.
 *
 * The sky dims through `scene.backgroundIntensity`, the distance fog shifts
 * towards a dark red. At amount 0 both are back at exactly their own values
 * and the quad is out of the render list.
 */
export class BloodMoonMood {
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly gate: DrawGate;
  private readonly tint = new Vector3(1, 1, 1);
  /** The fog colour the scene had, restored at amount 0 */
  private readonly fogBase: Color | null;
  private readonly fogTarget = new Color(BLOOD_MOON_LOOK.mood.fogColor);

  constructor(private readonly scene: Scene) {
    const material = new ShaderMaterial({
      vertexShader: MOOD_VERTEX_SHADER,
      fragmentShader: MOOD_FRAGMENT_SHADER,
      uniforms: {
        uTint: new Uniform(this.tint),
        uVignette: new Uniform(0),
        uExponent: new Uniform(1),
      },
      // Opaque list, so it draws before every transparent object; the
      // custom blending still applies (three only drops NormalBlending there)
      transparent: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: ZeroFactor,
      blendDst: SrcColorFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), material);
    this.quad.name = 'blood-moon-mood';
    this.quad.frustumCulled = false;
    this.quad.renderOrder = MOOD_ORDER;
    this.quad.raycast = noRaycast;
    this.quad.matrixAutoUpdate = false;
    this.quad.matrixWorldAutoUpdate = false;
    this.gate = new DrawGate([this.quad]);
    scene.add(this.quad);

    this.fogBase = scene.fog instanceof Fog ? scene.fog.color.clone() : null;
  }

  /**
   * 0 = normal look, 1 = full blood moon. `linearOutput`: the frame goes
   * through the post-processing target (bloom or colour grading on).
   */
  setAmount(amount: number, linearOutput: boolean): void {
    const k = Math.min(1, Math.max(0, amount));
    const { vignette, skyIntensity } = BLOOD_MOON_LOOK.mood;
    const uniforms = this.quad.material.uniforms;
    bloodMoonTintAt(k, this.tint);
    uniforms['uVignette'].value = vignette * k;
    uniforms['uExponent'].value = linearOutput ? LINEAR_EXPONENT : 1;
    this.gate.setCount(k > 0 ? 1 : 0);

    this.scene.backgroundIntensity = k > 0 ? 1 + (skyIntensity - 1) * k : 1;
    if (this.fogBase && this.scene.fog instanceof Fog) {
      this.scene.fog.color.copy(this.fogBase);
      if (k > 0) this.scene.fog.color.lerp(this.fogTarget, k);
    }
  }

  /** The quad is in the render list (amount above 0). */
  get visible(): boolean {
    return this.quad.visible;
  }

  dispose(): void {
    this.setAmount(0, false);
    this.scene.remove(this.quad);
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
