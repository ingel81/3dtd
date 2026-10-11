/**
 * A map script as the evaluator's program: JASS through `parseJass`, Lua
 * through `parseLua` into the same syntax tree.
 */
import { type JassProgram, parseJass } from './jass-parser';
import { parseLua } from './lua-parser';

const parsedScripts = new WeakMap<object, JassProgram>();

/**
 * The script's program, parsed once however many steps of the import read
 * it (routes, waves); the program is read only
 */
export function parseScript(script: { text: string; language?: string }): JassProgram {
  let program = parsedScripts.get(script);
  if (!program) {
    program = script.language === 'lua' ? parseLua(script.text) : parseJass(script.text);
    parsedScripts.set(script, program);
  }
  return program;
}
