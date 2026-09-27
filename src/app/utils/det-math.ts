/**
 * Deterministic transcendental functions for the simulation (TODO E28).
 *
 * `Math.sin`, `Math.exp`, `Math.pow` and the like may differ in the last bit
 * between engines and even between versions of one engine (measured: V8
 * before and after Chromium 152, Firefox). In coop and in replays one bit
 * grows into a divergence. These ports of FreeBSD msun (fdlibm) use only
 * `+ - * /`, `Math.sqrt` and bit access, which IEEE 754 makes the same
 * everywhere, so every engine gives the same bits. Error against the true
 * value is at most one ULP, like the native functions.
 *
 * The simulation calls these, never `Math.sin` and company (lint rule in
 * eslint.config.js). Sound, pictures and the camera keep the native ones.
 *
 * sin, cos and tan reduce the argument with the Cody-Waite steps only:
 * exact for |x| up to 2^20 * pi/2 (about 1.6 million), deterministic but
 * less accurate beyond. The simulation's angles are far below that.
 */

const f64 = new Float64Array(1);
// Little endian, as every engine this runs on: [0] the low word, [1] the high word
const i32 = new Int32Array(f64.buffer);

function hiOf(x: number): number {
  f64[0] = x;
  return i32[1];
}

function loOf(x: number): number {
  f64[0] = x;
  return i32[0];
}

function clearLow(x: number): number {
  f64[0] = x;
  i32[0] = 0;
  return f64[0];
}

function withHigh(x: number, hi: number): number {
  f64[0] = x;
  i32[1] = hi;
  return f64[0];
}

/** The double whose high word is `hi` and low word 0 */
function fromHigh(hi: number): number {
  i32[1] = hi;
  i32[0] = 0;
  return f64[0];
}

// Thresholds as floats: "high word of |x| <= H" is "|x| < fromHigh(H + 1)"
const PIO4_UP = fromHigh(0x3fe921fb + 1);
const TINY_SIN = fromHigh(0x3e500000);
const TINY_COS = fromHigh(0x3e46a09e);
const TINY_TAN = fromHigh(0x3e400000);

// ==================== Argument reduction (e_rem_pio2, medium path) ====================

const invpio2 = 6.36619772367581382433e-01;
const pio2_1 = 1.57079632673412561417e+00;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.07710050630396597660e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.02226624871116645580e-21;
const pio2_3t = 8.47842766036889956997e-32;
const toint = 6755399441055744.0;

/** The reduced argument of remPio2: head and tail */
let rY0 = 0;
let rY1 = 0;

/** x - n * pi/2 into rY0 + rY1, returns n. */
function remPio2(x: number): number {
  const fn = (x * invpio2 + toint) - toint;
  const n = fn | 0;
  let r = x - fn * pio2_1;
  let w = fn * pio2_1t;
  let y0 = r - w;
  const j = (hiOf(x) >> 20) & 0x7ff;
  let i = j - ((hiOf(y0) >> 20) & 0x7ff);
  if (i > 16) {
    let t = r;
    w = fn * pio2_2;
    r = t - w;
    w = fn * pio2_2t - ((t - r) - w);
    y0 = r - w;
    i = j - ((hiOf(y0) >> 20) & 0x7ff);
    if (i > 49) {
      t = r;
      w = fn * pio2_3;
      r = t - w;
      w = fn * pio2_3t - ((t - r) - w);
      y0 = r - w;
    }
  }
  rY0 = y0;
  rY1 = (r - y0) - w;
  return n;
}

// ==================== sin, cos (k_sin, k_cos) ====================

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4] of x + y (the tail of a reduced argument) */
function kSin1(x: number, y: number): number {
  const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** sin on [-pi/4, pi/4] of x without a tail */
function kSin0(x: number): number {
  const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  return x + z * x * (S1 + z * r);
}

function kCos(x: number, y: number): number {
  const z = x * x, w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z, u = 1.0 - hz;
  return u + (((1.0 - u) - hz) + (z * r - x * y));
}

function sin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < PIO4_UP) return ax < TINY_SIN ? x : kSin0(x);
  if (!(ax < Infinity)) return x - x;
  const n = remPio2(x) & 3;
  if (n === 0) return kSin1(rY0, rY1);
  if (n === 1) return kCos(rY0, rY1);
  if (n === 2) return -kSin1(rY0, rY1);
  return -kCos(rY0, rY1);
}

