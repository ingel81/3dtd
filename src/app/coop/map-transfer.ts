import { MAP_PART_BYTES, MAX_MAP_PARTS } from './protocol';

/** A piece of a custom map on its way through the relay (protocol `map`) */
export interface MapPart {
  mapId: string;
  hash: string;
  part: number;
  parts: number;
  /** Base64 of the piece's bytes */
  data: string;
}

/** Bytes as base64, in slices so a large piece does not overflow the argument list */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A map file as the pieces the host sends (coop, docs/COOP_PLAN.md): at most
 * MAP_PART_BYTES each before base64. Null when it needs more than
 * MAX_MAP_PARTS (the map is too big to share over the relay).
 */
export function splitMapFile(bytes: Uint8Array, mapId: string, hash: string): MapPart[] | null {
  const parts = Math.max(1, Math.ceil(bytes.length / MAP_PART_BYTES));
  if (parts > MAX_MAP_PARTS) return null;
  const out: MapPart[] = [];
  for (let part = 0; part < parts; part++) {
    out.push({ mapId, hash, part, parts, data: toBase64(bytes.subarray(part * MAP_PART_BYTES, (part + 1) * MAP_PART_BYTES)) });
  }
  return out;
}

/**
 * Puts the pieces of one map back together on the guest. A piece of another
 * map (another id or content) starts over; `add` returns the file's bytes
 * once every piece of it is there, null before.
 */
export class MapAssembler {
  private key: string | null = null;
  private pieces: (Uint8Array | undefined)[] = [];
  private count = 0;

  /** The map being put together, null before the first piece */
  get current(): { mapId: string; hash: string } | null {
    if (!this.key) return null;
    const [mapId, hash] = this.key.split('\n');
    return { mapId, hash };
  }

  add(piece: MapPart): Uint8Array | null {
    if (!Number.isInteger(piece.parts) || piece.parts < 1 || piece.parts > MAX_MAP_PARTS) return null;
    if (!Number.isInteger(piece.part) || piece.part < 0 || piece.part >= piece.parts) return null;
    const key = `${piece.mapId}\n${piece.hash}`;
    if (key !== this.key || this.pieces.length !== piece.parts) {
      this.key = key;
      this.pieces = new Array<Uint8Array | undefined>(piece.parts);
      this.count = 0;
    }
    if (!this.pieces[piece.part]) this.count++;
    this.pieces[piece.part] = fromBase64(piece.data);
    if (this.count < piece.parts) return null;
    const size = this.pieces.reduce((sum, p) => sum + p!.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of this.pieces) {
      bytes.set(p!, at);
      at += p!.length;
    }
    return bytes;
  }

  /** Forget the pieces (leaving the room) */
  reset(): void {
    this.key = null;
    this.pieces = [];
    this.count = 0;
  }
}
