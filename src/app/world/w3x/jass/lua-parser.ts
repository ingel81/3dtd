/**
 * Lua map scripts (war3map.lua, Reforged and 1.31+ maps saved in Lua mode)
 * read into the same program as JASS (`JassProgram`), so `JassEvaluator`
 * runs them unchanged: the natives (Rect, RegionAddRect, CreateTrigger,
 * TriggerRegisterEnterRectSimple, IssuePointOrderLoc, GetRectCenter ...)
 * have the same names in both languages.
 *
 * What the World Editor writes and hand-written GUI-like code uses maps
 * directly: global and local variables, functions, calls, `if`/`elseif`,
 * `while`, `repeat`, numeric `for`, `for ... in ipairs/pairs(t)`, `break`,
 * `return`. Tables (`{}`, `{a, b}`, `{[k] = v}`, `__jarray(d)`) become
 * arrays; a bare function name or an anonymous `function () ... end` used as
 * a value becomes a function reference (anonymous ones are lifted to named
 * functions and do not see the enclosing locals). Fields, methods,
 * metatables, varargs, bit and length operators read as unknown. A function
 * that does not parse is dropped with a warning, like in JASS.
 */

import { type JassExpr, type JassFunction, type JassProgram, type JassStmt, type JassVar, MAX_JASS_NESTING } from './jass-parser';

type Tok =
  | { t: 'id'; v: string; line: number }
  | { t: 'num'; v: number; line: number }
  | { t: 'str'; v: string; line: number }
  | { t: 'op'; v: string; line: number }
  | { t: 'eof'; line: number };

class LuaSyntaxError extends Error {}

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

const OPS = ['...', '..', '==', '~=', '<=', '>=', '//', '::', '<<', '>>', '+', '-', '*', '/', '%', '^', '#', '&', '~', '|', '<', '>', '=', '(', ')', '{', '}', '[', ']', ';', ':', ',', '.'];

/** Length of a long bracket `[==[` at `i` (its level plus two), 0 if none */
function longBracket(src: string, i: number): number {
  if (src[i] !== '[') return 0;
  let j = i + 1;
  while (src[j] === '=') j++;
  return src[j] === '[' ? j - i + 1 : 0;
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const skipLong = (open: number): string => {
    const level = open - 2;
    const close = `]${'='.repeat(level)}]`;
    const end = src.indexOf(close, i + open);
    if (end < 0) throw new LuaSyntaxError(`line ${line}: unfinished long bracket`);
    const body = src.slice(i + open, end);
    for (const c of body) if (c === '\n') line++;
    i = end + close.length;
    return body.startsWith('\n') ? body.slice(1) : body;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '-' && src[i + 1] === '-') {
      i += 2;
      const open = longBracket(src, i);
      if (open) skipLong(open);
      else while (i < n && src[i] !== '\n') i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i, i + 40)) ?? /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 80));
      const text = m![0];
      out.push({ t: 'num', v: /^0[xX]/.test(text) ? parseInt(text, 16) | 0 : parseFloat(text), line });
      i += text.length;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') throw new LuaSyntaxError(`line ${line}: unfinished string`);
        if (src[j] === '\\') {
          const e = src[j + 1];
          const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v' };
          if (e in esc) {
            s += esc[e];
            j += 2;
          } else if (/[0-9]/.test(e)) {
            const d = /^\d{1,3}/.exec(src.slice(j + 1))![0];
            s += String.fromCharCode(parseInt(d, 10));
            j += 1 + d.length;
          } else if (e === 'x') {
            s += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16));
            j += 4;
          } else if (e === '\n') {
            s += '\n';
            line++;
            j += 2;
          } else {
            s += e ?? '';
            j += 2;
          }
        } else {
          s += src[j++];
        }
      }
      if (j >= n) throw new LuaSyntaxError(`line ${line}: unfinished string`);
      out.push({ t: 'str', v: s, line });
      i = j + 1;
    } else if (longBracket(src, i)) {
      const startLine = line;
      out.push({ t: 'str', v: skipLong(longBracket(src, i)), line: startLine });
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new LuaSyntaxError(`line ${line}: unexpected character '${c}'`);
      out.push({ t: 'op', v: op, line });
      i += op.length;
    }
  }
  out.push({ t: 'eof', line });
  return out;
}

