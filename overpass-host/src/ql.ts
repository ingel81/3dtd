/**
 * What the proxy reads in an Overpass QL query before it lets it through:
 * where in the world it looks (its spatial anchors), whether every query
 * statement is held to such an anchor, and its settings, rewritten with the
 * timeout and memory the host allows. Not a full parser: a lexer that knows
 * strings and comments, and a walk over the statements that knows unions,
 * blocks and the filters of a query statement, enough to tell a query held
 * to a small area from one that reads the planet. Anything it cannot place
 * counts as unanchored, so the doubt goes against the query.
 * https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */
import { aroundAreaKm2, boxAreaKm2, boxEdgesKm, type Box } from './geo.ts';

export interface Token {
  /** `str` a quoted string, `word` a name or number, `op` one or two characters of punctuation */
  kind: 'str' | 'word' | 'op';
  text: string;
  start: number;
  end: number;
}

export class QlError extends Error {}

const WORD = /[A-Za-z0-9_.\-+]/;
const TWO_CHAR_OPS = new Set(['->', '<<', '>>', '!~', '==', '!=', '<=', '>=', '&&', '||']);

/**
 * The tokens of `text`, comments dropped. A word takes letters, digits, `_`,
 * `.`, `-` and `+` so that a number such as `-12.5e+3` stays one token; a
 * set name after a type (`way.a`) is split off where the walk needs it.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let k = 0;
  while (k < text.length) {
    const c = text[k];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      k++;
    } else if (c === '/' && text[k + 1] === '/') {
      while (k < text.length && text[k] !== '\n') k++;
    } else if (c === '/' && text[k + 1] === '*') {
      const close = text.indexOf('*/', k + 2);
      if (close < 0) throw new QlError('comment without its end');
      k = close + 2;
    } else if (c === '"' || c === "'") {
      const start = k++;
      while (k < text.length && text[k] !== c) k += text[k] === '\\' ? 2 : 1;
      if (k >= text.length) throw new QlError('string without its end');
      k++;
      tokens.push({ kind: 'str', text: text.slice(start, k), start, end: k });
    } else if (/[A-Za-z0-9_]/.test(c) || (c === '-' && /[0-9.]/.test(text[k + 1] ?? '')) || (c === '.' && /[A-Za-z0-9_]/.test(text[k + 1] ?? ''))) {
      const start = k++;
      while (k < text.length && WORD.test(text[k])) {
        // `-` and `+` belong to a word only inside a number's exponent or as the sign of a number
        if ((text[k] === '-' || text[k] === '+') && !/[eE]/.test(text[k - 1])) break;
        k++;
      }
      tokens.push({ kind: 'word', text: text.slice(start, k), start, end: k });
    } else {
      const two = text.slice(k, k + 2);
      const op = TWO_CHAR_OPS.has(two) ? two : c;
      tokens.push({ kind: 'op', text: op, start: k, end: k + op.length });
      k += op.length;
    }
  }
  return tokens;
}

/** Where a query statement looks */
export type Anchor =
  /** A box, explicit or the global `[bbox]` */
  | { kind: 'box'; box: Box; areaKm2: number }
  /** `around` a list of points: their envelope widened by the radius, and the area actually swept */
  | { kind: 'around'; box: Box; areaKm2: number; radiusM: number }
  /** `poly`: the polygon's envelope */
  | { kind: 'poly'; box: Box; areaKm2: number }
  /** Ids, or an input set, or `around` an input set (with its radius): bounded by what came before */
  | { kind: 'derived'; radiusM?: number };

export interface Settings {
  timeoutS: number | null;
  maxsizeBytes: number | null;
  bbox: Box | null;
  /** `date`, `diff` or `adiff`: history, which a database without attic does not have */
  history: boolean;
  /** Offsets of the settings statement in the text, `[` to its `;` included; null when the query has none */
  span: { start: number; end: number } | null;
  /** The settings other than timeout and maxsize, as written */
  others: string[];
}

