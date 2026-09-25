/** Types of lan-discovery.js for the relay's desktop entry (coop-server/src/desktop.ts). */

export interface LanRoom {
  code: string;
  host: string;
  players: number;
  gameVersion: string;
}

export interface LanAnnouncement {
  port: number;
  protocol: number;
  rooms: LanRoom[];
}

export interface LanAnnouncer {
  announce(): void;
  close(): void;
}

export const DISCOVERY_PORT: number;

export function createLanAnnouncer(options: {
  describe: () => LanAnnouncement;
  log?: (line: string) => void;
  port?: number;
  everyMs?: number;
}): LanAnnouncer;