/** A table being built: what an assignment of it declares (an array) and fills */
interface TableExpr {
  k: 'table';
  /** Value of a missing entry: __jarray(d), else nil */
  fill: JassExpr | null;
  items: { key: JassExpr; value: JassExpr }[];
}

type LuaExpr = JassExpr | TableExpr;

/** Binary operators by precedence (left, right binding power) */
const BINARY = new Map<string, [number, number]>([
  ['or', [1, 1]],
  ['and', [2, 2]],
  ['<', [3, 3]],
  ['>', [3, 3]],
  ['<=', [3, 3]],
  ['>=', [3, 3]],
  ['~=', [3, 3]],
  ['==', [3, 3]],
  ['|', [4, 4]],
  ['~', [5, 5]],
  ['&', [6, 6]],
  ['<<', [7, 7]],
  ['>>', [7, 7]],
  ['..', [9, 8]],
  ['+', [10, 10]],
  ['-', [10, 10]],
  ['*', [11, 11]],
  ['/', [11, 11]],
  ['//', [11, 11]],
  ['%', [11, 11]],
  ['^', [14, 13]],
]);
const UNARY_PRIORITY = 12;

/** What reads as unknown in the evaluator: a call no native or function answers */
const unknown = (what: string): JassExpr => ({ k: 'call', name: `__lua_${what}`, args: [] });

interface Scope {
  locals: Map<string, JassVar>;
  /** Lua name to the unique name of the local in the function (a shadowing local gets its own) */
  names: Map<string, string>[];
}

class Parser {
  pos = 0;
  private depth = 0;
  private anon = 0;
  readonly functions = new Map<string, JassFunction>();
  readonly globals = new Map<string, JassVar>();
  private scope: Scope | null = null;

  constructor(private readonly toks: Tok[]) {}

