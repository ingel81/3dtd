'use strict';

/**
 * Coop on the local network in the desktop app (docs/COOP_PLAN.md, C4d).
 *
 * The host's relay runs in a utility process, started at "Host LAN game" and
 * ended with the room or the app (D51). A guest's scanner asks the network for
 * games (lan-discovery.js). The page reaches both only through the channels
 * registered here, and only from the app's own origin.
 */

const os = require('node:os');
const { addressRank, createLanScanner, lanAdapters, readMessage } = require('./lan-discovery');

/** Ports a direct probe of the relay's status page tries, from the relay's first on */
const PROBE_PORTS = [3003, 3004, 3005];
/** How long a direct probe waits for the status page, ms */
const PROBE_TIMEOUT_MS = 1500;
/** How long the relay may take to listen, ms */
const RELAY_START_TIMEOUT_MS = 10_000;

/**
 * The relay's GET /status as the game message a LAN announcement carries, so
 * a game found by a direct probe lands in the same list. Null when the answer
 * is not a relay's.
 */
function gameFromStatus(status, port) {
  if (!status || typeof status !== 'object' || !Array.isArray(status.rooms)) return null;
  const rooms = status.rooms
    .filter((room) => room && !room.started && !room.locked)
    .map((room) => ({
      code: room.code,
      host: room.players?.find((p) => p.id === room.hostId)?.name ?? '',
      players: room.players?.length ?? 0,
      gameVersion: room.gameVersion ?? '',
    }));
  // Through readMessage, so the same checks hold as for a packet
  return readMessage(Buffer.from(JSON.stringify({ m: '3dtd-lan', v: 1, t: 'game', port, protocol: status.protocol, rooms })));
}

/** Adapters of virtual machines, WSL and VPNs: listed after the real network */
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|vpn|docker|tailscale|zerotier|hamachi|radmin|loopback/i;

/**
 * This machine's addresses for the host's dialog, adapter name and IPv4
 * address, the one guests most likely reach first: real adapters with a
 * private address, then other real ones, then virtual ones.
 */
function hostAddresses(interfaces = os.networkInterfaces()) {
  const rank = ({ name, address }) => (VIRTUAL_ADAPTER.test(name) ? 2 : addressRank(address) === 1 ? 0 : 1);
  return lanAdapters(interfaces)
    .map(({ name, address }) => ({ name, address }))
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * Registers the LAN channels on `ipcMain`. `isAppSender(event)` tells the
 * app's own page from anything else; `relayPath` is the bundled relay.
 */
function setUpCoopLan({ ipcMain, utilityProcess, relayPath, log, isAppSender, fetchImpl = fetch }) {
  let relay = null;
  let relayPort = null;
  let scanner = null;
  let scanTarget = null;

  const stopRelay = () => {
    if (!relay) return;
    relay.postMessage({ t: 'stop' });
    const child = relay;
    // Give it a moment to close its sockets, then end it for sure
    setTimeout(() => child.kill(), 1000);
    relay = null;
    relayPort = null;
  };

  const startRelay = () =>
    new Promise((resolve) => {
      if (relay && relayPort) {
        resolve({ port: relayPort });
        return;
      }
      const child = utilityProcess.fork(relayPath, [], { serviceName: '3DTD coop relay', stdio: 'ignore' });
      relay = child;
      const timer = setTimeout(() => resolve({ error: 'The coop server did not start in time.' }), RELAY_START_TIMEOUT_MS);
      child.on('message', (message) => {
        if (message?.t === 'log') log.info(`[coop relay] ${message.line}`);
        if (message?.t === 'listening') {
          clearTimeout(timer);
          relayPort = message.port;
          log.info(`[coop relay] listening on ${message.port}`);
          resolve({ port: message.port });
        }
        if (message?.t === 'failed') {
          clearTimeout(timer);
          log.warn(`[coop relay] could not start: ${message.error}`);
          resolve({ error: `The coop server could not start: ${message.error}` });
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (relay === child) {
          relay = null;
          relayPort = null;
        }
        log.info(`[coop relay] ended (${code})`);
        resolve({ error: 'The coop server stopped.' });
      });
    });

  const stopScan = () => {
    scanner?.close();
    scanner = null;
    scanTarget = null;
  };

  ipcMain.handle('desktop:lan-host', async (event) => {
    if (!isAppSender(event)) return { error: 'refused' };
    const started = await startRelay();
    return 'error' in started ? started : { port: started.port, addresses: hostAddresses() };
  });

  ipcMain.on('desktop:lan-stop', (event) => {
    if (isAppSender(event)) stopRelay();
  });

  const startScan = (sender) => {
    stopScan();
    scanTarget = sender;
    const target = scanTarget;
    scanner = createLanScanner({
      log: (line) => log.info(line),
      onGames: (games) => {
        if (!target.isDestroyed()) target.send('desktop:lan-games', games);
      },
    });
    target.once('destroyed', () => {
      if (scanTarget === target) stopScan();
    });
  };

  ipcMain.on('desktop:lan-scan', (event, on) => {
    if (!isAppSender(event)) return;
    if (on) startScan(event.sender);
    else stopScan();
  });

  // Another listener joined the running scan: it hears the list at once
  ipcMain.on('desktop:lan-games-again', (event) => {
    if (!isAppSender(event)) return;
    if (!scanner) startScan(event.sender);
    else if (!event.sender.isDestroyed()) event.sender.send('desktop:lan-games', scanner.games());
  });

  // The host IP field (D54): ask that address directly by UDP, and read its
  // relay's status page, which goes through where UDP does not
  ipcMain.handle('desktop:lan-probe', async (event, ip) => {
    if (!isAppSender(event)) return false;
    // Asked without a scan running (the list was closed meanwhile): start one for the answer
    if (!scanner) startScan(event.sender);
    if (!scanner.probe(String(ip ?? ''))) return false;
    const found = await Promise.all(PROBE_PORTS.map(async (port) => {
      try {
        const response = await fetchImpl(`http://${ip}:${port}/status`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        const game = gameFromStatus(await response.json(), port);
        if (!game) return false;
        scanner?.add(String(ip), game);
        return true;
      } catch {
        return false;
      }
    }));
    return found.some(Boolean);
  });

  return {
    /** End the relay and the scanner, when the app quits */
    close() {
      stopRelay();
      stopScan();
    },
  };
}

module.exports = { gameFromStatus, hostAddresses, setUpCoopLan };
