/**
 * Parser for JASS, the script language of Warcraft 3 maps (war3map.j). It
 * reads the globals block and every function into a small syntax tree for
 * the route evaluator; natives, types and statements it does not need are
 * skipped. A function that does not parse is dropped with a warning instead
 * of failing the whole script.
 */

export type JassExpr =
  | { k: 'num'; v: number; int: boolean }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'id'; name: string }
  | { k: 'index'; name: string; index: JassExpr }
  | { k: 'call'; name: string; args: JassExpr[] }
  | { k: 'fref'; name: string }
  | { k: 'un'; op: '-' | 'not'; e: JassExpr }
  | { k: 'bin'; op: string; l: JassExpr; r: JassExpr };

export type JassStmt =
  | { k: 'set'; name: string; index: JassExpr | null; value: JassExpr }
  | { k: 'call'; call: JassExpr & { k: 'call' } }
  | { k: 'if'; branches: { cond: JassExpr; body: JassStmt[] }[]; otherwise: JassStmt[] | null }
  | { k: 'loop'; body: JassStmt[] }
  | { k: 'exitwhen'; cond: JassExpr }
  | { k: 'return'; value: JassExpr | null };

export interface JassVar {
  name: string;
  type: string;
  array: boolean;
  init: JassExpr | null;
}

export interface JassFunction {
  name: string;
  params: JassVar[];
  returns: string;
  locals: JassVar[];
  body: JassStmt[];
}

export interface JassProgram {
  globals: JassVar[];
  functions: Map<string, JassFunction>;
  warnings: string[];
}

// ---------------------------------------------------------------- lexer

type Tok =
  | { t: 'id'; v: string; line: number }
  | { t: 'num'; v: number; int: boolean; line: number }
  | { t: 'str'; v: string; line: number }
  | { t: 'op'; v: string; line: number }
  | { t: 'nl'; line: number }
  | { t: 'eof'; line: number };

class JassSyntaxError extends Error {}

const OPS = ['==', '!=', '<=', '>=', '+', '-', '*', '/', '=', '<', '>', '(', ')', '[', ']', ','];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      out.push({ t: 'nl', line });
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
    } else if (/[0-9.]/.test(c) && (c !== '.' || /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        out.push({ t: 'num', v: parseInt(src.slice(i + 2, j), 16) | 0, int: true, line });
      } else {
        while (j < n && /[0-9]/.test(src[j])) j++;
        let real = false;
        if (src[j] === '.') {
          real = true;
          j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        const text = src.slice(i, j);
        // A leading zero makes an octal integer
        const v = real ? parseFloat(text) : /^0[0-7]+$/.test(text) ? parseInt(text, 8) : parseInt(text, 10);
        out.push({ t: 'num', v, int: !real, line });
      }
      i = j;
    } else if (c === '$') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      out.push({ t: 'num', v: parseInt(src.slice(i + 1, j), 16) | 0, int: true, line });
      i = j;
    } else if (c === "'") {
      // Raw code: 'hfoo' as a base-256 integer, or a single character
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new JassSyntaxError(`line ${line}: unterminated raw code`);
      let v = 0;
      for (let k = i + 1; k < end; k++) v = (v * 256 + (src.charCodeAt(k) & 0xff)) | 0;
      out.push({ t: 'num', v, int: true, line });
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          const e = src[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2;
        } else {
          if (src[j] === '\n') line++;
          s += src[j++];
        }
      }
      out.push({ t: 'str', v: s, line });
      i = j + 1;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new JassSyntaxError(`line ${line}: unexpected character "${c}"`);
      out.push({ t: 'op', v: op, line });
      i += op.length;
    }
  }
  out.push({ t: 'nl', line });
  out.push({ t: 'eof', line });
  return out;
}

// ---------------------------------------------------------------- parser

/** Binary operators by precedence; a Map, so a word like `constructor` or `toString` is no operator */
const BIN_PREC = new Map<string, number>([
  ['or', 1],
  ['and', 2],
  ['==', 3],
  ['!=', 3],
  ['<', 4],
  ['>', 4],
  ['<=', 4],
  ['>=', 4],
  ['+', 5],
  ['-', 5],
  ['*', 6],
  ['/', 6],
]);

/** Nesting of expressions and blocks the parser follows; deeper is a hostile script, not a map */
export const MAX_JASS_NESTING = 500;

class Parser {
  pos = 0;
  private depth = 0;