  peek(o = 0): Tok {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)];
  }

  next(): Tok {
    return this.toks[this.pos++];
  }

  is(v: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.t === 'op' || t.t === 'id') && t.v === v;
  }

  accept(v: string): boolean {
    if (!this.is(v)) return false;
    this.pos++;
    return true;
  }

  expect(v: string): void {
    if (!this.accept(v)) this.fail(`expected '${v}'`);
  }

  fail(msg: string): never {
    throw new LuaSyntaxError(`line ${this.peek().line}: ${msg}`);
  }

  name(): string {
    const t = this.next();
    if (t.t !== 'id' || KEYWORDS.has(t.v)) {
      this.pos--;
      this.fail('expected a name');
    }
    return t.v;
  }

  private nested<T>(fn: () => T): T {
    if (++this.depth > MAX_JASS_NESTING) {
      this.depth = 0;
      this.fail(`nested deeper than ${MAX_JASS_NESTING} levels`);
    }
    try {
      return fn();
    } finally {
      this.depth = Math.max(0, this.depth - 1);
    }
  }

  // ------------------------------------------------------------ scopes

  private local(name: string, array: boolean, type = 'lua'): string {
    const s = this.scope!;
    let unique = name;
    for (let k = 2; s.locals.has(unique); k++) unique = `${name}__${k}`;
    s.locals.set(unique, { name: unique, type, array, init: null });
    s.names[s.names.length - 1].set(name, unique);
    return unique;
  }

  private resolve(name: string): string {
    const s = this.scope;
    if (!s) return name;
    for (let i = s.names.length - 1; i >= 0; i--) {
      const u = s.names[i].get(name);
      if (u) return u;
    }
    return name;
  }

  private block<T>(fn: () => T): T {
    this.scope?.names.push(new Map());
    try {
      return fn();
    } finally {
      this.scope?.names.pop();
    }
  }

  /** A global that holds a table: an array of the program */
  private globalArray(name: string, fill: JassExpr | null): void {
    const type = fill?.k === 'num' ? 'real' : fill?.k === 'bool' ? 'boolean' : fill?.k === 'str' ? 'string' : 'lua';
    const g = this.globals.get(name);
    if (!g || !g.array) this.globals.set(name, { name, type, array: true, init: null });
  }

  // ------------------------------------------------------------ chunk

  chunk(warnings: string[]): void {
    while (this.peek().t !== 'eof') {
      const start = this.pos;
      try {
        this.topStatement();
      } catch (e) {
        if (!(e instanceof LuaSyntaxError)) throw e;
        warnings.push(`script: ${e.message}`);
        this.pos = start;
        this.recover();
      }
    }
  }

  /** Skips the statement at `pos`, a whole `function ... end` with all its blocks */
  private recover(): void {
    let depth = 0;
    do {
      const t = this.next();
      if (t.t === 'eof') return;
      if (t.t === 'id' && (t.v === 'function' || t.v === 'if' || t.v === 'do' || t.v === 'repeat')) depth++;
      else if (t.t === 'id' && (t.v === 'end' || t.v === 'until')) depth--;
    } while (depth > 0);
  }

  private topStatement(): void {
    if (this.accept(';')) return;
    if (this.is('function') || (this.is('local') && this.is('function', 1))) {
      this.accept('local');
      this.pos++;
      this.functionStatement();
      return;
    }
    if (this.accept('local')) {
      const names = this.nameList();
      const values = this.accept('=') ? this.exprList() : [];
      names.forEach((n, i) => this.globalInit(n, values[i] ?? null));
      return;
    }
    // Assignments to globals; anything else at the top runs nowhere and is only parsed
    const targets = this.suffixedList();
    if (this.accept('=')) {
      const values = this.exprList();
      targets.forEach((t, i) => {
        if (t.k === 'id') this.globalInit(t.name, values[i] ?? null);
      });
    }
  }

  private globalInit(name: string, value: LuaExpr | null): void {
    if (value?.k === 'table') {
      this.globalArray(name, value.fill);
      return;
    }
    this.globals.set(name, { name, type: 'lua', array: false, init: value ? (value as JassExpr) : null });
  }

  /** `function name(...) ... end` after the keyword; `a.b` and `a:b` names are parsed and dropped */
  private functionStatement(): void {
    let name = this.name();
    let plain = true;
    while (this.is('.') || this.is(':')) {
      this.pos++;
      name += `.${this.name()}`;
      plain = false;
    }
    const fn = this.functionBody(name);
    if (plain) this.functions.set(name, fn);
  }

  private functionBody(name: string): JassFunction {
    const outer = this.scope;
    this.scope = { locals: new Map(), names: [new Map()] };
    try {
      this.expect('(');
      const params: JassVar[] = [];
      while (!this.is(')')) {
        if (this.accept('...')) break;
        const p = this.local(this.name(), false, 'param');
        params.push(this.scope.locals.get(p)!);
        this.scope.locals.delete(p);
        if (!this.accept(',')) break;
      }
      this.expect(')');
      const body = this.statements(['end']);
      this.expect('end');
      return { name, params, returns: 'lua', locals: [...this.scope.locals.values()], body };
    } finally {
      this.scope = outer;
    }
  }

  // ------------------------------------------------------------ statements

  private statements(end: string[]): JassStmt[] {
    return this.nested(() =>
      this.block(() => {
        const out: JassStmt[] = [];
        while (!end.some((w) => this.is(w))) {
          if (this.peek().t === 'eof') this.fail(`missing ${end[0]}`);
          out.push(...this.statement());
        }
        return out;
      }),
    );
  }

  private statement(): JassStmt[] {
    const t = this.peek();
    if (t.t === 'op' && t.v === ';') {
      this.pos++;
      return [];
    }
    if (t.t === 'op' && t.v === '::') {
      this.pos++;
      this.name();
      this.expect('::');
      return [];
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'local':
          this.pos++;
          return this.localStatement();
        case 'function':
          this.pos++;
          this.functionStatement();
          return [];
        case 'if':
          this.pos++;
          return [this.ifStatement()];
        case 'while': {
          this.pos++;
          const cond = this.condition();
          this.expect('do');
          const body = this.statements(['end']);
          this.expect('end');
          return [{ k: 'loop', body: [{ k: 'exitwhen', cond: { k: 'un', op: 'not', e: cond } }, ...body] }];
        }
        case 'repeat': {
          this.pos++;
          const body = this.statements(['until']);
          this.expect('until');
          return [{ k: 'loop', body: [...body, { k: 'exitwhen', cond: this.condition() }] }];
        }
        case 'for':
          this.pos++;
          return this.forStatement();
        case 'do': {
          this.pos++;
          const body = this.statements(['end']);
          this.expect('end');
          return body;
        }
        case 'return': {
          this.pos++;
          const ends = this.peek().t === 'eof' || ['end', 'else', 'elseif', 'until', ';'].some((w) => this.is(w));
          const values = ends ? [] : this.exprList();
          this.accept(';');
          return [{ k: 'return', value: values.length ? this.value(values[0]) : null }];
        }
        case 'break':
          this.pos++;
          return [{ k: 'exitwhen', cond: { k: 'bool', v: true } }];
        case 'goto':
          this.pos++;
          this.name();
          return [];
      }
    }
    const targets = this.suffixedList();
    if (this.accept('=')) return this.assign(targets, this.exprList());
    if (targets.length !== 1) this.fail('expected an assignment');
    const call = targets[0];
    if (call.k !== 'call') this.fail('a statement must be a call or an assignment');
    return [{ k: 'call', call }];
  }

  private localStatement(): JassStmt[] {
    if (this.accept('function')) {
      // A local function lives as a function of the program
      const name = this.name();
      this.functions.set(name, this.functionBody(name));
      return [];
    }
    const names = this.nameList();
    const values = this.accept('=') ? this.exprList() : [];
    const out: JassStmt[] = [];
    names.forEach((n, i) => {
      const v = values[i];
      if (v?.k === 'table') {
        const unique = this.local(n, true);
        out.push(...this.fillTable(unique, v));
      } else {
        // The value is read before the name is the local's (`local x = x`)
        const value: JassExpr = v ? (v as JassExpr) : { k: 'null' };
        out.push({ k: 'set', name: this.local(n, false), index: null, value });
      }
    });
    return out;
  }

  private nameList(): string[] {
    const names = [this.name()];
    // Lua 5.4 attributes: <const>, <close>
    if (this.accept('<')) {
      this.name();
      this.expect('>');
    }
    while (this.accept(',')) {
      names.push(this.name());
      if (this.accept('<')) {
        this.name();
        this.expect('>');
      }
    }
    return names;
  }

  private assign(targets: JassExpr[], values: LuaExpr[]): JassStmt[] {
    const out: JassStmt[] = [];
    targets.forEach((target, i) => {
      const v = values[i];
      if (target.k === 'id') {
        if (v?.k === 'table') {
          if (!this.isLocalName(target.name)) this.globalArray(target.name, v.fill);
          out.push(...this.fillTable(target.name, v));
        } else {
          out.push({ k: 'set', name: target.name, index: null, value: v ? (v as JassExpr) : { k: 'null' } });
        }
      } else if (target.k === 'index') {
        if (!this.isLocalName(target.name)) this.globalArray(target.name, null);
        out.push({ k: 'set', name: target.name, index: target.index, value: v ? this.value(v) : { k: 'null' } });
      }
      // Fields (a.b = v) are left out
    });
    return out;
  }

  private isLocalName(unique: string): boolean {
    return !!this.scope?.locals.has(unique);
  }

  /** The entries of a table constructor, written into the array `name` */
  private fillTable(name: string, t: TableExpr): JassStmt[] {
    return t.items.map((it) => ({ k: 'set', name, index: it.key, value: it.value }) as JassStmt);
  }

  private ifStatement(): JassStmt {
    const branches: { cond: JassExpr; body: JassStmt[] }[] = [];
    let otherwise: JassStmt[] | null = null;
    const cond = this.condition();
    this.expect('then');
    branches.push({ cond, body: this.statements(['elseif', 'else', 'end']) });
    for (;;) {
      if (this.accept('elseif')) {
        const c = this.condition();
        this.expect('then');
        branches.push({ cond: c, body: this.statements(['elseif', 'else', 'end']) });
      } else if (this.accept('else')) {
        otherwise = this.statements(['end']);
      } else {
        this.expect('end');
        return { k: 'if', branches, otherwise };
      }
    }
  }

  private forStatement(): JassStmt[] {
    return this.block(() => {
      const first = this.name();
      if (this.accept('=')) {
        const from = this.expr();
        this.expect(',');
        const to = this.expr();
        const step = this.accept(',') ? this.expr() : ({ k: 'num', v: 1, int: false } as JassExpr);
        this.expect('do');
        const i = this.local(first, false);
        const body = this.statements(['end']);
        this.expect('end');
        const down = step.k === 'num' ? step.v < 0 : step.k === 'un' && step.op === '-';
        const id: JassExpr = { k: 'id', name: i };
        return [
          { k: 'set', name: i, index: null, value: from },
          {
            k: 'loop',
            body: [
              { k: 'exitwhen', cond: { k: 'bin', op: down ? '<' : '>', l: id, r: to } },
              ...body,
              { k: 'set', name: i, index: null, value: { k: 'bin', op: '+', l: id, r: step } },
            ],
          },
        ];
      }
      // Generic for: ipairs over an array from 1, pairs over indices 0 to 8191 (a JASS array's size)
      const names = [first];
      while (this.accept(',')) names.push(this.name());
      this.expect('in');
      const source = this.exprList();
      this.expect('do');
      const call = source.length === 1 && source[0].k === 'call' ? source[0] : null;
      const over = call && (call.name === 'ipairs' || call.name === 'pairs') && call.args.length === 1 ? call.args[0] : null;
      const key = this.local(names[0], false);
      const value = names[1] !== undefined ? this.local(names[1], false) : null;
      const body = this.statements(['end']);
      this.expect('end');
      if (!over || over.k !== 'id') return [];
      const k: JassExpr = { k: 'id', name: key };
      const item: JassExpr = { k: 'index', name: over.name, index: k };
      const next: JassStmt = { k: 'set', name: key, index: null, value: { k: 'bin', op: '+', l: k, r: { k: 'num', v: 1, int: false } } };
      const setValue: JassStmt[] = value ? [{ k: 'set', name: value, index: null, value: item }] : [];
      if (call!.name === 'ipairs') {
        return [
          { k: 'set', name: key, index: null, value: { k: 'num', v: 1, int: false } },
          { k: 'loop', body: [{ k: 'exitwhen', cond: { k: 'bin', op: '==', l: item, r: { k: 'null' } } }, ...setValue, ...body, next] },
        ];
      }
      return [
        { k: 'set', name: key, index: null, value: { k: 'num', v: 0, int: false } },
        {
          k: 'loop',
          body: [
            { k: 'exitwhen', cond: { k: 'bin', op: '>', l: k, r: { k: 'num', v: 8191, int: false } } },
            { k: 'if', branches: [{ cond: { k: 'bin', op: '!=', l: item, r: { k: 'null' } }, body: [...setValue, ...body] }], otherwise: null },
            next,
          ],
        },
      ];
    });
  }

  // ------------------------------------------------------------ expressions

  /** A condition by Lua's truth: nil and false fail, any other value passes */
  private condition(): JassExpr {
    return { k: 'un', op: 'truthy', e: this.expr() };
  }

  private exprList(): LuaExpr[] {
    const out = [this.luaExpr()];
    while (this.accept(',')) out.push(this.luaExpr());
    return out;
  }

  /** A table where a plain value is wanted reads as unknown */
  private value(e: LuaExpr): JassExpr {
    return e.k === 'table' ? unknown('table') : e;
  }

  expr(limit = 0): JassExpr {
    return this.value(this.luaExpr(limit));
  }

  private luaExpr(limit = 0): LuaExpr {
    return this.nested(() => {
      let left: LuaExpr;
      if (this.is('not') || this.is('-') || this.is('#') || this.is('~')) {
        const op = (this.next() as { v: string }).v;
        const e = this.expr(UNARY_PRIORITY);
        left = op === 'not' ? { k: 'un', op: 'lnot', e } : op === '-' ? { k: 'un', op: '-', e } : unknown(op === '#' ? 'length' : 'bnot');
      } else {
        left = this.simple();
      }
      for (;;) {
        const t = this.peek();
        const op = t.t === 'op' || t.t === 'id' ? t.v : '';
        const prio = BINARY.get(op);
        if (!prio || prio[0] <= limit) break;
        this.pos++;
        const right = this.expr(prio[1]);
        left = this.binary(op, this.value(left), right);
      }
      return left;
    });
  }

  private binary(op: string, l: JassExpr, r: JassExpr): JassExpr {
    switch (op) {
      case 'and':
        return { k: 'bin', op: 'land', l, r };
      case 'or':
        return { k: 'bin', op: 'lor', l, r };
      case '~=':
        return { k: 'bin', op: '!=', l, r };
      case '//':
        return { k: 'call', name: 'R2I', args: [{ k: 'bin', op: '/', l, r }] };
      case '%':
        return { k: 'call', name: 'ModuloInteger', args: [l, r] };
      case '^':
      case '|':
      case '~':
      case '&':
      case '<<':
      case '>>':
        return unknown('bitop');
      default:
        return { k: 'bin', op, l, r };
    }
  }

  private simple(): LuaExpr {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, int: false };
      case 'str':
        return { k: 'str', v: t.v };
      case 'op':
        if (t.v === '{') return this.table();
        if (t.v === '...') return unknown('vararg');
        this.pos--;
        return this.suffixed();
      case 'id':
        if (t.v === 'nil') return { k: 'null' };
        if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
        if (t.v === 'function') return this.anonymous();
        this.pos--;
        return this.suffixed();
      default:
        this.pos--;
        return this.fail('expected an expression');
    }
  }

  /** `function (...) ... end` as a value: a named function of its own, referenced */
  private anonymous(): JassExpr {
    const name = `__lua_fn_${++this.anon}`;
    this.functions.set(name, this.functionBody(name));
    return { k: 'fref', name };
  }

  private table(): LuaExpr {
    const items: TableExpr['items'] = [];
    let n = 0;
    while (!this.is('}')) {
      if (this.accept('[')) {
        const key = this.expr();
        this.expect(']');
        this.expect('=');
        items.push({ key, value: this.expr() });
      } else if (this.peek().t === 'id' && this.is('=', 1)) {
        // A named field is no array entry
        this.pos += 2;
        this.expr();
      } else {
        items.push({ key: { k: 'num', v: ++n, int: false }, value: this.expr() });
      }
      if (!this.accept(',') && !this.accept(';')) break;
    }
    this.expect('}');
    return { k: 'table', fill: null, items };
  }

  /** Several targets of an assignment, or one call */
  private suffixedList(): JassExpr[] {
    const out = [this.suffixed()];
    while (this.accept(',')) out.push(this.suffixed());
    return out;
  }

  private suffixed(): JassExpr {
    let base: JassExpr;
    let name: string | null = null;
    if (this.accept('(')) {
      base = this.expr();
      this.expect(')');
    } else {
      name = this.name();
      const local = this.resolve(name);
      base = { k: 'id', name: local };
      name = local;
    }
    for (;;) {
      if (this.accept('[')) {
        const index = this.expr();
        this.expect(']');
        base = name && base.k === 'id' ? { k: 'index', name, index } : unknown('index');
        name = null;
      } else if (this.is('.') || this.is(':')) {
        const method = (this.next() as { v: string }).v === ':';
        this.name();
        base = unknown('field');
        name = null;
        if (method) this.args();
      } else if (this.is('(') || this.is('{') || this.peek().t === 'str') {
        const args = this.args();
        base = name && base.k === 'id' ? this.call(name, args) : unknown('call');
        name = null;
      } else {
        return base;
      }
    }
  }

  private args(): JassExpr[] {
    if (this.peek().t === 'str') return [{ k: 'str', v: (this.next() as { v: string }).v }];
    if (this.accept('{')) return [this.value(this.table())];
    this.expect('(');
    const args: LuaExpr[] = [];
    while (!this.is(')')) {
      args.push(this.luaExpr());
      if (!this.accept(',')) break;
    }
    this.expect(')');
    // __jarray's default goes along with the table it makes
    return args.map((a) => (a.k === 'table' ? unknown('table') : a));
  }

  private call(name: string, args: JassExpr[]): JassExpr {
    if (name === 'FourCC' && args[0]?.k === 'str' && args[0].v.length === 4) {
      const s = args[0].v;
      return { k: 'num', v: ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) | 0, int: true };
    }
    return { k: 'call', name, args };
  }
}

