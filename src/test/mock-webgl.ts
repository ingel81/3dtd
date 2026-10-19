/**
 * A stand-in WebGL2 context for three's own WebGLRenderer in jsdom: it
 * compiles and draws nothing and keeps the source of every shader. It
 * answers only what three asks while it sets up, compiles and draws:
 * constants as made-up numbers, limits of a desktop GPU, highp in both
 * stages, no extension but float colour buffers, every compile and link a
 * success. The shader check (tools/shader-check) reads the sources; specs
 * count what three keeps (renderer.info) with it.
 */

export interface MockShader {
  source: string;
}

export interface MockProgram {
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

export function createMockContext(): WebGL2RenderingContext {
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