/** Why a query is refused: a code for the statistics, and the words for the client */
export type RefusalCode = 'xml' | 'syntax' | 'history' | 'area' | 'filter' | 'unbounded' | 'too-large' | 'body';
export interface Refusal {
  code: RefusalCode;
  message: string;
}

export interface QueryAnalysis {
  settings: Settings;
  /** Every spatial anchor of the query, the global bbox included once when a statement leans on it */
  anchors: Anchor[];
  /** Why the query is refused, or null when every statement is held to an area */
  refusal: Refusal | null;
}

const QUERY_TYPES = new Set(['node', 'way', 'rel', 'relation', 'nwr', 'nw', 'wr', 'nr', 'derived']);
const BLOCKS = new Set(['foreach', 'for', 'if', 'else', 'complete', 'retro', 'compare', 'timeline']);
const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

const AREA_REFUSAL: Refusal = { code: 'area', message: 'area queries are not available on this server (it has no areas)' };

const num = (text: string): number => (NUMBER.test(text) ? Number(text) : NaN);

function boxOf(s: number, w: number, n: number, e: number): Box | null {
  if (![s, w, n, e].every(Number.isFinite)) return null;
  if (s < -90 || n > 90 || s > n || w < -180 || w > 180 || e < -180 || e > 180) return null;
  return { s, w, n, e };
}

/** `[a, b, c, d]` of the words between commas, or null when they are not four numbers */
function fourNumbers(tokens: readonly Token[]): number[] | null {
  if (tokens.length !== 7) return null;
  const values: number[] = [];
  for (let k = 0; k < 7; k++) {
    if (k % 2 === 1) {
      if (tokens[k].text !== ',') return null;
    } else {
      values.push(num(tokens[k].text));
    }
  }
  return values.every(Number.isFinite) ? values : null;
}

/** The settings statement at the start of `tokens`, and the index after it */
function readSettings(text: string, tokens: readonly Token[]): { settings: Settings; next: number } {
  const settings: Settings = { timeoutS: null, maxsizeBytes: null, bbox: null, history: false, span: null, others: [] };
  if (tokens[0]?.text !== '[') return { settings, next: 0 };
  let k = 0;
  while (tokens[k]?.text === '[') {
    let depth = 0;
    let close = k;
    for (; close < tokens.length; close++) {
      if (tokens[close].text === '[') depth++;
      else if (tokens[close].text === ']' && --depth === 0) break;
    }
    if (close >= tokens.length) throw new QlError('setting without its ]');
    const inner = tokens.slice(k + 1, close);
    const name = inner[0]?.text.toLowerCase();
    if (inner[1]?.text !== ':') throw new QlError(`setting [${name ?? ''}] without a value`);
    const value = inner.slice(2);
    if (name === 'timeout') {
      settings.timeoutS = value.length === 1 ? num(value[0].text) : NaN;
      if (!Number.isFinite(settings.timeoutS)) throw new QlError('[timeout] is no number');
    } else if (name === 'maxsize') {
      settings.maxsizeBytes = value.length === 1 ? num(value[0].text) : NaN;
      if (!Number.isFinite(settings.maxsizeBytes)) throw new QlError('[maxsize] is no number');
    } else {
      if (name === 'bbox') {
        const v = fourNumbers(value);
        settings.bbox = v && boxOf(v[0], v[1], v[2], v[3]);
        if (!settings.bbox) throw new QlError('[bbox] is no box (south,west,north,east)');
      } else if (name === 'date' || name === 'diff' || name === 'adiff') {
        settings.history = true;
      }
      settings.others.push(text.slice(tokens[k].start, tokens[close].end));
    }
    k = close + 1;
  }
  if (tokens[k]?.text !== ';') throw new QlError('settings without the ; after them');
  settings.span = { start: tokens[0].start, end: tokens[k].end };
  return { settings, next: k + 1 };
}

