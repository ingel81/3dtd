/**
 * The waves a Warcraft TD's script spawns, read from its arrays.
 *
 * GUI tower defense maps keep their waves in arrays indexed by the wave
 * number: "Unit-Type[Level]" and "Count[Level]", spawned with
 * `CreateNUnitsAtLoc(Count[Level], UnitType[Level], ...)` (or
 * `CreateUnitAtLoc(player, UnitType[Level], ...)` for one unit). Bosses
 * often sit in parallel arrays (Boss[i], BossWave[i], BossAmount[i]) and are
 * spawned through a pointer slot: `CreateNUnitsAtLoc(BossAmount[BossWave[k]],
 * Boss[BossWave[k]], ...)`. This finds those calls in the script's syntax,
 * runs the map's initialisation (JassEvaluator) and reads the arrays.
 */

import { JassEvaluator } from '../jass/jass-evaluator';
import type { JassExpr, JassProgram, JassStmt } from '../jass/jass-parser';
import { looksLikeRawcode, rawcodeToId } from '../formats/w3u';

export interface ScriptWave {
  wave: number;
  /** Unit id ('n000') */
  unit: string;
  /** Units per spawn point; null where the script does not say (one unit created in a loop) */
  count: number | null;
}

export interface ScriptBoss {
  wave: number;
  unit: string;
  count: number;
}

export interface ScriptWaves {
  waves: ScriptWave[];
  bosses: ScriptBoss[];
  /** The arrays the waves came from, for the report */
  arrays: { unit: string; count: string | null; boss: string | null; bossWave: string | null };
}

interface SpawnCall {
  /** Array of unit types and the expression it is indexed by */
  typeArray: string;
  typeIndex: JassExpr;
  countArray: string | null;
}

/** A creation whose unit type is a plain variable, set wave by wave (`set udg_UNIT = 'hfoo'` per level trigger) */
interface ScalarSpawn {
  typeVar: string;
  count: JassExpr | undefined;
}

function* statements(body: JassStmt[]): Generator<JassStmt> {
  for (const s of body) {
    yield s;
    if (s.k === 'if') {
      for (const b of s.branches) yield* statements(b.body);
      if (s.otherwise) yield* statements(s.otherwise);
    } else if (s.k === 'loop') {
      yield* statements(s.body);
    }
  }
}

function* calls(e: JassExpr): Generator<JassExpr & { k: 'call' }> {
  if (e.k === 'call') {
    yield e;
    for (const a of e.args) yield* calls(a);
  } else if (e.k === 'index') yield* calls(e.index);
  else if (e.k === 'un') yield* calls(e.e);
  else if (e.k === 'bin') {
    yield* calls(e.l);
    yield* calls(e.r);
  }
}

/** Every unit creation whose type is an array element, and those whose type is a plain variable */
function spawnCalls(program: JassProgram): { arrays: SpawnCall[]; scalars: ScalarSpawn[] } {
  const out: SpawnCall[] = [];
  const scalars: ScalarSpawn[] = [];
  for (const fn of program.functions.values()) {
    for (const s of statements(fn.body)) {
      const exprs: JassExpr[] = s.k === 'set' ? [s.value] : s.k === 'call' ? [s.call] : [];
      for (const root of exprs) {
        for (const c of calls(root)) {
          let type: JassExpr | undefined;
          let count: JassExpr | undefined;
          if (c.name === 'CreateNUnitsAtLoc' || c.name === 'CreateNUnitsAtLocFacingLocBJ') {
            count = c.args[0];
            type = c.args[1];
          } else if (c.name === 'CreateUnitAtLoc' || c.name === 'CreateUnitAtLocSaveLast' || c.name === 'CreateUnit') {
            type = c.args[1];
          }
          if (type?.k === 'id') scalars.push({ typeVar: type.name, count });
          if (type?.k !== 'index') continue;
          out.push({ typeArray: type.name, typeIndex: type.index, countArray: count?.k === 'index' ? count.name : null });
        }
      }
    }
  }
  return { arrays: out, scalars };
}

/**
 * Waves from a unit-type variable the level triggers set in turn: every
 * `set V = 'xxxx'` in script order is one wave. The count is the creation's
 * literal where it has one.
 */
