'use strict';

/**
 * The only bridge between the game and Electron. The page runs sandboxed with
 * context isolation; whatever it may know about the desktop build is listed
 * here and nowhere else: the update hint, and writing a run log to disk.
 */

const { contextBridge, ipcRenderer } = require('electron');

const VERSION_ARG = '--desktop-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));

// Registered before the page runs, so an update the main process reports
// while the page still loads is kept and handed to the first listener.
let readyUpdate = null;
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
  })
);
