import { ShaderChunk, ShaderLib, UniformsUtils, type Material } from 'three';

/** What the scene gives a program beyond the material: the map views' (an environment map, the sun with its shadow) */
export interface ProgramScene {
  envMap?: boolean;
  /** Directional lights, and how many of them cast a shadow */
  directional?: number;
  directionalShadows?: number;
}

const MAP_SCENE: Required<ProgramScene> = { envMap: true, directional: 1, directionalShadows: 1 };

/**
 * The texture units three gives a material's program: its shader as three
 * builds it for `lib` after the material's onBeforeCompile, with the
 * defines three sets for the material and the scene, includes resolved and
 * the preprocessor run, then every sampler uniform either stage reads from
 * main (a declared one nothing reads is dropped by the compiler and takes
 * no unit), once, an array as its length. Without WebGL: what a spec per
 * program counts against the hardware's 16 (three warns from the 17th).
 */
export function programSamplers(material: Material, lib: keyof typeof ShaderLib = 'standard', scene: ProgramScene = MAP_SCENE): string[] {
  const s = { ...MAP_SCENE, ...scene };
  const source = ShaderLib[lib];
  const shader = {
    uniforms: UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    defines: { ...((material as { defines?: Record<string, unknown> }).defines ?? {}) },
  };
  material.onBeforeCompile(shader as never, null as never);
  const defines = new Map<string, string>();
  for (const [k, v] of Object.entries(shader.defines)) if (v !== false) defines.set(k, String(v === true ? '' : v));
  if (lib === 'standard' || lib === 'physical') defines.set('STANDARD', '');
  if (s.envMap) {
    defines.set('USE_ENVMAP', '');
    defines.set('ENVMAP_TYPE_CUBE_UV', '');
  }
  if (s.directionalShadows > 0) defines.set('USE_SHADOWMAP', '');
  const counts: Record<string, number> = {
    NUM_DIR_LIGHTS: s.directional,
    NUM_DIR_LIGHT_SHADOWS: s.directionalShadows,
    NUM_POINT_LIGHTS: 0,
    NUM_SPOT_LIGHTS: 0,
    NUM_RECT_AREA_LIGHTS: 0,
    NUM_HEMI_LIGHTS: 0,
    NUM_POINT_LIGHT_SHADOWS: 0,
    NUM_SPOT_LIGHT_SHADOWS: 0,
    NUM_SPOT_LIGHT_MAPS: 0,
    NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS: 0,
    NUM_LIGHT_PROBES: 0,
    NUM_CLIPPING_PLANES: 0,
    UNION_CLIPPING_PLANES: 0,
  };
  for (const [k, v] of Object.entries(counts)) defines.set(k, String(v));
  const names = new Set<string>();
  for (const stage of [shader.vertexShader, shader.fragmentShader]) {
    const stageDefines = new Map(defines);
    const src = preprocess(resolveIncludes(stage), stageDefines);
    const live = liveCode(src);
    for (const name of samplersOf(src, stageDefines)) {
      if (new RegExp(`\\b${name.replace(/\[\d+\]$/, '')}\\b`).test(live)) names.add(name);
    }
  }
  return [...names];
}

/** The code main reaches: its body and those of the functions it calls, at any depth */
function liveCode(src: string): string {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bodies = new Map<string, string[]>();
  const head = /\b(\w+)\s*\(([^()]*)\)\s*\{/g;
  let k = 0;
  while (k < code.length) {
    const brace = code.indexOf('{', k);
    if (brace < 0) break;
    head.lastIndex = k;
    const m = head.exec(code);
    const close = matchBrace(code, brace);
    // A function's head right before the brace (a struct's or a block's is none)
    if (m && m.index + m[0].length - 1 === brace) {
      const list = bodies.get(m[1]) ?? [];
      list.push(code.slice(brace, close + 1));
      bodies.set(m[1], list);
    }
    k = close + 1;
  }
  const live = new Set(['main']);
  const queue = ['main'];
  const parts: string[] = [];
  while (queue.length) {
    for (const body of bodies.get(queue.pop()!) ?? []) {
      parts.push(body);
      for (const id of body.match(/\b\w+(?=\s*\()/g) ?? []) {
        if (bodies.has(id) && !live.has(id)) {
          live.add(id);
          queue.push(id);
        }
      }
    }
  }
  return parts.join('\n');
}

function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}' && --depth === 0) return k;
  }
  return code.length - 1;
}

function resolveIncludes(src: string): string {
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name: string) => {
    const chunk = (ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`Unknown shader chunk ${name}`);
    return resolveIncludes(chunk);
  });
}

/** The lines the preprocessor keeps, #define, #undef, #if, #ifdef, #ifndef, #elif, #else and #endif applied */
function preprocess(src: string, defines: Map<string, string>): string {
  const out: string[] = [];
  // Per open block: whether its branch is on, whether one of its branches was taken, whether the block around is on
  const stack: { on: boolean; taken: boolean; outer: boolean }[] = [];
  const active = () => stack.every((b) => b.on);
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    const m = /^#\s*(\w+)\s*(.*)$/.exec(line);
    if (!m) {
      if (active()) out.push(raw);
      continue;
    }
    const [, directive, rest] = m;
    switch (directive) {
      case 'if':
      case 'ifdef':
      case 'ifndef': {
        const outer = active();
        const name = rest.trim();
        const on = outer && (directive === 'ifdef' ? defines.has(name) : directive === 'ifndef' ? !defines.has(name) : evaluate(rest, defines));
        stack.push({ on, taken: on, outer });
        break;
      }
      case 'elif': {
        const b = stack[stack.length - 1];
        b.on = b.outer && !b.taken && evaluate(rest, defines);
        b.taken ||= b.on;
        break;
      }
      case 'else': {
        const b = stack[stack.length - 1];
        b.on = b.outer && !b.taken;
        b.taken = true;
        break;
      }
      case 'endif':
        stack.pop();
        break;
      case 'define':
        if (active()) {
          const d = /^(\w+)(?:\s+(.*))?$/.exec(rest.trim());
          if (d && !d[1].includes('(')) defines.set(d[1], (d[2] ?? '').trim());
          out.push(raw);
        }
        break;
      case 'undef':
        if (active()) defines.delete(rest.trim());
        break;
      default:
        if (active()) out.push(raw);
    }
  }
  return out.join('\n');
}

/** A #if expression: defined(), numbers, the defines' values (unknown names 0), C operators */
function evaluate(expr: string, defines: Map<string, string>): boolean {
  const js = expr
    .replace(/\/\/.*$/, '')
    .replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a: string, b: string) => (defines.has(a ?? b) ? '1' : '0'))
    .replace(/\b[A-Za-z_]\w*\b/g, (name) => {
      const v = defines.get(name);
      return v !== undefined && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : '0';
    });
  return !!Function(`return (${js});`)();
}

/** Sampler uniforms of a stage, an array as one name per element */
function samplersOf(src: string, defines: Map<string, string>): string[] {
  const names: string[] = [];
  const re = /uniform\s+(?:(?:highp|mediump|lowp)\s+)?[iu]?sampler\w*\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/g;
  for (const m of src.matchAll(re)) {
    if (m[2] === undefined) {
      names.push(m[1]);
      continue;
    }
    const length = Number(/^\d+$/.test(m[2]) ? m[2] : defines.get(m[2]));
    for (let k = 0; k < length; k++) names.push(`${m[1]}[${k}]`);
  }
  return names;
}