  constructor(private readonly toks: Tok[]) {}

  peek(): Tok {
    return this.toks[this.pos];
  }

  next(): Tok {
    return this.toks[this.pos++];
  }

  isWord(w: string): boolean {
    const t = this.peek();
    return t.t === 'id' && t.v === w;
  }

  isOp(o: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === o;
  }

  /** One level deeper into an expression or block; past MAX_JASS_NESTING the function is skipped */
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

  fail(msg: string): never {
    throw new JassSyntaxError(`line ${this.peek().line}: ${msg}`);
  }

  word(w?: string): string {
    const t = this.next();
    if (t.t !== 'id' || (w !== undefined && t.v !== w)) {
      this.pos--;
      this.fail(`expected ${w ?? 'a name'}`);
    }
    return t.v;
  }

  op(o: string): void {
    if (!this.isOp(o)) this.fail(`expected "${o}"`);
    this.pos++;
  }

  skipNewlines(): void {
    while (this.peek().t === 'nl') this.pos++;
  }

  endOfLine(): void {
    const t = this.peek();
    if (t.t !== 'nl' && t.t !== 'eof') this.fail('expected end of line');
    this.skipNewlines();
  }

  skipLine(): void {
    while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.pos++;
    this.skipNewlines();
  }

  /** `[constant] type [array] name [= expr]` */
  variable(): JassVar {
    if (this.isWord('constant')) this.pos++;
    const type = this.word();
    let array = false;
    if (this.isWord('array')) {
      array = true;
      this.pos++;
    }
    const name = this.word();
    let init: JassExpr | null = null;
    if (this.isOp('=')) {
      this.pos++;
      init = this.expr(0);
    }
    return { name, type, array, init };
  }

  expr(minPrec: number): JassExpr {
    return this.nested(() => {
      let left = this.unary();
      for (;;) {
        const t = this.peek();
        const op = t.t === 'op' || t.t === 'id' ? t.v : '';
        const prec = BIN_PREC.get(op);
        if (prec === undefined || prec < minPrec) break;
        this.pos++;
        const right = this.expr(prec + 1);
        left = { k: 'bin', op, l: left, r: right };
      }
      return left;
    });
  }

  unary(): JassExpr {
    return this.nested(() => this.unaryOnce());
  }

