/**
 * A small abstract interpreter for map scripts, enough to find where units
 * walk: it runs the map's initialisation (main, one-shot timers, triggers
 * run from there) concretely, so rects and locations stored in globals and
 * arrays (`set udg_Rects[3] = gg_rct_Spawn_002`, filled in loops) get their
 * values, and records every trigger with an "enters rect" event.
 *
 * `collectOrders` then runs the actions of every trigger once with abstract
 * event data and records point orders (move, attack, smart, patrol and
 * teleports) together with where the ordered unit comes from: the trigger's
 * rects for "triggering unit", or the location a unit was created at for
 * "last created unit/group". Conditions whose value is unknown run every
 * branch; loops with unknown exits stop.
 *
 * Everything else (players, timers, dialogs, multiboards) evaluates to
 * "unknown" and is ignored. A step budget keeps hostile or huge scripts from
 * hanging the import.
 */

import type { JassExpr, JassFunction, JassProgram, JassStmt, JassVar } from './jass-parser';

export interface RectValue {
  kind: 'rect';
  id: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
  /** The gg_rct_ variable it was first stored in */
  variable?: string;
}

export interface LocValue {
  kind: 'loc';
  x: number;
  y: number;
  /** Set when the location is the centre of a rect */
  rect: RectValue | null;
}

export interface TriggerValue {
  kind: 'trigger';
  id: number;
  variable?: string;
  enterRects: RectValue[];
  actions: string[];
  /** Elapsed-time event (seconds) when it is a one-shot timer trigger */
  oneShotAt: number | null;
}

interface RegionValue {
  kind: 'region';
  rects: RectValue[];
}

interface FuncValue {
  kind: 'func';
  name: string;
}

/** A unit or unit group an order may address */
export interface UnitValue {
  kind: 'unit';
  /** 'event': the unit that fired the trigger; 'created': made at `at` */
  origin: 'event' | 'created';
  at: LocValue | null;
}

interface Unknown {
  kind: 'unknown';
}

export type Value = number | string | boolean | null | RectValue | LocValue | TriggerValue | RegionValue | FuncValue | UnitValue | Unknown;

export const UNKNOWN: Unknown = { kind: 'unknown' };

export interface PointOrder {
  order: string;
  /** Who is ordered */
  subject: UnitValue;
  target: LocValue;
  /** The trigger whose actions issued it */
  trigger: TriggerValue;
}

export interface EvaluatorOptions {
  /** Statement budget for the whole run (default 3 million) */
  maxSteps?: number;
  /** Iterations per loop (default 20000) */
  maxLoop?: number;
}

const ORDER_IDS: Record<number, string> = { 851986: 'move', 851983: 'attack', 851971: 'smart', 851990: 'patrol' };
const WALK_ORDERS = new Set(['move', 'attack', 'smart', 'patrol', 'teleport']);

class BudgetExceeded extends Error {}

type Signal = 0 | 1 | { value: Value }; // 0 normal, 1 exitwhen

interface Frame {
  vars: Map<string, Value>;
  arrays: Map<string, Map<number, Value>>;
  types: Map<string, string>;
  /** Unit returned by GetEnumUnit inside ForGroup */
  enumUnit: Value;
  trigger: TriggerValue | null;
  /** Running a trigger's actions for orders: global writes stay in the overlay */
  action: boolean;
}

function isObj<K extends string>(v: Value, kind: K): v is Extract<Value, { kind: K }> {
  return typeof v === 'object' && v !== null && v.kind === kind;
}

function known(v: Value): boolean {
  return !(typeof v === 'object' && v !== null && v.kind === 'unknown');
}

function num(v: Value): number | null {
  return typeof v === 'number' ? v : null;
}

const INT_NATIVES = new Set(['R2I', 'S2I', 'GetRandomInt', 'IMinBJ', 'IMaxBJ', 'IAbsBJ', 'ModuloInteger', 'StringLength']);

