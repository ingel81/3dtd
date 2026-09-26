/**
 * The relay inside the desktop app (docs/COOP_PLAN.md, C4d, D51). The main
 * process starts this in a utility process when the player clicks "Host LAN
 * game" and ends it with the room or the app; a crash here leaves the game
 * window alone. Bundled with esbuild into desktop/relay/relay.mjs
 * (desktop/scripts/build-relay.js).
 *
 * Takes the first free port from 3003 on, announces its open lobbies on the
 * LAN (desktop/src/lan-discovery.js) and tells the main process what it does:
 * `listening` with the port, `failed`, and every log line.
 */
import { createLanAnnouncer, type LanAnnouncer } from '../../desktop/src/lan-discovery.js';
import { startRelay, type RelayServer } from './server.ts';

/** Ports tried in turn; another program (or a second relay) may hold the first */
const FIRST_PORT = 3003;
const PORTS_TRIED = 10;

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;
const post = (message: unknown) => parent?.postMessage(message);
const log = (line: string) => post({ t: 'log', line });

async function listen(): Promise<RelayServer> {
  let lastError: unknown = null;
  for (let port = FIRST_PORT; port < FIRST_PORT + PORTS_TRIED; port++) {
    try {
      // Cheats go through the relay; the host's room option decides (D38). Only the
      // desktop app may connect: another page open in a browser on this machine
      // or in the LAN is refused (relay review M7); clients without an Origin pass.
      return await startRelay({ port, log, cheats: true, origins: ['app://app'] });
    } catch (error) {
      lastError = error;
      log(`port ${port} taken (${(error as NodeJS.ErrnoException).code ?? error})`);
    }
  }
  throw lastError;
}

// Nothing a room or a message does may end the LAN relay (review K1)
process.on('uncaughtException', (error) => log(`uncaught: ${String(error?.stack ?? error).slice(0, 500)}`));
process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${String(reason).slice(0, 500)}`));

let relay: RelayServer | null = null;
let announcer: LanAnnouncer | null = null;

try {
  relay = await listen();
  const running = relay;
  announcer = createLanAnnouncer({
    log,
    describe: () => {
      const status = running.status();
      return {
        port: running.port,
        protocol: status.protocol,
        rooms: status.rooms
          .filter((room) => !room.started && !room.locked)
          .map((room) => ({
            code: room.code,
            host: room.players.find((p) => p.id === room.hostId)?.name ?? '',
            players: room.players.length,
            gameVersion: room.gameVersion,
          })),
      };
    },
  });
  post({ t: 'listening', port: running.port });
} catch (error) {
  post({ t: 'failed', error: String((error as Error)?.message ?? error) });
}

parent?.on('message', ({ data }) => {
  if ((data as { t?: string } | null)?.t !== 'stop') return;
  announcer?.close();
  void (relay?.close('The host closed the game') ?? Promise.resolve()).then(() => process.exit(0));
});