  private unaryOnce(): JassExpr {
    if (this.isOp('-')) {
      this.pos++;
      return { k: 'un', op: '-', e: this.unary() };
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    if (this.isWord('not')) {
      this.pos++;
      return { k: 'un', op: 'not', e: this.expr(3) };
    }
    return this.primary();
  }

  primary(): JassExpr {
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.v, int: t.int };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr(0);
      this.op(')');
      return e;
    }
    if (t.t !== 'id') {
      this.pos--;
      this.fail('expected an expression');
    }
    switch (t.v) {
      case 'true':
        return { k: 'bool', v: true };
      case 'false':
        return { k: 'bool', v: false };
      case 'null':
        return { k: 'null' };
      case 'function':
        return { k: 'fref', name: this.word() };
    }
    if (this.isOp('(')) return this.callArgs(t.v);
    if (this.isOp('[')) {
      this.pos++;
      const index = this.expr(0);
      this.op(']');
      return { k: 'index', name: t.v, index };
    }
    return { k: 'id', name: t.v };
  }

  callArgs(name: string): JassExpr & { k: 'call' } {
    this.op('(');
    const args: JassExpr[] = [];
    if (!this.isOp(')')) {
      args.push(this.expr(0));
      while (this.isOp(',')) {
        this.pos++;
        args.push(this.expr(0));
      }
    }
    this.op(')');
    return { k: 'call', name, args };
  }

  /** Statements up to (not including) one of the `end` words */
  block(end: string[]): JassStmt[] {
    return this.nested(() => {
      const out: JassStmt[] = [];
      this.skipNewlines();
      while (!end.some((w) => this.isWord(w))) {
        if (this.peek().t === 'eof') this.fail(`missing ${end[0]}`);
        out.push(this.statement());
      }
      return out;
    });
  }

  statement(): JassStmt {
    if (this.isWord('debug')) this.pos++;
    const w = this.word();
    switch (w) {
      case 'set': {
        const name = this.word();
        let index: JassExpr | null = null;
        if (this.isOp('[')) {
          this.pos++;
          index = this.expr(0);
          this.op(']');
        }
        this.op('=');
        const value = this.expr(0);
        this.endOfLine();
        return { k: 'set', name, index, value };
      }
      case 'call': {
        const call = this.callArgs(this.word());
        this.endOfLine();
        return { k: 'call', call };
      }
      case 'if': {
        const branches: { cond: JassExpr; body: JassStmt[] }[] = [];
        let cond = this.expr(0);
        this.word('then');
        let body = this.block(['elseif', 'else', 'endif']);
        branches.push({ cond, body });
        let otherwise: JassStmt[] | null = null;
        for (;;) {
          const kw = this.word();
          if (kw === 'elseif') {
            cond = this.expr(0);
            this.word('then');
            body = this.block(['elseif', 'else', 'endif']);
            branches.push({ cond, body });
          } else if (kw === 'else') {
            otherwise = this.block(['endif']);
          } else {
            break;
          }
        }
        this.endOfLine();
        return { k: 'if', branches, otherwise };
      }
      case 'loop': {
        const body = this.block(['endloop']);
        this.pos++;
        this.endOfLine();
        return { k: 'loop', body };
      }
      case 'exitwhen': {
        const cond = this.expr(0);
        this.endOfLine();
        return { k: 'exitwhen', cond };
      }
      case 'return': {
        const t = this.peek();
        const value = t.t === 'nl' || t.t === 'eof' ? null : this.expr(0);
        this.endOfLine();
        return { k: 'return', value };
      }
    }
    this.pos--;
    return this.fail(`unexpected "${w}"`);
  }

  functionDecl(): JassFunction {
    const name = this.word();
    this.word('takes');
    const params: JassVar[] = [];
    if (this.isWord('nothing')) this.pos++;
    else {
      do {
        if (this.isOp(',')) this.pos++;
        const type = this.word();
        params.push({ name: this.word(), type, array: false, init: null });
      } while (this.isOp(','));
    }
    this.word('returns');
    const returns = this.word();
    this.endOfLine();
    const locals: JassVar[] = [];
    while (this.isWord('local')) {
      this.pos++;
      locals.push(this.variable());
      this.endOfLine();
    }
    const body = this.block(['endfunction']);
    this.pos++;
    this.endOfLine();
    return { name, params, returns, locals, body };
  }

  /** Skips to just past the next `endfunction` */
  recover(): void {
    while (this.peek().t !== 'eof' && !this.isWord('endfunction')) this.pos++;
    if (this.peek().t !== 'eof') this.pos++;
    this.skipNewlines();
  }
}

const parsedScripts = new WeakMap<object, JassProgram>();

/**
 * The script's program, parsed once however many steps of the import read
 * it (routes, waves); the program is read only
 */
export function parseScript(script: { text: string }): JassProgram {
  let program = parsedScripts.get(script);
  if (!program) {
    program = parseJass(script.text);
    parsedScripts.set(script, program);
  }
  return program;
}

export function parseJass(src: string): JassProgram {
  const program: JassProgram = { globals: [], functions: new Map(), warnings: [] };
  let toks: Tok[];
  try {
    toks = lex(src);
  } catch (e) {
    program.warnings.push(`script not readable: ${(e as Error).message}`);
    return program;
  }
  const p = new Parser(toks);
  p.skipNewlines();
  while (p.peek().t !== 'eof') {
    const start = p.pos;
    try {
      if (p.isWord('globals')) {
        p.pos++;
        p.skipNewlines();
        while (!p.isWord('endglobals')) {
          if (p.peek().t === 'eof') p.fail('missing endglobals');
          try {
            program.globals.push(p.variable());
            p.endOfLine();
          } catch (e) {
            program.warnings.push(`global skipped: ${(e as Error).message}`);
            p.skipLine();
          }
        }
        p.pos++;
        p.endOfLine();
      } else if (p.isWord('constant') || p.isWord('function')) {
        if (p.isWord('constant')) p.pos++;
        if (p.isWord('native')) {
          p.skipLine();
          continue;
        }
        p.word('function');
        const fn = p.functionDecl();
        program.functions.set(fn.name, fn);
      } else {
        // type declarations, natives and anything else at top level
        p.skipLine();
      }
    } catch (e) {
      if (!(e instanceof JassSyntaxError)) throw e;
      program.warnings.push(`function skipped: ${e.message}`);
      p.pos = start;
      p.recover();
    }
  }
  return program;
}
