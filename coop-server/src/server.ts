/**
 * The coop relay (docs/COOP_PLAN.md, C4, D2): WebSocket connections, rooms,
 * and the clock that closes their ticks. The rules of a room live in
 * room.ts; this file only connects sockets and time to them.
 *
 * Started by main.ts (npm run coop-server) on a machine of its own, or from
 * the desktop app's main process for a LAN game (D18).
 */
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/app/coop/protocol.ts';
import { PROTOCOL_VERSION } from '../../src/app/coop/protocol.ts';
import { Room, type RoomPlayer } from './room.ts';

/** How often the rooms' clocks run, ms. Ticks close at the room's pace, this only samples the wall clock. */
const CLOCK_MS = 5;

/** Room codes: no 0/O, 1/I/L, easy to read out */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

interface Connection {
  socket: WebSocket;
  player: RoomPlayer | null;
  room: Room | null;
}

export interface RelayServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface RelayOptions {
  port: number;
  /** Where the relay writes one line per event; silent by default */
  log?: (line: string) => void;
  /** Wall clock, ms; for the spec */
  now?: () => number;
}

/** Start the relay on `port` (0: any free port). */
export function startRelay(options: RelayOptions): Promise<RelayServer> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => performance.now());
  const rooms = new Map<string, Room>();
  const connections = new Map<string, Connection>();
  let nextPlayer = 1;

  const http: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`3dtd coop relay, protocol ${PROTOCOL_VERSION}, ${rooms.size} rooms\n`);
  });
  const wss = new WebSocketServer({ server: http });

  const send = (playerId: string, message: ServerMessage): void => {
    const socket = connections.get(playerId)?.socket;
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const newCode = (): string => {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };

  wss.on('connection', (socket) => {
    const id = `p${nextPlayer++}`;
    const connection: Connection = { socket, player: null, room: null };
    connections.set(id, connection);

    socket.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      if (message.t === 'hello') {
        if (message.protocol !== PROTOCOL_VERSION) {
          send(id, { t: 'refused', reason: 'protocol' });
          return;
        }
        connection.player = {
          id,
          name: String(message.name).slice(0, 32) || id,
          gameVersion: message.gameVersion,
          configHash: message.configHash,
        };
        send(id, { t: 'welcome', playerId: id });
        return;
      }
      const player = connection.player;
      if (!player) return;
      if (message.t === 'create') {
        if (connection.room) return;
        const room = new Room(newCode(), player, send);
        rooms.set(room.code, room);
        connection.room = room;
        log(`room ${room.code} opened by ${id}`);
        return;
      }
      if (message.t === 'join') {
        if (connection.room) return;
        const room = rooms.get(String(message.room).toUpperCase());
        if (!room) {
          send(id, { t: 'refused', reason: 'no-room' });
          return;
        }
        const refusal = room.join(player);
        if (refusal) {
          send(id, { t: 'refused', reason: refusal });
          return;
        }
        connection.room = room;
        log(`${id} joined ${room.code}`);
        return;
      }
      connection.room?.receive(id, message);
    });

    socket.on('close', () => {
      const room = connection.room;
      connections.delete(id);
      if (!room) return;
      room.leave(id);
      log(`${id} left ${room.code}`);
      if (room.isEmpty) {
        rooms.delete(room.code);
        log(`room ${room.code} closed`);
      }
    });
  });

  let last = now();
  const clock = setInterval(() => {
    const at = now();
    const elapsed = at - last;
    last = at;
    for (const room of rooms.values()) room.advance(elapsed);
  }, CLOCK_MS);

  return new Promise((resolve) => {
    http.listen(options.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      log(`coop relay on port ${port}`);
      resolve({
        port,
        close: () => new Promise<void>((done) => {
          clearInterval(clock);
          for (const { socket } of connections.values()) socket.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}