function cos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < PIO4_UP) return ax < TINY_COS ? 1.0 : kCos(x, 0);
  if (!(ax < Infinity)) return x - x;
  const n = remPio2(x) & 3;
  if (n === 0) return kCos(rY0, rY1);
  if (n === 1) return -kSin1(rY0, rY1);
  if (n === 2) return -kCos(rY0, rY1);
  return kSin1(rY0, rY1);
}

/** sin and cos of one angle, see sincos() */
export interface SinCos {
  s: number;
  c: number;
}

const sc: SinCos = { s: 0, c: 0 };

/**
 * sin(x) and cos(x) with one reduction, bit for bit the same as the two
 * calls. The result object is shared: read it before the next call.
 */
function sincos(x: number): Readonly<SinCos> {
  const ax = x < 0 ? -x : x;
  if (ax < PIO4_UP) {
    sc.s = ax < TINY_SIN ? x : kSin0(x);
    sc.c = ax < TINY_COS ? 1.0 : kCos(x, 0);
    return sc;
  }
  if (!(ax < Infinity)) {
    sc.s = sc.c = x - x;
    return sc;
  }
  const n = remPio2(x) & 3;
  const s = kSin1(rY0, rY1), c = kCos(rY0, rY1);
  if (n === 0) {
    sc.s = s;
    sc.c = c;
  } else if (n === 1) {
    sc.s = c;
    sc.c = -s;
  } else if (n === 2) {
    sc.s = -s;
    sc.c = -c;
  } else {
    sc.s = -c;
    sc.c = s;
  }
  return sc;
}

// ==================== tan (k_tan) ====================

const T0 = 3.33333333333334091986e-01;
const T1 = 1.33333333333201242699e-01;
const T2 = 5.39682539762260521377e-02;
const T3 = 2.18694882948595424599e-02;
const T4 = 8.86323982359930005737e-03;
const T5 = 3.59207910759131235356e-03;
const T6 = 1.45620945432529025516e-03;
const T7 = 5.88041240820264096874e-04;
const T8 = 2.46463134818469906812e-04;
const T9 = 7.81794442939557092300e-05;
const T10 = 7.14072491382608190305e-05;
const T11 = -1.85586374855275456654e-05;
const T12 = 2.59073051863633712884e-05;
const pio4 = 7.85398163397448278999e-01;
const pio4lo = 3.06161699786838301793e-17;
const TAN_BIG = fromHigh(0x3fe59428);

/** tan (iy 1) or -1/tan (iy -1) on [-pi/4, pi/4] of x + y */
function kTan(x: number, y: number, iy: number): number {
  const neg = x < 0, big = (neg ? -x : x) >= TAN_BIG;
  if (big) {
    if (neg) {
      x = -x;
      y = -y;
    }
    const z0 = pio4 - x, w0 = pio4lo - y;
    x = z0 + w0;
    y = 0.0;
  }
  let z = x * x, w = z * z;
  let r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
  let v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
  let s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T0 * s;
  w = x + r;
  if (big) {
    v = iy;
    return (neg ? -1 : 1) * (v - 2.0 * (x - (w * w / (w + v) - r)));
  }
  if (iy === 1) return w;
  z = clearLow(w);
  v = r - (z - x);
  const a = -1.0 / w;
  const t = clearLow(a);
  s = 1.0 + t * z;
  return t + a * (s + t * v);
}

function tan(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < PIO4_UP) return ax < TINY_TAN ? x : kTan(x, 0, 1);
  if (!(ax < Infinity)) return x - x;
  const n = remPio2(x);
  return kTan(rY0, rY1, 1 - ((n & 1) << 1));
}

// ==================== atan, atan2 (s_atan, e_atan2) ====================

