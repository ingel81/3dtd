import { describe, expect, it } from 'vitest';
import { CoopSession, type CoopSocket } from './coop-session';
import { encodeMapFrame } from './map-frame';
import type { MapPart } from './map-transfer';

describe('CoopSession map pieces (binary frames, protocol 5)', () => {
  it('sends a piece as a binary frame and takes one from the relay as an ArrayBuffer', async () => {
    const sent: (string | Uint8Array)[] = [];
    const socket = {
      readyState: 1,
      binaryType: 'blob',
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string | Uint8Array) {
        sent.push(data);
        if (typeof data === 'string' && JSON.parse(data).t === 'hello') {
          queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ t: 'welcome', playerId: 'p1' }) }));
        }
      },
      close: () => undefined,
    } as unknown as CoopSocket;
    const session = new CoopSession('ws://relay', { name: 'Ann', gameVersion: '1', configHash: 'x' }, () => {
      queueMicrotask(() => socket.onopen?.(null));
      return socket;
    });
    await session.connect();
    expect(socket.binaryType).toBe('arraybuffer');

    const piece: MapPart = { mapId: 'm', hash: 'h', part: 0, parts: 1, data: Uint8Array.from([7, 8, 9]) };
    session.sendMapPart(piece);
    expect(sent.at(-1)).toBeInstanceOf(Uint8Array);

    const got: MapPart[] = [];
    session.onMap = (p) => got.push(p);
    const frame = encodeMapFrame(piece, piece.data);
    socket.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
    expect(got.map((p) => [p.mapId, p.part, [...p.data]])).toEqual([['m', 0, [7, 8, 9]]]);
  });
});
