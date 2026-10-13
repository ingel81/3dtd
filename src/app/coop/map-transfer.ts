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

  /** Pieces of the current map here so far, of how many; null before the first piece */
  get progress(): { done: number; total: number } | null {
    return this.key ? { done: this.count, total: this.pieces.length } : null;
  }

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

/**
 * Base64 characters a second the host sends its map at most: under the
 * relay's 4 MB a second per connection with room for the lobby's other
 * messages. 32 MB (43 MB as base64) take some 14 s.
 */
export const MAP_SEND_CHARS_PER_SECOND = 3 * 1024 * 1024;

/** How often a wait for the relay's map-ack looks whether the session is gone, ms */
const ACK_POLL_MS = 500;

/** How far the host's map is out: pieces through the relay of how many */
export interface MapSendProgress {
  done: number;
  total: number;
}

/**
 * The host's map pieces, one after the other, and the world after them
 * (coop.service shareWorld). The next piece goes once the relay confirmed
 * the last (`acked`, protocol `map-ack`) and the byte rate allows it
 * (MAP_SEND_CHARS_PER_SECOND), so neither the relay's limit per connection
 * nor a guest's unread data are reached however large the map. The world
 * that follows is built when the last piece is through, not when the pieces
 * set off: a share while they are under way only asks for it, so an older
 * world can never arrive after a newer one and overwrite it at the relay
 * (review 2026-10-11). Nothing more is sent once `alive` says the session
 * is gone.
 */
export class PacedMapSend {
  /** The world to send after the pieces under way; null while none go */
  private worldAfter: (() => void) | null = null;
  /** The piece whose map-ack is awaited and what to call then */
  private awaited: { part: number; resolve: () => void } | null = null;

  /** Pieces through the relay of how many, while some go; null otherwise */
  onProgress: ((progress: MapSendProgress | null) => void) | null = null;

  /** Pieces under way */
  get busy(): boolean {
    return this.worldAfter !== null;
  }

  /**
   * Share the world: with `parts` the pieces first, then `sendWorld`; while
   * pieces are under way the world they end with is the newest asked for;
   * else the world at once.
   */
  share(parts: readonly MapPart[] | null, sendPart: (part: MapPart) => void, sendWorld: () => void, alive: () => boolean): void {
    if (this.worldAfter) {
      this.worldAfter = sendWorld;
      return;
    }
    if (!parts || parts.length === 0) {
      sendWorld();
      return;
    }
    this.worldAfter = sendWorld;
    void this.send(parts, sendPart, alive);
  }

  /** The relay confirmed piece `part` (protocol `map-ack`) */
  acked(part: number): void {
    const awaited = this.awaited;
    if (awaited?.part !== part) return;
    this.awaited = null;
    awaited.resolve();
  }

  private async send(parts: readonly MapPart[], sendPart: (part: MapPart) => void, alive: () => boolean): Promise<void> {
    try {
      let nextAt = 0;
      this.onProgress?.({ done: 0, total: parts.length });
      for (const [i, part] of parts.entries()) {
        const wait = nextAt - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (!alive()) return;
        nextAt = performance.now() + (part.data.length / MAP_SEND_CHARS_PER_SECOND) * 1000;
        const through = this.ackOf(part.part, alive);
        sendPart(part);
        if (!(await through)) return;
        this.onProgress?.({ done: i + 1, total: parts.length });
      }
      if (alive()) this.worldAfter?.();
    } finally {
      this.worldAfter = null;
      this.awaited = null;
      this.onProgress?.(null);
    }
  }

  /** True once the relay confirmed piece `part`, false when the session went first */
  private ackOf(part: number, alive: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (alive()) return;
        clearInterval(poll);
        this.awaited = null;
        resolve(false);
      }, ACK_POLL_MS);
      this.awaited = {
        part,
        resolve: () => {
          clearInterval(poll);
          resolve(true);
        },
      };
    });
  }
}
