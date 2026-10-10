/**
 * Little-endian reader over a byte buffer, as every Warcraft 3 map file is
 * laid out. Reads past the end throw a `W3xFormatError` naming the file, so a
 * truncated or tampered map fails with a readable message.
 */

export class W3xFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'W3xFormatError';
  }
}

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

export class BinaryReader {
  readonly view: DataView;
  pos = 0;

  constructor(
    readonly bytes: Uint8Array,
    /** File name for error messages */
    readonly file = 'buffer',
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  get left(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): number {
    const at = this.pos;
    if (at + n > this.bytes.length) {
      throw new W3xFormatError(`${this.file}: unexpected end at byte ${at} (needs ${n} more)`);
    }
    this.pos = at + n;
    return at;
  }

  u8(): number {
    return this.bytes[this.need(1)];
  }

  i16(): number {
    return this.view.getInt16(this.need(2), true);
  }

  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }

  i32(): number {
    return this.view.getInt32(this.need(4), true);
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }

  f32(): number {
    return this.view.getFloat32(this.need(4), true);
  }

  /** Four-character code such as a doodad id ('LTlt'), read as Latin-1 */
  id4(): string {
    const at = this.need(4);
    return latin1.decode(this.bytes.subarray(at, at + 4));
  }

  /** Zero-terminated UTF-8 string */
  cstr(): string {
    const start = this.pos;
    const end = this.bytes.indexOf(0, start);
    if (end < 0) throw new W3xFormatError(`${this.file}: unterminated string at byte ${start}`);
    this.pos = end + 1;
    return utf8.decode(this.bytes.subarray(start, end));
  }

  skip(n: number): void {
    this.need(n);
  }

  slice(n: number): Uint8Array {
    const at = this.need(n);
    return this.bytes.subarray(at, at + n);
  }
}

/** Reads a four-character magic and throws when it is not `expected` */
export function expectMagic(r: BinaryReader, expected: string): void {
  const got = r.id4();
  if (got !== expected) throw new W3xFormatError(`${r.file}: expected "${expected}", found "${got}"`);
}
