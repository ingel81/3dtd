import type { Messages } from '../i18n/messages/en';
import type { Said } from '../i18n/said';

/**
 * What an import (an OSM place, a Warcraft map) says it could not take over
 * or only roughly, as data (`importNotes`): it comes from a worker, the
 * frame and the editor word it. Details from a script or an archive (a
 * parser's message) stay as the parser says them.
 */
export type ImportNote = Said<Messages['importNotes']>;