export class JassEvaluator {
  readonly globals = new Map<string, Value>();
  readonly globalArrays = new Map<string, Map<number, Value>>();
  readonly globalTypes = new Map<string, string>();
  readonly triggers: TriggerValue[] = [];
  readonly orders: PointOrder[] = [];
  readonly warnings: string[] = [];
  /** Locations where actions create units */
  readonly creations: { at: LocValue; trigger: TriggerValue }[] = [];

  private steps = 0;
  private depth = 0;
  private nextId = 1;
  private readonly maxSteps: number;
  private readonly maxLoop: number;
  private readonly pendingTimers: { at: number; run: () => void }[] = [];
  private overlay: Map<string, Value> | null = null;
  private overlayArrays: Map<string, Map<number, Value>> | null = null;
  private loopWarned = false;

  constructor(
    private readonly program: JassProgram,
    options: EvaluatorOptions = {},
  ) {
    this.maxSteps = options.maxSteps ?? 3_000_000;
    this.maxLoop = options.maxLoop ?? 20_000;
  }

  /** Runs the globals' initialisers, main and the one-shot timers it sets up */
  runInit(): void {
    const top = this.frame(null, false);
    this.guard('globals', () => {
      for (const g of this.program.globals) {
        this.globalTypes.set(g.name, g.type);
        if (g.array) this.globalArrays.set(g.name, new Map());
        else this.globals.set(g.name, g.init ? this.eval(g.init, top) : UNKNOWN);
      }
    });
    if (this.program.functions.has('main')) {
      this.guard('main', () => this.callUser('main', [], top));
    } else {
      // Scripts cut down by protectors may lack main; run the usual init chain
      for (const f of ['InitGlobals', 'CreateRegions', 'InitCustomTriggers', 'RunInitializationTriggers']) {
        if (this.program.functions.has(f)) this.guard(f, () => this.callUser(f, [], top));
      }
    }
    // Elapsed-time triggers and one-shot timers, earliest first (they may queue more)
    for (let guardCount = 0; guardCount < 1000; guardCount++) {
      const timers = this.triggers
        .filter((t) => t.oneShotAt !== null)
        .map((t) => ({ at: t.oneShotAt!, run: () => this.runTrigger(t, false) }));
      for (const t of this.triggers) t.oneShotAt = null;
      timers.push(...this.pendingTimers.splice(0));
      if (timers.length === 0) break;
      timers.sort((a, b) => a.at - b.at);
      for (const t of timers) this.guard('timer', t.run);
    }
  }

  /** Runs every trigger's actions once in action mode and records point orders */
  collectOrders(): void {
    for (const t of [...this.triggers]) {
      this.overlay = new Map();
      this.overlayArrays = new Map();
      this.guard(`trigger ${t.variable ?? t.id}`, () => this.runTrigger(t, true));
    }
    this.overlay = null;
    this.overlayArrays = null;
  }

