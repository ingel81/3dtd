'use strict';

/**
 * The only bridge between the game and Electron. The page runs sandboxed with
 * context isolation; whatever it may know about the desktop build is listed
 * here and nowhere else: the update hint, writing a run log to disk, coop
 * on the local network, the map folder and AI agents in the map editor.
 */

const { contextBridge, ipcRenderer } = require('electron');

const VERSION_ARG = '--desktop-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));

// Registered before the page runs, so an update the main process reports
// while the page still loads is kept and handed to the first listener.
let readyUpdate = null;
/** Listeners of coopLan.scan; the main process scans while there is one */
let scanListeners = 0;
const listeners = new Set();
ipcRenderer.on('desktop:update-ready', (_event, update) => {
  readyUpdate = { version: String(update?.version ?? ''), notes: String(update?.notes ?? '') };
  for (const listener of listeners) listener(readyUpdate);
});

// A double-clicked map (desktop:open-map) is kept until the page listens for it
let openedMap = null;
const mapListeners = new Set();
ipcRenderer.on('desktop:open-map', (_event, name) => {
  openedMap = String(name ?? '');
  for (const listener of mapListeners) listener(openedMap);
  if (mapListeners.size) openedMap = null;
});

/** An answer as plain data: text, an optional picture, the error flag; anything else is no answer */
function plainAgentAnswer(answer) {
  if (!answer || typeof answer !== 'object' || typeof answer.text !== 'string') return { text: 'The editor gave no answer', isError: true };
  const plain = { text: answer.text, isError: answer.isError === true };
  const image = answer.image;
  if (image && typeof image === 'object' && typeof image.data === 'string') plain.image = { mimeType: String(image.mimeType || 'image/jpeg'), data: image.data };
  return plain;
}

// An AI agent's tool call (desktop:agent-call, docs/AGENT_MCP.md): the open editor answers it
// through `reply`, without one the answer says so; either way the main process hears back once
// under the call's id. What the handler returns is not waited on: a page promise that is not the
// native one (zone.js patches it) crosses the context bridge as a plain object without `then`, and
// the answer was lost (empty text for every tool, 2026-10-15)
let agentHandler = null;
ipcRenderer.on('desktop:agent-call', (_event, call) => {
  let replied = false;
  const reply = (answer) => {
    if (replied) return;
    replied = true;
    ipcRenderer.send('desktop:agent-reply', { id: call?.id, answer: plainAgentAnswer(answer) });
  };
  if (!agentHandler) {
    reply({ text: 'The map editor is not open. Ask the player to open a map in the editor (main menu, Map editor).', isError: true });
    return;
  }
  try {
    agentHandler({ tool: String(call?.tool ?? ''), args: call?.args && typeof call.args === 'object' ? call.args : {} }, reply);
  } catch (error) {
    reply({ text: String(error?.message ?? error), isError: true });
  }
});

