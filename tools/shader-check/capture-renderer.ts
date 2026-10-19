import {
  Fog,
  HalfFloatType,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { addSceneLights } from '../../src/app/three-engine/scene-environment';
import { createMockContext, type MockProgram } from '../../src/test/mock-webgl';

/**
 * three's own WebGLRenderer over a stand-in WebGL2 context that compiles
 * nothing and keeps the source of every shader. `renderer.compile()` then
 * runs the whole path a material takes in the game: WebGLPrograms picks the
 * parameters (instancing, fog, lights, log depth, output colour space),
 * onBeforeCompile patches the shader, WebGLProgram resolves the chunks,
 * unrolls the loops and puts the WebGL2 prefix in front. What reaches
 * `shaderSource()` is what the browser's driver would get.
 *
 * The context answers only what three asks while it sets up and compiles:
 * constants as made-up numbers, limits of a desktop GPU, highp in both
 * stages, no extension but float colour buffers, every compile and link a
 * success.
 */

/** A program as three hands it to WebGL: the final GLSL of both stages. */
export interface CapturedProgram {
  /** three's SHADER_NAME: the material's name, else its type */
  name: string;
  vertex: string;
  fragment: string;
}

/** Output and scene a material meets in the game (three-tiles-engine.ts). */
export interface RenderSetup {
  name: string;
  /** Into the post-processing composer's linear target (bloom or colour grading on) instead of the sRGB canvas */
  composerTarget: boolean;
  /** The scene's distance fog; only materials with `fog: true` take it */
  fog: boolean;
}

export const GAME_SETUPS: readonly RenderSetup[] = [
  { name: 'canvas', composerTarget: false, fog: true },
  { name: 'composer', composerTarget: true, fog: true },
  { name: 'canvas-nofog', composerTarget: false, fog: false },
];

/**
 * The programs three builds for what `build` puts into a scene set up like
 * the game's in `setup`: its lights (no point light: the shots and a map's
 * lamps go to the light buffer, shot-lights), its fog, a perspective camera, log depth, sRGB canvas
 * or the composer's half-float target. A ShaderMaterial is one program per
 * setup (forceSinglePass is its default in r186); a built-in material that
 * is transparent and double-sided gives two, back and front, as it draws
 * in two passes.
 */
export function capturePrograms(build: (scene: Scene) => void, setup: RenderSetup): CapturedProgram[] {
  const renderer = new WebGLRenderer({
    canvas: document.createElement('canvas'),
    context: createMockContext(),
    antialias: true,
    logarithmicDepthBuffer: true,
    stencil: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  if (setup.fog) scene.fog = new Fog(0x1a1f25, 2000, 6000);
  addSceneLights(scene);
  build(scene);

  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  const target = setup.composerTarget ? new WebGLRenderTarget(4, 4, { type: HalfFloatType }) : null;
  renderer.setRenderTarget(target);
  renderer.compile(scene, camera);

  return (renderer.info.programs ?? []).map((program) => {
    const [vertex, fragment] = (program.program as unknown as MockProgram).shaders;
    return { name: program.name, vertex: vertex.source, fragment: fragment.source };
  });
}