/** `__jarray(d)` reads as a table with that default for missing entries */
function asTable(e: LuaExpr | null | undefined): TableExpr | null {
  if (!e) return null;
  if (e.k === 'table') return e;
  if (e.k === 'call' && e.name === '__jarray') return { k: 'table', fill: e.args[0] ?? null, items: [] };
  return null;
}

// ---------------------------------------------------------------- after parsing

type Walk = (e: JassExpr) => JassExpr;

function mapExpr(e: JassExpr, f: Walk): JassExpr {
  switch (e.k) {
    case 'index':
      return f({ ...e, index: mapExpr(e.index, f) });
    case 'call':
      return f({ ...e, args: e.args.map((a) => mapExpr(a, f)) });
    case 'un':
      return f({ ...e, e: mapExpr(e.e, f) });
    case 'bin':
      return f({ ...e, l: mapExpr(e.l, f), r: mapExpr(e.r, f) });
    default:
      return f(e);
  }
}

function mapStmts(body: JassStmt[], f: Walk): JassStmt[] {
  return body.map((s): JassStmt => {
    switch (s.k) {
      case 'set':
        return { ...s, index: s.index ? mapExpr(s.index, f) : null, value: mapExpr(s.value, f) };
      case 'call':
        return { k: 'call', call: mapExpr(s.call, f) as JassExpr & { k: 'call' } };
      case 'if':
        return {
          k: 'if',
          branches: s.branches.map((b) => ({ cond: mapExpr(b.cond, f), body: mapStmts(b.body, f) })),
          otherwise: s.otherwise ? mapStmts(s.otherwise, f) : null,
        };
      case 'loop':
        return { k: 'loop', body: mapStmts(s.body, f) };
      case 'exitwhen':
        return { k: 'exitwhen', cond: mapExpr(s.cond, f) };
      case 'return':
        return { k: 'return', value: s.value ? mapExpr(s.value, f) : null };
    }
  });
}