const ah0 = 4.63647609000806093515e-01, ah1 = 7.85398163397448278999e-01;
const ah2 = 9.82793723247329054082e-01, ah3 = 1.57079632679489655800e+00;
const al0 = 2.26987774529616870924e-17, al1 = 3.06161699786838301793e-17;
const al2 = 1.39033110312309984516e-17, al3 = 6.12323399573676603587e-17;
const aT0 = 3.33333333333329318027e-01;
const aT1 = -1.99999999998764832476e-01;
const aT2 = 1.42857142725034663711e-01;
const aT3 = -1.11111104054623557880e-01;
const aT4 = 9.09088713343650656196e-02;
const aT5 = -7.69187620504482999495e-02;
const aT6 = 6.66107313738753120669e-02;
const aT7 = -5.83357013379057348645e-02;
const aT8 = 4.97687799461593236017e-02;
const aT9 = -3.65315727442169155270e-02;
const aT10 = 1.62858201153657823623e-02;
const AT_HUGE = fromHigh(0x44100000);
const AT_SMALL = fromHigh(0x3fdc0000);
const AT_TINY = fromHigh(0x3e400000);
const AT_1 = fromHigh(0x3ff30000);
const AT_0 = fromHigh(0x3fe60000);
const AT_2 = fromHigh(0x40038000);

function atan(x: number): number {
  const neg = x < 0, ax = neg ? -x : x;
  if (ax >= AT_HUGE) {
    if (x !== x) return x + x;
    return neg ? -ah3 - al3 : ah3 + al3;
  }
  if (ax < AT_SMALL) {
    if (ax < AT_TINY) return x;
    const z = x * x, w = z * z;
    const s1 = z * (aT0 + w * (aT2 + w * (aT4 + w * (aT6 + w * (aT8 + w * aT10)))));
    const s2 = w * (aT1 + w * (aT3 + w * (aT5 + w * (aT7 + w * aT9))));
    return x - x * (s1 + s2);
  }
  let hi: number, lo: number, t: number;
  if (ax < AT_1) {
    if (ax < AT_0) {
      hi = ah0;
      lo = al0;
      t = (2.0 * ax - 1.0) / (2.0 + ax);
    } else {
      hi = ah1;
      lo = al1;
      t = (ax - 1.0) / (ax + 1.0);
    }
  } else if (ax < AT_2) {
    hi = ah2;
    lo = al2;
    t = (ax - 1.5) / (1.0 + 1.5 * ax);
  } else {
    hi = ah3;
    lo = al3;
    t = -1.0 / ax;
  }
  const z = t * t, w = z * z;
  const s1 = z * (aT0 + w * (aT2 + w * (aT4 + w * (aT6 + w * (aT8 + w * aT10)))));
  const s2 = w * (aT1 + w * (aT3 + w * (aT5 + w * (aT7 + w * aT9))));
  const r = hi - ((t * (s1 + s2) - lo) - t);
  return neg ? -r : r;
}

const pi_o_4 = 7.8539816339744827900e-01;
const pi_o_2 = 1.5707963267948965580e+00;
const PI = 3.1415926535897931160e+00;
const pi_lo = 1.2246467991473532e-16;

function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1.0) return atan(y);
  const hx = hiOf(x), hy = hiOf(y), ix = hx & 0x7fffffff, iy = hy & 0x7fffffff;
  let m = (hy >>> 31) | ((hx >>> 31) << 1);
  if (y === 0) {
    if (m <= 1) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return hy < 0 ? -pi_o_2 : pi_o_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return m === 0 ? pi_o_4 : m === 1 ? -pi_o_4 : m === 2 ? 3.0 * pi_o_4 : -3.0 * pi_o_4;
    return m === 0 ? 0.0 : m === 1 ? -0.0 : m === 2 ? PI : -PI;
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 : pi_o_2;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0.0;
  } else {
    const q = y / x;
    z = atan(q < 0 ? -q : q);
  }
  if (m === 0) return z;
  if (m === 1) return -z;
  if (m === 2) return PI - (z - pi_lo);
  return (z - pi_lo) - PI;
}

// ==================== asin, acos (e_asin, e_acos) ====================

