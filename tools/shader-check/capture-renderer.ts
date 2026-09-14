import {
  Fog,
  HalfFloatType,
  PerspectiveCamera,
  PointLight,
  SRGBColorSpace,
  Scene,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { addSceneLights } from '../../src/app/three-engine/scene-environment';

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

interface MockShader {
  source: string;
}

interface MockProgram {
  shaders: MockShader[];
}

/** getParameter() answers; any other MAX_* gets 16 */
const LIMITS: Record<string, number> = {
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_TEXTURE_SIZE: 16384,
  MAX_CUBE_MAP_TEXTURE_SIZE: 16384,
  MAX_VERTEX_ATTRIBS: 16,
  MAX_VERTEX_UNIFORM_VECTORS: 4096,
  MAX_VARYING_VECTORS: 30,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
  MAX_SAMPLES: 4,
};

function createMockContext(): WebGL2RenderingContext {
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  const constant = (name: string): number => {
    let id = ids.get(name);
    if (id === undefined) {
      id = 0x8000 + ids.size;
      ids.set(name, id);
      names.set(id, name);
    }
    return id;
  };

  const answers: Record<string, unknown> = {
    isContextLost: () => false,
    getContextAttributes: () => ({
      alpha: true,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    }),
    // Only what the composer's half-float target needs, as every desktop GPU has it
    getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
    getSupportedExtensions: () => [],
    getParameter: (pname: number) => {
      const name = names.get(pname) ?? '';
      if (name === 'VERSION') return 'WebGL 2.0';
      if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00';
      if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return new Int32Array([0, 0, 1, 1]);
      if (name in LIMITS) return LIMITS[name];
      return name.startsWith('MAX_') ? 16 : 0;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getError: () => 0,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    createProgram: (): MockProgram => ({ shaders: [] }),
    createShader: (): MockShader => ({ source: '' }),
    shaderSource: (shader: MockShader, source: string) => {
      shader.source = source;
    },
    attachShader: (program: MockProgram, shader: MockShader) => {
      program.shaders.push(shader);
    },
    getShaderParameter: () => true,
    getProgramParameter: (_program: MockProgram, pname: number) => {
      const name = names.get(pname);
      return name === 'LINK_STATUS' || name === 'VALIDATE_STATUS' ? true : 0;
    },
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
  };

  return new Proxy(answers, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return constant(prop);
      // Every other call: a handle for create*, nothing for the rest
      return prop.startsWith('create') ? () => ({}) : () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
}

/**
 * The programs three builds for what `build` puts into a scene set up like
 * the game's in `setup`: its lights (plus a point light, as a tower's muzzle
 * flash adds one), its fog, a perspective camera, log depth, sRGB canvas
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
  scene.add(new PointLight(0xffaa44, 0, 30));
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