// The agent's status as the main process pushes it (who connected, what runs, Stop): kept for the next listener
let agentStatus = null;
const statusListeners = new Set();
ipcRenderer.on('desktop:agent-status-changed', (_event, status) => {
  agentStatus = status && typeof status === 'object' ? status : null;
  if (agentStatus) for (const listener of statusListeners) listener(agentStatus);
});

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    version: versionArg ? versionArg.slice(VERSION_ARG.length) : '',

    /** Calls `listener` with { version } once an update is downloaded; returns an unsubscribe. */
    onUpdateReady(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      if (readyUpdate) listener(readyUpdate);
      return () => listeners.delete(listener);
    },

    /** Quit now and install the downloaded update; the app starts again afterwards. */
    installUpdateNow() {
      ipcRenderer.send('desktop:install-update');
    },

    /**
     * Write a run log next to the app's own logs (`userData/runs`). The page
     * hands over the file name and the JSONL text; the main process decides
     * where it lands, so the page never learns a path
     * (docs/RUN_LOG.md).
     *
     * Returns true when the file was written.
     */
    saveRun(fileName, text) {
      if (typeof fileName !== 'string' || typeof text !== 'string') return Promise.resolve(false);
      return ipcRenderer.invoke('desktop:save-run', { fileName, text });
    },

    /**
     * Coop on the local network (docs/COOP_PLAN.md, C4d). The relay runs in
     * the app only while hosting; the scan reports the games it hears of.
     */
    coopLan: Object.freeze({
      /** Start this machine's relay: { port, addresses: [{ name, address }] } or { error } */
      host() {
        return ipcRenderer.invoke('desktop:lan-host');
      },
      /** End this machine's relay */
      stop() {
        ipcRenderer.send('desktop:lan-stop');
      },
      /**
       * Look for games until the returned function is called; `listener`
       * gets the whole list whenever it changes. One scan at a time.
       */
      scan(listener) {
        if (typeof listener !== 'function') return () => {};
        const forward = (_event, games) => listener(Array.isArray(games) ? games : []);
        ipcRenderer.on('desktop:lan-games', forward);
        // One scan in the main process for every listener: it ends with the last one
        if (scanListeners++ === 0) ipcRenderer.send('desktop:lan-scan', true);
        else ipcRenderer.send('desktop:lan-games-again');
        let stopped = false;
        return () => {
          if (stopped) return;
          stopped = true;
          ipcRenderer.removeListener('desktop:lan-games', forward);
          if (--scanListeners === 0) ipcRenderer.send('desktop:lan-scan', false);
        };
      },
      /** Ask one address directly, during a scan; resolves true when its relay answered */
      probe(ip) {
        return ipcRenderer.invoke('desktop:lan-probe', String(ip ?? ''));
      },
    }),

    /**
     * The player's map folder (Documents/3DTD/Maps): own maps as .3dtdmap
     * files by name; the main process keeps every name inside the folder.
     */
    maps: Object.freeze({
      /** [{ name, size, mtime }] */
      list() {
        return ipcRenderer.invoke('desktop:maps-list');
      },
      /** The file's bytes, or null */
      read(name) {
        return ipcRenderer.invoke('desktop:maps-read', String(name ?? ''));
      },
      /** { mtime } once written, or null */
      write(name, bytes) {
        if (!(bytes instanceof Uint8Array)) return Promise.resolve(null);
        return ipcRenderer.invoke('desktop:maps-write', { name: String(name ?? ''), bytes });
      },
      /** True when the file is gone */
      remove(name) {
        return ipcRenderer.invoke('desktop:maps-remove', String(name ?? ''));
      },
      /** Shows the folder in the system's file manager */
      reveal() {
        ipcRenderer.send('desktop:maps-reveal');
      },
      /** Calls `listener` with the file name of a double-clicked map (at once for one that came before); returns an unsubscribe */
      onOpen(listener) {
        if (typeof listener !== 'function') return () => {};
        mapListeners.add(listener);
        if (openedMap) {
          listener(openedMap);
          openedMap = null;
        }
        return () => mapListeners.delete(listener);
      },
    }),

    /** AI agents editing maps over MCP (docs/AGENT_MCP.md), off until the player allows it */
    agent: Object.freeze({
      /**
       * The open editor answers the agent's calls: `handler(call, reply)` calls `reply(answer)` once
       * with plain data; what it returns is ignored. Returns an unsubscribe. One handler at a time
       */
      onCall(handler) {
        if (typeof handler !== 'function') return () => {};
        agentHandler = handler;
        return () => {
          if (agentHandler === handler) agentHandler = null;
        };
      },
      /** { enabled, url, error?, held, client, current, last } */
      status() {
        return ipcRenderer.invoke('desktop:agent-status');
      },
      /** The settings switch; resolves the new status */
      setEnabled(on) {
        return ipcRenderer.invoke('desktop:agent-set-enabled', on === true);
      },
      /** Calls `listener` with the status at once and on every change; returns an unsubscribe */
      onStatus(listener) {
        if (typeof listener !== 'function') return () => {};
        statusListeners.add(listener);
        if (agentStatus) listener(agentStatus);
        else void ipcRenderer.invoke('desktop:agent-status').then((status) => status && statusListeners.has(listener) && listener(agentStatus ?? status));
        return () => statusListeners.delete(listener);
      },
      /** Stop: the call running now ends, every call after is refused; resolves the new status */
      stop() {
        return ipcRenderer.invoke('desktop:agent-stop');
      },
      /** The agent may go on; resolves the new status */
      resume() {
        return ipcRenderer.invoke('desktop:agent-resume');
      },
    }),

    /** The window's fullscreen as F11 switches it (game menu, TODO A3); resolves the new state */
    toggleFullscreen() {
      return ipcRenderer.invoke('desktop:toggle-fullscreen');
    },

    /** Whether the window is fullscreen */
    isFullscreen() {
      return ipcRenderer.invoke('desktop:is-fullscreen');
    },

    /** Quit the app; a downloaded update installs on the way out */
    quit() {
      ipcRenderer.send('desktop:quit');
    },
  })
);
