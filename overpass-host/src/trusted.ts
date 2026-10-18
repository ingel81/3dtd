/**
 * Whose word on the client's address the proxy takes: Cloudflare's headers
 * (CF-Connecting-IP, CF-IPCountry) count only on a connection from a trusted
 * address, the tunnel's connector; on any other the proxy goes by the
 * connection's own address, so a client that reaches the port directly cannot
 * pick an address to slip past its rate limit. A list of CIDR ranges, IPv4
 * and IPv6; `private` stands for the local ranges (loopback, RFC 1918,
 * link-local, IPv6 unique local), where a cloudflared next to the proxy sits.
 */

const PRIVATE = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];

interface Range {
  bytes: Uint8Array;
  bits: number;
}

/** An address as its bytes (4 or 16), an IPv4-mapped IPv6 address as IPv4; null when it is none */
export function addressBytes(address: string): Uint8Array | null {
  const plain = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(plain)) {
    const parts = plain.split('.').map(Number);
    return parts.every((p) => p <= 255) ? Uint8Array.from(parts) : null;
  }
  if (!/^[0-9a-f:]+$/i.test(plain) || plain.split('::').length > 2) return null;
  const [head, tail] = plain.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(Math.max(0, fill)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((g) => g.length < 1 || g.length > 4)) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((g, k) => {
    const v = parseInt(g, 16);
    bytes[2 * k] = v >> 8;
    bytes[2 * k + 1] = v & 255;
  });
  return bytes;
}

/** The ranges of a list such as `private,203.0.113.0/24`; throws on one it cannot read */
export function parseRanges(list: string): Range[] {
  const entries = list.split(',').map((e) => e.trim()).filter(Boolean).flatMap((e) => (e === 'private' ? PRIVATE : [e]));
  return entries.map((entry) => {
    const [address, prefix] = entry.split('/');
    const bytes = addressBytes(address);
    const bits = prefix === undefined ? (bytes?.length ?? 0) * 8 : Number(prefix);
    if (!bytes || !Number.isInteger(bits) || bits < 0 || bits > bytes.length * 8) throw new Error(`not an address range: ${entry}`);
    return { bytes, bits };
  });
}

/** Whether `address` lies in one of `ranges` */
export function inRanges(address: string | undefined, ranges: readonly Range[]): boolean {
  const bytes = address ? addressBytes(address) : null;
  if (!bytes) return false;
  return ranges.some((range) => {
    if (range.bytes.length !== bytes.length) return false;
    const whole = range.bits >> 3;
    for (let k = 0; k < whole; k++) if (bytes[k] !== range.bytes[k]) return false;
    const rest = range.bits & 7;
    if (!rest) return true;
    const mask = (0xff << (8 - rest)) & 0xff;
    return (bytes[whole] & mask) === (range.bytes[whole] & mask);
  });
}