  private guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      if (e instanceof BudgetExceeded) this.warnings.push(`script: step budget used up in ${what}`);
      else throw e;
    }
  }

  private runTrigger(t: TriggerValue, action: boolean): void {
    for (const fn of t.actions) {
      if (!this.program.functions.has(fn)) continue;
      const f = this.frame(t, action);
      this.callUser(fn, [], f);
    }
  }

  private frame(trigger: TriggerValue | null, action: boolean): Frame {
    return { vars: new Map(), arrays: new Map(), types: new Map(), enumUnit: UNKNOWN, trigger, action };
  }

  private step(): void {
    if (++this.steps > this.maxSteps) throw new BudgetExceeded();
  }

  // ------------------------------------------------------------ variables

  private read(name: string, f: Frame): Value {
    if (f.vars.has(name)) return f.vars.get(name)!;
    if (this.overlay?.has(name)) return this.overlay.get(name)!;
    return this.globals.get(name) ?? UNKNOWN;
  }

  private write(name: string, v: Value, f: Frame): void {
    if (f.vars.has(name) || f.types.has(name)) f.vars.set(name, v);
    else if (f.action && this.overlay) this.overlay.set(name, v);
    else {
      this.globals.set(name, v);
      if (isObj(v, 'rect') && !v.variable && name.startsWith('gg_rct_')) v.variable = name;
      if (isObj(v, 'trigger') && !v.variable) v.variable = name;
    }
  }

  private array(name: string, f: Frame, forWrite: boolean): Map<number, Value> | null {
    const local = f.arrays.get(name);
    if (local) return local;
    const global = this.globalArrays.get(name);
    if (!global) return null;
    if (!f.action || !this.overlayArrays) return global;
    let o = this.overlayArrays.get(name);
    if (!o && forWrite) {
      o = new Map(global);
      this.overlayArrays.set(name, o);
    }
    return o ?? global;
  }

  private arrayDefault(name: string, f: Frame): Value {
    const type = f.types.get(name) ?? this.globalTypes.get(name);
    if (type === 'integer' || type === 'real') return 0;
    if (type === 'boolean') return false;
    return null;
  }

  private declaredType(name: string, f: Frame): string | undefined {
    return f.types.get(name) ?? this.globalTypes.get(name);
  }

  // ------------------------------------------------------------ statements

  private exec(body: JassStmt[], f: Frame): Signal {
    for (const s of body) {
      this.step();
      const sig = this.stmt(s, f);
      if (sig !== 0) return sig;
    }
    return 0;
  }

  private stmt(s: JassStmt, f: Frame): Signal {
    switch (s.k) {
      case 'set': {
        const v = this.eval(s.value, f);
        if (s.index) {
          const i = num(this.eval(s.index, f));
          const arr = this.array(s.name, f, true);
          if (arr && i !== null) arr.set(i, v);
        } else {
          this.write(s.name, v, f);
        }
        return 0;
      }
      case 'call':
        this.eval(s.call, f);
        return 0;
      case 'if': {
        for (const b of s.branches) {
          const c = this.eval(b.cond, f);
          if (c === true) return this.exec(b.body, f);
          if (!known(c)) {
            // Unknown condition: explore this branch and keep going with the rest
            const sig = this.exec(b.body, f);
            if (sig !== 0) return sig;
          }
        }
        return s.otherwise ? this.exec(s.otherwise, f) : 0;
      }
      case 'loop': {
        for (let i = 0; ; i++) {
          if (i >= this.maxLoop) {
            if (!this.loopWarned) this.warnings.push('script: a loop ran into the iteration limit');
            this.loopWarned = true;
            return 0;
          }
          const sig = this.exec(s.body, f);
          if (sig === 1) return 0;
          if (sig !== 0) return sig;
        }
      }
      case 'exitwhen': {
        const c = this.eval(s.cond, f);
        return c === false ? 0 : 1;
      }
      case 'return':
        return { value: s.value ? this.eval(s.value, f) : null };
    }
  }

  private callUser(name: string, args: Value[], caller: Frame): Value {
    const fn: JassFunction | undefined = this.program.functions.get(name);
    if (!fn) return UNKNOWN;
    if (this.depth > 40) return UNKNOWN;
    const f = this.frame(caller.trigger, caller.action);
    f.enumUnit = caller.enumUnit;
    fn.params.forEach((p, i) => {
      f.types.set(p.name, p.type);
      f.vars.set(p.name, args[i] ?? UNKNOWN);
    });
    for (const l of fn.locals) this.declareLocal(l, f);
    this.depth++;
    try {
      const sig = this.exec(fn.body, f);
      return typeof sig === 'object' ? sig.value : null;
    } finally {
      this.depth--;
    }
  }

  private declareLocal(l: JassVar, f: Frame): void {
    f.types.set(l.name, l.type);
    if (l.array) f.arrays.set(l.name, new Map());
    else f.vars.set(l.name, l.init ? this.eval(l.init, f) : UNKNOWN);
  }

  // ------------------------------------------------------------ expressions

  private isInt(e: JassExpr, f: Frame): boolean {
    switch (e.k) {
      case 'num':
        return e.int;
      case 'id':
      case 'index':
        return this.declaredType(e.name, f) === 'integer';
      case 'call':
        return INT_NATIVES.has(e.name) || this.program.functions.get(e.name)?.returns === 'integer';
      case 'un':
        return this.isInt(e.e, f);
      case 'bin':
        return this.isInt(e.l, f) && this.isInt(e.r, f);
      default:
        return false;
    }
  }

  eval(e: JassExpr, f: Frame): Value {
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'null':
        return null;
      case 'id':
        return this.read(e.name, f);
      case 'index': {
        const i = num(this.eval(e.index, f));
        const arr = this.array(e.name, f, false);
        if (!arr || i === null) return UNKNOWN;
        return arr.has(i) ? arr.get(i)! : this.arrayDefault(e.name, f);
      }
      case 'fref':
        return { kind: 'func', name: e.name };
      case 'un': {
        const v = this.eval(e.e, f);
        if (e.op === 'not') return typeof v === 'boolean' ? !v : UNKNOWN;
        return typeof v === 'number' ? -v : UNKNOWN;
      }
      case 'bin':
        return this.binary(e, f);
      case 'call': {
        const args = e.args.map((a) => this.eval(a, f));
        if (this.program.functions.has(e.name)) return this.callUser(e.name, args, f);
        return this.native(e.name, args, f);
      }
    }
  }

  private binary(e: JassExpr & { k: 'bin' }, f: Frame): Value {
    if (e.op === 'and' || e.op === 'or') {
      const l = this.eval(e.l, f);
      if (e.op === 'and' && l === false) return false;
      if (e.op === 'or' && l === true) return true;
      const r = this.eval(e.r, f);
      if (typeof l === 'boolean' && typeof r === 'boolean') return e.op === 'and' ? l && r : l || r;
      if (e.op === 'and' && r === false) return false;
      if (e.op === 'or' && r === true) return true;
      return UNKNOWN;
    }
    const l = this.eval(e.l, f);
    const r = this.eval(e.r, f);
    if (e.op === '==' || e.op === '!=') {
      if (!known(l) || !known(r)) return UNKNOWN;
      const eq = l === r;
      return e.op === '==' ? eq : !eq;
    }
    if (e.op === '+' && (typeof l === 'string' || typeof r === 'string')) {
      if (!known(l) || !known(r)) return UNKNOWN;
      return `${l ?? ''}${r ?? ''}`;
    }
    if (typeof l !== 'number' || typeof r !== 'number') return UNKNOWN;
    switch (e.op) {
      case '+':
        return l + r;
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        if (r === 0) return UNKNOWN;
        return this.isInt(e.l, f) && this.isInt(e.r, f) ? Math.trunc(l / r) : l / r;
      case '<':
        return l < r;
      case '>':
        return l > r;
      case '<=':
        return l <= r;
      case '>=':
        return l >= r;
    }
    return UNKNOWN;
  }

  // ------------------------------------------------------------ natives

  private rect(l: Value, b: Value, r: Value, t: Value): Value {
    if (typeof l !== 'number' || typeof b !== 'number' || typeof r !== 'number' || typeof t !== 'number') return UNKNOWN;
    return { kind: 'rect', id: this.nextId++, left: l, bottom: b, right: r, top: t };
  }

  private loc(x: Value, y: Value, rect: RectValue | null = null): Value {
    if (typeof x !== 'number' || typeof y !== 'number') return UNKNOWN;
    return { kind: 'loc', x, y, rect };
  }

  private center(r: Value): Value {
    if (!isObj(r, 'rect')) return UNKNOWN;
    return { kind: 'loc', x: (r.left + r.right) / 2, y: (r.bottom + r.top) / 2, rect: r };
  }

  private unitArg(v: Value): UnitValue | null {
    return isObj(v, 'unit') ? v : null;
  }

  private order(subject: Value, order: Value, target: Value, f: Frame): void {
    if (!f.action || !f.trigger) return;
    const name = typeof order === 'number' ? ORDER_IDS[order] : typeof order === 'string' ? order.toLowerCase() : null;
    const unit = this.unitArg(subject);
    if (!name || !WALK_ORDERS.has(name) || !unit || !isObj(target, 'loc')) return;
    this.orders.push({ order: name, subject: unit, target, trigger: f.trigger });
  }

  private created(at: Value, f: Frame, group: boolean): Value {
    const loc = isObj(at, 'loc') ? at : null;
    const unit: UnitValue = { kind: 'unit', origin: 'created', at: loc };
    if (loc && f.action && f.trigger) this.creations.push({ at: loc, trigger: f.trigger });
    // The BJ wrappers keep the result in these globals; GetLastCreated* reads them back
    this.write(group ? 'bj_lastCreatedGroup' : 'bj_lastCreatedUnit', unit, { ...f, vars: new Map(), types: new Map() });
    if (group) this.write('bj_lastCreatedUnit', unit, { ...f, vars: new Map(), types: new Map() });
    return unit;
  }

  private native(name: string, a: Value[], f: Frame): Value {
    switch (name) {
      // geometry
      case 'Rect':
        return this.rect(a[0], a[1], a[2], a[3]);
      case 'RectFromLoc':
        return isObj(a[0], 'loc') && isObj(a[1], 'loc') ? this.rect(a[0].x, a[0].y, a[1].x, a[1].y) : UNKNOWN;
      case 'RectFromCenterSizeBJ': {
        const c = a[0];
        const w = num(a[1]);
        const h = num(a[2]);
        if (!isObj(c, 'loc') || w === null || h === null) return UNKNOWN;
        return this.rect(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2);
      }
      case 'GetRectCenter':
        return this.center(a[0]);
      case 'GetRectCenterX':
        return isObj(a[0], 'rect') ? (a[0].left + a[0].right) / 2 : UNKNOWN;
      case 'GetRectCenterY':
        return isObj(a[0], 'rect') ? (a[0].bottom + a[0].top) / 2 : UNKNOWN;
      case 'GetRectMinX':
        return isObj(a[0], 'rect') ? a[0].left : UNKNOWN;
      case 'GetRectMinY':
        return isObj(a[0], 'rect') ? a[0].bottom : UNKNOWN;
      case 'GetRectMaxX':
        return isObj(a[0], 'rect') ? a[0].right : UNKNOWN;
      case 'GetRectMaxY':
        return isObj(a[0], 'rect') ? a[0].top : UNKNOWN;
      case 'Location':
        return this.loc(a[0], a[1]);
      case 'GetLocationX':
        return isObj(a[0], 'loc') ? a[0].x : UNKNOWN;
      case 'GetLocationY':
        return isObj(a[0], 'loc') ? a[0].y : UNKNOWN;
      case 'OffsetLocation': {
        const l = a[0];
        const dx = num(a[1]);
        const dy = num(a[2]);
        return isObj(l, 'loc') && dx !== null && dy !== null ? this.loc(l.x + dx, l.y + dy) : UNKNOWN;
      }
      case 'CreateRegion':
        return { kind: 'region', rects: [] };
      case 'RegionAddRect':
        if (isObj(a[0], 'region') && isObj(a[1], 'rect')) a[0].rects.push(a[1]);
        return null;

      // triggers
      case 'CreateTrigger': {
        const t: TriggerValue = { kind: 'trigger', id: this.nextId++, enterRects: [], actions: [], oneShotAt: null };
        this.triggers.push(t);
        return t;
      }
      case 'TriggerRegisterEnterRectSimple':
        if (isObj(a[0], 'trigger') && isObj(a[1], 'rect')) a[0].enterRects.push(a[1]);
        return UNKNOWN;
      case 'TriggerRegisterEnterRegion':
        if (isObj(a[0], 'trigger') && isObj(a[1], 'region')) a[0].enterRects.push(...a[1].rects);
        return UNKNOWN;
      case 'TriggerAddAction':
        if (isObj(a[0], 'trigger') && isObj(a[1], 'func')) a[0].actions.push(a[1].name);
        return UNKNOWN;
      case 'Condition':
      case 'Filter':
        return a[0];
      case 'TriggerRegisterTimerEventSingle':
        if (isObj(a[0], 'trigger') && typeof a[1] === 'number') a[0].oneShotAt = a[1];
        return UNKNOWN;
      case 'TriggerRegisterTimerEvent':
        if (isObj(a[0], 'trigger') && typeof a[1] === 'number' && a[2] === false) a[0].oneShotAt = a[1];
        return UNKNOWN;
      case 'TimerStart': {
        const fn = a[3];
        if (!f.action && a[2] === false && isObj(fn, 'func') && typeof a[1] === 'number') {
          const caller = this.frame(null, false);
          this.pendingTimers.push({ at: a[1], run: () => this.callUser(fn.name, [], caller) });
        }
        return null;
      }
      case 'TriggerExecute':
      case 'TriggerExecuteBJ':
      case 'ConditionalTriggerExecute':
        // In action mode another trigger's orders would be credited to this one
        if (!f.action && isObj(a[0], 'trigger')) this.runTrigger(a[0], false);
        return null;
      case 'ExecuteFunc':
        if (typeof a[0] === 'string') this.callUser(a[0], [], f);
        return null;
      case 'ForGroup':
      case 'ForGroupBJ': {
        const fn = a[1];
        if (isObj(fn, 'func')) {
          const inner = { ...f, enumUnit: this.unitArg(a[0]) ?? UNKNOWN };
          this.callUser(fn.name, [], inner);
        }
        return null;
      }
      case 'ForForce':
        if (isObj(a[1], 'func')) this.callUser(a[1].name, [], f);
        return null;

      // units
      case 'GetTriggerUnit':
      case 'GetEnteringUnit':
        return f.trigger ? { kind: 'unit', origin: 'event', at: null } : UNKNOWN;
      case 'GetEnumUnit':
        return f.enumUnit;
      case 'GetLastCreatedUnit':
        return this.read('bj_lastCreatedUnit', f);
      case 'GetLastCreatedGroup':
        return this.read('bj_lastCreatedGroup', f);
      case 'CreateUnit':
        return this.created(this.loc(a[2], a[3]), f, false);
      case 'CreateUnitAtLoc':
      case 'CreateUnitAtLocSaveLast':
        return this.created(a[2], f, false);
      case 'CreateNUnitsAtLoc':
      case 'CreateNUnitsAtLocFacingLocBJ':
        return this.created(a[3], f, true);

      // orders
      case 'IssuePointOrder':
      case 'IssuePointOrderById':
      case 'GroupPointOrder':
      case 'GroupPointOrderById':
        this.order(a[0], a[1], this.loc(a[2], a[3]), f);
        return true;
      case 'IssuePointOrderLoc':
      case 'IssuePointOrderLocBJ':
      case 'IssuePointOrderByIdLoc':
      case 'IssuePointOrderByIdLocBJ':
      case 'GroupPointOrderLoc':
      case 'GroupPointOrderLocBJ':
      case 'GroupPointOrderByIdLoc':
      case 'GroupPointOrderByIdLocBJ':
        this.order(a[0], a[1], a[2], f);
        return true;
      case 'SetUnitPosition':
        this.order(a[0], 'teleport', this.loc(a[1], a[2]), f);
        return null;
      case 'SetUnitPositionLoc':
        this.order(a[0], 'teleport', a[1], f);
        return null;

      // conversions
      case 'I2R':
        return typeof a[0] === 'number' ? a[0] : UNKNOWN;
      case 'R2I':
        return typeof a[0] === 'number' ? Math.trunc(a[0]) : UNKNOWN;
      case 'I2S':
        return typeof a[0] === 'number' ? String(Math.trunc(a[0])) : UNKNOWN;
      case 'S2I':
        return typeof a[0] === 'string' ? parseInt(a[0], 10) || 0 : UNKNOWN;
      case 'ModuloInteger': {
        const x = num(a[0]);
        const m = num(a[1]);
        if (x === null || !m) return UNKNOWN;
        return ((x % m) + m) % m;
      }
    }
    return UNKNOWN;
  }
}