const pio2_hi = 1.57079632679489655800e+00;
const pio2_lo = 6.12323399573676603587e-17;
const pio4_hi = 7.85398163397448278999e-01;
const pS0 = 1.66666666666666657415e-01;
const pS1 = -3.25565818622400915405e-01;
const pS2 = 2.01212532134862925881e-01;
const pS3 = -4.00555345006794114027e-02;
const pS4 = 7.91534994289814532176e-04;
const pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00;
const qS2 = 2.02094576023350569471e+00;
const qS3 = -6.88283971605453293030e-01;
const qS4 = 7.70381505559019352791e-02;
const AS_HALF = fromHigh(0x3fe00000);
const AS_TINY = fromHigh(0x3e500000);
const AS_NEAR1 = fromHigh(0x3fef3333);
const AC_TINY = fromHigh(0x3c600000 + 1);

function asinP(t: number): number {
  return t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
}

function asinQ(t: number): number {
  return 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
}

function asin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (!(ax < 1.0)) {
    if (ax === 1.0) return x * pio2_hi + x * pio2_lo;
    return (x - x) / (x - x);
  }
  if (ax < AS_HALF) {
    if (ax < AS_TINY) return x;
    const t = x * x;
    return x + x * (asinP(t) / asinQ(t));
  }
  const t = (1.0 - ax) * 0.5;
  let p = asinP(t), q = asinQ(t);
  const s = Math.sqrt(t);
  let r: number;
  if (ax >= AS_NEAR1) {
    r = pio2_hi - (2.0 * (s + s * (p / q)) - pio2_lo);
  } else {
    const w = clearLow(s), c = (t - w * w) / (s + w), rr = p / q;
    p = 2.0 * s * rr - (pio2_lo - 2.0 * c);
    q = pio4_hi - 2.0 * w;
    r = pio4_hi - (p - q);
  }
  return x > 0 ? r : -r;
}

function acos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (!(ax < 1.0)) {
    if (ax === 1.0) return x > 0 ? 0.0 : PI + 2.0 * pio2_lo;
    return (x - x) / (x - x);
  }
  if (ax < AS_HALF) {
    if (ax < AC_TINY) return pio2_hi + pio2_lo;
    const z = x * x;
    const r = asinP(z) / asinQ(z);
    return pio2_hi - (x - (pio2_lo - x * r));
  }
  if (x < 0) {
    const z = (1.0 + x) * 0.5, s = Math.sqrt(z);
    const r = asinP(z) / asinQ(z);
    return PI - 2.0 * (s + (r * s - pio2_lo));
  }
  const z = (1.0 - x) * 0.5, s = Math.sqrt(z), df = clearLow(s), c = (z - df * df) / (s + df);
  const r = asinP(z) / asinQ(z);
  return 2.0 * (df + (r * s + c));
}

// ==================== exp (e_exp) ====================

const o_threshold = 7.09782712893383973096e+02;
const u_threshold = -7.45133219101941108420e+02;
const ln2HI0 = 6.93147180369123816490e-01;
const ln2LO0 = 1.90821492927058770002e-10;
const invln2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;
const twom1000 = 9.33263618503218878990e-302;
const EX_BIG = fromHigh(0x40862e42);
const EX_RED = fromHigh(0x3fd62e42 + 1);
const EX_ONE = fromHigh(0x3ff0a2b2);
const EX_TINY = fromHigh(0x3e300000);
/** 2^k for k in [-1021, 1023] at index k + 1024 */
const P2K = new Float64Array(2048);
for (let k = -1021; k <= 1023; k++) P2K[k + 1024] = fromHigh((k + 1023) << 20);

function exp(x: number): number {
  const neg = x < 0, ax = neg ? -x : x;
  let hi = 0, lo = 0, k = 0;
  if (!(ax < EX_BIG)) {
    if (x !== x) return x + x;
    if (ax === Infinity) return neg ? 0.0 : x;
    if (x > o_threshold) return Infinity;
    if (x < u_threshold) return 0.0;
  }
  if (ax >= EX_RED) {
    if (ax < EX_ONE) {
      hi = neg ? x + ln2HI0 : x - ln2HI0;
      lo = neg ? -ln2LO0 : ln2LO0;
      k = neg ? -1 : 1;
    } else {
      k = (invln2 * x + (neg ? -0.5 : 0.5)) | 0;
      hi = x - k * ln2HI0;
      lo = k * ln2LO0;
    }
    x = hi - lo;
  } else if (ax < EX_TINY) {
    return 1.0 + x;
  }
  const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  const y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    if (k === 1024) return withHigh(y * 2.0, hiOf(y * 2.0) + (1023 << 20));
    return y * P2K[k + 1024];
  }
  return withHigh(y, hiOf(y) + ((k + 1000) << 20)) * twom1000;
}

