/**
 * The plain fields of an object as JSON-safe data, for the snapshot mid-wave
 * (wave-snapshot.ts): every own property that holds a number, a boolean, a
 * string or null. References (paths, profiles, other entities, maps) are
 * left out; the owner puts those back itself.
 *
 * Numbers go in bit for bit: -0, NaN and the infinities, which JSON loses,
 * travel as marked strings. A marked string starts with U+0000, which no
 * game string does.
 */
export type PlainValue = number | string | boolean | null;
export type PlainRecord = Record<string, PlainValue>;

const MARK = '\u0000';

/** `value` as JSON keeps it: -0, NaN and the infinities as marked strings */
export function encodeNumber(value: number): number | string {
  if (Number.isFinite(value) && !Object.is(value, -0)) return value;
  return MARK + String(Object.is(value, -0) ? '-0' : value);
}

/** The number encodeNumber() gave `value` for */
export function decodeNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  if (!value.startsWith(MARK)) throw new Error(`not an encoded number: ${value}`);
  const text = value.slice(1);
  return text === '-0' ? -0 : Number(text);
}

/** Every own number, boolean, string and null of `source`, except the keys in `skip` */
export function plainFields(source: object, skip: readonly string[] = []): PlainRecord {
  const out: PlainRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (skip.includes(key)) continue;
    if (typeof value === 'number') out[key] = encodeNumber(value);
    else if (typeof value === 'boolean' || typeof value === 'string' || value === null) {
      out[key] = typeof value === 'string' && value.startsWith(MARK) ? null : value;
    }
  }
  return out;
}

/** Write what plainFields() took back onto `target` */
export function assignPlainFields(target: object, fields: PlainRecord): void {
  const out = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === 'string' && value.startsWith(MARK) ? decodeNumber(value) : value;
  }
}
