'use strict';

/**
 * Finding coop games on the local network (docs/COOP_PLAN.md, C4d, D50).
 *
 * The host's relay answers questions and also announces itself; a guest asks.
 * Either direction getting through is enough: a guest whose firewall drops
 * unasked packets still hears the answer to its own question, a host whose
 * answer is lost still reaches a guest listening for announcements.
 *
 * Every packet goes out on every IPv4 adapter separately, from a socket bound
 * to that adapter's address, to the subnet's directed broadcast, to
 * 255.255.255.255 and to a multicast group. Windows with Hyper-V, WSL or a VPN
 * adapter otherwise sends a plain broadcast out of one adapter only, often the
 * wrong one. The adapters are read again every round, so a laptop that
 * changes networks keeps working.
 *
 * The message helpers and the list are plain functions, testable without
 * sockets; createLanAnnouncer and createLanScanner do the networking
 * (`listAdapters` replaces the adapters, for the spec on loopback).
 */

const dgram = require('node:dgram');
const os = require('node:os');

/** UDP port both sides listen on */
const DISCOVERY_PORT = 3013;
/** Multicast group, administratively scoped; TTL 1 keeps it on the local link */
const MULTICAST_GROUP = '239.255.77.13';
/** Marks our packets; anything else on the port is dropped */
const MAGIC = '3dtd-lan';
/** Version of this message format */
const LAN_VERSION = 1;
/** Larger packets are not ours */
const MAX_PACKET_BYTES = 2048;
/** A guest asks this often, ms */
const ASK_EVERY_MS = 1000;
/** A host announces this often, ms */
const ANNOUNCE_EVERY_MS = 2000;
/** A game not heard of for this long leaves the list, ms */
const FORGET_AFTER_MS = 5000;

/**
 * The IPv4 adapters worth sending on: not loopback, not link-local
 * (169.254.x.x, an adapter without a network). Each with its name, address and
 * the subnet's broadcast address.
 */
function lanAdapters(interfaces = os.networkInterfaces()) {
  const adapters = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const family = typeof entry.family === 'number' ? `IPv${entry.family}` : entry.family;
      if (family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      adapters.push({ name, address: entry.address, netmask: entry.netmask, broadcast: broadcastAddress(entry.address, entry.netmask) });
    }
  }
  return adapters;
}

/** The directed broadcast address of `address` in `netmask`, null for a /31 or /32 */
function broadcastAddress(address, netmask) {
  const ip = toNumber(address);
  const mask = toNumber(netmask);
  if (ip === null || mask === null || mask >>> 0 >= 0xfffffffe) return null;
  return fromNumber((ip | ~mask) >>> 0);
}

