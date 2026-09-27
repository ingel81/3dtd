import { describe, it, expect } from 'vitest';
import { DetMath } from './det-math';

/** Fixed inputs: angles, tiny values, large values, values in [-1, 1], in turn */
function inputs(n: number, seed: number): Float64Array {
  let s = seed >>> 0;
  const r = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    out[i] = k === 0 ? (r() - 0.5) * 4 * Math.PI : k === 1 ? (r() - 0.5) * 1e-3 : k === 2 ? (r() - 0.5) * 4000 : (r() - 0.5) * 2;
  }
  return out;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const i64 = new BigInt64Array(f64.buffer);

function fnv(hash: number, word: number): number {
  let h = hash;
  for (let b = 0; b < 4; b++) {
    h ^= (word >>> (8 * b)) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/** FNV-1a over the bits of every value */
function fingerprint(values: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (const value of Array.from(values)) {
    f64[0] = value;
    h = fnv(fnv(h, u32[0]), u32[1]);
  }
  return h >>> 0;
}

/** Doubles between a and b (0 for the same value, both NaN or +-0) */
function ulps(a: number, b: number): number {
  if (a !== a || b !== b) return a !== a && b !== b ? 0 : Infinity;
  if (a === b) return 0;
  const ord = (x: number): bigint => {
    f64[0] = x;
    const bits = i64[0];
    return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

function same(a: number, b: number): boolean {
  return (a !== a && b !== b) || (a === b && (a !== 0 || 1 / a === 1 / b));
}

const A = inputs(20000, 7);
const B = inputs(20000, 11);

type Unary = 'sin' | 'cos' | 'tan' | 'atan' | 'asin' | 'acos' | 'exp' | 'log';
/** Each unary function's inputs, mapped into its domain */
const UNARY: Record<Unary, (x: number) => number> = {
  sin: (x) => x,
  cos: (x) => x,
  tan: (x) => x,
  atan: (x) => x * 50,
  asin: (x) => Math.max(-1, Math.min(1, x)),
  acos: (x) => Math.max(-1, Math.min(1, x)),
  exp: (x) => x % 50,
  log: (x) => Math.abs(x) + 1e-9,
};

describe('DetMath', () => {
  /**
   * The bits of every result over fixed inputs. sin to hypot are those of the
   * prototype (tmp/math-determinism/detmath.js), measured bit for bit the same
   * in Electron 44, Chrome 154, Edge 154, Chromium 141, Firefox 142 and Node
   * 24 (TODO E28); pow is the e_pow port. A change here is a change of the
   * simulation's results in coop and in replays.
   */
  it('gives the same bits as ever', () => {
    const got: Record<string, number> = {};
    for (const [fn, map] of Object.entries(UNARY)) got[fn] = fingerprint(Array.from(A, (x) => DetMath[fn as Unary](map(x))));
    got['atan2'] = fingerprint(Array.from(A, (y, i) => DetMath.atan2(y, B[i])));
    got['hypot'] = fingerprint(Array.from(A, (y, i) => DetMath.hypot(y, B[i])));
    got['pow'] = fingerprint(Array.from(A, (x, i) => DetMath.pow(Math.abs(x), B[i] % 8)));
    expect(got).toEqual({
      sin: 2021644095,
      cos: 4128868057,
      tan: 3790148469,
      atan: 1115555549,
      asin: 1095482083,
      acos: 4015818569,
      exp: 2702850851,
      log: 2866940215,
      atan2: 217317121,
      hypot: 1602721557,
      pow: 1018550945,
    });
    expect(DetMath.sin(1)).toBe(0.8414709848078965);
    expect(DetMath.atan2(1, -1)).toBe(2.356194490192345);
    expect(DetMath.exp(1)).toBe(2.7182818284590455); // fdlibm, one ULP above Math.E
  });

  it('stays within one ULP of the native functions', () => {
    for (const [fn, map] of Object.entries(UNARY)) {
      let worst = 0;
      for (const x of A) worst = Math.max(worst, ulps(DetMath[fn as Unary](map(x)), Math[fn as Unary](map(x))));
      expect(worst, fn).toBeLessThanOrEqual(1);
    }
    let atan2 = 0, pow = 0, hypot = 0;
    for (let i = 0; i < A.length; i++) {
      atan2 = Math.max(atan2, ulps(DetMath.atan2(A[i], B[i]), Math.atan2(A[i], B[i])));
      pow = Math.max(pow, ulps(DetMath.pow(Math.abs(A[i]) * 10, B[i] % 8), Math.pow(Math.abs(A[i]) * 10, B[i] % 8)));
      hypot = Math.max(hypot, ulps(DetMath.hypot(A[i], B[i]), Math.hypot(A[i], B[i])));
    }
    expect(atan2).toBeLessThanOrEqual(1);
    expect(pow).toBeLessThanOrEqual(1);
    // Without Math.hypot's scaling: one rounding more
    expect(hypot).toBeLessThanOrEqual(2);
  });

  it('gives sin and cos from sincos bit for bit', () => {
    for (const x of [...A, 0, -0, Math.PI, 1e5, Infinity, NaN]) {
      const { s, c } = DetMath.sincos(x);
      expect(same(s, DetMath.sin(x)), `sin ${x}`).toBe(true);
      expect(same(c, DetMath.cos(x)), `cos ${x}`).toBe(true);
    }
  });

  it('keeps the special values of the native functions', () => {
    for (const fn of Object.keys(UNARY) as Unary[]) {
      for (const x of [0, -0, NaN, Infinity, -Infinity, 1, -1, 2, -2]) {
        const native = Math[fn](x), det = DetMath[fn](x);
        expect(same(native, det) || ulps(native, det) <= 1, `${fn}(${x}): native ${native}, det ${det}`).toBe(true);
      }
    }
    const pairs: [number, number][] = [
      [0, 0], [-0, 0], [0, -0], [-0, -0], [1, 0], [-1, 0], [0, 1], [0, -1],
      [Infinity, Infinity], [-Infinity, -Infinity], [1, Infinity], [1, -Infinity], [NaN, 1], [1, NaN],
    ];
    for (const [y, x] of pairs) expect(same(DetMath.atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBe(true);
  });

  describe('pow', () => {
    const SPECIAL = [
      0, -0, NaN, Infinity, -Infinity, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 1.5, -1.5, 5e-324, -5e-324,
      2.2250738585072014e-308, 1e-300, 1e300, 1024, -1075, 1e10, 2 ** 53, 2 ** 53 + 2, 2 ** 64, 0.999999, 1.000001,
    ];

    it('agrees with Math.pow on every special value: zeros, infinities, NaN, negative bases', () => {
      for (const x of SPECIAL) {
        for (const y of SPECIAL) {
          const native = Math.pow(x, y), det = DetMath.pow(x, y);
          // Where both are finite and not zero, the last bit may differ, see the ULP test
          const exact = !Number.isFinite(native) || native === 0 || !Number.isFinite(det) || det === 0;
          if (exact) expect(same(det, native), `${x} ** ${y}: native ${native}, det ${det}`).toBe(true);
          else expect(ulps(det, native), `${x} ** ${y}`).toBeLessThanOrEqual(1);
        }
      }
    });

    it('keeps the sign of a negative base: odd exponents negative, even ones positive, others NaN', () => {
      expect(DetMath.pow(-2, 3)).toBe(-8);
      expect(DetMath.pow(-2, 2)).toBe(4);
      expect(DetMath.pow(-2, -1)).toBe(-0.5);
      expect(DetMath.pow(-8, 1 / 3)).toBeNaN();
      expect(DetMath.pow(-0, 3)).toBe(-0);
      expect(DetMath.pow(-0, -3)).toBe(-Infinity);
      expect(DetMath.pow(-0, -2)).toBe(Infinity);
      expect(DetMath.pow(-0, 0.5)).toBe(0);
      expect(DetMath.pow(-1, Infinity)).toBeNaN();
      expect(DetMath.pow(1, NaN)).toBeNaN();
      expect(DetMath.pow(NaN, 0)).toBe(1);
    });

    it('is exact for whole and half exponents where the result is', () => {
      expect(DetMath.pow(2, 10)).toBe(1024);
      expect(DetMath.pow(3, 4)).toBe(81);
      expect(DetMath.pow(10, 3)).toBe(1000);
      expect(DetMath.pow(4, 0.5)).toBe(2);
      expect(DetMath.pow(9, 1.5)).toBe(27);
      expect(DetMath.pow(2, -1)).toBe(0.5);
      expect(DetMath.pow(7, 1)).toBe(7);
    });

    it('overflows to infinity and underflows to zero and subnormals as Math.pow does', () => {
      expect(DetMath.pow(10, 309)).toBe(Infinity);
      expect(DetMath.pow(-10, 309)).toBe(-Infinity);
      expect(DetMath.pow(10, -400)).toBe(0);
      expect(DetMath.pow(2, -1074)).toBe(5e-324);
      expect(DetMath.pow(2, -1060)).toBe(Math.pow(2, -1060));
      expect(DetMath.pow(2, 1024.5)).toBe(Infinity);
      expect(ulps(DetMath.pow(2, 1023.25), Math.pow(2, 1023.25))).toBeLessThanOrEqual(1);
      expect(ulps(DetMath.pow(0.5, 1070.5), Math.pow(0.5, 1070.5))).toBeLessThanOrEqual(1);
      expect(DetMath.pow(1 + 2 ** -30, 2 ** 40)).toBe(Math.pow(1 + 2 ** -30, 2 ** 40));
    });

    it('stays within one ULP of Math.pow over a wide range', () => {
      let s = 99;
      const r = (): number => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      let worst = 0;
      for (let i = 0; i < 100_000; i++) {
        const k = i % 4;
        const x = k === 0 ? r() * 2000 : k === 1 ? 10 ** ((r() - 0.5) * 600) : k === 2 ? (r() - 0.5) * 100 : 1 + (r() - 0.5) * 1e-6;
        const y = k === 0 ? (r() - 0.5) * 16 : k === 1 ? (r() - 0.5) * 2 : k === 2 ? Math.round((r() - 0.5) * 40) : (r() - 0.5) * 1e7;
        worst = Math.max(worst, ulps(DetMath.pow(x, y), Math.pow(x, y)));
      }
      expect(worst).toBeLessThanOrEqual(1);
    });
  });
});
