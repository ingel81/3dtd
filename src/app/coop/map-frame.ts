/**
 * A piece of a custom map as one binary WebSocket frame (protocol 5,
 * docs/COOP_PLAN.md C1c): the map's file goes through the relay as bytes,
 * not as base64 in JSON, a third less to send under the relay's byte rate.
 * Client and relay share this file; it needs no runtime import.
 *
 *   0..3   'MAP1'
 *   4..7   header length, u32 little endian
 *   8..    header, JSON: { mapId, hash, part, parts }
 *   then   the piece's bytes
 */

export interface MapPieceHeader {
  mapId: string;
  hash: string;
  part: number;
  parts: number;
}

const MAGIC = [0x4d, 0x41, 0x50, 0x31];
/** Longest header a frame may carry, bytes: ids and hashes are short */
const MAX_HEADER_BYTES = 512;

export function encodeMapFrame(header: MapPieceHeader, data: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ mapId: header.mapId, hash: header.hash, part: header.part, parts: header.parts }));
  const out = new Uint8Array(8 + head.length + data.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  out.set(data, 8 + head.length);
  return out;
}

/** The frame's header and bytes (a view into `frame`), null when it is no map frame */
export function decodeMapFrame(frame: Uint8Array): { header: MapPieceHeader; data: Uint8Array } | null {
  if (frame.length < 8 || MAGIC.some((b, k) => frame[k] !== b)) return null;
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(4, true);
  if (length === 0 || length > MAX_HEADER_BYTES || 8 + length > frame.length) return null;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(frame.subarray(8, 8 + length)));
  } catch {
    return null;
  }
  const h = header as Partial<MapPieceHeader> | null;
  if (!h || typeof h.mapId !== 'string' || typeof h.hash !== 'string' || !Number.isInteger(h.part) || !Number.isInteger(h.parts)) return null;
  return { header: { mapId: h.mapId, hash: h.hash, part: h.part!, parts: h.parts! }, data: frame.subarray(8 + length) };
}