// ==================== log (e_log) ====================

const ln2_hi = 6.93147180369123816490e-01;
const ln2_lo = 1.90821492927058770002e-10;
const two54 = 1.80143985094819840000e+16;
const Lg1 = 6.666666666666735130e-01;
const Lg2 = 3.999999999940941908e-01;
const Lg3 = 2.857142874366239149e-01;
const Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01;
const Lg6 = 1.531383769920937332e-01;
const Lg7 = 1.479819860511658591e-01;

function log(x: number): number {
  f64[0] = x;
  let hx = i32[1];
  const lx = i32[0];
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return (x - x) / 0.0;
    k -= 54;
    x *= two54;
    f64[0] = x;
    hx = i32[1];
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  // f64 still holds x's low word
  i32[1] = hx | (i ^ 0x3ff00000);
  x = f64[0];
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0.0) {
      if (k === 0) return 0.0;
      return k * ln2_hi + k * ln2_lo;
    }
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R;
    return k * ln2_hi - ((R - k * ln2_lo) - f);
  }
  const s = f / (2.0 + f), dk = k, z = s * s;
  i = hx - 0x6147a;
  const w = z * z, j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

// ==================== pow (e_pow) ====================

const two53 = 9007199254740992.0;
const huge = 1.0e300;
const tiny = 1.0e-300;
const L1 = 5.99999999999994648725e-01;
const L2 = 4.28571428578550184252e-01;
const L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01;
const L5 = 2.30660745775561754067e-01;
const L6 = 2.06975017800338417784e-01;
const lg2 = 6.93147180559945286227e-01;
const lg2_h = 6.93147182464599609375e-01;
const lg2_l = -1.90465429995776804525e-09;
const ovt = 8.008566259537294e-17;
const cp = 9.61796693925975554329e-01;
const cp_h = 9.61796700954437255859e-01;
const cp_l = -7.02846165095275826516e-09;
const ivln2 = 1.44269504088896338700e+00;
const ivln2_h = 1.44269502162933349609e+00;
const ivln2_l = 1.92596299112661746887e-08;
const dp_h1 = 5.84962487220764160156e-01;
const dp_l1 = 1.35003920212974897128e-08;
const two54inv = 5.55111512312578270212e-17;

