import { Injectable } from '@angular/core';
import type { CoopSession } from './coop-session';
import type { RelaySource } from './relay-address';
import type { CoopChatLine } from '../services/coop.service';

/**
 * A coop room on its way from one world to the next in the page
 * (docs/WORLDS_NAVIGATION_PLAN.md, 4.1 point 7): the connection to the relay
 * and what the room's panel showed. The game of the old world goes, its
 * CoopService with it; the next game's CoopService takes the room up again.
 */
export interface CarriedRoom {
  /** The open connection, its handlers off (CoopSession.unhook) */
  session: CoopSession;
  relay: { url: string; source: RelaySource } | null;
  intent: 'host' | 'join' | null;
  /** The chat lines so far, and the next line's id */
  chat: readonly CoopChatLine[];
  chatId: number;
  /** A LAN host's addresses: its relay runs on with the room; null for a room on a lobby */
  lan: readonly { name: string; address: string }[] | null;
}

/**
 * Holds a coop room between two worlds of the page. The game of a world is
 * made and taken down whole (WorldSession, GameHostComponent), the
 * connection to the relay is not: a room in the lobby stays when its host
 * changes the world or a guest follows the host to another one.
 */
@Injectable({ providedIn: 'root' })
export class CoopRoomCarry {
  private carried: CarriedRoom | null = null;

  /** Keep `room` for the next world; one kept before and never taken leaves its room */
  keep(room: CarriedRoom): void {
    if (this.carried && this.carried.session !== room.session) this.carried.session.close();
    this.carried = room;
  }

  /** The room kept for this world, once */
  take(): CarriedRoom | null {
    const room = this.carried;
    this.carried = null;
    return room;
  }
}
