'use strict';

/**
 * The only bridge between the game and Electron. The page runs sandboxed with
 * context isolation; whatever it may know about the desktop build is listed
 * here and nowhere else: the update hint, writing a run log to disk, and
 * coop on the local network.
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
  })
);