export function parseLua(src: string): JassProgram {
  const program: JassProgram = { globals: [], functions: new Map(), warnings: [] };
  let toks: Tok[];
  try {
    toks = lex(src);
  } catch (e) {
    program.warnings.push(`script not readable: ${(e as Error).message}`);
    return program;
  }
  const p = new Parser(toks);
  p.chunk(program.warnings);

  // `x = __jarray(d)` in a function made x an array; tables that came as calls are tables too
  const tableType = (t: TableExpr): string => (t.fill?.k === 'num' ? 'real' : t.fill?.k === 'bool' ? 'boolean' : 'lua');
  const fixTables = (body: JassStmt[], fn: JassFunction): JassStmt[] =>
    body.flatMap((s): JassStmt[] => {
      if (s.k === 'set' && !s.index) {
        const t = asTable(s.value);
        if (t) {
          const local = fn.locals.find((l) => l.name === s.name);
          if (local) {
            local.array = true;
            local.type = tableType(t);
          } else if (!fn.params.some((v) => v.name === s.name)) {
            p.globals.set(s.name, { name: s.name, type: tableType(t), array: true, init: null });
          }
          return [];
        }
      }
      if (s.k === 'if') return [{ ...s, branches: s.branches.map((b) => ({ ...b, body: fixTables(b.body, fn) })), otherwise: s.otherwise ? fixTables(s.otherwise, fn) : null }];
      if (s.k === 'loop') return [{ ...s, body: fixTables(s.body, fn) }];
      return [s];
    });
  for (const fn of p.functions.values()) fn.body = fixTables(fn.body, fn);
  for (const [name, g] of p.globals) {
    const t = asTable(g.init);
    if (t) p.globals.set(name, { name, type: tableType(t), array: true, init: null });
  }

  // A function's name as a value is a reference to it (TriggerAddAction(t, Trig_X_Actions))
  const functions = p.functions;
  for (const fn of functions.values()) {
    const locals = new Set([...fn.params, ...fn.locals].map((v) => v.name));
    fn.body = mapStmts(fn.body, (e) => (e.k === 'id' && functions.has(e.name) && !locals.has(e.name) ? { k: 'fref', name: e.name } : e));
  }
  program.globals = [...p.globals.values()].map((g) =>
    g.init ? { ...g, init: mapExpr(g.init, (e) => (e.k === 'id' && functions.has(e.name) ? { k: 'fref', name: e.name } : e)) } : g,
  );
  program.functions = functions;
  return program;
}
