import type { Messages } from '../../i18n/messages/en';
import { say, type Said } from '../../i18n/said';
import { mapErrorMessage } from '../custom-map/map-text';

/** Why loading a place or making its map failed, as data (`osm.errors`): it crosses from the OSM worker as it is */
export type OsmErrorText = Said<Messages['osm']['errors']>;

/** A failure of the OSM frame the player reads; the message is its key, for logs */
export class OsmError extends Error {
  constructor(readonly said: OsmErrorText) {
    super(`osm:${String(said.key)}`);
    this.name = 'OsmError';
  }
}

/**
 * What went wrong, in the language of `t`: an OsmError or a map's error worded, also where another error
 * wraps one (`cause`, a world that is not available), any other by its message. Their messages are keys
 * for the logs: this is the one way they reach the player or an agent
 */
export function osmErrorMessage(t: Messages, error: unknown): string {
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
    if (e instanceof OsmError) return say(t.osm.errors, e.said);
  }
  return mapErrorMessage(t, error);
}