function scalarWaves(program: JassProgram, scalars: ScalarSpawn[]): { waves: ScriptWave[]; variable: string } | null {
  let best: { waves: ScriptWave[]; variable: string } | null = null;
  for (const spawn of scalars) {
    if (!program.globals.some((g) => g.name === spawn.typeVar)) continue;
    const units: string[] = [];
    const initial = program.globals.find((g) => g.name === spawn.typeVar)?.init;
    if (initial?.k === 'num' && initial.v !== 0 && looksLikeRawcode(initial.v)) units.push(rawcodeToId(initial.v));
    for (const fn of program.functions.values()) {
      for (const s of statements(fn.body)) {
        if (s.k === 'set' && s.name === spawn.typeVar && !s.index && s.value.k === 'num' && looksLikeRawcode(s.value.v)) {
          units.push(rawcodeToId(s.value.v));
        }
      }
    }
    // One unit at a time is a stream (a timer or a loop spawns it again): the count is unknown
    const count = spawn.count?.k === 'num' && spawn.count.v > 1 ? spawn.count.v : null;
    if (units.length >= 2 && (!best || units.length > best.waves.length)) {
      best = { variable: spawn.typeVar, waves: units.map((unit, i) => ({ wave: i + 1, unit, count })) };
    }
  }
  return best;
}

/** Positive integer keys of an array with unit raw codes as values, in order */
function unitEntries(arr: Map<number, unknown> | undefined): [number, string][] {
  if (!arr) return [];
  const out: [number, string][] = [];
  for (const [k, v] of arr) {
    if (typeof v === 'number' && v !== 0 && looksLikeRawcode(v)) out.push([k, rawcodeToId(v)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const countAt = (arr: Map<number, unknown> | undefined, k: number): number | null => {
  const v = arr?.get(k);
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
};

export function wavesFromScript(program: JassProgram): ScriptWaves | null {
  const { arrays: found, scalars } = spawnCalls(program);
  if (found.length === 0) {
    const scalar = scalarWaves(program, scalars);
    return scalar ? { waves: scalar.waves, bosses: [], arrays: { unit: scalar.variable, count: null, boss: null, bossWave: null } } : null;
  }
  const ev = new JassEvaluator(program, { maxSteps: 1_500_000 });
  ev.runInit();
  const arrays = ev.globalArrays;

  // Main waves: indexed by a plain variable (the wave counter); the array with the most unit entries
  let main: SpawnCall | null = null;
  let mainEntries: [number, string][] = [];
  for (const c of found) {
    if (c.typeIndex.k !== 'id') continue;
    const entries = unitEntries(arrays.get(c.typeArray)).filter(([k]) => k > 0);
    if (entries.length > mainEntries.length || (entries.length === mainEntries.length && c.countArray && !main?.countArray)) {
      main = c;
      mainEntries = entries;
    }
  }
  if (!main || mainEntries.length < 2) {
    const scalar = scalarWaves(program, scalars);
    return scalar ? { waves: scalar.waves, bosses: [], arrays: { unit: scalar.variable, count: null, boss: null, bossWave: null } } : null;
  }
  const counts = main.countArray ? arrays.get(main.countArray) : undefined;
  const waves: ScriptWave[] = mainEntries.map(([wave, unit]) => ({ wave, unit, count: counts ? countAt(counts, wave) : null }));

  // Bosses: an array element indexed through a parallel array of wave numbers
  const lastWave = waves[waves.length - 1].wave;
  let bosses: ScriptBoss[] = [];
  let bossArray: string | null = null;
  let bossWaveArray: string | null = null;
  for (const c of found) {
    if (c.typeArray === main.typeArray || c.typeIndex.k !== 'index') continue;
    const pointer = arrays.get(c.typeIndex.name);
    const units = unitEntries(arrays.get(c.typeArray));
    const amounts = c.countArray ? arrays.get(c.countArray) : undefined;
    const list: ScriptBoss[] = [];
    for (const [slot, unit] of units) {
      const wave = countAt(pointer, slot);
      if (wave === null || wave > lastWave) continue;
      list.push({ wave, unit, count: countAt(amounts, slot) ?? 1 });
    }
    if (list.length > bosses.length) {
      bosses = list;
      bossArray = c.typeArray;
      bossWaveArray = c.typeIndex.name;
    }
  }
  return {
    waves,
    bosses: bosses.sort((a, b) => a.wave - b.wave),
    arrays: { unit: main.typeArray, count: main.countArray, boss: bossArray, bossWave: bossWaveArray },
  };
}