/** Index of the token that closes the bracket at `open` */
function closing(tokens: readonly Token[], open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k].text;
    if (tokens[k].kind !== 'op') continue;
    if (pairs[t]) stack.push(pairs[t]);
    else if (t === ')' || t === ']' || t === '}') {
      if (stack.pop() !== t) throw new QlError(`unexpected ${t}`);
      if (!stack.length) return k;
    }
  }
  throw new QlError(`${tokens[open].text} without its end`);
}

/** The latitudes and longitudes of a `poly:"lat lon lat lon ..."` string */
function polyBox(literal: string): Box | null {
  const values = literal.slice(1, -1).trim().split(/\s+/).map(num);
  if (values.length < 6 || values.length % 2 || !values.every(Number.isFinite)) return null;
  let s = 90, n = -90, w = 180, e = -180;
  for (let k = 0; k < values.length; k += 2) {
    s = Math.min(s, values[k]);
    n = Math.max(n, values[k]);
    w = Math.min(w, values[k + 1]);
    e = Math.max(e, values[k + 1]);
  }
  return boxOf(s, w, n, e);
}

/**
 * What one `( ... )` filter of a query statement says about where it looks:
 * an anchor, `null` for a filter that does not hold the statement to an area
 * (`if:`, `user:`, `newer:` and the like), or a refusal.
 */