function toNumber(dotted) {
  const parts = String(dotted ?? '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function fromNumber(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Where one round of packets goes from `adapter`: its broadcast, the global one, the group */
function targetsFor(adapter) {
  return [...new Set([adapter.broadcast, '255.255.255.255', MULTICAST_GROUP].filter(Boolean))];
}

/** A guest's question */
function askMessage() {
  return Buffer.from(JSON.stringify({ m: MAGIC, v: LAN_VERSION, t: 'ask' }));
}

/**
 * A host's announcement and answer: the relay's port and protocol and its
 * open lobbies. `rooms` holds { code, host, players, gameVersion }.
 */
function gameMessage({ port, protocol, rooms }) {
  return Buffer.from(JSON.stringify({ m: MAGIC, v: LAN_VERSION, t: 'game', port, protocol, rooms }));
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * A packet as the message it carries, or null when it is not one of ours or
 * malformed. Strings are cut and numbers checked, since anyone on the network
 * can send to the port.
 */
function readMessage(buffer) {
  if (!buffer || buffer.length > MAX_PACKET_BYTES) return null;
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
  if (!data || data.m !== MAGIC || data.v !== LAN_VERSION) return null;
  if (data.t === 'ask') return { type: 'ask' };
  if (data.t !== 'game') return null;
  const port = Number(data.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Array.isArray(data.rooms)) return null;
  const rooms = data.rooms.slice(0, 20).flatMap((room) => {
    const code = text(room?.code, 12);
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return [];
    const players = Number(room.players);
    return [{
      code,
      host: text(room.host, 40),
      players: Number.isInteger(players) && players >= 0 && players <= 16 ? players : 0,
      gameVersion: text(room.gameVersion, 40),
    }];
  });
  return { type: 'game', port, protocol: Number(data.protocol) || 0, rooms };
}

/**
 * Order in which a guest tries a host's addresses: one in the subnet of a
 * local adapter first, then private ranges, then the rest (a VPN overlay
 * may hand out addresses outside the private ranges, which work but are slower).
 */
function addressRank(address, localAdapters = []) {
  const ip = toNumber(address);
  if (ip === null) return 3;
  for (const local of localAdapters) {
    const mine = toNumber(local.address);
    const mask = toNumber(local.netmask);
    if (mine !== null && mask !== null && ((ip & mask) >>> 0) === ((mine & mask) >>> 0)) return 0;
  }
  const [a, b] = address.split('.').map(Number);
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 1;
  return 2;
}

/**
 * The games found. A host with several adapters is heard on each of them;
 * that is one game with several addresses, keyed by its room code, best
 * address first. Pure; the scanner feeds it and reads it.
 */
function createGameList(forgetAfterMs = FORGET_AFTER_MS, localAdapters = () => []) {
  const relays = new Map();
  return {
    /** A 'game' message from `address` at `now`; true when the list changed */
    heard(address, message, now) {
      const key = `${address}:${message.port}`;
      const before = JSON.stringify(relays.get(key)?.message ?? null);
      relays.set(key, { address, message, at: now });
      return before !== JSON.stringify(message);
    },
    /** Forget relays not heard of for a while; true when the list changed */
    expire(now) {
      let changed = false;
      for (const [key, relay] of relays) {
        if (now - relay.at <= forgetAfterMs) continue;
        relays.delete(key);
        changed = true;
      }
      return changed;
    },
    /** One entry per room with its addresses (`address` is the best), sorted by host name */
    games() {
      const locals = localAdapters();
      const byCode = new Map();
      for (const { address, message } of relays.values()) {
        for (const room of message.rooms) {
          const game = byCode.get(room.code) ?? { ...room, protocol: message.protocol, endpoints: [] };
          game.endpoints.push({ address, port: message.port });
          byCode.set(room.code, game);
        }
      }
      return [...byCode.values()]
        .map(({ endpoints, ...game }) => {
          endpoints.sort((a, b) => addressRank(a.address, locals) - addressRank(b.address, locals) || a.address.localeCompare(b.address));
          return { ...game, address: endpoints[0].address, port: endpoints[0].port, endpoints };
        })
        .sort((a, b) => a.host.localeCompare(b.host) || a.code.localeCompare(b.code));
    },
  };
}

/** A socket that ignores its own errors after reporting the first one; a dead adapter must not stop the rest. */
function quietSocket(log, label) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let reported = false;
  socket.on('error', (error) => {
    if (!reported) log?.(`[lan] ${label}: ${error.code ?? error.message}`);
    reported = true;
  });
  return socket;
}

/** Close a socket that may be closed already (an adapter that went away) */
function closeQuietly(socket) {
  try {
    socket.close();
  } catch {
    /* not running any more */
  }
}

/**
 * One socket per adapter, bound to its address, for sending and for the
 * answers that come back to it. Rebuilt when the adapters change.
 */
function createAdapterSockets({ log, onMessage, listAdapters = lanAdapters }) {
  let sockets = new Map();
  let signature = '';

  const refresh = () => {
    const adapters = listAdapters();
    const next = adapters.map((a) => `${a.name}/${a.address}/${a.broadcast}`).join(',');
    if (next === signature) return;
    signature = next;
    for (const { socket } of sockets.values()) closeQuietly(socket);
    sockets = new Map();
    for (const adapter of adapters) {
      const socket = quietSocket(log, `adapter ${adapter.name} ${adapter.address}`);
      socket.on('message', (buffer, remote) => onMessage(buffer, remote));
      const entry = { adapter, socket, ready: false };
      socket.bind(0, adapter.address, () => {
        try {
          socket.setBroadcast(true);
          socket.setMulticastTTL(1);
          socket.setMulticastInterface(adapter.address);
        } catch {
          /* some adapters refuse multicast; broadcast still goes */
        }
        entry.ready = true;
      });
      sockets.set(adapter.address, entry);
    }
    log?.(`[lan] adapters: ${adapters.map((a) => `${a.name} ${a.address}`).join(', ') || 'none'}`);
  };

  return {
    refresh,
    /** Send `buffer` to every target of every adapter, and to `extra` addresses */
    sendAll(buffer, port, extra = []) {
      refresh();
      for (const { adapter, socket, ready } of sockets.values()) {
        if (!ready) continue;
        for (const target of [...targetsFor(adapter), ...extra]) {
          socket.send(buffer, port, target, () => undefined);
        }
      }
    },
    close() {
      for (const { socket } of sockets.values()) closeQuietly(socket);
      sockets = new Map();
      signature = '';
    },
  };
}

/**
 * The socket on the discovery port itself: hears questions (host) or
 * announcements (guest), broadcast and multicast alike.
 */
function listenOnPort({ port, log, onMessage }) {
  const socket = quietSocket(log, `port ${port}`);
  socket.on('message', (buffer, remote) => onMessage(buffer, remote, socket));
  socket.bind(port, () => {
    socket.setBroadcast(true);
    for (const adapter of lanAdapters()) {
      try {
        socket.addMembership(MULTICAST_GROUP, adapter.address);
      } catch {
        /* no multicast on this adapter */
      }
    }
  });
  return socket;
}

/**
 * The host's side, run next to the relay. `describe()` gives what to announce
 * ({ port, protocol, rooms }); rooms that already started are left out by the
 * caller. Answers every question at once, to the address it came from.
 */
function createLanAnnouncer({ describe, log, port = DISCOVERY_PORT, everyMs = ANNOUNCE_EVERY_MS, listAdapters }) {
  const adapters = createAdapterSockets({ log, onMessage: () => undefined, listAdapters });
  const listener = listenOnPort({
    port,
    log,
    onMessage: (buffer, remote, socket) => {
      if (readMessage(buffer)?.type !== 'ask') return;
      socket.send(gameMessage(describe()), remote.port, remote.address, () => undefined);
    },
  });
  const announce = () => adapters.sendAll(gameMessage(describe()), port);
  announce();
  const timer = setInterval(announce, everyMs);
  return {
    announce,
    close() {
      clearInterval(timer);
      adapters.close();
      closeQuietly(listener);
    },
  };
}

/**
 * The guest's side: asks every second, listens for announcements, and calls
 * `onGames` with the list whenever it changes. `probe(ip)` also asks one
 * address directly, for the host IP field (D54): it goes through where
 * broadcast is blocked.
 */
function createLanScanner({ onGames, log, port = DISCOVERY_PORT, everyMs = ASK_EVERY_MS, now = Date.now, listAdapters }) {
  const list = createGameList(FORGET_AFTER_MS, listAdapters ?? lanAdapters);
  const heard = (buffer, remote) => {
    const message = readMessage(buffer);
    if (message?.type !== 'game') return;
    if (list.heard(remote.address, message, now())) onGames(list.games());
  };
  const adapters = createAdapterSockets({ log, onMessage: heard, listAdapters });
  const listener = listenOnPort({ port, log, onMessage: heard });
  const probes = new Set();
  const ask = () => {
    adapters.sendAll(askMessage(), port, [...probes]);
    if (list.expire(now())) onGames(list.games());
  };
  ask();
  const timer = setInterval(ask, everyMs);
  return {
    /** Ask `ip` directly from now on */
    probe(ip) {
      if (toNumber(ip) === null) return false;
      probes.add(ip);
      ask();
      return true;
    },
    /** A game learned another way (the relay's status page); `message` as readMessage gives it */
    add(address, message) {
      if (list.heard(address, message, now())) onGames(list.games());
    },
    games: () => list.games(),
    close() {
      clearInterval(timer);
      adapters.close();
      closeQuietly(listener);
    },
  };
}

module.exports = {
  ANNOUNCE_EVERY_MS,
  ASK_EVERY_MS,
  DISCOVERY_PORT,
  FORGET_AFTER_MS,
  MULTICAST_GROUP,
  addressRank,
  askMessage,
  broadcastAddress,
  createGameList,
  createLanAnnouncer,
  createLanScanner,
  gameMessage,
  lanAdapters,
  readMessage,
  targetsFor,
};