/** x * 2^n, one rounding (s_scalbn) */
function scalbn(x: number, n: number): number {
  let hx = hiOf(x);
  const lx = loOf(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    if ((lx | (hx & 0x7fffffff)) === 0) return x;
    x *= two54;
    hx = hiOf(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
  }
  if (k === 0x7ff) return x + x;
  k += n;
  if (k > 0x7fe) return huge * (x < 0 ? -huge : huge);
  if (k > 0) return withHigh(x, (hx & 0x800fffff) | (k << 20));
  if (k <= -54) return tiny * (x < 0 ? -tiny : tiny);
  k += 54;
  return withHigh(x, (hx & 0x800fffff) | (k << 20)) * two54inv;
}

function pow(x: number, y: number): number {
  f64[0] = x;
  const hx = i32[1], lx = i32[0] >>> 0;
  f64[0] = y;
  const hy = i32[1], ly = i32[0] >>> 0;
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  // y == 0: x ** 0 = 1. Then JavaScript, not C: NaN in, NaN out, and 1 ** NaN, (+-1) ** (+-inf) are NaN
  if ((iy | ly) === 0) return 1.0;
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) {
    return NaN;
  }
  if (iy === 0x7ff00000 && ix === 0x3ff00000 && lx === 0) return NaN;
  if (hx === 0x3ff00000 && lx === 0) return 1.0;

  // For x < 0: yisint 0 y is no integer, 1 an odd one, 2 an even one
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2;
    } else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if ((j << (20 - k)) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  // y is +-inf, +-1, 2, 0.5
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0.0;
      return hy < 0 ? -y : 0.0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1.0 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }

  // Math.abs, not x < 0 ? -x : x: the absolute value of -0 is +0
  let ax = Math.abs(x);
  // x is +-0, +-inf, +-1
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1.0 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z);
      else if (yisint === 1) z = -z;
    }
    return z;
  }

  let n = (hx >>> 31) - 1;
  // (x < 0) ** (no integer) is NaN
  if ((n | yisint) === 0) return (x - x) / (x - x);
  // The sign of the result: -1 for (x < 0) ** (odd integer)
  let s = 1.0;
  if ((n | (yisint - 1)) === 0) s = -1.0;

  let t1: number, t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
      if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
    }
    // Over- or underflow if x is not close to one
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    // |1 - x| <= 2^-20: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = ax - 1.0;
    const w = (t * t) * (0.5 - t * (3.3333333333333331e-01 - t * 0.25));
    const u = ivln2_h * t;
    const v = t * ivln2_l - w * ivln2;
    t1 = clearLow(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    // Subnormal x
    if (ix < 0x00100000) {
      ax *= two53;
      n -= 53;
      ix = hiOf(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    // The interval: |x| < sqrt(3/2), < sqrt(3), else halved
    let k: number;
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) {
      k = 0;
    } else if (j < 0xbb67a) {
      k = 1;
    } else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = withHigh(ax, ix);
    const bp = k === 0 ? 1.0 : 1.5;
    const dpH = k === 0 ? 0.0 : dp_h1;
    const dpL = k === 0 ? 0.0 : dp_l1;

    // ss = s_h + s_l = (x - 1) / (x + 1) or (x - 1.5) / (x + 1.5)
    let u = ax - bp;
    let v = 1.0 / (ax + bp);
    const ss = u * v;
    const s_h = clearLow(ss);
    // t_h = ax + bp, its high part
    let t_h = fromHigh(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    let t_l = ax - (t_h - bp);
    const s_l = v * ((u - s_h * t_h) - s_h * t_l);
    // log(ax)
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = clearLow(3.0 + s2 + r);
    t_l = r - ((t_h - 3.0) - s2);
    // u + v = ss * (1 + ...)
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    // 2 / (3 log2) * (ss + ...)
    const p_h = clearLow(u + v);
    const p_l = v - (p_h - u);
    const z_h = cp_h * p_h;
    const z_l = cp_l * p_h + p_l * cp + dpL;
    // log2(ax) = (ss + ...) * 2 / (3 log2) = n + dp_h + z_h + z_l
    const t = n;
    t1 = clearLow(((z_h + z_l) + dpH) + t);
    t2 = z_l - (((t1 - t) - dpH) - z_h);
  }

  // y = y1 + y2, times t1 + t2
  const y1 = clearLow(y);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  f64[0] = z;
  let j = i32[1];
  let i = i32[0];
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (j !== (0xc090cc00 | 0) || i !== 0) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }

  // 2 ** (p_h + p_l)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromHigh(n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  const t = clearLow(p_l + p_h);
  const u = t * lg2_h;
  const v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const tz = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * tz) / (tz - 2.0) - (w + z * w);
  z = 1.0 - (r - z);
  j = hiOf(z) + (n << 20);
  if ((j >> 20) <= 0) z = scalbn(z, n);
  else z = withHigh(z, j);
  return s * z;
}

// ==================== hypot ====================

/**
 * sqrt(x^2 + y^2), without the scaling of Math.hypot: no guard against
 * overflow beyond 1e154, which the simulation never reaches. Up to about
 * one ULP off, the same bits everywhere.
 */
function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** sqrt(x^2 + y^2 + z^2), see hypot() */
function hypot3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** The deterministic functions; call them as `DetMath.sin(x)` */
export const DetMath = {
  sin,
  cos,
  sincos,
  tan,
  atan,
  atan2,
  asin,
  acos,
  exp,
  log,
  pow,
  hypot,
  hypot3,
} as const;