function readFilter(inner: readonly Token[]): Anchor | null | { refusal: Refusal } {
  const first = inner[0]?.text ?? '';
  const head = first.split('.')[0].toLowerCase();
  const bbox = fourNumbers(inner);
  if (bbox) {
    const box = boxOf(bbox[0], bbox[1], bbox[2], bbox[3]);
    return box ? { kind: 'box', box, areaKm2: boxAreaKm2(box) } : { refusal: { code: 'filter', message: 'a box that is no box (south,west,north,east)' } };
  }
  if (head === 'around') {
    if (inner[1]?.text !== ':') return { refusal: { code: 'filter', message: 'around without its radius' } };
    const radiusM = num(inner[2]?.text ?? '');
    if (!Number.isFinite(radiusM) || radiusM < 0) return { refusal: { code: 'filter', message: 'around with a radius that is no number' } };
    const rest = inner.slice(3);
    // around an input set: `around:R` or `around.a:R`
    if (!rest.length) return { kind: 'derived', radiusM };
    const values: number[] = [];
    for (let k = 0; k < rest.length; k++) {
      if (k % 2 === 0) {
        if (rest[k].text !== ',') return { refusal: { code: 'filter', message: 'around with a point list that is no list' } };
      } else {
        values.push(num(rest[k].text));
      }
    }
    if (values.length < 2 || values.length % 2 || !values.every(Number.isFinite)) return { refusal: { code: 'filter', message: 'around with points that are no points' } };
    const points: { lat: number; lon: number }[] = [];
    for (let k = 0; k < values.length; k += 2) points.push({ lat: values[k], lon: values[k + 1] });
    if (points.some((p) => Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) return { refusal: { code: 'filter', message: 'around with a point off the planet' } };
    const around = aroundAreaKm2(points, radiusM);
    return { kind: 'around', box: around.box, areaKm2: around.areaKm2, radiusM };
  }
  if (head === 'poly') {
    const box = inner[1]?.text === ':' && inner[2]?.kind === 'str' && inner.length === 3 ? polyBox(inner[2].text) : null;
    return box ? { kind: 'poly', box, areaKm2: boxAreaKm2(box) } : { refusal: { code: 'filter', message: 'poly that is no polygon' } };
  }
  if (head === 'area' || head === 'pivot') return { refusal: AREA_REFUSAL };
  // Ids: `(123)`, `(id:1,2,3)`
  if (inner.length && inner.every((t, k) => (k % 2 === 1 ? t.text === ',' : /^\d+$/.test(t.text)))) return { kind: 'derived' };
  if (head === 'id' && inner[1]?.text === ':') return { kind: 'derived' };
  // Recursion from an input set: `(r)`, `(w.a)`, `(bn)`, `(r.a:"role")`
  if (/^(r|w|n|bn|bw|br)$/.test(head)) return { kind: 'derived' };
  return null;
}

export interface Limits {
  /** Longest edge of any one anchor's box, km */
  maxEdgeKm: number;
  /** All the anchors' areas together, km² */
  maxAreaKm2: number;
}

/**
 * The anchors of the query in `text` and whether the host takes it: every
 * query statement held to an area (an explicit box, `around`, `poly`, ids,
 * an input set, or the global `[bbox]`), no history, no areas, no XML.
 * Throws QlError where the text is no query it can read.
 */
export function analyzeQuery(text: string, limits: Limits): QueryAnalysis {
  if (/^\s*</.test(text)) {
    return { settings: readSettings('', []).settings, anchors: [], refusal: { code: 'xml', message: 'only Overpass QL is taken here, no XML queries' } };
  }
  const tokens = tokenize(text);
  const { settings, next } = readSettings(text, tokens);
  const anchors: Anchor[] = [];
  let refusal: Refusal | null = settings.history
    ? { code: 'history', message: 'no history here: [date], [diff] and [adiff] need attic data' }
    : null;
  let usesGlobalBox = false;
  const refuse = (why: Refusal): void => {
    refusal ??= why;
  };

  /** Walk the statements from `k` to `end` (exclusive) */
  const walk = (from: number, end: number): void => {
    let k = from;
    while (k < end && !refusal) {
      const t = tokens[k];
      const word = t.kind === 'word' ? t.text.split('.')[0].toLowerCase() : '';
      if (t.text === ';' || t.text === '-') {
        k++;
      } else if (t.text === '(' || t.text === '{') {
        // A union or difference; a block's body when it follows the block's header
        const close = closing(tokens, k);
        walk(k + 1, close);
        k = close + 1;
      } else if (t.kind === 'word' && QUERY_TYPES.has(word)) {
        k = queryStatement(k, end, word);
      } else if (t.kind === 'word' && BLOCKS.has(word)) {
        k = blockStatement(k, end);
      } else if (word === 'area' || word === 'is_in' || word === 'map_to_area') {
        refuse(AREA_REFUSAL);
      } else {
        // out, recursion (>, >>, <, <<), make, convert, local, a set (.a), and the rest: no query of the database by itself
        k = statementEnd(k, end);
      }
    }
  };

  /** The index after the `;` that ends the statement at `k`, brackets skipped */
  const statementEnd = (k: number, end: number): number => {
    while (k < end && tokens[k].text !== ';') {
      if (tokens[k].text === '(' || tokens[k].text === '[' || tokens[k].text === '{') k = closing(tokens, k);
      k++;
    }
    return k + 1;
  };

  /** A block statement: its header up to the `{` (or the old `(` body of foreach), then its body */
  const blockStatement = (k: number, end: number): number => {
    const isForeach = tokens[k].text.split('.')[0].toLowerCase() === 'foreach';
    k++;
    while (k < end) {
      const t = tokens[k].text;
      if (t === '{' || (isForeach && t === '(')) {
        const close = closing(tokens, k);
        walk(k + 1, close);
        return close + 1;
      }
      if (t === '(') k = closing(tokens, k) + 1;
      else if (t === ';') return k + 1;
      else k++;
    }
    return k;
  };

  /** A query statement: its type, its filters, its output set */
  const queryStatement = (k: number, end: number, type: string): number => {
    let anchored = tokens[k].text.includes('.') || type === 'derived';
    const own: Anchor[] = [];
    k++;
    while (k < end && tokens[k].text !== ';' && tokens[k].text !== '->') {
      const t = tokens[k];
      if (t.text === '[') {
        k = closing(tokens, k) + 1;
      } else if (t.text === '(') {
        const close = closing(tokens, k);
        const filter = readFilter(tokens.slice(k + 1, close));
        if (filter && 'refusal' in filter) {
          refuse(filter.refusal);
          return close + 1;
        }
        if (filter) {
          anchored = true;
          if (filter.kind === 'derived') {
            const r = filter.radiusM ?? 0;
            if (r * 2 > limits.maxEdgeKm * 1000) {
              refuse({ code: 'too-large', message: `around with a radius of ${r} m, more than ${(limits.maxEdgeKm * 500).toFixed(0)} m` });
            }
          } else {
            own.push(filter);
          }
        }
        k = close + 1;
      } else if (t.kind === 'word' && t.text.startsWith('.')) {
        // An input set written apart: `way .a [..]`
        anchored = true;
        k++;
      } else {
        k++;
      }
    }
    anchors.push(...own);
    if (!anchored) {
      if (settings.bbox) usesGlobalBox = true;
      else refuse({ code: 'unbounded', message: 'a query statement without a box: give it one, (south,west,north,east), around or [bbox]' });
    }
    return statementEnd(k, end);
  };

  walk(next, tokens.length);
  if (usesGlobalBox && settings.bbox) anchors.push({ kind: 'box', box: settings.bbox, areaKm2: boxAreaKm2(settings.bbox) });
  if (!refusal) refusal = sizeRefusal(anchors, limits);
  return { settings, anchors, refusal };
}

/** Why the anchors read too much of the world, or null */
function sizeRefusal(anchors: readonly Anchor[], limits: Limits): Refusal | null {
  let area = 0;
  for (const anchor of anchors) {
    if (anchor.kind === 'derived') continue;
    const { ns, ew } = boxEdgesKm(anchor.box);
    const edge = Math.max(ns, ew);
    if (edge > limits.maxEdgeKm) return { code: 'too-large', message: `a box of ${edge.toFixed(1)} km, more than ${limits.maxEdgeKm} km` };
    area += anchor.areaKm2;
  }
  if (area > limits.maxAreaKm2) return { code: 'too-large', message: `${area.toFixed(1)} km² in all, more than ${limits.maxAreaKm2} km²` };
  return null;
}

/** The hull of the query's anchors with a box, for the statistics; null when none has one */
export function anchorHull(anchors: readonly Anchor[]): Box | null {
  let hull: Box | null = null;
  for (const anchor of anchors) {
    if (anchor.kind === 'derived') continue;
    const b = anchor.box;
    hull = hull ? { s: Math.min(hull.s, b.s), w: Math.min(hull.w, b.w), n: Math.max(hull.n, b.n), e: Math.max(hull.e, b.e) } : { ...b };
  }
  return hull;
}

/** The anchors' areas together, km² */
export const anchorArea = (anchors: readonly Anchor[]): number =>
  anchors.reduce((sum, a) => sum + (a.kind === 'derived' ? 0 : a.areaKm2), 0);

export interface Caps {
  timeoutS: number;
  maxsizeBytes: number;
}

/**
 * `text` with its settings holding the caps: a timeout or maxsize above the
 * cap, or none, becomes the cap; one below stays. The other settings stay as
 * written. A query without settings gets them in front.
 */
export function capSettings(text: string, settings: Settings, caps: Caps): { query: string; timeoutS: number; maxsizeBytes: number } {
  const timeoutS = Math.max(1, Math.min(caps.timeoutS, settings.timeoutS ?? Infinity));
  const maxsizeBytes = Math.max(1, Math.min(caps.maxsizeBytes, settings.maxsizeBytes ?? Infinity));
  const head = `${settings.others.join('')}[timeout:${Math.floor(timeoutS)}][maxsize:${Math.floor(maxsizeBytes)}];`;
  const query = settings.span ? text.slice(0, settings.span.start) + head + text.slice(settings.span.end) : `${head}\n${text}`;
  return { query, timeoutS: Math.floor(timeoutS), maxsizeBytes: Math.floor(maxsizeBytes) };
}
