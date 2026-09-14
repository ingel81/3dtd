import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * glslangValidator, the Khronos reference front end, as the GLSL compiler
 * of the shader check. Without -V it validates a `#version 300 es` source
 * against GLSL ES 3.00, the language WebGL2 takes; `-l` links both stages,
 * which catches a uniform or varying declared with other types in the two.
 *
 * Not a dependency of the project: the path in GLSLANG_VALIDATOR, else
 * `glslangValidator` on the PATH (a Khronos release or the Vulkan SDK, see
 * docs/ARCHITECTURE.md). Null when neither runs.
 */
export function findGlslang(): string | null {
  const fromEnv = process.env['GLSLANG_VALIDATOR'];
  const candidates = fromEnv ? [fromEnv, 'glslangValidator'] : ['glslangValidator'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

export interface CompileResult {
  ok: boolean;
  /** glslang's messages, each error followed by the lines around it */
  report: string;
}

/**
 * Compile both stages and link them. The sources go to `dir` as
 * `<stem>.vert` and `<stem>.frag`, where they stay for a look.
 */
export function compileProgram(glslang: string, vertex: string, fragment: string, dir: string, stem: string): CompileResult {
  const sources = new Map([
    [join(dir, `${stem}.vert`), vertex],
    [join(dir, `${stem}.frag`), fragment],
  ]);
  for (const [path, source] of sources) writeFileSync(path, source);
  // glslang knows a built-in average() in GLSL ES, which WebGL has not, and
  // rejects the one three's common chunk defines: renamed for glslang only
  const run = spawnSync(glslang, ['-l', '-Daverage=threeAverage', ...sources.keys()], { encoding: 'utf8' });
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`;
  return { ok: run.status === 0, report: withContext(log, sources) };
}

/**
 * A stage's source after the preprocessor: three's defines applied, `varying`
 * already in/out. Throws when glslang fails: empty output would let every
 * check on it pass.
 */
export function preprocess(glslang: string, path: string): string {
  const run = spawnSync(glslang, ['-E', path], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`glslang -E ${path} failed (exit ${run.status}): ${run.stderr || run.stdout || run.error}`);
  }
  return run.stdout;
}

/**
 * glslang prints each file's name before its messages; after every
 * `ERROR: 0:<line>:` the report shows that file's lines around it.
 */
function withContext(log: string, sources: Map<string, string>): string {
  const out: string[] = [];
  let lines: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    out.push(line);
    const source = sources.get(line.trim());
    if (source !== undefined) {
      lines = source.split('\n');
      continue;
    }
    const at = /^ERROR: .*?:(\d+): /.exec(line);
    // "compilation terminated" repeats the line of the error before it
    if (!at || line.includes("'' : compilation terminated")) continue;
    const n = Number(at[1]);
    for (let i = Math.max(1, n - 2); i <= Math.min(lines.length, n + 2); i++) {
      out.push(`${i === n ? '>' : ' '} ${String(i).padStart(5)} | ${lines[i - 1]}`);
    }
  }
  return out.join('\n').trim();
}

/** Declarations `<qualifiers> in|out <type> <name>;` of a preprocessed stage. */
function interfaceVariables(source: string, storage: 'in' | 'out'): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = new RegExp(
    String.raw`^\s*(?:layout\s*\([^)]*\)\s*)?(?:(?:flat|smooth|centroid|invariant)\s+)*${storage}\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*;`,
    'gm',
  );
  for (const match of source.matchAll(pattern)) found.set(match[2], match[1] + (match[3] ?? ''));
  return found;
}

/**
 * Fragment inputs the fragment stage uses but the vertex stage does not
 * write: WebGL fails the link on those, glslang's -l does not report them.
 * (Other type mismatches between the stages are glslang's -l.)
 */
export function unmatchedFragmentInputs(vertexPreprocessed: string, fragmentPreprocessed: string): string[] {
  const outputs = interfaceVariables(vertexPreprocessed, 'out');
  const inputs = interfaceVariables(fragmentPreprocessed, 'in');
  const missing: string[] = [];
  for (const name of inputs.keys()) {
    if (outputs.has(name)) continue;
    const uses = fragmentPreprocessed.match(new RegExp(String.raw`\b${name}\b`, 'g'))?.length ?? 0;
    if (uses > 1) missing.push(name);
  }
  return missing;
}
