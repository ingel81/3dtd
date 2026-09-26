/**
 * Every message a client sends, checked before the relay acts on it
 * (relay review 2026-09-26, K1, H1, N1): the right type for every field,
 * strings without control characters and cut to a length, numbers finite,
 * commands small and without keys that reach an object's prototype. What
 * does not fit is null and dropped; the relay never throws on a message.
 *
 * The result is a new object: nothing of the input's own keys beyond the
 * fields listed here goes on. `world`, `options` and `entities` pass as
 * they came; the room checks them (validOptions, validDetail) or only
 * forwards them (the world, bounded by the relay's message size).
 */
import type { ClientMessage } from '../../src/app/coop/protocol.ts';

/** Longest name, as the client allows it */
const NAME_MAX = 32;
/** Game version and balance hash: "0.5.0-beta.1", eight hex digits */
const VERSION_MAX = 64;
const CHAT_MAX = 500;
/** A run log's payload (TODO E38) */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Room codes, player ids, spawn ids */
const ID_MAX = 64;
/**
 * A command as JSON, bytes. The largest is command:los-mask, a tower's line
 * of sight as base64 bits over the route cells in its range: tens of kB for
 * a long-range tower. Far below the message size, far above any real one.
 */
export const COMMAND_MAX = 256 * 1024;
/** Spawn points of a world */
const SPAWNS_MAX = 16;
/** Keys that reach an object's prototype when a client copies a command key by key */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001f\u007f\u2028\u2029]', 'g');

/** `value` as a clean string: control characters out, trimmed, at most `max`; null when it is no string. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters and the two line separators, which would break a log line
  return value.replace(CONTROL, ' ').trim().slice(0, max);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const tickOf = (value: unknown): number | null => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);

/** A key anywhere in `value` that would reach a prototype, as far as `depth` goes. */
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || typeof value !== 'object' || value === null) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** The message `value` came as, checked; null when it has no known type or a field does not fit. */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isObject(value) || typeof value['t'] !== 'string') return null;
  const m = value;
  switch (m['t']) {
    case 'hello': {
      const name = cleanText(m['name'], NAME_MAX);
      const gameVersion = cleanText(m['gameVersion'], VERSION_MAX);
      const configHash = cleanText(m['configHash'], VERSION_MAX);
      if (!finite(m['protocol']) || name === null || gameVersion === null || configHash === null) return null;
      return { t: 'hello', protocol: m['protocol'], name, gameVersion, configHash, client: m['client'] as never };
    }
    case 'create':
    case 'moving':
    case 'rooms':
      return { t: m['t'] };
    case 'join': {
      const room = cleanText(m['room'], ID_MAX);
      return room === null ? null : { t: 'join', room };
    }
    case 'world': {
      const spawns = m['spawnIds'];
      if (!Array.isArray(spawns) || spawns.length > SPAWNS_MAX) return null;
      const spawnIds = spawns.map((id) => cleanText(id, ID_MAX));
      if (spawnIds.some((id) => id === null || id === '')) return null;
      return { t: 'world', world: m['world'], spawnIds: spawnIds as string[] };
    }
    case 'status': {
      const status = cleanText(m['status'], 16);
      return status === null ? null : { t: 'status', status: status as never };
    }
    case 'pick': {
      if (m['spawnId'] === null) return { t: 'pick', spawnId: null };
      const spawnId = cleanText(m['spawnId'], ID_MAX);
      return spawnId === null ? null : { t: 'pick', spawnId };
    }
    case 'rename': {
      const name = cleanText(m['name'], NAME_MAX);
      return name === null ? null : { t: 'rename', name };
    }
    case 'kick': {
      const playerId = cleanText(m['playerId'], ID_MAX);
      return playerId === null ? null : { t: 'kick', playerId };
    }
    case 'lock':
      return typeof m['locked'] === 'boolean' ? { t: 'lock', locked: m['locked'] } : null;
    case 'listing': {
      const l = m['listing'];
      if (!isObject(l)) return null;
      const title = l['title'] === undefined ? '' : cleanText(l['title'], 64);
      const city = l['city'] === undefined ? '' : cleanText(l['city'], 64);
      if (title === null || city === null) return null;
      return { t: 'listing', listing: { public: l['public'] !== false, title, city } };
    }
    case 'options':
      return isObject(m['options']) ? { t: 'options', options: m['options'] as never } : null;
    case 'ready':
      return typeof m['ready'] === 'boolean' ? { t: 'ready', ready: m['ready'] } : null;
    case 'start':
      return finite(m['seed']) ? { t: 'start', seed: m['seed'] } : null;
    case 'cmd': {
      const command = m['command'];
      if (!isObject(command) || typeof command['type'] !== 'string' || command['type'].length > ID_MAX) return null;
      if (JSON.stringify(command).length > COMMAND_MAX || hasForbiddenKey(command)) return null;
      return { t: 'cmd', command: command as never };
    }
    case 'hash': {
      const tick = tickOf(m['tick']);
      if (tick === null || !finite(m['hash'])) return null;
      const parts = m['parts'];
      const clean = Array.isArray(parts) && parts.length <= 32 && parts.every(finite) ? (parts as number[]) : undefined;
      return clean ? { t: 'hash', tick, hash: m['hash'], parts: clean } : { t: 'hash', tick, hash: m['hash'] };
    }
    case 'hash-detail': {
      const tick = tickOf(m['tick']);
      return tick === null ? null : { t: 'hash-detail', tick, entities: m['entities'] as never };
    }
    case 'stats': {
      const s = m['stats'];
      if (!isObject(s)) return null;
      const numbers = ['frames', 'blocked', 'behindAvg', 'behindMin', 'tickGapAvg', 'tickGapSd', 'inputs'] as const;
      const nullable = ['inputAvg', 'inputMax'] as const;
      const steps = s['steps'];
      if (!numbers.every((key) => finite(s[key])) || !nullable.every((key) => s[key] === null || finite(s[key]))) return null;
      if (!Array.isArray(steps) || steps.length !== 4 || !steps.every(finite)) return null;
      return {
        t: 'stats',
        stats: {
          frames: s['frames'] as number, blocked: s['blocked'] as number,
          steps: steps as [number, number, number, number],
          behindAvg: s['behindAvg'] as number, behindMin: s['behindMin'] as number,
          tickGapAvg: s['tickGapAvg'] as number, tickGapSd: s['tickGapSd'] as number,
          inputAvg: s['inputAvg'] as number | null, inputMax: s['inputMax'] as number | null, inputs: s['inputs'] as number,
        },
      };
    }
    case 'speed':
      return finite(m['speed']) ? { t: 'speed', speed: m['speed'] } : null;
    case 'chat': {
      const text = cleanText(m['text'], CHAT_MAX);
      return text ? { t: 'chat', text } : null;
    }
    case 'ping':
      return finite(m['lat']) && finite(m['lon']) && finite(m['height'])
        ? { t: 'ping', lat: m['lat'], lon: m['lon'], height: m['height'] }
        : null;
    case 'run-log':
      // Base64 only; the size is capped by the message limit, the content by RunStore
      return typeof m['gz'] === 'string' && m['gz'].length > 0 && BASE64.test(m['gz'])
        ? { t: 'run-log', gz: m['gz'] }
        : null;
    default:
      return null;
  }
}
